---
title: 'Login with email and password'
type: 'feature'
created: '2026-09-11'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '49719ac87fb1611772d0348935f9867d1f660edf'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `Usuario` rows exist (Story 1.1), but nothing lets a registered user actually authenticate — there is no way in or out of the system yet.

**Approach:** Add a `POST /auth/login` endpoint that verifies email + password against the stored `argon2` hash and, on success, issues a short-lived JWT access token plus a persisted, hashed refresh token (AD-5). Wrong credentials, unknown email, and non-active accounts all return one identical generic error.

## Boundaries & Constraints

**Always:**
- `AuthModule` remains the only owner of `Usuario` and now also `RefreshToken` (AD-1).
- Password is checked with `argon2.verify` against the stored hash — plaintext is never compared or logged.
- Email lookup is normalized (trim + lowercase) through one shared helper used by both this story and `bootstrap.service.ts` — resolves the centralization item logged in `deferred-work.md`.
- Wrong password, unknown email, and a non-`ACTIVE` user status all return the exact same generic "invalid credentials" response — never reveal which.
- The JWT signing secret comes from `JWT_SECRET` (AD-7, env var); the access token is short-lived (`[ASSUMPTION: 15 minutes]`, AD-5).
- The refresh token itself is a random, high-entropy value; only its SHA-256 hash is persisted (`RefreshToken.tokenHash`) — the raw value is returned to the client once and never stored.

**Never:**
- No `@Roles`/RBAC guard infrastructure — no endpoint needs role-protection yet (login is public). That lands with whichever later story first protects a route.
- No refresh/renewal endpoint or token rotation — that is Story 1.5.
- No logout/revocation endpoint — that is Story 1.3.
- No lockout-after-failed-attempts logic — that is Story 1.4.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Correct email + password, user `ACTIVE` | `POST /auth/login` | `200` with `{ accessToken, refreshToken }` | N/A |
| Correct email, wrong password | `POST /auth/login` | `401`, generic "invalid credentials" | Same shape/message as unknown email |
| Unknown email | `POST /auth/login` | `401`, generic "invalid credentials" | Same shape/message as wrong password |
| Email with different capitalization than stored | `POST /auth/login` | `200`, resolves to the same user | N/A |
| User status is `PENDING_VERIFICATION` or `DEACTIVATED` | `POST /auth/login` | `401`, same generic "invalid credentials" | Never reveals account status |

</frozen-after-approval>

## Code Map

