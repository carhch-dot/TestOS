---
title: 'Logout'
type: 'feature'
created: '2026-09-12'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
baseline_commit: '556e296aef4fda1b4b435cf96faa698dd6bbefff'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.2 issues refresh tokens but nothing lets a user invalidate one — a logged-in session can never be explicitly ended (FR3, NFR1: sessions must be revocable explicitly, not just left to expire).

**Approach:** Add `POST /auth/logout` accepting `{ refreshToken }` in the body. Hash it the same way `RefreshTokenService.issue` does (SHA-256) and mark the matching `RefreshToken` row `revoked: true`. The endpoint is idempotent and always responds success (`204`) — whether the token existed, was already revoked, or never matched anything — so it never reveals whether a given token is/was valid (same "never leak account/token state" posture as Story 1.2's login). No auth guard on this endpoint: possession of the refresh token itself is what's being invalidated, matching how `POST /auth/login` and the planned Story 1.5 renewal endpoint work — none of Epic 1's endpoints have RBAC guard infrastructure yet (deferred, per Story 1.2's Boundaries, to whichever story first needs to protect a route by *role*, which logout does not).

</frozen-after-approval>

## Implementation Notes

- `RefreshTokenService.issue`'s inline SHA-256 hashing was extracted into a private `hash()` helper, now shared with the new `revoke()` method — both need the exact same hash to look up/write the same rows.
- `revoke()` uses `prisma.refreshToken.updateMany` (not `update`), which does not throw when zero rows match — needed for the idempotent, non-revealing behavior the Intent requires (an `update` on a non-existent unique key throws `P2025`, which would have to be caught anyway; `updateMany` sidesteps that entirely).
- `LogoutController` never distinguishes "revoked", "already revoked", "unknown token", or "no token given" — all four resolve to the same `204 No Content` with no body, exactly like `LoginService`'s unified failure response in Story 1.2.
- Files: `apps/api/src/auth/refresh-token.service.ts` (added `revoke()` + `hash()`), `apps/api/src/auth/logout.controller.ts` (new), `apps/api/src/auth/auth.module.ts` (registered `LogoutController`), plus `refresh-token.service.spec.ts` (added `revoke` tests) and `logout.controller.spec.ts` (new). No schema/migration change — `RefreshToken.revoked` already existed from Story 1.2.
- Verified end-to-end against a real ephemeral Postgres: login → logout returns `204` and the matching row flips to `revoked: true`; a second logout with the same token, a logout with an unknown token, and a logout with a missing `refreshToken` field all also return `204` with an empty body, confirming the idempotent/non-revealing behavior. Full suite independently re-run: 8 suites / 36 tests pass; lint clean after auto-fix (2 pure formatting fixes, no logic changes).
- Review round (blind-hunter): added a `MAX_REFRESH_TOKEN_LENGTH` cap (512 chars, mirrors `LoginController`'s length guards) and 6 new test cases (non-string variants, oversized token, missing body). Final: 8 suites / 42 tests pass, lint clean.

## Review Triage Log

- **No upper bound on `refreshToken` length before hashing** — `low` — Verified true; trivial one-line extension of the existing guard, mirroring `LoginController`'s pattern. → **patch**
- **No test for non-string `refreshToken` (number/null/object/array)** — `low` — Verified true; the `typeof === 'string'` guard exists but those branches were unverified. → **patch**
- **No test for a missing/undefined request body** — `low` — Verified true; `body?.refreshToken` optional chaining assumes this case but nothing exercised it. → **patch**
- **No cleanup/expiry job for revoked or expired `RefreshToken` rows** — `low` — Real (table grows unboundedly), but raised for the second time now (also seen in Story 1.2's review) with no user-deletion feature yet to make it concrete, and a cleanup job is more than this story's scope. → **defer**
- **No automated e2e/HTTP-level test asserting the `204` status code and actual routing** — `low` — Verified true, but this repo has no e2e test infrastructure at all (removed deliberately in Story 1.1's review round); adding it now is a large, unrelated scope expansion for a small story. → rejected
- **No rate limiting on the endpoint** — `low` — Real but systemic (spans every endpoint, not just logout); no throttling dependency exists anywhere in the app yet, and the 256-bit token space makes brute-forcing the token itself impractical regardless. Fix is far more than a direct correction. → rejected
- **No Swagger/OpenAPI documentation** — `low` — Real, but no `@nestjs/swagger` dependency or pattern exists anywhere in the repo, and no FR/AC asks for generated API docs. → rejected

