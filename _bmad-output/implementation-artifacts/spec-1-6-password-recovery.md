---
title: 'Password recovery'
type: 'feature'
created: '2026-09-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'bac15581f53d11cf2b4dd471656cdedb81deaeb8'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A user who forgets their password has no way back in — only an Administrator/Manager forcing a reset (Story 1.10, not yet built) could help them (FR5).

**Approach:** Two endpoints. `POST /auth/forgot-password` accepts `{ email }` and always returns the identical generic response, whether or not the email belongs to a real account — internally, an `ACTIVE` match gets a one-time reset token (1 hour expiry) emailed via `MailService`. `POST /auth/reset-password` accepts `{ token, newPassword }`: a valid, unused, unexpired token atomically consumes itself (same conditional-update pattern as `RefreshTokenService.consume`, closing the same replay/race class Story 1.5 fixed, from the start), sets the new password hash, and revokes every refresh token for that user (NFR1: "sessions must be revocable explicitly... on password change").

## Boundaries & Constraints

**Always:**
- `AuthModule` remains the only writer of `Usuario` and the new `PasswordResetToken` table (AD-1).
- `forgot-password` returns the exact same response (status, body) whether the email is unknown, belongs to a non-`ACTIVE` user, or belongs to a real `ACTIVE` account — never revealing which (FR5, same posture as login).
- Consuming a reset token is an atomic conditional update (`updateMany` with `where: { id, used: false }`, checking the affected count) — never a plain read-then-write, from the start (the pattern Story 1.5 had to retrofit after review).
- A valid reset sets the new password hash with `argon2` (matching Story 1.1's bootstrap and Story 1.2's login), marks the token `used`, and calls `RefreshTokenService.revokeAllForUser` — a password change invalidates every existing session (NFR1), not just this token.
- The reset email is fire-and-forget (`void mailService.send(...).catch(() => {})`), matching Story 1.4's fix — `forgot-password`'s response must never wait on SMTP latency.
- No password-complexity validation on the new password here — matches Story 1.7's activation flow: "accept any non-empty password," hardened uniformly by Story 1.11 across every password-setting flow. Only "non-empty" is checked.
- `PasswordResetToken` gets `@@index([userId])` from the start (the gap Story 1.5 had to add after review).