- `apps/api/src/auth/bootstrap.service.ts` -- existing, reuse: only current `Usuario` writer; will switch to the new shared email-normalization helper instead of its inline `.trim().toLowerCase()`
- `apps/api/prisma/schema.prisma` -- existing: add `RefreshToken` model + relation field on `Usuario`; new migration required
- `apps/api/src/prisma/prisma.service.ts` -- existing, reuse as-is, no changes needed
- `apps/api/src/auth/auth.module.ts` -- existing: register the new controller/services, import `JwtModule`
- `apps/api/src/common/normalize-email.ts` -- new: shared `normalizeEmail()` helper
- `apps/api/src/auth/login.controller.ts` -- new: `POST /auth/login`
- `apps/api/src/auth/login.service.ts` -- new: verifies credentials, issues access + refresh tokens
- `apps/api/src/auth/refresh-token.service.ts` -- new: generates/hashes refresh tokens (kept separate so Story 1.5's rotation logic has one place to extend)
- `.env.example` (root) -- add `JWT_SECRET`
- `apps/api/package.json` -- add `@nestjs/jwt` dependency

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma` -- add `RefreshToken` model (id, userId, tokenHash unique, expiresAt, revoked default false, createdAt) + `Usuario.refreshTokens` relation -- backs AD-5
- [x] `apps/api/src/common/normalize-email.ts` -- add shared `normalizeEmail()` -- resolves deferred centralization item
- [x] `apps/api/src/auth/bootstrap.service.ts` -- switch to `normalizeEmail()` -- keeps the two call sites consistent
- [x] `apps/api/src/auth/refresh-token.service.ts` -- generate a random token, persist its SHA-256 hash with expiry -- implements the refresh-token half of AD-5
- [x] `apps/api/src/auth/login.service.ts` -- look up by normalized email, `argon2.verify`, check `status === 'ACTIVE'`, sign JWT access token, issue refresh token -- implements FR1
- [x] `apps/api/src/auth/login.controller.ts` -- `POST /auth/login`, maps all failure paths to one generic 401 -- implements the I/O matrix's error scenarios
- [x] `apps/api/src/auth/auth.module.ts` -- wire `JwtModule.register` with `JWT_SECRET` and the new providers/controller
- [x] `.env.example` -- document `JWT_SECRET`
- [x] Unit tests for `login.service.ts` covering all five I/O matrix scenarios

**Acceptance Criteria:**
- Given a user created by Story 1.1's bootstrap, when logging in with the correct email (any capitalization) and password, then the response includes a valid JWT access token and a refresh token, and exactly one new `RefreshToken` row exists with a hashed (not plaintext) value.
- Given three failure inputs (wrong password, unknown email, non-`ACTIVE` status), when each is submitted to `POST /auth/login`, then all three produce byte-identical response bodies.

## Implementation Notes

- Used `@nestjs/jwt@^11.0.2`, not the newer `12.x` — `12.x` ships as an ESM-only package (`"type": "module"`, `dist/index.js` uses bare `import`/`export`), which fails under this repo's CommonJS `ts-jest` setup with `Must use import to load ES Module`. `11.0.2` has no `"type"` field (plain CommonJS) and its peer range (`^8‖^9‖^10‖^11` of `@nestjs/common`) matches this repo's Nest 11. Confirmed via `npm view @nestjs/jwt@11.0.2 type` (empty/CJS) vs `@nestjs/jwt@12.0.1` (`module`).
- `JwtModule` is wired with `registerAsync`/`useFactory` rather than `register({ secret: ... })` directly: the factory throws `Missing required environment variable: JWT_SECRET` only when Nest instantiates the module inside `NestFactory.create()`, so a missing secret is caught by `main.ts`'s existing top-level `bootstrap().catch(...)` handler exactly like `PrismaService`'s missing-`DATABASE_URL` fail-fast — not as a raw uncaught exception at import time (which a plain `getJwtSecret()` called inside the `@Module({...})` decorator arguments would have produced, since decorator arguments evaluate at class-definition/import time, before `bootstrap()` ever runs).
- Login failure paths (wrong password, unknown email, non-ACTIVE status) all throw the same `UnauthorizedException(INVALID_CREDENTIALS_MESSAGE)` from `login.service.ts` directly — Nest's built-in exception filter then serializes all three to the identical `{"statusCode":401,"message":"Invalid credentials","error":"Unauthorized"}` body, satisfying the byte-identical acceptance criterion without the controller needing its own mapping layer beyond a manual guard on missing/empty `email`/`password` fields (no `class-validator`/`ValidationPipe` exists in this repo yet, so that guard is a plain `typeof`/length check that also fails into the same generic 401).
- Refresh token TTL: the spec's Design Notes and I/O matrix don't state one, only the access token's `[ASSUMPTION: 15 minutes]`. Set `RefreshTokenService`'s TTL to a separate `[ASSUMPTION: 30 days]` (long-lived relative to the 15-minute access token, so a client isn't forced back to a password prompt every 15 minutes) — flagging this as an assumption for renegotiation since it isn't pinned by AD-5 or the frozen Intent.
- **Migration caveat (risk):** this sandbox has no reachable Postgres and no Docker, so `npx prisma migrate dev` could not be run against a real database (it errors immediately without a configured `datasource.shadowDatabaseUrl`/live connection). Instead, generated the exact DDL Prisma's own engine would produce via a purely schema-to-schema diff — `npx prisma migrate diff --from-schema <pre-change schema.prisma> --to-schema ./prisma/schema.prisma --script` — which needs no database connection, and hand-placed its output verbatim into `prisma/migrations/20260912001925_add_refresh_token/migration.sql` (same mechanism/format as the existing `20260911234648_init` migration). This should be byte-identical to what `prisma migrate dev` would have written, but it has not been applied against a real Postgres instance in this session. **Before merging, run `npx prisma migrate dev` (or at minimum `prisma migrate deploy`) against a real database once to confirm it applies cleanly.**
  - **Resolved by the reviewing session:** ran `npx prisma migrate deploy` against a real ephemeral local Postgres (`prisma dev`). Both migrations applied cleanly. Full end-to-end verification against that real database: login with a differently-capitalized email succeeded (`200`, valid JWT with a 900s/15min `exp-iat`, 64-hex-char refresh token); wrong password, unknown email, and empty body all produced byte-identical `401` bodies; exactly one `Usuario` row and one `RefreshToken` row existed afterward, with `tokenHash` a 64-hex SHA-256 digest, never the raw value. Ephemeral database and API process torn down afterward.
  - **Re-verified after the review-patch round** (timing-side-channel fix): against a second fresh ephemeral database, correct login took ~182ms; unknown-email and wrong-password both took ~100-110ms (previously the unknown-email path returned near-instantly) and produced byte-identical response bodies — the timing gap is closed. Full suite independently re-run: 7 suites / 30 tests pass.
- `npm install --workspace=apps/api` hoisted `@nestjs/jwt` into `apps/api/node_modules/` rather than the repo root `node_modules/` (npm's dedupe algorithm's choice, not a manual placement) — functionally equivalent, just noting it since every other Nest package here lives at the root.

## Spec Change Log

## Review Triage Log

- **Timing side-channel: unknown-email returns before `argon2.verify`, wrong-password always pays its cost** — `medium` — Verified: `login.service.ts`'s `if (!usuario)` branch throws immediately; the wrong-password and non-`ACTIVE` branches always run `argon2.verify` first. Response bodies are byte-identical but the latency gap lets an attacker enumerate valid emails — the exact leak the frozen Boundaries say must never happen ("never reveal which"). Flagged independently by all three review layers. Fix: always run `argon2.verify` against a real-or-dummy hash before branching on user existence. → **patch**
- **`RefreshTokenService`'s real hash/persistence logic is never executed by any test** — `medium` — Verified: `login.service.spec.ts` fully mocks `RefreshTokenService`; no test asserts `tokenHash` is a SHA-256 digest of the raw value rather than the raw value itself — exactly this story's own acceptance criterion. Filed by verification-gap layer (pre-verified). → **patch**
- **`LoginController`'s manual validation guard has no test at any level** — `medium` — Verified: no `login.controller.spec.ts` exists; if the guard were weakened, malformed input would reach `normalizeEmail(undefined)` and throw an uncaught `TypeError` (500) instead of the documented 401. Filed by verification-gap layer (pre-verified). → **patch**
- **No test for the new shared `normalizeEmail()` helper** — `low` — Verified true; trivial to add, and it's now security-relevant shared infrastructure (two call sites depend on it). → **patch**
- **No upper length bound on `email`/`password` before they reach `argon2.verify`** — `low` — Verified: the controller's existing guard checks type/non-empty only. A very long password adds proportional (not catastrophic) `argon2` cost, but a length cap is a one-line extension of the guard block that already exists for the same purpose. → **patch**
- **`AuthModule`'s `JWT_SECRET` fail-fast and 15-minute TTL are never exercised by a test** — `low` (filed disposition trusted from verification-gap, pre-verified) — mirrors the pre-existing, already-accepted `PrismaService`/`DATABASE_URL` fail-fast convention from Story 1.1, which is likewise untested. → **defer**
- **Redundant double invocation of `service.login(...)` in `login.service.spec.ts`'s failure-path tests** — `low` — Verified true, but no real bad outcome (tests still pass correctly, just call the mocked/real path twice) — purely a test-style nit. → rejected
- **`RefreshToken` FK is `ON DELETE RESTRICT` with no expired-token cleanup job** — `low` — Verified true, but there is no user-deletion capability anywhere in the current scope for this to block yet, and a cleanup job is more than a direct correction. → rejected
- **30-day refresh-token TTL assumption noted in prose but not logged in `## Spec Change Log`** — its fix is to edit this build's spec, which is explicitly excluded from patching. → rejected (out of scope by rule)
- **`package-lock.json` renames `web`→`testos-web`** — `false` — Verified: this is `npm install` correctly catching up the lockfile to `apps/web/package.json`'s name, which was already deliberately renamed and approved during Story 1.1's review round — not a new or undocumented change from this story.
- **No DB-level case-insensitive uniqueness constraint (`citext`/expression index) on `Usuario.email`** — `low` — Verified true (uniqueness is enforced only at the normalized-string level, in application code), but no code path today bypasses `normalizeEmail()`, and a schema-level constraint is more than a direct correction. → rejected
- **`argon2.verify` could throw (not just return `false`) on a malformed stored hash, yielding a 500 instead of 401** — `low` — Verified: the only writer of `passwordHash` (`bootstrap.service.ts`) always calls `argon2.hash()` first, so no code path today can produce a malformed hash; unreachable in current scope. → rejected

## Design Notes

Refresh token generation: `crypto.randomBytes(32).toString('hex')` for the raw value; store `crypto.createHash('sha256').update(raw).digest('hex')` as `tokenHash`. SHA-256 (not `argon2`) is appropriate here — the token is already high-entropy random data, not a low-entropy human password, so a fast hash is both sufficient and avoids needless CPU cost on every refresh lookup.

## Verification

**Commands:**
- `npx prisma validate` (in `apps/api`) -- ran, schema is valid. Ran in place of `npx prisma migrate dev`, which could not run: no reachable Postgres/Docker in this sandbox (see Implementation Notes' migration caveat). `npx prisma generate` also ran successfully and produced a `RefreshToken`-aware client.
- `npx prisma migrate diff --from-schema <pre-change schema> --to-schema ./prisma/schema.prisma --script` -- ran without a database connection; output matches `prisma/migrations/20260912001925_add_refresh_token/migration.sql` exactly.
- `npm run -w apps/api build` -- ran, compiles without errors (exit code 0).
- `npm run -w apps/api test` -- ran, 4 suites / 15 tests passed, including the new `login.service.spec.ts` (6 tests covering all five I/O matrix scenarios plus the byte-identical-failure-body acceptance check).
- `npx eslint "src/**/*.ts"` (in `apps/api`, not in the spec's original list but run as a repo-standard check) -- ran, 0 errors after `--fix` for formatting-only issues.
- **Not run: `npx prisma migrate dev` against a real Postgres.** This is the one command from the original list that could not be executed in this environment — flagged as the main outstanding risk before merge.
