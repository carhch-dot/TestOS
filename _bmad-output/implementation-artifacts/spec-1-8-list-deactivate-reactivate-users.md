---
title: 'List, deactivate, and reactivate users'
type: 'feature'
created: '2026-09-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '80793ecae7664ef3aa38ffb9afda142e0af8b5ca'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Manager/Administrator has no way to see who has access or to revoke it as the team changes — the only way in is Story 1.7's invite, and there's no way back out.

**Approach:** `GET /users` (RBAC-protected: Manager or Administrator) returns a paginated list of every `Usuario` with a computed `effectiveStatus` that folds the lockout timer into the status the epic's AC actually asks for. `POST /users/:id/deactivate` transitions `ACTIVE → DEACTIVATED`, revokes every refresh token for that user (blocks login immediately, not just at next renewal), and is idempotent on an already-`DEACTIVATED` target. `POST /users/:id/reactivate` reverses it (`DEACTIVATED → ACTIVE`), also clearing any stale lockout so the user isn't reactivated straight into a lock. Both endpoints reuse `JwtAuthGuard`/`RolesGuard`/`@Roles()` from Story 1.7 exactly as built — this story adds no new auth infrastructure.

## Boundaries & Constraints

**Always:**
- New `UsersController`/`UsersService` live under `apps/api/src/auth/` (no new module), registered in `AuthModule` — `AuthModule` remains the only writer of `Usuario` (AD-1).
- `GET /users`, `POST /users/:id/deactivate`, `POST /users/:id/reactivate` all use `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR)` — reused as-is from Story 1.7, no changes to those files.
- List response never includes `passwordHash`; shape matches the architecture's pagination convention: `{ data, total, page, pageSize }`.
- Each list entry's `effectiveStatus` is computed, not the raw `status` column: `DEACTIVATED` if `status === DEACTIVATED`; else `PENDING_VERIFICATION` if `status === PENDING_VERIFICATION`; else `LOCKED` if `lockedUntil` is in the future; else `ACTIVE`. This is what satisfies the AC's four-state list ("activo/pendiente/bloqueado/desactivado") — `LOCKED` is not a `UsuarioStatus` enum value anywhere else in the schema.
- Any Manager or Administrator may deactivate/reactivate any user regardless of that user's own role, including another Administrator or themselves — same uniform-capability precedent as Story 1.7's resolved Open Question 1, not re-litigated here.
- Deactivating a still-`ACTIVE` user also calls `RefreshTokenService.revokeAllForUser` — blocks login immediately (via `LoginService`'s existing `status === ACTIVE` check) and kills any live session, not just future ones (mirrors Story 1.6's password-change revocation).
- Reactivating a `DEACTIVATED` user also clears `failedLoginAttempts`/`lockedUntil` — a reactivated account isn't handed back into a stale lock (mirrors Story 1.6's reset-clears-lockout fix).
- `deactivate` on an already-`DEACTIVATED` target and `reactivate` on an already-`ACTIVE` target are both idempotent no-ops (`200`, no mutation) — not errors.
- `POST /users/:id/deactivate` rejects with a conflict error when `:id` equals the caller's own `sub` (from `request.user`, populated by `JwtAuthGuard`) — self-deactivation is blocked. (Resolved Open Question.)

