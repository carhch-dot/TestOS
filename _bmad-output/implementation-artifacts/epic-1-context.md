# Epic 1 Context: User Access and Account Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Anyone can sign in securely, recover a forgotten password, and an Administrator can invite, manage, and deactivate users under the correct role (Administrator, Manager, Editor, Read-only). This epic is fully self-contained: there is no inventory yet, but the system is already usable end-to-end as an access-control manager (login, invitation, role change, lockout after failed attempts), and it is the entry gate every later epic depends on — nothing else in the system makes sense without identity, sessions, and roles in place.

## Stories

- Story 1.1: System bootstrap and first administrator
- Story 1.2: Login with email and password
- Story 1.3: Logout
- Story 1.4: Temporary lockout after failed login attempts
- Story 1.5: Transparent session renewal
- Story 1.6: Password recovery
- Story 1.7: Invite users and activate account
- Story 1.8: List, deactivate, and reactivate users
- Story 1.9: Change user role
- Story 1.10: Force password reset for another user
- Story 1.11: Password policy

## Requirements & Constraints

- On first startup with zero users in the database, the system auto-creates one Administrator account; credentials come only from environment variables, never hardcoded or logged. On any later startup with existing users, no additional admin is created.
- Login validates the password against its stored hash (never plaintext) and returns a short-lived access token plus a refresh token. Invalid credentials return one generic error that never reveals which field was wrong.
- User email matching must be case-insensitive (normalize consistently, e.g. uppercase, in one shared place) to avoid duplicate accounts from capitalization differences alone.
- Logout revokes the active refresh token immediately; any later use of that token must fail.
- While a session is valid, the client can silently renew it without forcing re-login.
- Repeated consecutive failed logins temporarily lock the account and trigger an email notification; a locked account rejects even correct credentials until the lockout expires. Reference values (configurable): 3 failed attempts → 30 minute lockout.
- Password recovery sends a one-time, short-expiry link by email; the response is identical whether or not the email belongs to a real account (never reveal existence). Reference expiry: 1 hour. A used or expired link is rejected.
- Only Manager and Administrator can invite new users (one-time activation link, configurable expiry, reference: 7 days) or force another user's password reset. Invited users start "pending verification" with no usable password until they activate.
- Only Manager and Administrator can list, deactivate, and reactivate users; deactivating a user blocks their login but must not touch their existing audit history.
- Only Administrator can change another user's role (one of the four valid roles), effective immediately.
- New passwords must meet a configurable minimum complexity and must not repeat the user's last N passwords (reference: N=3) across registration, reset, and change flows. Note: Story 1.7's activation flow only enforces "non-empty" — full complexity/reuse enforcement is added later by Story 1.11 over that same flow.
- Session/token behavior: revocation must be explicit and immediate (logout, password change), never dependent on natural expiry; the signing secret must be rotatable.

## Technical Decisions

- Monolithic backend (NestJS), modular by domain; this epic owns and is the only writer of `Usuario` and `RefreshToken` (AuthModule). No other module ever injects Prisma to write these entities directly.
- Story 1.1 is also responsible for bootstrapping the monorepo from scratch: `apps/api` (NestJS 11 + Prisma 7 + PostgreSQL 18.x) and `apps/web` (React 19 + Vite 8), plus the initial `Usuario` schema and a startup health check that verifies the Postgres connection before the API accepts traffic.
- Auth: short-lived JWT access token (reference: 15 minutes) + opaque refresh token persisted in Postgres (user, token hash, expiry, revoked flag), rotated on every use. A reused/replayed refresh token revokes the user's entire token chain, not just that token.
- RBAC is declarative: every endpoint declares allowed roles via a `@Roles(...)` decorator resolved by one global guard — no manual role `if` checks in handlers. One controller per entity.
- All mutations happen only in each module's service layer; controllers never call Prisma directly.
- No Organization/Tenant entity — roles are global to a single instance (no multi-tenancy).
- All sensitive config (DB connection string, JWT signing secret, SMTP credentials) comes from environment variables injected at deploy time; nothing sensitive is committed to the repo.
- Outbound email (lockout notice, password recovery, invitations) goes through one shared `MailModule` with a configurable timeout and non-blocking degradation: if sending fails or times out, the triggering operation (login attempt, invite, etc.) still completes, and only the mail failure is logged.
- Conventions used throughout: UUID v4 for all entity IDs, ISO-8601 UTC timestamps, paginated list responses shaped as `{ data, total, page, pageSize }`, structured JSON logging to stdout.

## Cross-Story Dependencies

- Story 1.1 must land first — it creates the monorepo, the `Usuario` schema, and the bootstrap admin that every later story (and every other epic) builds on.
- Story 1.2 (login) depends on the schema and password-hash handling established in 1.1, and is the flow that Story 1.7's activation ultimately hands the user into.
- Story 1.5 (renewal) and Story 1.3 (logout) both depend on the refresh-token model introduced by Story 1.2.
- Story 1.7's activation endpoint intentionally accepts a weak (non-empty) password; Story 1.11 later tightens that same code path with real complexity/reuse rules — implement 1.11's validation as a shared check both stories call, not a duplicate.
- Story 1.6 (self-service recovery) and Story 1.10 (admin-forced reset) should share the same reset-link mechanism rather than two parallel implementations.
- This epic has no dependency on any other epic — it is the foundation Epics 2–7 build on (all later RBAC checks and the "acting user" on every audit record originate here).
