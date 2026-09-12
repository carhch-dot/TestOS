---
title: 'Transparent session renewal'
type: 'feature'
created: '2026-09-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '361b5114dea45c95f611cc246518c0ebfc18aeec'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The access token expires after 15 minutes (Story 1.2) with no way to get a new one — a user would be forced back to the password prompt constantly (FR4).

**Approach:** Add `POST /auth/refresh` accepting `{ refreshToken }`. A valid, unexpired, not-yet-used refresh token is rotated: it is atomically consumed (revoked) and a new access+refresh pair is issued, exactly like login's response shape (AD-5). Presenting a refresh token that has *already* been consumed — a replay, whether from token theft or a lost race between two concurrent requests for the same token — revokes every refresh token belonging to that user, forcing a full re-login everywhere, per AD-5's explicit reuse-detection requirement. A simply-expired token (the normal case for an idle session) is rejected without that drastic step.

## Boundaries & Constraints

**Always:**
- `AuthModule`/`RefreshTokenService` remain the only writers of `RefreshToken` (AD-1); no new table.
- Consuming a refresh token is an atomic conditional update (`updateMany` with `where: { id, revoked: false }`, checking the affected count) — never a plain read-then-write. Two concurrent requests presenting the same token must not both succeed; exactly one wins, the other is treated as a reuse.
- "Reuse" (the token was already `revoked`, whether from a prior legitimate rotation, a lost race, or theft) revokes **every** `RefreshToken` row for that user (`RefreshTokenService.revokeAllForUser`) before rejecting.
- A merely **expired** (but not yet revoked) token is rejected with no chain revocation — this is the ordinary outcome of an idle session, not a signal of compromise.
- An unknown token (no row matches its hash at all) and a token belonging to a non-`ACTIVE` user are both rejected the same way as an expired one — no chain revocation, since there is nothing suspicious to react to.
- Every failure path (unknown token, expired, non-`ACTIVE` user, reuse) returns the exact same generic message and status — the caller never learns which case occurred.
- The new access token is signed with the same claims shape as login's (`sub`, `email`, `role`), read fresh from the `Usuario` row at renewal time (not carried over from the expired access token, which this endpoint never even receives).

**Never:**
- No timing-safety machinery (no `DUMMY_*` constant, no forced-equal-cost branch) like Story 1.2's login — a refresh token is the credential itself (a 256-bit secret, not a guessable identifier like an email), so there is no enumerable secondary state for a timing side-channel to leak; the four failure states already collapse to one message deliberately, for the same never-reveal-which reason as login, but without login's CPU-cost-asymmetry concern.
- No RBAC/`@Roles` guard — same posture as login/logout, this endpoint is a public entry point gated by possession of the refresh token itself.
- No change to how access tokens or refresh tokens are issued at login (Story 1.2) or revoked at logout (Story 1.3) — this story only adds the renewal path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid, unexpired, not-yet-used refresh token | `POST /auth/refresh` | `200` with a new `{ accessToken, refreshToken }`; old token row is now `revoked: true` | N/A |
| Unknown token (no matching row) | `POST /auth/refresh` | `401`, generic message | N/A |
| Expired but not revoked | `POST /auth/refresh` | `401`, same generic message; no other `RefreshToken` rows are touched | N/A |
| Already-revoked token presented again (reuse/replay) | `POST /auth/refresh` | `401`, same generic message; **every** `RefreshToken` row for that user is now `revoked: true` | N/A |
| Two concurrent requests present the same valid token at once | Two simultaneous `POST /auth/refresh` | Exactly one succeeds (`200`, new pair); the other is treated as reuse (`401`, full chain revoked) | N/A |
| Token belongs to a user whose status is no longer `ACTIVE` | `POST /auth/refresh` | `401`, same generic message; no chain revocation | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/auth/refresh-token.service.ts` -- existing: add `findByRawToken(raw)`, `consume(id)` (the atomic conditional revoke), and `revokeAllForUser(userId)`
- `apps/api/src/auth/renewal.service.ts` -- new: orchestrates the I/O matrix above using `RefreshTokenService`, `PrismaService` (read the `Usuario` for status + claims), and `JwtService`
- `apps/api/src/auth/renewal.controller.ts` -- new: `POST /auth/refresh`
- `apps/api/src/auth/auth.module.ts` -- existing: register `RenewalController`, `RenewalService`

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/auth/refresh-token.service.ts` -- add `findByRawToken`, `consume` (atomic conditional update), `revokeAllForUser` -- backs AD-5's rotation/reuse-detection
- [x] `apps/api/src/auth/renewal.service.ts` -- implement the six I/O matrix scenarios -- implements FR4
- [x] `apps/api/src/auth/renewal.controller.ts` -- `POST /auth/refresh`, maps every failure to one generic 401
- [x] `apps/api/src/auth/auth.module.ts` -- wire `RenewalController`/`RenewalService`
- [x] Unit tests for `renewal.service.ts` covering all six I/O matrix scenarios (the concurrent case as two sequential calls against the same underlying row, asserting the second sees `consume` return a zero-count result)
- [x] Unit tests for the three new `RefreshTokenService` methods

