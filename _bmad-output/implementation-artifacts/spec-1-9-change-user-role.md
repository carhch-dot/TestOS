---
title: 'Change user role'
type: 'feature'
created: '2026-09-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '6e1011d79a28449dc25b3fc2e742cfff5084ebc8'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A user's role is fixed at invite time (Story 1.7) with no way to correct it later as responsibilities change (FR9), and unlike invite/deactivate this action is Administrator-only.

**Approach:** `POST /users/:id/role` (RBAC-protected: Administrator only, not Manager) accepts `{ role }` and sets `Usuario.role` to one of the four valid `UsuarioRole` values. It also revokes every refresh token for that user, the same immediacy lever Stories 1.6/1.8 already use, so the new role takes effect on the user's very next login/renewal rather than waiting out their current access token's ~15-minute life. Reuses `JwtAuthGuard`/`RolesGuard`/`@Roles(ADMINISTRATOR)` from Story 1.7 exactly as built.

## Boundaries & Constraints

**Always:**
- `POST /users/:id/role` uses `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UsuarioRole.ADMINISTRATOR)` — Manager is explicitly excluded here, unlike `/users/:id/deactivate`/`/reactivate` (epic AC: "exclusivo de Administrador").
- Applies to a target in any `status` (`ACTIVE`, `PENDING_VERIFICATION`, or `DEACTIVATED`) — no status restriction, unlike Story 1.8's deactivate/reactivate.
- Setting the same role a user already has is a no-op (`200`, still revokes tokens — see below) rather than an error; idempotent by design like every other mutation in this epic.
- A successful role change also calls `RefreshTokenService.revokeAllForUser` unconditionally (including the no-op-role case) — matches Story 1.6/1.8's precedent of using immediate session revocation as the enforcement lever for "applies immediately," and keeps the endpoint's behavior uniform regardless of whether the role actually differed.
- `role` in the request body is validated against the four `UsuarioRole` enum values, same posture as `InviteController`'s `role` guard clause.
- `UsersController`/`UsersService` (Story 1.8) gain this as a third method/route; no new controller or service file.
- An Administrator cannot change their own role — `POST /users/:id/role` rejects with a conflict error when `:id` equals the caller's own `sub`, same self-action guard as Story 1.8's self-deactivation block. (Not re-asked as an Open Question: same reasoning as 1.8 — an Administrator demoting themselves in a single-admin org could leave nobody able to invite a replacement Administrator either, since invite is Manager/Administrator-only and a demoted former-Administrator might land below Manager.)

