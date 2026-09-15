---
title: 'System bootstrap and first administrator'
type: 'feature'
created: '2026-09-11'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '0c9246b469038cd961c54698c782ff3ebbb4f7af'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The project has no code yet. There is no way to run TestOS, and even once running, a fresh deployment has no way for anyone to log in.

**Approach:** Scaffold the monorepo (`apps/api` NestJS 11, `apps/web` React 19 + Vite, npm workspaces), add the first Prisma schema (`Usuario`), and make the API auto-create one Administrator account from environment variables on first startup against an empty database, gated by a Postgres health check before the API accepts traffic.

## Boundaries & Constraints

**Always:**
- `AuthModule` is the only writer of `Usuario` (AD-1) — no other module ever injects Prisma to touch it.
- All sensitive config (`DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) comes only from environment variables (AD-7) — never hardcoded, never logged.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` are required when the database has zero users; the API fails fast with a clear error naming the missing variable rather than starting in a half-configured state or auto-generating a password.
- Password is hashed with `argon2` before storage; the plaintext value is never persisted or logged.
- Bootstrap runs at most once: it only fires when the `Usuario` table is empty.
- The API verifies the Postgres connection (health check) before accepting HTTP traffic (NFR5).

**Never:**
- No login/session/RefreshToken work — that is Story 1.2. This story only creates the account.
- No Dockerfiles, docker-compose, or CI/CD — deployment packaging is separate future work; keep this story's footprint to the bootstrap behavior itself.
- No bootstrap-related frontend screen — bootstrap is fully automatic and server-side; `apps/web` only needs an empty, running shell in this story.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh DB, zero users, `ADMIN_EMAIL`/`ADMIN_PASSWORD` set | API starts | Exactly one `Usuario` row created, role Administrator, `argon2` password hash | N/A |
| Fresh DB, zero users, `ADMIN_EMAIL` or `ADMIN_PASSWORD` missing | API starts | Process exits non-zero with an error naming the missing variable | No user row created |
| DB already has ≥1 user | API starts | No new user created, no error | N/A |
| Postgres unreachable at startup | API starts | Health check fails; API does not accept HTTP traffic | Failure logged clearly; no silent accept of traffic |

</frozen-after-approval>

## Code Map

- `package.json` (root) -- new: npm workspaces root defining `apps/*`
- `apps/api/` -- new: NestJS 11 app (Nest CLI scaffold)
- `apps/api/prisma/schema.prisma` -- new: first model `Usuario` (id UUID, email unique, passwordHash, role enum, status enum, createdAt)
- `apps/api/prisma.config.ts` -- new: Prisma 7 config (`definePrismaConfig` envelope — Prisma 7 no longer reads config from `package.json`)
- `apps/api/src/auth/auth.module.ts` -- new: `AuthModule` skeleton, owns `Usuario`
- `apps/api/src/auth/bootstrap.service.ts` -- new: runs on `OnApplicationBootstrap`, creates the admin from env vars when `Usuario` is empty
- `apps/api/src/health/health.service.ts` -- new: verifies Postgres connectivity before the app accepts traffic
- `apps/api/src/main.ts` -- new: Nest bootstrap; wires health check before `listen()`
- `apps/web/` -- new: Vite + React 19 app shell, no bootstrap-specific UI
- `.env.example` -- new: documents `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- create npm workspaces root -- establishes the `apps/*` monorepo per the architecture's Structural Seed
- [x] `apps/api` -- scaffold NestJS 11 app via Nest CLI -- base for `AuthModule` and every future module
- [x] `apps/api/prisma/schema.prisma` -- define `Usuario` model -- first entity, owned by AuthModule (AD-1)
- [x] `apps/api/prisma.config.ts` -- add Prisma 7 config -- required by Prisma 7's config format
- [x] `apps/api/src/auth/auth.module.ts` + `bootstrap.service.ts` -- implement bootstrap-admin logic -- implements FR6
- [x] `apps/api/src/health/health.service.ts` -- implement Postgres connectivity check -- implements NFR5
- [x] `apps/api/src/main.ts` -- wire health check before accepting traffic, register `AuthModule`
- [x] `apps/web` -- scaffold Vite + React 19 shell -- establishes `apps/web` per Structural Seed
- [x] `.env.example` -- document required variables -- keeps AD-7 config discoverable
- [x] Unit test for `bootstrap.service.ts` covering the four I/O matrix scenarios above

**Acceptance Criteria:**
- Given a fresh Postgres database with zero rows in `Usuario`, when the API starts with `ADMIN_EMAIL`/`ADMIN_PASSWORD` set, then exactly one `Usuario` row exists afterward with role Administrator and an `argon2` password hash (never the plaintext value).
- Given the monorepo root, when running `npm install`, then both `apps/api` and `apps/web` install correctly as workspaces.
- Given `apps/web`, when running its dev server, then it serves a blank React shell with no runtime errors.

## Implementation Notes

- Prisma 7.10.0's actual published API does not export `definePrismaConfig` (only `defineConfig`/`env` from `prisma/config`), and Prisma 7 also requires a driver adapter at runtime (`@prisma/adapter-pg`) plus moves the datasource `url` out of `schema.prisma` into `prisma.config.ts`. Implemented against the verified real API instead of the illustrative snippet in Design Notes; `npm run -w apps/api build` and `npx prisma migrate dev` both confirmed working.
- Added `postinstall: prisma generate` to `apps/api/package.json` — required in Prisma 7 since the client is not otherwise generated on `npm install`.
- Verified end-to-end against a real ephemeral local Postgres (via `prisma dev`, since torn down): fresh start with admin env vars → exactly one `Usuario` row (role ADMINISTRATOR, argon2id hash, email lowercased); second start → no duplicate; unreachable `DATABASE_URL` → health check fails, clear log, process exits 1, port never opens.
- Independently re-verified by the reviewing session (this note): `npm run -w apps/api build`, `npm run -w apps/api test` (6/6 passing), and `npm run -w apps/web build` all succeed from a clean state.
- Review round 1: 3 layers (blind-hunter, edge-case-hunter, verification-gap) ran in parallel against the diff; 6 findings routed to `patch` and applied (whitespace-only admin credentials, non-numeric `PORT`, missing `HealthService` test, broken/unrun e2e spec, unused Vite assets, generic Vite placeholders), 2 routed to `defer` (logged in `deferred-work.md`), 10 rejected (low severity + non-trivial or negligible-impact fix). Re-verified independently after patching: `npm run -w apps/api build`, `npm run -w apps/api test` (8/8 passing, up from 6 — 2 new `HealthService` tests), `npm run -w apps/web build` all succeed; deleted files/scripts confirmed gone.

## Spec Change Log

## Review Triage Log

- **Health check (`HealthService.checkDatabaseConnection`) has no automated test** — `medium` — Verified: repo-wide search confirms no spec references `HealthService`/`checkDatabaseConnection`; `bootstrap.service.spec.ts` mocks `PrismaService` entirely. Deleting the `try/catch` in `main.ts` would let the API accept traffic against a dead DB with no test failing (violates NFR5 silently). Filed by verification-gap layer (pre-verified). → **patch**
- **No test exercises `main.ts`'s `bootstrap()` orchestration itself** — `low` — Verified: true, no test invokes `main.ts`. Reasonable to leave uncovered once `HealthService`'s contract is pinned (would require `process.exit` mocking disproportionate to the value); fix is more than a direct correction. → rejected
- **`PrismaService` fail-fast on missing `DATABASE_URL` has no test** — `low` (filed disposition trusted from verification-gap, pre-verified) — one-line guard on a hard-to-misconfigure path; no existing pattern in this repo for testing Prisma-extending constructors in isolation. → **defer**
- **Unused Vite-scaffold assets** (`App.css`, `hero.png`, `react.svg`, `vite.svg`) — `low` — Verified: `App.tsx` returns `null` and imports none of them; `main.tsx` only imports `index.css`. Dead code, trivial deletion. → **patch**
- **`apps/api/README.md` is unmodified Nest-CLI boilerplate; no root README** — `low` — Verified true. Writing real setup docs is more than a direct correction. → rejected
- **`apps/api/test/app.e2e-spec.ts` requires a live Postgres + `ADMIN_EMAIL`/`ADMIN_PASSWORD` to pass `app.init()` (via the now-wired `PrismaModule`/`AuthModule`), and isn't run by any `## Verification` command** — `medium` — Verified: `app.e2e-spec.ts` imports the real `AppModule`; `AppModule` now includes `PrismaModule` (throws without `DATABASE_URL`) and `AuthModule` (bootstrap requires DB + env vars). This test would fail on any clean checkout/CI without infra, and nobody would notice since it isn't run. Smallest fix is subtractive (this story has no e2e-testing requirement). → **patch**
- **Email normalization (`.trim().toLowerCase()`) is only inline in `bootstrap.service.ts`, not the "one shared place" the epic context calls for** — `low` — Verified true, but there is only one call site today; extracting a shared helper now would be a premature abstraction for a single caller. Real concern once Story 1.2/1.7 add a second call site. → **defer**
- **`argon2.hash()` called with no explicit tuning parameters** — `low` — Verified true; the `argon2` package's own defaults (argon2id, moderate cost) are already reasonable for this project's stakes. Choosing specific tuning values without benchmarking is more than a direct correction. → rejected
- **`apps/web/index.html` `<title>web</title>` and `apps/web/package.json` `"name": "web"` are generic Vite placeholders** — `low` — Verified true; fix is a direct one-line correction each. → **patch**
- **Root `package.json`'s `test` script only runs `apps/api`; no root `lint` script** — `low` — Verified true, but `apps/web` has no test script yet to run, so the "fix" needs an `--if-present`-style guard, not a direct correction. → rejected
- **`ConfigModule.forRoot({ isGlobal: true })` registered but unused; env vars read ad hoc via `process.env` in three files** — `low` — Verified true; no named concrete harm today (single reader per var), and centralizing would be a non-trivial refactor. → rejected
- **`ADMIN_EMAIL`/`ADMIN_PASSWORD` set to a whitespace-only string passes the `!email`/`!password` presence check** — `medium` — Verified true (`" "` is truthy, `!email` is `false`); creates an admin with an effectively-empty, unusable email, contradicting the documented fail-fast behavior. Fix is a direct correction (`!email?.trim()`). → **patch**
- **`app.listen(process.env.PORT ?? 3000)` passes a non-numeric `PORT` string straight through** — `low` — Verified true against Node's `net.Server.listen()` overloads (a non-numeric string is treated as a pipe path, not rejected). Fix is a direct correction (`Number(...) || 3000`). → **patch**
- **Concurrent double-start race on the bootstrap `count()`-then-`create()` check** — `low` — Real in theory, but this project deploys as a single Dokploy instance (no horizontal scaling planned); very unlikely in everyday use, and a correct fix requires branching on Prisma's unique-constraint error code — more than a direct correction. → rejected
- **`bootstrap().catch()` calls `process.exit(1)` without `app.close()` when `onApplicationBootstrap` throws during `app.listen()`'s init phase** — `low` — Real but negligible: the process terminates immediately either way, so skipping graceful Nest-level cleanup has no observable consequence. → rejected
- **`HealthService.checkDatabaseConnection()` has no timeout — a network black-hole would hang startup indefinitely instead of failing** — `low` — Real, but connection-refused (already handled) is a far more common failure mode than a silent network black-hole; adding a timeout/race introduces new configurable state not demonstrated as needed yet for a single hobby-stakes deployment. → rejected
- **`prisma.config.ts` gives Prisma's own generic error (not a named-variable error) when `DATABASE_URL` is missing at CLI time** — `low` — Real but low-impact: `dotenv/config` already loads a local `.env` first, and Prisma's own error is reasonably diagnosable. → rejected

## Design Notes

Password hashing: use `argon2` (npm package `argon2`) rather than `bcrypt` — it is OWASP's current recommendation and there is no existing-codebase precedent to match, so this is a free choice made now rather than left ambiguous.

Prisma 7 config example (`apps/api/prisma.config.ts`):
```ts
import { definePrismaConfig } from 'prisma/config'
export default definePrismaConfig({ schema: './prisma/schema.prisma' })
```

## Verification

**Commands:**
- `npm install` -- expected: installs cleanly across both workspaces
- `npm run -w apps/api build` -- expected: NestJS compiles without errors
- `npx prisma migrate dev` (in `apps/api`) -- expected: migration creates the `Usuario` table matching the schema
- `npm run -w apps/api test` -- expected: bootstrap-service unit tests pass, covering all four I/O matrix scenarios