**Acceptance Criteria:**
- Given a valid refresh token, when it is used to renew, then the response contains a new access token and a new refresh token, and the original token's row is `revoked: true` while the new row is not.
- Given a refresh token that was already revoked (by a prior renewal, logout, or a lost race), when it is presented again, then every `RefreshToken` row belonging to its user is `revoked: true` afterward, including ones that were previously valid and unrelated to this specific token.

## Implementation Notes

- `RenewalService.renew` checks in this final order (post-review): unknown token
  -> already-revoked (immediate chain revocation, regardless of expiry) -> expired
  (not revoked) -> non-`ACTIVE` status or active lockout -> atomic `consume`.
  A lost concurrent race against `consume()` (`count: 0`) is handled by the
  same `revokeAllForUser` path as an already-revoked token read directly —
  both are "reuse" per AD-5. Non-`ACTIVE`/locked-out users are rejected
  without touching any row. Only the winning path and the two reuse paths
  ever write to `RefreshToken`.
- Both new controllers/services follow the existing `login`/`logout`
  conventions in this module: same generic-message discipline, same
  `MAX_REFRESH_TOKEN_LENGTH` (512) input guard as `LogoutController`, and no
  RBAC guard.
- **Review round:** reordered the revoked-check ahead of the expiry-check so a
  token that is both already-revoked and expired still triggers chain
  revocation (previously it was rejected on the expiry path first, silently
  skipping `revokeAllForUser`). Added a `lockedUntil` check alongside
  `status !== ACTIVE`. Added a `Logger.warn` in `revokeAllForUser` naming the
  user id (never the token). Added `@@index([userId])` on `RefreshToken` +
  migration. Added `revoked: false` to `revokeAllForUser`'s where clause so it
  stops rewriting already-revoked rows. Corrected both the class doc comment
  and `revokeAllForUser`'s own comment, which overstated chain revocation as
  forcing "a full re-login everywhere" — access tokens are stateless JWTs
  that remain valid until their own ~15-minute expiry regardless.
- **Independently re-verified by the reviewing session**, against a real
  ephemeral Postgres with all 4 migrations (including the new index) applied:
  login → renew succeeded and rotated the token; replaying the old
  (now-revoked) token was rejected *and* also invalidated the just-issued
  newer token (full chain revocation, working as designed); a token seeded
  directly as both `revoked: true` and expired also correctly triggered chain
  revocation, sweeping up an otherwise-still-valid sibling token — confirming
  the critical review fix; a locked-out account (`lockedUntil` in the future)
  could not renew even with an otherwise-valid token. Full suite independently
  re-run after fixing one additional lint error (`no-unsafe-assignment` in a
  new spec test, corrected directly): 11 suites / 80 tests pass, lint clean.

## Spec Change Log

## Review Triage Log