**Never:**
- No password-complexity enforcement — deferred to Story 1.11 (see Always).
- No RBAC guard on either endpoint — both are public entry points, same posture as login/logout/refresh.
- No timing-safety machinery (no dummy-hash symmetry): a reset token is a 256-bit secret, not a guessable identifier — the small residual DB-write timing gap between "email found" and "email not found" in `forgot-password` is the same class of negligible, already-accepted gap logged for login (Story 1.2's `deferred-work.md` entry) — noted, not re-litigated.
- No change to `POST /auth/login`, `/logout`, or `/refresh` — this story only adds the two recovery endpoints.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Email belongs to a real `ACTIVE` user | `POST /auth/forgot-password` | `200`, generic message; one `PasswordResetToken` row created; email sent (best-effort) | Mail failure logged, response unaffected |
| Email is unknown, or belongs to a non-`ACTIVE` user | `POST /auth/forgot-password` | `200`, byte-identical generic message; no token row created, no email sent | N/A |
| Valid, unused, unexpired token + non-empty new password | `POST /auth/reset-password` | `200`; `Usuario.passwordHash` updated; token row `used: true`; every `RefreshToken` for that user is now `revoked: true` | N/A |
| Unknown, already-used, or expired token | `POST /auth/reset-password` | `401`, generic message; no password change; no chain revocation | N/A |
| Two concurrent requests present the same valid token at once | Two simultaneous `POST /auth/reset-password` | Exactly one succeeds; the other gets the generic rejection (lost the atomic consume) | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/common/hash-token.ts` -- new: extracts the random-token-generation + SHA-256-hash pattern currently inlined in `RefreshTokenService`, shared with the new `PasswordResetService`
- `apps/api/src/auth/refresh-token.service.ts` -- existing: refactor to use the new shared helper (no behavior change)
- `apps/api/prisma/schema.prisma` -- existing: add `PasswordResetToken` model (+ `Usuario.passwordResetTokens` relation, `@@index([userId])`); new migration
- `apps/api/src/auth/password-reset.service.ts` -- new: `requestReset(email)`, `confirmReset(token, newPassword)`
- `apps/api/src/auth/password-reset.controller.ts` -- new: `POST /auth/forgot-password`, `POST /auth/reset-password`
- `apps/api/src/auth/auth.module.ts` -- existing: register the new controller/service

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/common/hash-token.ts` -- extract `generateRawToken()`/`hashToken()` -- shared by `RefreshTokenService` and the new service
- [x] `apps/api/src/auth/refresh-token.service.ts` -- switch to the shared helper -- no behavior change
- [x] `apps/api/prisma/schema.prisma` -- add `PasswordResetToken` (id, userId, tokenHash unique, expiresAt, used default false, createdAt) + relation + `@@index([userId])` -- backs FR5
- [x] `apps/api/src/auth/password-reset.service.ts` -- `requestReset`/`confirmReset` implementing the five I/O matrix scenarios -- implements FR5, NFR1
- [x] `apps/api/src/auth/password-reset.controller.ts` -- the two endpoints, mapping every `reset-password` failure to one generic 401 and every `forgot-password` outcome to the same 200 -- implements the I/O matrix
- [x] `apps/api/src/auth/auth.module.ts` -- wire the new controller/service
- [x] Unit tests for `password-reset.service.ts` covering all five I/O matrix scenarios
- [x] Unit tests for `hash-token.ts`

**Acceptance Criteria:**
- Given an unknown email and a real `ACTIVE` user's email, when each is submitted to `forgot-password`, then both responses are byte-identical.
- Given a valid reset token, when used to reset the password, then the user can log in with the new password, the old password no longer works, and every prior refresh token for that user is `revoked: true`.
- Given a reset token already used once, when presented again, then the second attempt is rejected and does not change the password again.

## Implementation Notes

- `hash-token.ts` extracted exactly as specified; `RefreshTokenService` now imports `generateRawToken`/`hashToken` and no longer has a private `hash()` method. `refresh-token.service.spec.ts` needed no changes — it independently recomputes `createHash('sha256')...` rather than depending on the private method, so it still passes unchanged against the refactor.
- **Migration caveat (risk, same as spec-1-2):** this sandbox has no reachable Postgres/Docker, so `npx prisma migrate dev` could not run — it fails immediately without a live connection/`shadowDatabaseUrl`. Instead, hand-wrote `prisma/migrations/20260912110000_add_password_reset_token/migration.sql` in the same format as the sibling `RefreshToken` migration, then verified it byte-matches Prisma's own output via `npx prisma migrate diff --from-empty --to-schema ./prisma/schema.prisma --script` (a schema-to-schema diff that needs no database connection): the `CreateTable "PasswordResetToken"`, both `CreateIndex` statements, and the `AddForeignKey` statement are identical to what's in the migration file. **Not yet applied against a real Postgres instance — run `npx prisma migrate dev` (or `migrate deploy`) once before merging to confirm it applies cleanly.**
- Reset-email content: the frozen Intent says a matching token "gets a one-time reset token... emailed via `MailService`" without specifying wording or a link format (the broader `epic-1-context.md` mentions a "link," but that file isn't in this spec's `context:` and the frozen Intent here says "token," not "link"). Implemented as a plaintext one-time code in the email body (`Use this code to reset your password: <raw token>`), not a URL — there is no frontend base-URL environment variable anywhere in this codebase yet to build a link from, and inventing one would be scope creep beyond the Code Map. Flagging as an assumption in case a clickable link is actually wanted; would need a new env var (e.g. `FRONTEND_URL`) and is a small follow-up if so.
- Malformed-input handling mirrors the existing controllers' posture: `forgot-password` treats a missing/non-string/empty/oversized `email` as a no-op (same 200 generic body as an unknown email — never a distinct response, per FR5); `reset-password` maps a missing/non-string/empty/oversized `token` or `newPassword` to the same generic 401 as every other rejection (mirrors `LoginController`'s guard).
- No password-complexity validation added, per the frozen Boundaries — only `newPassword.length === 0` is rejected (in both the controller's cheap guard and the service's own check).

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | No `password-reset.controller.spec.ts` exists; controller's dispatch guards (email/token/newPassword malformed-input branches) are untested (blind-hunter, verification-gap x2) | medium | Verified — `password-reset.controller.ts` has no sibling spec file; grep for `PasswordResetController` across `apps/api/src` returns only the controller and `auth.module.ts`. Every sibling controller (`login`, `logout`, `renewal`) has its own spec asserting the dispatch boundary. verification-gap's two findings (missing dispatch-assertion test; non-string `token` guard untested, risking a 500 instead of the generic 401 if the guard regresses) are pre-verified per that layer's evidence rules and corroborate this. |
| 2 | `sprint-status.yaml`'s `1-6-recuperación-de-contraseña` entry is `in-progress`, not `review` (blind-hunter) | low | Verified — spec frontmatter says `status: 'in-review'`, every Execution task is `[x]`, and Verification reports completed build/test runs, matching how `1-3`/`1-4`/`1-5` are all recorded as `review`. |
| 3 | `confirmReset` → `RefreshTokenService.revokeAllForUser` unconditionally logs `(suspected replay)`, mislabeling every legitimate password-change-triggered session revocation (blind-hunter) | low | Verified at `refresh-token.service.ts:90-92` — the log line is unconditional and worded for `RenewalService`'s actual reuse/replay path, which is the only other caller. |
| 4 | Prior unused `PasswordResetToken` rows for the same user stay valid after a successful reset (blind-hunter, edge-case-hunter) | medium | Verified — `confirmReset` only flips the one consumed row's `id` to `used: true`; a sibling row from an earlier `forgot-password` call remains usable until its own 1-hour expiry, even after the password has already been changed via a different token. |
| 5 | `confirmReset` doesn't clear `failedLoginAttempts`/`lockedUntil`, so a locked-out user who resets their password still can't log in (blind-hunter) | medium | Verified — `login.service.ts:76-77` rejects while `lockedUntil` is in the future (default 30-minute lockout, `login.service.ts:22`); `confirmReset`'s `usuario.update` only sets `passwordHash`. Defeats a primary real-world reason to use forgot-password. |
| 6 | No rate limiting on the two new public endpoints, and the (systemic, pre-existing) gap isn't cross-referenced for this story (blind-hunter) | low | Verified — `deferred-work.md` already tracks this app-wide gap from Story 1.4's review but has no entry naming spec-1-6's endpoints. |
| 7 | `PasswordResetToken` has no cleanup/expiry job; not cross-referenced (blind-hunter) | low | Verified — `deferred-work.md` tracks the analogous `RefreshToken` unbounded-growth gap (Story 1.3) but nothing for `PasswordResetToken`, which grows on every `forgot-password` call including retries. |
| 8 | Reset email calls the 64-hex-char raw token a "code" (blind-hunter) | low | Verified at `password-reset.service.ts:70` — `generateRawToken()` returns a 64-character hex string, not a short human-enterable code. |
| 9 | `confirmReset` doesn't re-check `Usuario.status`, so an account deactivated between token issuance and use could still reset its password (edge-case-hunter) | false | Checked — no code path anywhere in `apps/api/src` sets `UsuarioStatus.DEACTIVATED`; Story 1.8 (deactivate/reactivate users) is still `backlog` in `sprint-status.yaml`. The described state cannot currently occur. |
| 10 | If `argon2.hash`/`usuario.update` throws after the atomic consume, the token is permanently burned with no password change; if `revokeAllForUser` throws after `usuario.update` succeeds, sessions stay live despite the password having changed (edge-case-hunter) | medium | Verified — `confirmReset`'s three steps (consume → hash+update → revoke) run as sequential awaits, not a `$transaction`. Same pre-existing pattern as `RenewalService.renew` (consume → sign → issue, also unwrapped) — `deferred-work.md` already carries the identical class of finding for that story (spec-1-5 entry, "If JWT signing or refresh-token issuance throws..."). No `$transaction` call exists anywhere in the repo. |



