---
title: 'Password policy'
type: 'feature'
created: '2026-09-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '64a7d1d5de8e7ac49135d4a5a86fbfdbe2e1dd9f'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every password-setting flow built so far (bootstrap 1.1, activate 1.7, reset-confirm 1.6) accepts any non-empty password by explicit, documented design — each story deferred real enforcement to this one (FR11).

**Approach:** One shared helper (`enforcePasswordPolicy`) checks minimum length and non-reuse of the last `N=3` passwords, and is called from all three existing password-setting sites — `BootstrapService`, `InviteService.activate`, `PasswordResetService.confirmReset` — replacing their current bare non-empty checks. A new `Usuario.previousPasswordHashes` column (capped array, updated only when a *real* password replaces another) backs the reuse check. A violation throws a specific `BadRequestException` (distinct from each flow's existing generic-rejection message, which stays reserved for token/credential problems) so the caller sees which requirement failed, per the AC.

## Boundaries & Constraints

**Always:**
- `apps/api/src/common/password-policy.ts` exports `enforcePasswordPolicy(password, priorHashes)`: throws `BadRequestException` with a specific message on either length or reuse failure; no-op on success. `priorHashes` is `[]` for a brand-new account (bootstrap, or activate — see below) or `[currentHash, ...previousPasswordHashes]` for a real reset.
- Minimum length is configurable via `PASSWORD_MIN_LENGTH` (default 8), mirroring `LOGIN_LOCKOUT_*`'s existing env-var-with-default pattern.
- History depth is configurable via `PASSWORD_HISTORY_COUNT` (default 3, matching the epic's `[ASSUMPTION: 3]`).
- The policy check runs *after* each flow's existing token/credential validity checks and *before* the token is atomically consumed — a policy-rejected attempt never burns the token, so the caller can retry the same link with a better password. This applies to `confirmReset` and `activate`; `BootstrapService` has no token to protect, so the check simply runs before hashing.
- `BootstrapService` gains the same check (`priorHashes: []`) — a policy-failing `ADMIN_PASSWORD` fails application startup with a clear error, the same fail-fast posture it already uses for a missing `ADMIN_EMAIL`/`ADMIN_PASSWORD`. (Resolved Open Question: bootstrap is in scope.)
- Only `PasswordResetService.confirmReset` ever *replaces* an existing real password, so only it pushes the old `passwordHash` onto `previousPasswordHashes` (prepend, sliced to `PASSWORD_HISTORY_COUNT`) as part of the same `usuario.update` that sets the new hash. `InviteService.activate` sets a user's *first* real password (replacing the unusable placeholder, spec-1-7) and never pushes to history — there is no real prior password to protect against reuse of.
- Existing generic-rejection messages (`RESET_PASSWORD_FAILED_MESSAGE`, `ACTIVATE_FAILED_MESSAGE`) are unchanged and still used for every token/credential problem — only a policy violation on an otherwise-valid token gets the new specific `400`.

**Never:**
- No character-class requirements (uppercase/digit/symbol) — length and reuse only, matching the AC's literal "longitud/complejidad mínima" without inventing unrequested rules.
- No retroactive validation of already-stored passwords — the policy only gates new passwords going forward.
- `POST /users/:id/force-reset-password` (Story 1.10) is unaffected — it only triggers `requestReset`, never sets a password itself.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New password shorter than `PASSWORD_MIN_LENGTH`, via activate/reset-confirm | valid token + short password | `400`, message naming the length requirement; token remains unused | N/A |
| New password matches the account's current or one of its last `N` passwords, via reset-confirm | valid token + reused password | `400`, message naming the reuse rule; token remains unused | N/A |
| New password passes both checks, via activate/reset-confirm | valid token + strong new password | `200`; password set; for reset-confirm only, old hash pushed onto `previousPasswordHashes` (capped) | N/A |
| `ADMIN_PASSWORD` shorter than `PASSWORD_MIN_LENGTH` | app startup, empty `Usuario` table | Startup fails with a clear error; no admin created | N/A |
| Invalid/expired/already-used token, regardless of password strength | any token failure | Unchanged generic rejection (`401`) — policy is never evaluated | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/common/password-policy.ts` -- new: `enforcePasswordPolicy(password, priorHashes)`
- `apps/api/prisma/schema.prisma` -- existing: add `Usuario.previousPasswordHashes String[] @default([])`; new migration
- `apps/api/src/auth/bootstrap.service.ts` -- existing: call `enforcePasswordPolicy(password, [])` after the existing env-var checks
- `apps/api/src/auth/invite.service.ts` -- existing: `activate` calls `enforcePasswordPolicy(password, [usuario.passwordHash])` after the status re-check, before the atomic consume
- `apps/api/src/auth/password-reset.service.ts` -- existing: `confirmReset` fetches the target `Usuario`, calls `enforcePasswordPolicy(newPassword, [usuario.passwordHash, ...usuario.previousPasswordHashes])` before the atomic consume, and pushes the old hash onto `previousPasswordHashes` in the existing `usuario.update` call

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/common/password-policy.ts` -- `enforcePasswordPolicy` implementing the I/O matrix
- [x] `apps/api/prisma/schema.prisma` -- `previousPasswordHashes` column + migration
- [x] `apps/api/src/auth/bootstrap.service.ts` -- wire the check
- [x] `apps/api/src/auth/invite.service.ts` -- wire the check into `activate`
- [x] `apps/api/src/auth/password-reset.service.ts` -- wire the check + history push into `confirmReset`
- [x] Unit tests: `password-policy.ts`, and updated specs for all three call sites covering every I/O matrix row

**Acceptance Criteria:**
- Given a new password that fails the minimum length, when submitted via activation, reset, or bootstrap, then it is rejected with a message naming the unmet requirement.
- Given a new password matching one of the account's last `N` passwords, when submitted via reset, then it is rejected.
- Given a policy-rejected attempt against a still-valid token, when the same token is presented again with a compliant password, then it succeeds — the token was never consumed by the rejected attempt.

## Implementation Notes

`apps/api/src/common/password-policy.ts` exports `enforcePasswordPolicy(password, priorHashes)`: checks `password.length` against `PASSWORD_MIN_LENGTH` (env-var-with-default, mirroring `LOGIN_LOCKOUT_*`), then `argon2.verify`s `password` against each entry in `priorHashes` in turn, stopping at the first match. Throws `BadRequestException` with a length-specific or the exported `PASSWORD_REUSED_MESSAGE` on failure; resolves with no value on success.

`Usuario.previousPasswordHashes String[] @default([])` added to the schema (hand-written migration `20260914120000_add_previous_password_hashes`, confirmed to match `prisma migrate diff --from-empty` byte-for-byte, including that Prisma emits the array column *without* `NOT NULL`).

All three call sites were reordered so the policy check (and, for `activate`, the existing Usuario-status re-check) runs *before* the token is atomically consumed, not after — this was a real reordering, not just an addition, since the pre-existing `activate`/`confirmReset` code consumed the token first and validated state second:
- `BootstrapService.onApplicationBootstrap` -- calls `enforcePasswordPolicy(password, [])` right after the existing `ADMIN_EMAIL`/`ADMIN_PASSWORD` presence checks, before `argon2.hash`.
- `InviteService.activate` -- the Usuario fetch/status-recheck (previously done *after* the atomic `updateMany` consume) now happens *before* it, immediately followed by `enforcePasswordPolicy(password, [usuario.passwordHash])`, and only then the atomic consume. This also means a stale token against a non-`PENDING_VERIFICATION` Usuario no longer marks the token used either (a behavior change implied by the Code Map's ordering, not just a side effect).
- `PasswordResetService.confirmReset` -- now fetches the target `Usuario` (previously not fetched at all before the `usuario.update` call) before the atomic consume, calls `enforcePasswordPolicy(newPassword, [usuario.passwordHash, ...usuario.previousPasswordHashes])`, and — only in the final `usuario.update` — prepends the old `passwordHash` onto `previousPasswordHashes`, sliced to `PASSWORD_HISTORY_COUNT` (new env-var-with-default, defined in this file). A defensive `if (!usuario) return false` guards the (currently unreachable, since no delete-user feature exists) case of a reset token pointing at a since-deleted user.

Tests: new `apps/api/src/common/password-policy.spec.ts` covers every I/O matrix row plus both env-var overrides and the length-before-reuse ordering. `bootstrap.service.spec.ts` gained the ADMIN_PASSWORD-fails-policy case. `invite.service.spec.ts` and `password-reset.service.spec.ts` each gained: a too-short-password case, a token-remains-usable-after-policy-rejection retry case, and (reset only) two reuse cases plus history-capping cases; their `makeUsuario()` helpers now produce a real `argon2` hash (via `beforeAll`) instead of a literal placeholder string, since `enforcePasswordPolicy`'s reuse check now runs `argon2.verify` against every mocked `Usuario` and argon2 throws on a malformed hash rather than returning `false`. The pre-existing concurrent-race tests for `activate`/`confirmReset` now also mock the `Usuario` fetch (previously unmocked, which accidentally still passed for the wrong reason once the fetch moved earlier).

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | The new `400` (policy violation) vs `401` (token problem) split is a binary oracle for "is this token currently valid" — directly contradicts Story 1.6's frozen boundary that token/credential/malformed-input cases "must all be indistinguishable to the caller" (blind-hunter) | medium | Verified — genuine tension between 1.6's boundary and 1.11's own AC (informative policy-violation messages necessarily differ from the generic rejection). Practical exploitability is low: the oracle only has value to someone who already possesses a candidate 256-bit token, at which point submitting a *compliant* password achieves full takeover directly — the oracle adds no capability a valid-token holder doesn't already have. |
| 2 | Because a policy-rejected attempt never burns the token (by design, for retryability) and no rate limiting exists anywhere, an attacker holding one valid token can force unlimited `argon2.verify` calls (up to `PASSWORD_HISTORY_COUNT + 1` per request) with no throttle (blind-hunter) | medium | Verified — real new cost-multiplier, but extends the already-accepted systemic no-rate-limiting gap (spec-1-4/1-6/1-10 entries) rather than introducing a new vulnerability class. |
| 3 | Two valid reset tokens for the same user, confirmed concurrently (`requestReset` doesn't invalidate prior unused tokens, unlike invite's resend), can race past `confirmReset`'s non-atomic `findUnique`→policy-check→`update` sequence and corrupt `previousPasswordHashes`; `activate` has a narrower analogous window between its status re-check and final update (blind-hunter, edge-case-hunter) | medium | Verified — incremental worsening (history corruption, not just which password wins) of a pre-existing gap: `requestReset`'s lack of sibling-invalidation is unchanged by this diff, and no `$transaction` exists anywhere in this codebase (same class already logged repeatedly). |
| 4 | `getHistoryCount()` has no test for an invalid `PASSWORD_HISTORY_COUNT` env var falling back to the default, unlike the analogous (and tested) `getPasswordMinLength()` (blind-hunter) | low | Verified — real, trivial test-coverage gap. |
| 5 | No controller-level test confirms a `BadRequestException` thrown by `activate`/`confirmReset` actually propagates as `400`, not swallowed or reinterpreted (blind-hunter) | low | Verified — `invite.controller.spec.ts`/`password-reset.controller.spec.ts` are untouched by this diff. Standard NestJS behavior (no exception filters exist), but cheap to pin as a regression guard, matching this epic's established pattern of testing dispatch/error-propagation at the controller layer. |
| 6 | A password consisting only of whitespace (e.g. 8 spaces) passes the raw-length check (edge-case-hunter) | low | Verified — `enforcePasswordPolicy` measures `password.length`, not a trimmed length. |
| 7 | No upper bound on `PASSWORD_MIN_LENGTH`/`PASSWORD_HISTORY_COUNT`; a misconfigured `PASSWORD_MIN_LENGTH` at or above the controllers' hardcoded `MAX_PASSWORD_LENGTH = 1024` would make every submission fail (blind-hunter, edge-case-hunter) | low | Verified — self-inflicted operator misconfiguration; matches this codebase's existing pattern of not upper-bounding configurable env vars (`LOGIN_LOCKOUT_*`, `INVITATION_TOKEN_TTL_DAYS` are equally unbounded). |
| 8 | `confirmReset`'s new `Usuario` fetch checks only `!usuario`, never `status === ACTIVE`, before resetting a password (edge-case-hunter) | low | Pre-existing, not introduced by this diff (confirmed by verification-gap layer) — `confirmReset` never checked target status even before 1.11. Bounded impact: `status` itself is never touched by `confirmReset`, so a deactivated target stays unable to log in regardless (`LoginService` independently gates on `status === ACTIVE`). |
| 9 | Duplicated "parse a positive-integer env var with a default" logic across `getPasswordMinLength`/`getHistoryCount`/`LOGIN_LOCKOUT_*`/`INVITATION_TOKEN_TTL_DAYS` (blind-hunter) | low (rejected) | Matches an already-repeated pattern across 4+ existing call sites in this codebase, not a regression introduced by this story specifically — a shared-helper refactor is a cross-cutting cleanup beyond this story's scope. |
| 10 | `PASSWORD_HISTORY_COUNT=0` can't disable the reuse check — falls back to the default instead (edge-case-hunter) | low (rejected) | No requirement anywhere asks for a way to disable the check; matches `LOGIN_LOCKOUT_MAX_ATTEMPTS`'s identical `> 0` fallback behavior. |
| 11 | Minor timing side-channel in `enforcePasswordPolicy`'s early-exit reuse loop — latency roughly correlates with how far into history a match occurred (blind-hunter) | low (rejected) | Negligible signal value (attacker must already know a candidate plaintext password to trigger a match at all); same already-accepted class of timing gap `login.service.ts` itself documents and accepts. |



## Design Notes

`previousPasswordHashes` is a plain `String[]` column on `Usuario`, not a separate table like `RefreshToken`/`PasswordResetToken`/`InvitationToken` — it's a small, bounded, per-user list with no independent lifecycle (no expiry, no individual lookup), so a dedicated table with its own model/index/migration would be disproportionate.

## Verification

**Commands:**
- `npx prisma generate` (in `apps/api`) -- expected: clean generate. Ran clean.
- `npx prisma migrate diff --from-empty --to-schema ./prisma/schema.prisma --script` -- expected: matches the hand-written migration (no live DB in this sandbox — same caveat as spec-1-2/1-6/1-7). Ran; output matches `20260914120000_add_previous_password_hashes/migration.sql` exactly (including that the array column has no `NOT NULL`, which the first hand-written draft got wrong and was corrected to match).
- `npm run -w apps/api build` -- expected: exit 0. Passed.
- `npm run -w apps/api test` -- expected: all suites pass, including new/updated specs. Passed: 22 suites, 264 tests, 0 failures.