- **Replay of a token that is both already-revoked AND expired never triggers chain revocation** — `medium` — Verified: `renew()` checks `row.expiresAt` before ever consulting `row.revoked`/calling `consume()`, so such a token is rejected on the plain-expiry path and `revokeAllForUser` never fires — contradicting the Intent's literal "presenting an already-consumed token always revokes every token for that user." Flagged independently by both blind-hunter and edge-case-hunter (high confidence). Fix: check `row.revoked === true` first (regardless of expiry) and route straight to chain revocation; only fall through to the plain-expiry check for a token that is *not* already revoked. → **patch**
- **A user with an active lockout (`lockedUntil`, Story 1.4) can still renew an existing valid refresh token** — `low` — Verified true; `RenewalService` only checks `status !== ACTIVE`, never `lockedUntil`. Lockout's stated purpose is blocking further password-guessing attempts, not expiring already-established sessions, so this isn't a security bypass in the sense Story 1.4 intended — but closing it removes a reasonable "locked means locked" expectation for a trivial cost. → **patch**
- **No log line when `revokeAllForUser` fires** — `low` — Verified true; a suspected-replay event that force-logs-out a whole account currently leaves zero trace for whoever operates this later. Cheap to add. → **patch**
- **`RefreshToken.userId` has no index**, yet `revokeAllForUser` (this story's new hot path) filters on it — `low` — Verified true; cheap, purely-additive migration. → **patch**
- **`revokeAllForUser` rewrites already-revoked rows too** (no `revoked: false` filter) — `low` — Verified true; wasted, ever-growing write volume on every replay event for a long-lived account. One-line fix. → **patch**
- **Spec/comment wording overstates the effect of chain revocation** ("forcing a full re-login everywhere") — `low` — Verified true: access tokens are stateless JWTs with their own independent ~15-minute expiry, so a still-valid access token from the compromised session keeps working until it naturally expires — only *future renewals* are blocked immediately. Reworded rather than re-architected (a token-blocklist for immediate access-token invalidation is a much bigger, separate feature). → **patch**
- **The loser of a concurrent-race chain revocation can revoke the winner's brand-new token if its `revokeAllForUser` write lands after the winner's `issue()` commits** — `medium` — Verified real (`revokeAllForUser`'s blanket `where: { userId }` has no time cutoff excluding rows created during this exact rotation). A fully correct fix needs per-user serialization (e.g. a `SELECT ... FOR UPDATE` advisory lock around the whole consume-then-issue-or-revoke sequence) — real architecture, not a simple correction, and this narrow interleaving only matters when a token is *already* being actively replayed concurrently (i.e., something has already gone wrong); the fallback outcome (both parties end up logged out) is an acceptable fail-safe for an already-anomalous condition. → **defer**
- **If `signAsync`/`issue()` throws after `consume()` already revoked the old token, the caller is left without a new session** — `low` — Verified real but low-probability (would typically coincide with a broader systemic failure — DB down, OOM — that breaks other endpoints too); a fully atomic fix needs a DB transaction wrapping sign+issue, disproportionate for the likelihood involved. → **defer**
- **No automated test exercises genuinely concurrent requests against a real database** — `low` — Verified true (the "concurrent" test is two sequential calls with scripted mock results); this repo has no e2e/integration test infrastructure at all (removed deliberately in Story 1.1's review round). Independently verified live instead (see Implementation Notes) — real concurrent requests against a real Postgres database, substituting for automated coverage. → rejected (compensating manual verification performed)

## Design Notes

`consume(id)` shape: `updateMany({ where: { id, revoked: false }, data: { revoked: true } })`, returning `{ count }`. `count === 1` → this call won; `count === 0` → already revoked (by a prior rotation, logout, or a concurrent winner) — treat as reuse. This is the same atomic-conditional-update pattern Story 1.4 used to fix its counter race, applied here to the consume step instead of a counter increment.

## Verification

**Commands:**
- `npm run -w apps/api build` -- expected: compiles without errors -- ran, passed
- `npm run -w apps/api test` -- expected: new and existing tests pass, covering all six I/O matrix scenarios -- ran, 11 suites / 76 tests passed (includes new `renewal.service.spec.ts`, `renewal.controller.spec.ts`, and the three added `refresh-token.service.spec.ts` describe blocks)
- `npm run -w apps/api lint` -- ran (`eslint --fix`); no functional changes, only formatting