## Design Notes

`hash-token.ts` shape: `generateRawToken(): string` (32 random bytes, hex) and `hashToken(raw: string): string` (SHA-256 hex digest) — two small pure functions, not a class, mirroring `normalize-email.ts`'s shape. `RefreshTokenService`'s private `hash()` method and its `randomBytes(32).toString('hex')` call in `issue()` are replaced with calls to these.

## Verification

**Commands:**
- `npx prisma generate` (in `apps/api`) -- ran, produced a `PasswordResetToken`-aware client with no errors.
- `npx prisma migrate diff --from-empty --to-schema ./prisma/schema.prisma --script` -- ran without a database connection, in place of `npx prisma migrate dev` (no reachable Postgres/Docker in this sandbox — see Implementation Notes). Output's `PasswordResetToken` statements match `prisma/migrations/20260912110000_add_password_reset_token/migration.sql` exactly.
- `npm run -w apps/api build` -- ran, compiles without errors (exit code 0).
- `npm run -w apps/api test` -- ran, 13 suites / 97 tests passed, including the new `hash-token.spec.ts` (5 tests) and `password-reset.service.spec.ts` (13 tests covering all five I/O matrix scenarios plus capitalization, non-blocking-mail, and empty-password edge cases). `refresh-token.service.spec.ts` (existing) still passes unchanged against the refactor.
- **Not run: `npx prisma migrate dev`/`migrate deploy` against a real Postgres.** Same outstanding risk as spec-1-2 — flagged for before-merge verification.