**Never:**
- No last-Administrator protection — deactivating the only remaining Administrator (by someone else) is allowed; self-deactivation is the only blocked case.
- `deactivate`/`reactivate` on a `PENDING_VERIFICATION` target is out of scope — rejected with a conflict error; canceling a pending invite is not this story's job.
- No search/filter/sort on `GET /users` — pagination only, matching the literal AC.
- No audit-trail recording of who deactivated/reactivated whom (Epic 2's job).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Manager/Administrator lists users | `GET /users?page=1&pageSize=20` | `200`; `{ data, total, page, pageSize }`; each entry has `effectiveStatus`, no `passwordHash` | N/A |
| Deactivate an `ACTIVE` (or currently-`LOCKED`) user | `POST /users/:id/deactivate` | `200`; `status: DEACTIVATED`; all refresh tokens for that user revoked | N/A |
| Deactivate an already-`DEACTIVATED` user | `POST /users/:id/deactivate` | `200`; no-op, no mutation | N/A |
| Deactivate a `PENDING_VERIFICATION` user, or an unknown `id` | `POST /users/:id/deactivate` | `409`-class conflict (unknown `id`: `404`) | Clear error message |
| Caller attempts to deactivate their own account | `POST /users/:id/deactivate` with `:id === caller.sub` | `409`-class conflict; no mutation | Clear error message |
| Reactivate a `DEACTIVATED` user | `POST /users/:id/reactivate` | `200`; `status: ACTIVE`; `failedLoginAttempts: 0`, `lockedUntil: null` | N/A |
| Reactivate an already-`ACTIVE` (or `LOCKED`) user | `POST /users/:id/reactivate` | `200`; no-op, no mutation | N/A |
| Reactivate a `PENDING_VERIFICATION` user, or an unknown `id` | `POST /users/:id/reactivate` | `409`-class conflict (unknown `id`: `404`) | Clear error message |
| Editor/Read-only, or unauthenticated caller, calls any of the three routes | any of the three | `403` (or `401` if unauthenticated); no state change | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/auth/users.controller.ts` -- new: `GET /users`, `POST /users/:id/deactivate`, `POST /users/:id/reactivate`, all guarded
- `apps/api/src/auth/users.service.ts` -- new: `list(page, pageSize)`, `deactivate(id)`, `reactivate(id)`
- `apps/api/src/auth/jwt-auth.guard.ts`, `roles.guard.ts`, `roles.decorator.ts` -- existing, reused unchanged (Story 1.7)
- `apps/api/src/auth/refresh-token.service.ts` -- existing: `revokeAllForUser` reused as-is for deactivate
- `apps/api/src/auth/auth.module.ts` -- existing: register new controller/service
- `apps/api/src/auth/login.service.ts` -- reference only: confirms `status === ACTIVE` already gates login, so deactivation's login-blocking half needs no new code there

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/auth/users.service.ts` -- `list`/`deactivate`/`reactivate` implementing the I/O matrix
- [x] `apps/api/src/auth/users.controller.ts` -- the three guarded endpoints
- [x] `apps/api/src/auth/auth.module.ts` -- wire new provider/controller
- [x] Unit tests: `users.service.ts` (all I/O scenarios incl. `effectiveStatus` computation), `users.controller.ts` (dispatch + RBAC rejection using the real guard chain, per Story 1.7's review precedent)

**Acceptance Criteria:**
- Given a Manager or Administrator, when they list users, then every user appears with one of `ACTIVE`/`PENDING_VERIFICATION`/`LOCKED`/`DEACTIVATED`.
- Given an active user, when a Manager or Administrator deactivates them, then they can no longer log in (even with an already-issued refresh token) and their prior audit history is untouched (nothing to touch yet — Epic 2 not built).
- Given an Editor or Read-only caller, when they call any of the three routes, then the request is rejected.
- Given a Manager or Administrator, when they attempt to deactivate their own account, then the request is rejected and their account remains active.
- Given a deactivated user, when a Manager or Administrator reactivates them, then they can log in again and any stale lockout (`failedLoginAttempts`/`lockedUntil`) is cleared.

## Implementation Notes

- `UsersController` is registered in `AuthModule` (AD-1: `AuthModule` stays the only writer of `Usuario`) but is deliberately its own top-level `@Controller('users')`, not nested under `/auth` — matching the spec Intent's literal `GET /users` route, distinct from `InviteController`'s `@Controller('auth')`.
- Self-deactivation (`:id === caller.sub`) is checked in `UsersController.deactivate`, before `UsersService.deactivate` is ever called — the service's `deactivate(id)` signature (per Code Map) has no caller-identity parameter, and `request.user.sub` is only available where `JwtAuthGuard` populates it, i.e. the controller.
- `deactivate`/`reactivate` return the raw `status` column (`UserStatusResult`), not `effectiveStatus` — the I/O matrix's response wording ("status: DEACTIVATED", "status: ACTIVE") is the mutation's own after-state, distinct from `GET /users`' lockout-aware `effectiveStatus` view. Both idempotent no-op paths (already-`DEACTIVATED` target on deactivate, already-`ACTIVE`/`LOCKED` target on reactivate) still return this same shape with the target's current (unchanged) status, so the response is consistent whether or not a mutation happened.
- `GET /users` defaults to `page=1`, `pageSize=50` (`[ASSUMPTION: pageSize=50]`, matching the architecture's general pagination convention in `ARCHITECTURE-SPINE.md` — no story-1-8-specific override was given) and clamps an oversized `pageSize` to 200 as a defensive upper bound, not a real limit — same posture as the length caps in `InviteController`/`LoginController`. Non-numeric or non-positive `page`/`pageSize` query params silently fall back to the defaults rather than erroring.
- List entries never include `passwordHash`, `failedLoginAttempts`, or `lockedUntil` directly — only `id`/`email`/`role`/`effectiveStatus`/`createdAt`. No consumer of these fields exists yet (this is the first read endpoint over `Usuario`), so the shape is a reasonable minimal default rather than one dictated by an existing frontend contract.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | No manual way to clear a `LOCKED` status early — `reactivate` no-ops whenever the target's raw `status` is already `ACTIVE`, and a locked user's `status` stays `ACTIVE` (only `lockedUntil` is set), so a Manager can see who's `LOCKED` but has no dedicated action to unlock them (blind-hunter) | low | Real but narrow: a deactivate-then-reactivate round trip already unlocks them today (deactivate doesn't no-op on a `LOCKED`/`ACTIVE` target; the subsequent reactivate clears `lockedUntil` on the real `DEACTIVATED → ACTIVE` transition) — non-obvious but not a hard capability gap. Self-resolves within the lockout window (default 30 min) either way, same posture as Story 1.4's documented-but-accepted lockout limitations. |
| 2 | `reactivate`'s I/O matrix row lists `failedLoginAttempts: 0, lockedUntil: null` as "Expected Output / Behavior," but `UserStatusResult`/`toStatusResult()` never puts those fields in the HTTP response body (blind-hunter) | false | Every I/O matrix in this project's specs (1.6, 1.7 included) documents DB-state changes in that column, not literal response-body contents — e.g. spec-1-6's "every RefreshToken...revoked" is never in `reset-password`'s response either. `users.service.spec.ts` verifies the DB write directly. No contradiction, consistent with established convention. |
| 3 | No test for a `PENDING_VERIFICATION` user with a future `lockedUntil` (the `effectiveStatus` priority-ordering's untested symmetric case) (blind-hunter) | false | Checked `login.service.ts:97` — the `status !== ACTIVE` throw happens before any lockout bookkeeping (`failedLoginAttempts`/`lockedUntil` mutation), so a `PENDING_VERIFICATION` user can never accumulate a `lockedUntil`. The state is unreachable in this codebase. |
| 4 | `deactivate`'s `usuario.update` (status → `DEACTIVATED`) and `refreshTokenService.revokeAllForUser` run as separate un-transactioned awaits; a failure between them leaves the user `DEACTIVATED` with sessions still live (blind-hunter, edge-case-hunter) | medium | Same pre-existing no-`$transaction`-anywhere pattern already logged repeatedly in `deferred-work.md` (spec-1-5/1-6/1-7 entries). |
| 5 | `deactivate`/`reactivate`'s `findUnique`-then-`update` has no atomic conditional update, so two concurrent calls on the same `id` can race past the initial status check and clobber each other (blind-hunter, edge-case-hunter) | medium | Same class as #4 — verified at `users.service.ts`'s `deactivate`/`reactivate`, no `updateMany`-with-status-guard or `$transaction`. |
| 6 | Tasks & Acceptance's "Acceptance Criteria" list has no bullet for reactivation itself, despite it being one of the three headline endpoints with its own idempotency/lockout-clearing behavior (blind-hunter) | low | Verified — the AC list covers listing, deactivation, RBAC rejection, and self-deactivation, but not reactivation. Spec-documentation gap outside the frozen block. |
| 7 | `users.controller.spec.ts` defines the same three-route array twice instead of hoisting it once (blind-hunter) | low | Verified at the `RBAC rejection` describe block and the real-guard-chain test — pure duplication, risks drift if a route is added. |
| 8 | No test for the exact `MAX_PAGE_SIZE` boundary (200 unclamped vs. 201 clamped) — only a grossly oversized value is tested (blind-hunter) | low | Verified — an off-by-one in the `Math.min` clamp wouldn't be caught by the existing test. |
| 9 | No test confirming the documented "no last-Administrator protection" behavior is actually what happens (blind-hunter) | low (rejected) | No code path exists that could regress this (no admin-counting logic anywhere) — a test would only re-assert the absence of a feature, providing no regression coverage. Rejected: fix is disproportionate to a non-existent risk. |
| 10 | `page` query param has no upper clamp — only `pageSize` does via `MAX_PAGE_SIZE` — so an absurdly large `page` produces a huge `skip` passed straight to Prisma (edge-case-hunter) | low | Verified at `users.controller.ts`'s `list()` — `parsePositiveInt(pageRaw, DEFAULT_PAGE)` has no `Math.min` cap, unlike `pageSize`. Likely harmless (an out-of-range `OFFSET` just returns zero rows) but inconsistent with the existing defensive posture. |



## Design Notes

`effectiveStatus` is computed in the service (not the controller), so it's covered directly by `users.service.spec.ts` rather than requiring an HTTP round-trip to test the derivation logic.

## Verification

**Commands:**
- `npm run -w apps/api build` -- ran, exit 0, no TypeScript errors.
- `npm run -w apps/api test` -- ran, all 21 suites / 212 tests pass, including new `users.service.spec.ts` (24 tests) and `users.controller.spec.ts` (15 tests, incl. the real-`JwtAuthGuard`/`RolesGuard`-chain RBAC test across all three routes, per Story 1.7's review precedent).
- `npx eslint` on all new/changed files (`users.service.ts`, `users.controller.ts`, `users.service.spec.ts`, `users.controller.spec.ts`, `auth.module.ts`) -- ran, 0 errors after fixing formatting and an `@typescript-eslint/no-unsafe-*` violation from dynamic `supertest` method dispatch in the route-table-driven RBAC tests (replaced with a typed `sendRequest` helper).
