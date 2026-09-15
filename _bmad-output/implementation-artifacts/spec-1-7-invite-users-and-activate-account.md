---
title: 'Invite users and activate account'
type: 'feature'
created: '2026-09-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'ffe489ef981024b2d639da2a5e937f18d3def906'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way to add a new user today — only the bootstrap Administrator exists (Story 1.1), and every current endpoint is public (FR: only Manager/Administrator may invite).

**Approach:** `POST /auth/invite` (RBAC-protected: Manager or Administrator only) accepts `{ email, role }`, creates a `Usuario` in `PENDING_VERIFICATION` with an unusable placeholder `passwordHash`, generates a one-time activation token (7-day expiry), and emails it. `POST /auth/activate` (public) accepts `{ token, password }`: a valid, unused, unexpired token atomically consumes itself (same pattern as Story 1.5/1.6), sets the real password hash, and flips status to `ACTIVE`. This is the first RBAC-protected endpoint in the codebase — introduces a reusable `JwtAuthGuard` + `RolesGuard` + `@Roles()` decorator per the architecture's declarative-RBAC decision (AD-4), for this and every later story to reuse.

## Boundaries & Constraints

**Always:**
- `AuthModule` remains the only writer of `Usuario` and the new `InvitationToken` table (AD-1); both live under `apps/api/src/auth/`, no new `users/` module.
- `JwtAuthGuard` verifies the Bearer access token and attaches `{ sub, email, role }` straight from its claims to `request.user` — no DB round-trip per request, matching the existing short-lived-JWT design (`RenewalService`'s own comment: claims go stale by design, refreshed only at renewal).
- `RolesGuard` + `@Roles(...UsuarioRole[])` reject with `403` when `request.user.role` isn't in the allowed list; both guards apply only via explicit `@UseGuards(...)` on the new `/auth/invite` route — no global `APP_GUARD` wiring yet (the four existing public auth endpoints stay untouched).
- Activation token follows the `PasswordResetToken` shape exactly: `tokenHash` (SHA-256 via the shared `hash-token.ts` helpers), `expiresAt`, `used`, `@@index([userId])`, atomic `updateMany` consume.
- Invitation TTL is configurable via env var with a sane default, mirroring `LOGIN_LOCKOUT_*`'s pattern in `login.service.ts` (default 7 days).
- The activation email is fire-and-forget, matching Stories 1.4/1.6.
- No password-complexity validation on activation — only non-empty, matching Story 1.6; Story 1.11 hardens both flows later via one shared check.
- Any Manager or Administrator may assign any of the four roles at invite time, including Administrator — the ACs restrict who may invite, not which role an inviter may assign; Story 1.9's Administrator-only restriction applies only to *changing* an existing user's role, not initial invite assignment. (Resolved Open Question 1.)
- Inviting an email already belonging to an `ACTIVE` or `DEACTIVATED` `Usuario` is rejected with a clear conflict error. Inviting an email already `PENDING_VERIFICATION` (already invited, not yet activated) is a resend: issue a fresh `InvitationToken`, invalidate any prior unused one for that user (same sibling-invalidation pattern as Story 1.6's `confirmReset`), send a new email — no duplicate `Usuario` row. (Resolved Open Question 2.)

**Never:**
- No password-complexity enforcement here (deferred to Story 1.11).
- No global auth guard rollout — only the new invite endpoint is protected.
- No audit-trail recording of who invited whom (Epic 2's job).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Manager/Administrator invites a new email | `POST /auth/invite` | `200`; `Usuario` created `PENDING_VERIFICATION`; one `InvitationToken` row; email sent (best-effort) | Mail failure logged, response unaffected |
| Manager/Administrator re-invites an email already `PENDING_VERIFICATION` | `POST /auth/invite` | `200`; no duplicate `Usuario`; prior unused token(s) invalidated; one fresh `InvitationToken` row; new email sent | N/A |
| Invite targets an email already `ACTIVE` or `DEACTIVATED` | `POST /auth/invite` | `409`-class conflict error; no `Usuario`/token mutation | Clear conflict message (authenticated admin action, not anti-enumeration) |
| Editor/Read-only, or unauthenticated caller, attempts to invite | `POST /auth/invite` | `403` (or `401` if unauthenticated); no `Usuario`/token row created | N/A |
| Valid, unused, unexpired activation token + non-empty password | `POST /auth/activate` | `200`; `Usuario.passwordHash` set, `status: ACTIVE`; token row `used: true` | N/A |
| Unknown, already-used, or expired activation token | `POST /auth/activate` | `401`, generic message; no state change | N/A |
| Two concurrent requests present the same valid activation token | Two simultaneous `POST /auth/activate` | Exactly one succeeds; the other gets the generic rejection | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/auth/roles.decorator.ts` -- new: `@Roles(...UsuarioRole[])` metadata decorator
- `apps/api/src/auth/jwt-auth.guard.ts` -- new: verifies `Authorization: Bearer`, populates `request.user`
- `apps/api/src/auth/roles.guard.ts` -- new: reads `@Roles` metadata, checks `request.user.role`
- `apps/api/src/common/hash-token.ts` -- existing: reused as-is for the activation token
- `apps/api/prisma/schema.prisma` -- existing: add `InvitationToken` model (mirrors `PasswordResetToken`) + `Usuario.invitationTokens` relation; new migration
- `apps/api/src/auth/invite.service.ts` -- new: `invite(actingRole, email, role)`, `activate(token, password)`
- `apps/api/src/auth/invite.controller.ts` -- new: `POST /auth/invite` (guarded), `POST /auth/activate` (public)
- `apps/api/src/auth/auth.module.ts` -- existing: register new controller/service/guards
- `apps/api/src/auth/login.service.ts` -- reference only: JWT payload shape (`sub`/`email`/`role`) the guard must parse identically

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/auth/roles.decorator.ts` -- `@Roles(...roles)` `SetMetadata` wrapper -- backs AD-4
- [x] `apps/api/src/auth/jwt-auth.guard.ts` -- verify Bearer token via `JwtService`, reject `401` on missing/invalid/expired -- first authenticated endpoint
- [x] `apps/api/src/auth/roles.guard.ts` -- reject `403` when role not allowed -- backs AD-4
- [x] `apps/api/prisma/schema.prisma` -- `InvitationToken` model + relation + index -- backs FR (invite)
- [x] `apps/api/src/auth/invite.service.ts` -- `invite`/`activate` implementing the I/O matrix
- [x] `apps/api/src/auth/invite.controller.ts` -- the two endpoints
- [x] `apps/api/src/auth/auth.module.ts` -- wire new providers/controller
- [x] Unit tests: guards, `invite.service.ts` (all I/O scenarios), `invite.controller.ts` (dispatch + RBAC rejection)

**Acceptance Criteria:**
- Given a Manager or Administrator, when they invite an email with a role, then the invited user can activate and immediately log in with that role (Story 1.2).
- Given an Editor or Read-only caller, when they call `/auth/invite`, then the request is rejected and no user/token row is created.
- Given an activation token already used once, when presented again, then the second attempt is rejected and the account is not re-activated.

## Implementation Notes

- `JwtAuthGuard` and `RolesGuard` are registered as ordinary `AuthModule` providers, not `APP_GUARD`s — they apply only via `@UseGuards(JwtAuthGuard, RolesGuard)` on `POST /auth/invite`. Every pre-existing public endpoint (`login`, `logout`, `refresh`, `forgot-password`, `reset-password`) and the new public `POST /auth/activate` are untouched.
- `JwtAuthGuard.canActivate` reads `Authorization: Bearer <token>`, calls `JwtService.verifyAsync` (same secret/algorithm as `LoginService.login`'s `signAsync`), and on success copies exactly `{ sub, email, role }` onto `request.user` — no DB read. Any failure (missing header, wrong scheme, missing token, invalid/expired JWT) is collapsed to the same generic 401.
- `RolesGuard.canActivate` reads `@Roles(...)` metadata via `Reflector.getAllAndOverride` off the handler then the class, and throws `403 ForbiddenException` when `request.user.role` isn't in the list. A handler with no `@Roles` metadata (and, defensively, an empty list) is allowed through — no route currently relies on that fallback since every guarded route carries `@Roles`.
- `InviteService.invite`'s placeholder password hash for a brand-new `PENDING_VERIFICATION` user is `argon2.hash(generateRawToken())` — a well-formed argon2 hash of a random 256-bit value, never a malformed/sentinel string. This matters because `LoginService.login` runs `argon2.verify(usuario.passwordHash, password)` *before* checking `status`; a malformed hash there would make `argon2.verify` throw (an unhandled 500) instead of returning `false` on any login attempt against a still-pending account. The chosen approach mirrors `LoginService`'s own `DUMMY_PASSWORD_HASH` posture (a real hash that can never match) rather than inventing a new "unusable" sentinel format.
- Resend (re-inviting an already-`PENDING_VERIFICATION` email) invalidates prior unused `InvitationToken` rows for that user (`updateMany` on `used: false`) exactly like `PasswordResetService.confirmReset`'s sibling-invalidation, then creates one fresh token — no duplicate `Usuario` row, and the user's `role` from the original invite is left unchanged (the spec's I/O matrix only specifies token/email behavior for a resend, not a role update, so the endpoint's `role` argument is not re-applied to an existing pending user).
- `InviteService.activate` does not additionally invalidate sibling `InvitationToken` rows on success (unlike `confirmReset`'s reset-token handling): because every resend already invalidates prior unused tokens at invite time, at most one unused token can exist for a given user by the time `activate` runs, so sibling invalidation there would be a no-op in every reachable state.
- `InviteController.invite`'s malformed-input guard (missing/non-string/empty/oversized `email`, or a `role` that isn't one of the four `UsuarioRole` enum values) throws `400 BadRequestException` rather than folding into the generic-rejection pattern used elsewhere — this is an authenticated admin-facing endpoint with a small, cooperative caller base (Manager/Administrator), not a public anti-enumeration surface, so there is no benefit to hiding validation errors behind a vaguer status.
- `InviteController.activate`'s malformed-input guard mirrors `PasswordResetController.resetPassword` exactly: any of missing/non-string/empty/oversized `token` or `password` maps to the same generic `401` (`ACTIVATE_FAILED_MESSAGE`) as an unknown/used/expired token, never a distinct response.
- Invitation email content follows the flagged assumption in Design Notes: a plaintext one-time token, not a link (`FRONTEND_URL` still doesn't exist anywhere in this codebase).
- New env var `INVITATION_TOKEN_TTL_DAYS` (default 7), documented in `.env.example`, mirrors `LOGIN_LOCKOUT_*`'s override pattern in `login.service.ts`.
- **Migration caveat (risk, same as spec-1-2/1-6):** this sandbox has no reachable Postgres/Docker, so `npx prisma migrate dev` could not run. Hand-wrote `prisma/migrations/20260914090000_add_invitation_token/migration.sql` in the same shape as the sibling `PasswordResetToken` migration, then verified it byte-matches Prisma's own output via `npx prisma migrate diff --from-schema <pre-change-schema> --to-schema ./prisma/schema.prisma --script` (no DB connection needed). **Not yet applied against a real Postgres instance — run `npx prisma migrate dev` (or `migrate deploy`) once before merging to confirm it applies cleanly.**
- `InviteController.invite`'s guard-rejection path (`403`/`401`) is exercised end-to-end through `supertest` against a real `INestApplication` with `JwtAuthGuard`/`RolesGuard` overridden to throw — the only spec in this codebase so far that boots a full Nest app rather than instantiating the controller directly, since this is the first route where guard *ordering* (`JwtAuthGuard` before `RolesGuard`, both populating/reading `request.user`) is itself part of the behavior under test.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | Concurrent `invite()` calls for the same brand-new email both pass the `null` check, then one `usuario.create` throws an unhandled unique-constraint violation → 500 instead of the documented 409 (blind-hunter, edge-case-hunter) | medium | Verified — `invite.service.ts`'s `findUnique`-then-`create` has no `$transaction` or `catch` for Prisma's P2002; repo-wide grep for `PrismaClientKnownRequestError`/`P2002` finds no existing handling pattern to mirror. |
| 2 | `AuthModule` registers `JwtAuthGuard`/`RolesGuard` as plain providers with no `exports`, so a future module outside `auth/` (e.g. a later epic's own module) can't reuse them without duplicating registration — contradicts the spec's own "for this and every later story to reuse" framing (blind-hunter) | low | Verified — `auth.module.ts`'s `@Module` has no `exports` array. `MailModule` exports `MailService` for the same cross-module-reuse purpose. |
| 3 | `RolesGuard.canActivate` fails *open* (allows through) when no `@Roles(...)` metadata is present — a latent footgun for a guard explicitly meant to be copied by future RBAC routes (blind-hunter) | low | Verified at `roles.guard.ts`. No other route in the repo uses `RolesGuard` yet (grep confirms), so nothing is exploitable today — purely a forward-looking risk for whoever reuses this guard without `@Roles(...)`. |
| 4 | No `deferred-work.md` entries added for gaps this story introduces, breaking the convention every prior story (1.1–1.6) followed (blind-hunter) | low | Verified — this diff doesn't touch `deferred-work.md` at all, unlike every predecessor. |
| 5 | Resend's `invitationToken.updateMany` (invalidate old) and `.create` (issue new) run as separate un-transactioned awaits; a failure between them burns the old tokens with no replacement (blind-hunter, edge-case-hunter) | medium | Verified — same pre-existing no-`$transaction`-anywhere pattern already logged in `deferred-work.md` for `PasswordResetService.confirmReset`/`RenewalService.renew`. |
| 6 | Two concurrent resends for the same `PENDING_VERIFICATION` email can each run their `updateMany`+`create` interleaved, leaving two simultaneously-valid `InvitationToken` rows for one user (edge-case-hunter) | low (see #8) | Verified reachable via the same un-transactioned sequence as #5. Severity capped low because finding #8's fix (status re-check in `activate()`) independently closes the only harmful consequence this could enable. |
| 7 | `activate()` never re-checks the target `Usuario`'s current `status` before overwriting `passwordHash` and setting `ACTIVE` — a still-valid leftover token (enabled by #6's race) could silently reset an already-`ACTIVE` user's password with no re-authentication (edge-case-hunter) | high | Verified at `invite.service.ts`'s `activate()` — no status check exists between the atomic consume and the `usuario.update`. Real account-takeover consequence (unauthenticated password overwrite) once a stale valid token exists; #6 demonstrates a concrete path to that precondition. |
| 8 | Real `JwtAuthGuard`+`RolesGuard`+`Reflector` chain on `POST /auth/invite` is never exercised end to end — every test fakes at least one piece (both guards mocked in the "RBAC rejection" supertest tests; dispatch tests bypass guards entirely; `roles.guard.spec.ts` feeds `RolesGuard` a hand-built fake `Reflector`) (verification-gap) | medium | Pre-verified by the verification-gap layer per its evidence rules: a dropped `@Roles(...)` or swapped guard order on this reference-implementation route would ship with the full suite green. |
| 9 | `invite` dispatch tests have no case for a wholly-missing request body, unlike the `activate` suite's equivalent test, even though the controller's guard clause (`body?.email`) is written to handle it (blind-hunter) | low | Verified — `invite.controller.spec.ts`'s `invite (dispatch)` describe block has no `controller.invite(undefined as never)` case. |
| 10 | Resend (`invite()` on an already-`PENDING_VERIFICATION` email) never applies the submitted `role` to the existing `Usuario` row — a corrected role on re-invite is silently discarded (blind-hunter, edge-case-hunter) | medium | Verified at `invite.service.ts`'s resend branch — only token operations run; `usuario.role` is never touched. The spec's resolved Open Question 2 only specified token/email resend behavior, leaving role-on-resend unaddressed; the more useful reading (apply the submitted role) is the obvious intended behavior of accepting a `role` parameter at all. |
| 11 | No format validation on `email` beyond non-empty/length-capped, including whitespace-only strings that `normalizeEmail`'s trim collapses to `""` — creates a permanent unusable `Usuario` row with no cleanup path (no delete-user feature exists anywhere in the roadmap) (blind-hunter, edge-case-hunter) | medium | Verified at `invite.controller.ts`'s guard clause and `normalize-email.ts`'s trim behavior. Unlike `forgotPassword`'s lax-input posture (a pure no-op for bad input), a bad `invite` email persists real, permanent state. |
| 12 | A Manager (not just Administrator) can mint a brand-new Administrator account via invite | false (out of scope) | This is exactly the frozen, human-resolved Open Question 1 decision (`<frozen-after-approval>` Boundaries, "Resolved Open Question 1") — not a gap, the explicit intent. Rejected per the rule against routing a finding whose fix is to edit this build's spec. |



## Design Notes

Activation email content follows Story 1.6's precedent: a plaintext one-time token in the body (`Use this token to activate your account: <raw token>`), not a clickable link — no `FRONTEND_URL` env var exists anywhere in this codebase yet; inventing one is out of scope here (same flagged assumption as spec-1-6).

`invite.controller.ts` bundles both endpoints the way `password-reset.controller.ts` bundles `forgot-password`/`reset-password` — one cohesive flow, not two controllers.

## Verification

**Commands:**
- `npx prisma generate` (in `apps/api`) -- ran, produced an `InvitationToken`-aware client with no errors.
- `npx prisma migrate diff --from-empty --to-schema ./prisma/schema.prisma --script` -- ran without a database connection (no live DB in this sandbox — same caveat as spec-1-2/1-6). Output's `InvitationToken` `CreateTable`/`CreateIndex`/`AddForeignKey` statements match `prisma/migrations/20260914090000_add_invitation_token/migration.sql` exactly.
- `npm run -w apps/api build` -- ran, compiles without errors (exit code 0).
- `npm run -w apps/api test` -- ran, 19 suites / 166 tests passed, including the five new spec files: `roles.decorator.spec.ts` (2 tests), `jwt-auth.guard.spec.ts` (5 tests), `roles.guard.spec.ts` (6 tests), `invite.service.spec.ts` (19 tests covering every I/O matrix scenario, the concurrent-activation race, and the placeholder-hash's well-formedness), `invite.controller.spec.ts` (19 tests covering dispatch, malformed input, RBAC rejection via a real `supertest`-driven `INestApplication`, and activation dispatch). All 14 pre-existing suites pass unchanged.
- `npm run -w apps/api lint` -- ran, 0 errors / 0 warnings after fixing two `eslint --fix`-flagged `unbound-method`/`no-unsafe-assignment` issues in the first draft of `roles.decorator.spec.ts` and two `no-unsafe-argument` warnings on `app.getHttpServer()` in `invite.controller.spec.ts` (fixed with an explicit `Server` type import).
- **Not run: `npx prisma migrate dev`/`migrate deploy` against a real Postgres.** Same outstanding risk as spec-1-2/1-6 — flagged for before-merge verification.