**Never:**
- No restriction on which role can be assigned based on the target's current role or the caller's identity beyond the self-change block above — any Administrator may set any target (other than themselves) to any of the four roles.
- No audit-trail recording of who changed whose role (Epic 2's job).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Administrator changes another user's role to a valid role | `POST /users/:id/role` | `200`; `Usuario.role` updated; all refresh tokens for that user revoked | N/A |
| Administrator sets a role the user already has | `POST /users/:id/role` | `200`; no-op on `role`, but refresh tokens still revoked | N/A |
| Manager, Editor, or Read-only, or unauthenticated caller, attempts to change a role | `POST /users/:id/role` | `403` (or `401` if unauthenticated); no state change | N/A |
| Administrator attempts to change their own role | `POST /users/:id/role` with `:id === caller.sub` | `409`-class conflict; no mutation | Clear error message |
| Unknown `id`, or malformed/invalid `role` value | `POST /users/:id/role` | `404` (unknown id) / `400` (invalid role); no mutation | Clear error message |

</frozen-after-approval>

## Code Map

- `apps/api/src/auth/users.controller.ts` -- existing (Story 1.8): add `POST /:id/role`, guarded `@Roles(ADMINISTRATOR)` only
- `apps/api/src/auth/users.service.ts` -- existing (Story 1.8): add `changeRole(id, role)`, reusing `USER_NOT_FOUND_MESSAGE`/`UserStatusResult` shape
- `apps/api/src/auth/refresh-token.service.ts` -- existing: `revokeAllForUser` reused as-is
- `apps/api/src/auth/jwt-auth.guard.ts`, `roles.guard.ts`, `roles.decorator.ts` -- existing, reused unchanged (Story 1.7)
- `apps/api/src/auth/invite.controller.ts` -- reference only: the existing `role`-validation guard-clause pattern to mirror

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/auth/users.service.ts` -- `changeRole(id, role)` implementing the I/O matrix
- [x] `apps/api/src/auth/users.controller.ts` -- `POST /:id/role`, `@Roles(ADMINISTRATOR)` only
- [x] Unit tests: `users.service.ts` (all I/O scenarios), `users.controller.ts` (dispatch, self-change rejection, RBAC rejection incl. Manager, using the real guard chain per Story 1.7/1.8's precedent)

**Acceptance Criteria:**
- Given an Administrator, when they change another user's role, then the target's `Usuario.role` reflects the new role and all of that user's refresh tokens are revoked.
- Given a Manager, Editor, or Read-only caller, when they attempt to change a role, then the request is rejected (Manager included, unlike Story 1.8's deactivate/reactivate).
- Given an Administrator, when they attempt to change their own role, then the request is rejected and their role is unchanged.

## Implementation Notes

`UsersService.changeRole(id, role)` looks up the target, throws `NotFoundException(USER_NOT_FOUND_MESSAGE)` if missing, skips the Prisma write only when `role` already matches (still an update-free no-op), and unconditionally calls `RefreshTokenService.revokeAllForUser(id)` on every successful path (including the no-op-role case) before returning the shared `UserStatusResult` shape. No status check -- applies to `ACTIVE`/`PENDING_VERIFICATION`/`DEACTIVATED` targets alike.

`UsersController.changeRole` adds `POST /:id/role` guarded by `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UsuarioRole.ADMINISTRATOR)` (Manager excluded, unlike `deactivate`/`reactivate`). It validates `body.role` against the `UsuarioRole` enum (mirrors `InviteController`'s guard-clause pattern, `400` + `INVALID_ROLE_MESSAGE` on failure), then blocks `request.user.sub === id` with a `409` (`ConflictException` + `SELF_ROLE_CHANGE_MESSAGE`) before ever calling the service -- same self-action-guard split as `deactivate`'s `SELF_DEACTIVATION_MESSAGE`.

Added exports: `SELF_ROLE_CHANGE_MESSAGE`, `INVALID_ROLE_MESSAGE`, `ChangeRoleRequestDto` (in `users.controller.ts`).

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | `changeRole`'s `usuario.update` and `revokeAllForUser` run as separate un-transactioned awaits; a failure between them leaves the new role committed without the promised session revocation (blind-hunter) | medium | Same pre-existing no-`$transaction`-anywhere pattern already logged repeatedly (spec-1-5/1-6/1-7/1-8 entries) — confirmed by the verification-gap layer as "not a new regression introduced here." |
| 2 | The real-guard-chain RBAC test only asserts status codes (`200`/`403`), never the response body, on the Administrator-success case (blind-hunter) | low | Verified at `users.controller.spec.ts`'s real-guard-chain test — a regression that silently returned the wrong payload would still pass. |
| 3 | No test pins the precedence between the two failure modes when both apply — an Administrator submitting an invalid `role` for their own `id` (blind-hunter) | low | Verified — code validates role-format before the self-change check (400, not 409), but that ordering is untested; a future refactor could flip it unnoticed. |
| 4 | A demoted (or deactivated) user's already-issued access token retains their old role's privileges for up to its ~15-minute life — `changeRole` revokes refresh tokens but can't invalidate an already-signed JWT (blind-hunter) | low | Real but pre-existing/systemic (same staleness Story 1.5 already accepts, and equally true of Story 1.8's deactivate) — more security-relevant here since it means a just-caught malicious/compromised Administrator keeps elevated privileges in-flight briefly. |
| 5 | `usuario.update` could throw Prisma's P2025 (record not found) if the target row is deleted between `findUnique` and `update` (edge-case-hunter) | false | Checked — no code path anywhere in `apps/api/src` ever deletes a `Usuario` row (no delete-user feature exists in this codebase at all). The race is unreachable. |
| 6 | `ChangeRoleRequestDto` has no `class-validator` decorators / no global `ValidationPipe` registered, relying solely on a hand-rolled guard clause (blind-hunter) | low (rejected) | Matches `InviteController`'s existing, already-accepted pattern uniformly across the whole codebase — not a gap introduced by this story specifically. |



## Design Notes

## Verification

**Commands:**
- `npm run -w apps/api build` -- expected: exit 0
- `npm run -w apps/api test` -- expected: all suites pass, including updated `users.service.spec.ts`/`users.controller.spec.ts`
