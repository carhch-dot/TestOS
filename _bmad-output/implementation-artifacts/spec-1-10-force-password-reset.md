---
title: 'Force password reset for another user'
type: 'feature'
created: '2026-09-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'dc345635bbbcd5aaa3732b14e556ac61a07daba2'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Manager/Administrator who wants to help a user regain access (forgotten password, suspected compromise) has no way to trigger a reset without knowing the user's current password — only the user themselves can start self-service recovery (Story 1.6).

**Approach:** `POST /users/:id/force-reset-password` (RBAC-protected: Manager or Administrator, same as invite/deactivate) looks up the target by id and, only when their status is `ACTIVE`, calls the existing `PasswordResetService.requestReset(email)` unchanged — the exact same token/email mechanism Story 1.6 built, not a parallel implementation (epic-1-context.md's explicit cross-story dependency). The target receives the identical reset email Story 1.6 sends and completes the flow the identical way, via the existing public `POST /auth/reset-password`.

## Boundaries & Constraints

**Always:**
- `POST /users/:id/force-reset-password` uses `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR)` — same pair as `/users/:id/deactivate`/`/reactivate` (Story 1.8), unlike Story 1.9's Administrator-only role change.
- `UsersService` gains a `forcePasswordReset(id)` method that calls `PasswordResetService.requestReset(usuario.email)` — `PasswordResetService`/`PasswordResetToken` are not modified in any way.
- Any Manager or Administrator may target any user regardless of that user's own role, including themselves — same uniform-capability precedent as Stories 1.7/1.8, and harmless here (no lockout or privilege-escalation risk the way self-deactivation/self-role-change had, so unlike those two, self-targeting is not blocked).
- Only an `ACTIVE` target receives the email — `PENDING_VERIFICATION`/`DEACTIVATED` targets get a clear conflict error instead of the self-service flow's silent no-op, matching this epic's established posture for authenticated admin actions (Stories 1.8/1.9 reject out-of-scope target states explicitly) rather than `forgot-password`'s anti-enumeration silence, which has no reason to apply to an authenticated caller who can already see the target's status via `GET /users`.
- No new revocation on this endpoint — forcing a reset only sends the email (identical to self-service `forgot-password`'s own behavior); session revocation already happens where it already happens, at the point the reset is actually confirmed (`PasswordResetService.confirmReset`, unchanged).

**Never:**
- No new `PasswordResetToken`-like table or parallel token mechanism — reuses Story 1.6's exactly as built.
- No audit-trail recording of who forced whose reset (Epic 2's job).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Manager/Administrator forces a reset for an `ACTIVE` target | `POST /users/:id/force-reset-password` | `200`; one `PasswordResetToken` row created for that user; reset email sent (best-effort), identical to `forgot-password`'s | Mail failure logged, response unaffected |
| Target is `PENDING_VERIFICATION` or `DEACTIVATED` | `POST /users/:id/force-reset-password` | `409`-class conflict; no token row created, no email sent | Clear error message |
| Unknown `id` | `POST /users/:id/force-reset-password` | `404` | Clear error message |
| Editor/Read-only, or unauthenticated caller, attempts to force a reset | `POST /users/:id/force-reset-password` | `403` (or `401` if unauthenticated); no state change | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/auth/users.controller.ts` -- existing (Story 1.8/1.9): add `POST /:id/force-reset-password`, guarded `@Roles(MANAGER, ADMINISTRATOR)`
- `apps/api/src/auth/users.service.ts` -- existing: add `forcePasswordReset(id)`, injecting `PasswordResetService`
- `apps/api/src/auth/password-reset.service.ts` -- existing, unchanged: `requestReset(email)` reused as-is
- `apps/api/src/auth/jwt-auth.guard.ts`, `roles.guard.ts`, `roles.decorator.ts` -- existing, reused unchanged (Story 1.7)

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/auth/users.service.ts` -- `forcePasswordReset(id)` implementing the I/O matrix
- [x] `apps/api/src/auth/users.controller.ts` -- `POST /:id/force-reset-password`, `@Roles(MANAGER, ADMINISTRATOR)`
- [x] Unit tests: `users.service.ts` (all I/O scenarios, incl. asserting delegation to `PasswordResetService.requestReset`), `users.controller.ts` (dispatch + RBAC rejection using the real guard chain, per Story 1.7/1.8/1.9's precedent)

**Acceptance Criteria:**
- Given a Manager or Administrator, when they force a reset for an `ACTIVE` user, then that user receives the same reset email/token flow as self-service recovery and can complete it via the existing `POST /auth/reset-password`.
- Given an Editor or Read-only caller, when they attempt to force a reset, then the request is rejected.
- Given a target that is `PENDING_VERIFICATION` or `DEACTIVATED`, when a Manager or Administrator forces a reset, then the request is rejected with a clear error and no email is sent.

## Implementation Notes

`UsersService` now injects `PasswordResetService` alongside the existing `PrismaService`/`RefreshTokenService` (both already registered as providers in `AuthModule`, so no module wiring changes were needed). `forcePasswordReset(id)` looks up the target, throws `NotFoundException(USER_NOT_FOUND_MESSAGE)` if missing, throws `ConflictException(FORCE_RESET_CONFLICT_MESSAGE)` for any non-`ACTIVE` status (`PENDING_VERIFICATION` or `DEACTIVATED`), otherwise calls `PasswordResetService.requestReset(usuario.email)` unchanged and returns the same `UserStatusResult` shape `deactivate`/`reactivate`/`changeRole` already return (id/email/role/status) -- no new response shape introduced. `PasswordResetToken`/`PasswordResetService` were not touched.

`UsersController.forcePasswordReset` adds `POST /:id/force-reset-password` guarded by `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(MANAGER, ADMINISTRATOR)`, same pair as `deactivate`/`reactivate`. Unlike `deactivate`/`changeRole`, there is no self-targeting guard -- per spec Boundaries, self-targeting is explicitly allowed since it carries no lockout/privilege-escalation risk.

Added export: `FORCE_RESET_CONFLICT_MESSAGE` (in `users.service.ts`).

Tests: `users.service.spec.ts` gained a `forcePasswordReset` describe block covering the ACTIVE-delegates-to-requestReset case, the no-Usuario-mutation assertion, PENDING_VERIFICATION and DEACTIVATED conflicts, the currently-LOCKED-but-still-ACTIVE case, and unknown-id 404. `users.controller.spec.ts` gained a `forcePasswordReset (dispatch)` describe block (delegation, self-targeting allowed, error propagation) and the route was folded into the existing `MANAGER_OR_ADMIN_ROUTES` table (renamed from `THREE_ROUTES`) so it's covered by both the overridden-guard RBAC-rejection tests (401/403) and the real-guard-chain test (Manager/Administrator succeed, Editor/Read-only get 403).

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | `forcePasswordReset`'s own status check and `PasswordResetService.requestReset`'s internal re-check race: if the target's status flips between the two, `requestReset` silently no-ops (no token, no email) but `forcePasswordReset` still returns `200` using the stale pre-fetched `usuario`, misleading the caller into thinking it worked (blind-hunter, edge-case-hunter) | low | Real but narrow — requires a concurrent admin action changing the same user's status in the exact window between two back-to-back DB reads. A proper fix needs either a transaction (same pre-existing no-`$transaction`-anywhere pattern already deferred repeatedly) or changing `requestReset`'s return contract, which the frozen spec explicitly forbids ("`PasswordResetService`/`PasswordResetToken` are not modified in any way"). |
| 2 | An authenticated Manager/Administrator can now loop over every user id and fire a reset email at each of them, with no throttle (blind-hunter) | low | Real new avenue, but same systemic no-rate-limiting-anywhere gap already logged repeatedly (spec-1-4/1-6 entries in `deferred-work.md`). |
| 3 | No test asserts the response body of a successful `force-reset-password` call — only the RBAC real-guard-chain test's status code is checked (blind-hunter) | low | Verified — same gap class already identified and patched in spec-1-9's review for its own real-guard-chain test. |
| 4 | The self-targeting controller test is close to vacuous — `forcePasswordReset` takes no caller-identity parameter at all, so there's nothing for a self-targeting rule to violate (blind-hunter) | low (rejected) | Correct by design (spec Boundaries: self-targeting is explicitly unrestricted, no `@Req()` needed) — the test is weak but not wrong or misleading; not worth removing or strengthening further. |
| 5 | `invite.controller.spec.ts` carries an unrelated pure line-wrap reformat with no connection to this story (blind-hunter) | false | Confirmed non-behavioral (prettier/eslint `--fix` reflow) by the verification-gap layer; harmless, not worth reverting. |
| 6 | No test verifies a `PasswordResetToken` row is actually persisted, since `PasswordResetService` is mocked in `users.service.spec.ts` (blind-hunter) | false | Out of scope by design — `PasswordResetService`/`PasswordResetToken` are unchanged and already covered by Story 1.6's own test suite; asserting `requestReset` was called with the correct email is the correct unit-test boundary here. |



## Design Notes

## Verification

**Commands:**
- `npm run -w apps/api build` -- expected: exit 0
- `npm run -w apps/api test` -- expected: all suites pass, including updated `users.service.spec.ts`/`users.controller.spec.ts`
