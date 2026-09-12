---
title: 'Temporary lockout after failed login attempts'
type: 'feature'
created: '2026-09-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'f42da08337f9b9badc3bee20ecef4519fe6cd378'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `POST /auth/login` has no defense against repeated password guessing — an attacker (or a broken client) can retry indefinitely (FR2).

**Approach:** Track consecutive failed attempts on `Usuario`. On reaching a configurable threshold, lock the account for a configurable duration and email the user (via a new shared `MailModule`, AD-9 — first story that needs to send mail). A locked account rejects login attempts with a distinct, honest message — unlike the generic "invalid credentials" from Story 1.2, an account being locked is meant to be visible to its owner. A successful login resets the counter; an expired lock clears itself on the next attempt.

## Boundaries & Constraints

**Always:**
- `AuthModule` remains the only writer of `Usuario` (AD-1); the new counter/lock fields live on the existing `Usuario` row, no new table.
- The lockout check and the failed-attempt increment happen inside `LoginService`, after the existing (already timing-safe, Story 1.2) `argon2.verify` step — a *locked* account is an intentionally distinguishable state (the user is meant to know why they can't log in), so this does not reopen the Story 1.2 timing/enumeration concern for the *other* three failure states (unknown email, wrong password, non-`ACTIVE`), which keep returning the identical generic message in constant time exactly as before.
- Threshold and duration are configurable via environment variables (`[ASSUMPTION]` defaults: `LOGIN_LOCKOUT_MAX_ATTEMPTS=3`, `LOGIN_LOCKOUT_DURATION_MINUTES=30`).
- `MailModule` (new): one shared service for all outbound email, with a configurable timeout (`[ASSUMPTION]` `MAIL_TIMEOUT_MS=5000`) and non-blocking degradation — a failed or timed-out send is logged and swallowed; it never fails the login/lockout response itself (AD-9). If `SMTP_HOST` isn't configured at all, `MailModule` logs and skips the send immediately rather than attempting a connection — this project has no SMTP provider decided yet (Deferred, per the architecture spine).
- A successful login (correct password, `ACTIVE`, not currently locked) resets `failedLoginAttempts` to `0`.
- An expired lock (`lockedUntil` in the past) is cleared (`lockedUntil: null`, `failedLoginAttempts: 0`) the next time that account is evaluated, giving the user a fresh set of attempts rather than staying "soft-locked" forever.

**Never:**
- No new table for attempt history — a running counter + a lock-until timestamp on `Usuario` is sufficient for what FR2 asks.
- No change to the three existing generic-failure states from Story 1.2 (unknown email, wrong password on an unlocked account, non-`ACTIVE` status) — they keep the exact same message, and the lockout check must not add argon2 cost or latency to those paths.
- No SMTP provider is chosen here — `MailModule` only needs a generic SMTP client wired to environment variables; picking an actual provider is a deployment decision (Deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Wrong password, 1st–2nd consecutive failure | `POST /auth/login` | `401`, generic "Invalid credentials" (unchanged from Story 1.2); `failedLoginAttempts` increments | N/A |
| Wrong password, attempt reaches the threshold | `POST /auth/login` | `401`, generic message; account is now locked (`lockedUntil` set); a lockout email is sent (best-effort) | Mail failure is logged, response is unaffected |
| Login attempt while locked (even with the correct password) | `POST /auth/login` | `401`, distinct "account temporarily locked" message | N/A |
| Login attempt after the lock has expired | `POST /auth/login` | Lock clears; evaluated as a normal login (succeeds or fails on its own merits) | N/A |
| Correct password on an unlocked, `ACTIVE` account | `POST /auth/login` | `200` as in Story 1.2; `failedLoginAttempts` resets to `0` | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/auth/login.service.ts` -- existing: add lockout-check/increment/reset logic around the existing `argon2.verify` call
- `apps/api/prisma/schema.prisma` -- existing: add `failedLoginAttempts Int @default(0)` and `lockedUntil DateTime?` to `Usuario`; new migration required
- `apps/api/src/mail/mail.module.ts` -- new: `MailModule`, provides `MailService`
- `apps/api/src/mail/mail.service.ts` -- new: `send(to, subject, body)` via `nodemailer`, generic SMTP transport from env vars, timeout + non-blocking failure handling
- `apps/api/src/auth/auth.module.ts` -- existing: import `MailModule`, inject `MailService` into `LoginService`
- `apps/api/package.json` -- add `nodemailer` (+ `@types/nodemailer` dev dep)
- `.env.example` -- document `LOGIN_LOCKOUT_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_DURATION_MINUTES`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `MAIL_TIMEOUT_MS`

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma` -- add `failedLoginAttempts`, `lockedUntil` to `Usuario` -- backs FR2
- [x] `apps/api/src/mail/mail.service.ts` + `mail.module.ts` -- generic SMTP client, timeout, non-blocking failure -- implements AD-9's `MailModule`
- [x] `apps/api/src/auth/login.service.ts` -- evaluate/clear expired lock, check active lock (distinct message), increment on failure, lock + email at threshold, reset on success -- implements FR2
- [x] `apps/api/src/auth/auth.module.ts` -- wire `MailModule` into `AuthModule`
- [x] `.env.example` -- document the new variables
- [x] Unit tests for `login.service.ts` covering all five I/O matrix scenarios (mocking `MailService`)
- [x] Unit tests for `mail.service.ts` covering: successful send, send failure (swallowed), timeout (swallowed), `SMTP_HOST` unset (skipped, no connection attempted)

**Acceptance Criteria:**
- Given an account with `LOGIN_LOCKOUT_MAX_ATTEMPTS` consecutive wrong-password attempts, when one more wrong attempt occurs, then the account's `lockedUntil` is set `LOGIN_LOCKOUT_DURATION_MINUTES` in the future and `MailService.send` is called once, regardless of whether that send succeeds.
- Given a locked account, when login is attempted with the *correct* password before `lockedUntil` passes, then the response is still `401` with the distinct locked message, not a successful login.
- Given a locked account whose `lockedUntil` has passed, when login is attempted again, then the lock is cleared and the attempt is evaluated normally.

## Implementation Notes

- `LoginService.login` splits the old single combined failure condition (`!usuario || !passwordMatches || status !== ACTIVE`) into two stages: (1) an existing user's lock status is checked (and an expired lock noted) *before* `argon2.verify` — a currently-locked account is rejected immediately without ever hashing, since "locked" is already a distinguishable response; (2) after `argon2.verify`, unknown email / non-`ACTIVE` status stay unchanged from Story 1.2 (no lockout bookkeeping, no extra DB write), while a wrong password on an existing `ACTIVE` user increments-or-locks, and a success resets-if-needed.
- `ACCOUNT_LOCKED_MESSAGE` is a new, deliberately distinct exported constant (separate from `INVALID_CREDENTIALS_MESSAGE`) per the frozen Intent's "meant to be visible to its owner" requirement.
- `MailService.send(to, subject, body)` matches the Design Notes shape exactly: it never rejects (missing `SMTP_HOST`, a transport error, and a timeout are all logged via `Logger.warn`/`Logger.error` and swallowed internally), so `LoginService` calls it with a plain `await`/`.catch(() => {})`, no try/catch needed. Timeout is implemented as a `Promise.race`-style wrapper (`withTimeout`) around `transporter.sendMail(...)`, using `MAIL_TIMEOUT_MS` both for that wrapper and for nodemailer's own `connectionTimeout`/`greetingTimeout`/`socketTimeout` options (belt-and-suspenders). `SMTP_HOST` unset short-circuits before `nodemailer.createTransport` is ever called, per the "no SMTP provider decided yet" boundary. `transporter.close()` runs in a `finally` around `sendMail` so the socket is always released.
- Env vars are read at call time in both `LoginService` (`LOGIN_LOCKOUT_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_DURATION_MINUTES`) and `MailService` (`SMTP_*`, `MAIL_FROM`, `MAIL_TIMEOUT_MS`), matching `BootstrapService`'s existing pattern of reading `process.env` directly rather than a config-injection layer (none exists in this repo yet). Both have `[ASSUMPTION]` defaults (3 attempts / 30 minutes / 5000ms) exactly as specced, used whenever the variable is unset or not a valid positive number.
- Added `nodemailer@^10.0.9` to `apps/api/package.json` and ran `npm install` so `package-lock.json`/`node_modules` stay in sync. No `@types/nodemailer` — `nodemailer@^10` ships its own bundled types, so a separate `@types` package would conflict.
- Files: `apps/api/prisma/schema.prisma` (new `Usuario` fields), `apps/api/prisma/migrations/20260912010000_add_login_lockout/migration.sql` (new), `apps/api/src/mail/mail.service.ts` + `mail.module.ts` (new), `apps/api/src/auth/login.service.ts` (lockout logic), `apps/api/src/auth/auth.module.ts` (imports `MailModule`), `.env.example` (new variables documented), `apps/api/src/auth/login.service.spec.ts` (extended with a `describe('lockout', ...)` block), `apps/api/src/mail/mail.service.spec.ts` (new).
- **Migration**: unlike Stories 1.2/1.3's sessions, this session had `npx prisma dev` (Prisma's bundled ephemeral local Postgres) available, so the migration was both diff-verified *and* actually applied and exercised end-to-end (see Verification) — no outstanding "run this before merge" risk on the migration itself.
- One test from an earlier draft was deliberately removed before finalizing: a "MailService.send rejects but the response is unaffected" case. `MailService`'s contract guarantees `send` never rejects, so mocking a rejecting `MailService` in `login.service.spec.ts` would contradict that contract and exercise a scenario that can't occur in production. The "failure is swallowed" behavior is covered where it actually lives: `mail.service.spec.ts`.
- **Review round:** fixed a critical non-atomic read-then-write on `failedLoginAttempts` (concurrent wrong-password requests could each read the same starting count and lose increments, letting an attacker exceed the threshold without tripping the lock) — now uses Prisma's atomic `{ increment: 1 }` and reads the post-increment count off the `update` call's own return value. Reordered the lock check ahead of `argon2.verify` (a locked account no longer pays the hash cost). Made `mailService.send(...)` fire-and-forget (`void ... .catch(() => {})`) in the response path so a slow SMTP server can no longer delay the HTTP response. Removed `@types/nodemailer` (conflicts with `nodemailer`'s own bundled types). Added `transporter.close()` in a `finally` in `MailService`, and fixed its fallback "from" address to match `.env.example`'s placeholder domain (`no-reply@example.com`). Reworded the class doc comment to acknowledge the residual wrong-password-vs-unknown-email DB-write timing gap (already tracked in `deferred-work.md`) instead of claiming perfect constant-time equivalence. Added `mailService.send` not-called assertions to the unknown-email, non-ACTIVE, and already-locked test cases. Re-ran the targeted suites (`login.service.spec.ts`, `mail.service.spec.ts`): all pass.
- **Independently re-verified by the reviewing session**, against a real ephemeral Postgres with all 3 migrations applied: fired 6 concurrent wrong-password `POST /auth/login` requests at once (`LOGIN_LOCKOUT_MAX_ATTEMPTS=3`) — `failedLoginAttempts` landed at exactly `6` (matching every real attempt, proving the atomic-increment fix holds under genuine concurrency; the old buggy code would very likely have under-counted), and `lockedUntil` was set correctly. Correct password while locked: still rejected with the distinct locked message, responding in ~51ms (vs. the ~100ms+ argon2-dominated paths), confirming the reordered lock-check skips the hash. Full suite independently re-run: 9 suites / 53 tests pass; lint clean.

## Spec Change Log

## Review Triage Log

- **Race condition (TOCTOU): the failed-attempt counter is read-then-written non-atomically** — `high` — Verified: `login.service.ts` reads `failedLoginAttempts` from the initial `findUnique`, computes `+1` in memory, and writes it back with a plain `update`. Concurrent wrong-password requests can all read the same starting count and each write back the same incremented value, silently losing increments — an attacker who scripts a handful of parallel requests can exceed the threshold without ever tripping the lock, defeating FR2 entirely. Flagged independently by all three review layers. Fix: use Prisma's atomic `{ increment: 1 }` and read the threshold off the update's own return value. → **patch**
- **A known-locked account still pays full `argon2.verify` cost on every request** — `medium` — Verified: the lock-status check runs *after* `argon2.verify`, so an attacker hammering an already-locked account still forces a full argon2 hash each time, undermining the CPU-cost protection lockout is partly meant to provide. Since "locked" is already an intentionally distinguishable state (own message), checking it before `argon2.verify` reveals nothing new. → **patch**
- **`mailService.send` is awaited in the response path, so a slow/hanging SMTP server delays the HTTP response by up to `MAIL_TIMEOUT_MS` (5s) on the exact attempt that crosses the lockout threshold** — `medium` — Verified true (edge-case-hunter's claim, confirmed by reading `login.service.ts`). This is both a large, attempt-specific timing signal (much bigger than the small per-request DB-write gap below) and a real UX problem (a legitimate user's request could hang for 5s). Fix: fire-and-forget the email (`MailService.send` already never rejects) instead of awaiting it in the response path. → **patch**
- **Small residual timing gap: wrong-password on a real account now does one extra DB write the unknown-email/non-ACTIVE paths don't** — `low` — Verified true (verification-gap's own filed disposition). A single indexed primary-key `UPDATE` is on the order of a few ms against argon2's ~100ms dominant cost — real but very hard to reliably exploit over a network. The file's own comment claiming "constant time exactly as before" is updated to stop overclaiming. → **defer**
- **`@types/nodemailer` installed alongside `nodemailer@^10`, which ships its own bundled types** — `low` — Verified true (documented conflict in nodemailer's own v10 migration notes); trivial to drop the now-redundant dev dependency. → **patch**
- **SMTP transporter is created fresh on every `send()` call and never closed** — `low` — Verified true; wasteful under any real volume and leaves sockets to linger after a timeout. Fix: `transporter.close()` in a `finally` block. → **patch**
- **No test asserts `mailService.send` is NOT called on the unknown-email/non-ACTIVE/already-locked paths** — `low` — Verified true; cheap to add alongside the existing per-scenario tests, closes a real (if narrow) regression-detection gap. → **patch**
- **`MailService`'s fallback "from" address (`no-reply@testos.local`) doesn't match `.env.example`'s documented placeholder (`no-reply@example.com`)** — `low` — Verified true; one-line fix to align them. → **patch**
- **No IP-based or client-based rate limiting anywhere — lockout is purely per-account, so credential stuffing across many emails never trips any single account's threshold** — `low` — Real, but systemic (spans every endpoint, not just login); no throttling dependency exists anywhere in the app yet. Same class as Story 1.3's rejected "no rate limiting" finding. → **defer**
- **The lockout mechanism itself can be weaponized against legitimate users: knowing only a victim's email, an attacker can keep re-triggering the lock indefinitely** — `low` — Real, but this is an inherent, well-known trade-off of any consecutive-failed-attempt lockout design, already implicit in the original FR2 requirement (which specifies exactly this mechanism without mentioning IP throttling, CAPTCHA, or an admin/self-unlock path) — not something this implementation introduced. Worth a future product decision, not a code fix. → **defer**
- **No upper-bound sanity check on numeric env vars (`LOGIN_LOCKOUT_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_DURATION_MINUTES`, `SMTP_PORT`)** — `low` — Real, but a misconfiguration here only makes the system *more* restrictive, not less; self-inflicted and easily corrected by whoever set the env var. → rejected
- **Lockout email doesn't tell a genuinely-locked-out owner what to do next** — `low` — Content/wording nicety, not a structural issue; easy to revise later without any code risk. → rejected

## Design Notes

`MailService.send` shape: `send(to: string, subject: string, body: string): Promise<void>` — always resolves (never rejects), logging internally on failure/timeout. Callers (like the new lockout logic) simply `await mailService.send(...)` without a try/catch, matching AD-9's "never fails the triggering operation" contract.

## Verification

**Commands:**
- `npx prisma generate` (in `apps/api`) -- ran, regenerated the client with `failedLoginAttempts`/`lockedUntil` on `Usuario`, no DB connection needed.
- `npx prisma migrate diff --from-schema <pre-change schema> --to-schema ./prisma/schema.prisma --script` -- ran without a database connection; output matches `prisma/migrations/20260912010000_add_login_lockout/migration.sql` exactly.
- `npx prisma dev` (Prisma's bundled ephemeral local Postgres) + `npx prisma migrate deploy` -- ran; all three migrations (`init`, `add_refresh_token`, `add_login_lockout`) applied cleanly against a real database.
- `npm run -w apps/api build` -- ran, compiles without errors (exit code 0).
- `npm run -w apps/api test` -- ran, 9 suites / 52 tests passed, including the extended `login.service.spec.ts` `lockout` block (7 tests covering all five I/O matrix scenarios plus the expired-lock-then-wrong-password edge case) and the new `mail.service.spec.ts` (4 tests: successful send, send failure swallowed, timeout swallowed, `SMTP_HOST` unset skips the connection).
- `npx eslint "src/**/*.ts"` (in `apps/api`) -- ran, 0 errors after `--fix` (one real fix needed: `prefer-promise-reject-errors` in `MailService.withTimeout`, now normalizes non-`Error` rejections; the rest were pure formatting).
- **Full end-to-end verification against the real ephemeral Postgres**, running the actual built API (`npm run start`) with `SMTP_HOST` unset and `LOGIN_LOCKOUT_MAX_ATTEMPTS=3` / `LOGIN_LOCKOUT_DURATION_MINUTES=30`, against the bootstrapped admin account:
  - 3 consecutive wrong-password `POST /auth/login` calls each returned `401 {"message":"Invalid credentials",...}`; the log showed exactly one `MailService` line (`Skipping email ...: SMTP_HOST is not configured`), confirming the send-at-threshold path fired exactly once.
  - A 4th attempt with the *correct* password, while still locked, returned `401 {"message":"Account temporarily locked due to too many failed login attempts. Please try again later.",...}` — the distinct message, not a successful login.
  - DB inspection confirmed `failedLoginAttempts: 3`, `lockedUntil` set to exactly 30 minutes past the moment of the third attempt.
  - After manually back-dating `lockedUntil` into the past (simulating expiry, since 30 real minutes couldn't be waited out), a correct-password login returned `200` with a valid access + refresh token, and the row was confirmed reset to `failedLoginAttempts: 0, lockedUntil: null`.
  - The ephemeral database and API process were both torn down afterward (`prisma dev stop`/`rm`); no `.env` or temp scripts were left in the working tree.
