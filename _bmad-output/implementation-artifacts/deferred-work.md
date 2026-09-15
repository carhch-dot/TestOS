- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-system-bootstrap-and-first-admin.md`
  summary: PrismaService's fail-fast on a missing DATABASE_URL has no unit test.
  evidence: One-line guard clause on a hard-to-misconfigure path; no existing pattern in this repo for testing Prisma-extending service constructors in isolation, so the added test scaffolding would be disproportionate to the risk right now.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-system-bootstrap-and-first-admin.md`
  summary: Centralize email normalization (trim + lowercase) into one shared helper instead of leaving it inline in bootstrap.service.ts.
  evidence: RESOLVED by Story 1.2 — `apps/api/src/common/normalize-email.ts` now backs both `bootstrap.service.ts` and `login.service.ts`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-login-with-email-and-password.md`
  summary: AuthModule's JWT_SECRET fail-fast and the 15-minute access-token TTL are never exercised by any test.
  evidence: Mirrors the pre-existing, already-accepted PrismaService/DATABASE_URL fail-fast convention from Story 1.1, which is likewise untested — no existing pattern in this repo for testing a NestJS module's async factory in isolation, disproportionate to the risk right now.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-logout.md`
  summary: No cleanup/expiry job for revoked or expired RefreshToken rows — the table grows unboundedly as users log in and out.
  evidence: Raised independently in Story 1.2's review (FK is ON DELETE RESTRICT), Story 1.3's review (no purge mechanism), and now Story 1.5 adds a rotation-on-every-renewal write path onto the same unbounded table. Real for a long-lived deployment, but there is no user-deletion feature yet for the FK concern to block, and building a cleanup job now is more than any one story's scope. Revisit once the table's growth or a deletion feature makes it concrete.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-transparent-session-renewal.md`
  summary: The loser of a concurrent refresh-token race can revoke the winner's brand-new token if its chain-wide revocation write lands after the winner's new-token insert commits.
  evidence: `RefreshTokenService.revokeAllForUser`'s `where: { userId }` has no time cutoff excluding rows created during the exact rotation in progress. A fully correct fix needs per-user serialization (a `SELECT ... FOR UPDATE` advisory lock around the whole consume-then-issue-or-revoke sequence) — real architecture, not a simple correction. Only matters when a token is already being actively replayed concurrently (something has already gone wrong); the fallback outcome (both parties end up logged out) is an acceptable fail-safe for an already-anomalous condition.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-transparent-session-renewal.md`
  summary: If JWT signing or refresh-token issuance throws after the old refresh token was already consumed/revoked, the caller is left without a working session despite nothing malicious happening.
  evidence: Low-probability (would typically coincide with a broader systemic failure — DB down, OOM — that breaks other endpoints too); a fully atomic fix needs a DB transaction wrapping sign+issue, disproportionate for the likelihood involved at this stage.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-lockout-after-failed-attempts.md`
  summary: Small residual timing gap — a wrong-password attempt on a real, unlocked account now performs one extra DB write that the unknown-email/non-ACTIVE paths don't.
  evidence: A single indexed primary-key UPDATE (~few ms) against argon2's ~100ms dominant verify cost — real but very hard to reliably exploit via network timing analysis. Filed by the verification-gap review layer.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-lockout-after-failed-attempts.md`
  summary: No IP-based or client-based rate limiting anywhere in the app — lockout is purely per-account, so credential stuffing across many different emails never trips any single account's threshold.
  evidence: Systemic concern spanning every endpoint, not just login; no throttling dependency (`@nestjs/throttler` or similar) exists anywhere yet. Same class of gap as the rate-limiting finding rejected in Story 1.3's review.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-lockout-after-failed-attempts.md`
  summary: The lockout mechanism itself can be weaponized against legitimate users — knowing only a victim's email, an attacker can keep re-triggering the lock indefinitely.
  evidence: An inherent, well-known trade-off of any consecutive-failed-attempt lockout design, already implicit in FR2's original requirement (which specifies exactly this mechanism without mentioning IP throttling, CAPTCHA, or an admin/self-unlock path). Worth a future product decision (e.g. an admin-unlock path, or a self-unlock-via-email link) rather than a code fix to this story.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-password-recovery.md`
  summary: `POST /auth/forgot-password` and `POST /auth/reset-password` have no rate limiting, so an attacker can flood a victim's inbox with reset emails or brute-force the (256-bit, so infeasible in practice) reset token.
  evidence: Same systemic, app-wide gap already tracked from Story 1.4's review (no `@nestjs/throttler` or equivalent anywhere yet) — these two new public endpoints inherit it, not a defect introduced by this story specifically.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-password-recovery.md`
  summary: `PasswordResetToken` has no cleanup/expiry job — the table grows unboundedly, and faster than `RefreshToken` since every `forgot-password` call (including retries) inserts a new row regardless of whether any prior token was ever used.
  evidence: Same class of gap already tracked for `RefreshToken` (Story 1.3's entry above); real for a long-lived deployment, but building a shared cleanup job now is more than any one story's scope. Revisit both tables together once growth or a deletion feature makes it concrete.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-password-recovery.md`
  summary: `PasswordResetService.confirmReset` runs its consume-token, hash+update-password, and revoke-sessions steps as sequential awaits rather than inside a single transaction; a failure between steps can permanently burn the token without changing the password, or change the password without revoking old sessions.
  evidence: Same pre-existing pattern as `RenewalService.renew`'s unwrapped consume-then-issue sequence (spec-1-5 entry above) — no `$transaction` call exists anywhere in this codebase yet. Low-probability (would typically coincide with a broader systemic failure), and a proper fix is a codebase-wide transactional convention, not a one-story patch.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-invite-users-and-activate-account.md`
  summary: `InvitationToken` has no cleanup/expiry job — the table grows unboundedly, same as `RefreshToken` and `PasswordResetToken`.
  evidence: Same class of gap already tracked for those two tables (Story 1.3/1.6 entries above); every `forgot-password`-style resend also inserts a new row. Revisit all three tables together once growth or a deletion feature makes it concrete.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-invite-users-and-activate-account.md`
  summary: `POST /auth/invite` and `POST /auth/activate` have no rate limiting.
  evidence: Same systemic, app-wide gap already tracked from Story 1.4's review and extended to `forgot-password`/`reset-password` in Story 1.6 — these two new endpoints inherit it, not a defect introduced by this story specifically.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-invite-users-and-activate-account.md`
  summary: `InviteService.invite`'s resend branch runs its role-update, token-invalidation, and new-token-create steps as separate un-transactioned awaits; two concurrent resends for the same still-pending user could each interleave and leave two simultaneously-valid `InvitationToken` rows for that one user (a mostly-cosmetic redundancy — `activate()`'s status re-check, added in this story's review, independently prevents either row from being usable against an already-activated account).
  evidence: Same pre-existing no-`$transaction`-anywhere pattern already logged for `PasswordResetService.confirmReset`/`RenewalService.renew` (spec-1-5/1-6 entries above) and for `activate()`'s own consume-then-update sequence in this same story. A proper fix is the same codebase-wide transactional convention noted there, not a one-story patch.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-list-deactivate-reactivate-users.md`
  summary: `UsersService.deactivate`/`reactivate` each do a `findUnique`-then-`update` with no atomic conditional update or transaction — two concurrent calls on the same user id can both pass the initial status check and clobber each other; `deactivate`'s status flip and its `revokeAllForUser` call are likewise two separate un-transactioned awaits.
  evidence: Same pre-existing no-`$transaction`-anywhere pattern already logged repeatedly (spec-1-5/1-6/1-7 entries above). A proper fix is the same codebase-wide transactional convention noted there, not a one-story patch.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-list-deactivate-reactivate-users.md`
  summary: There is no dedicated action to unlock a `LOCKED` (temporarily-locked) user early — `reactivate` no-ops whenever the target's raw `status` is already `ACTIVE`, which it still is while merely locked, so an admin has no direct way to clear `lockedUntil` before it naturally expires.
  evidence: A `deactivate`-then-`reactivate` round trip on the same user works as an unintentional, non-obvious workaround today (deactivate doesn't no-op on a `LOCKED` target; the follow-up reactivate hits the real `DEACTIVATED → ACTIVE` path, which does clear the lock). Worth a dedicated action in a future story — Story 1.10 ("force password reset for another user") is a natural place to also clear a lock, since both are admin-assisted account-recovery actions.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-change-user-role.md`
  summary: `UsersService.changeRole`'s `usuario.update` and `refreshTokenService.revokeAllForUser` run as separate un-transactioned awaits; a failure between them leaves the new role committed without the promised session revocation.
  evidence: Same pre-existing no-`$transaction`-anywhere pattern already logged repeatedly (spec-1-5/1-6/1-7/1-8 entries above). A proper fix is the same codebase-wide transactional convention noted there, not a one-story patch.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-change-user-role.md`
  summary: A demoted or deactivated user's already-issued access token keeps working with their old role/session validity for up to its ~15-minute life — `changeRole`/`deactivate` revoke refresh tokens (blocking renewal) but cannot invalidate an already-signed stateless JWT.
  evidence: Inherent to the short-lived-JWT design accepted since Story 1.5 (claims go stale by design, refreshed only at renewal) — true of `deactivate` too, but more security-relevant for role changes specifically: a just-caught malicious or compromised Administrator keeps elevated privileges in-flight briefly. A real fix needs token revocation infrastructure (e.g. a short-lived denylist) not built anywhere in this codebase; disproportionate for a single story.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-10-force-password-reset.md`
  summary: `UsersService.forcePasswordReset` checks the target's status, then `PasswordResetService.requestReset` independently re-checks it — if the status flips in between (a concurrent admin action), `requestReset` silently no-ops but `forcePasswordReset` still returns `200` using its stale pre-fetch, misleading the caller into thinking the email was sent.
  evidence: Narrow race (requires another admin action landing in the exact window between two back-to-back DB reads). A proper fix needs either a transaction (same pre-existing no-`$transaction`-anywhere pattern already logged repeatedly above) or changing `PasswordResetService.requestReset`'s return contract, which spec-1-10 explicitly keeps unmodified by design (reuses Story 1.6's mechanism as-is).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-10-force-password-reset.md`
  summary: An authenticated Manager/Administrator can loop over every user id and fire a reset email at each of them via `POST /users/:id/force-reset-password`, with no throttle.
  evidence: Same systemic, app-wide no-rate-limiting gap already tracked from Story 1.4's review and extended to `forgot-password`/`reset-password` in Story 1.6 — this new endpoint inherits it, not a defect introduced by this story specifically.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-11-password-policy.md`
  summary: The new `400` (password-policy violation) vs `401` (token/credential problem) split on `activate`/`confirmReset` is a binary oracle for "is this token currently valid," contradicting Story 1.6's frozen boundary that such cases "must all be indistinguishable to the caller."
  evidence: Genuine tension between 1.6's boundary and 1.11's own AC, which explicitly requires an informative message naming the unmet policy requirement — the two can't both be fully satisfied. Practical exploitability is low: the oracle only has value to someone who already possesses a candidate 256-bit token, at which point submitting a *compliant* password achieves full account takeover directly, so the oracle adds no capability a valid-token holder doesn't already have. Revisit if either boundary is renegotiated.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-11-password-policy.md`
  summary: A policy-rejected `activate`/`confirmReset` attempt never burns its token (by design, for retryability), so an attacker holding one valid token can force unlimited `argon2.verify` calls (up to `PASSWORD_HISTORY_COUNT + 1` per request) with no throttle.
  evidence: Real new cost-multiplier, but extends the already-accepted systemic no-rate-limiting gap (Story 1.4/1.6/1.10 entries above) rather than introducing a new vulnerability class.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-11-password-policy.md`
  summary: `requestReset` doesn't invalidate prior unused `PasswordResetToken` rows when issuing a new one (unchanged since Story 1.6), so two valid tokens for the same user confirmed concurrently can race past `confirmReset`'s non-atomic read-check-write sequence and corrupt `previousPasswordHashes`; `InviteService.activate` has a narrower analogous window between its status re-check and its final `usuario.update`.
  evidence: Incremental worsening (history corruption, not just which password wins) of a pre-existing gap — no `$transaction` exists anywhere in this codebase (same class already logged repeatedly for spec-1-5/1-6/1-7/1-8/1-9).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-11-password-policy.md`
  summary: `PASSWORD_MIN_LENGTH`/`PASSWORD_HISTORY_COUNT` have no upper bound; a `PASSWORD_MIN_LENGTH` set at or above the controllers' hardcoded `MAX_PASSWORD_LENGTH = 1024` would make every password submission fail.
  evidence: Self-inflicted operator misconfiguration, not reachable through normal use — matches this codebase's existing pattern of not upper-bounding configurable env vars (`LOGIN_LOCKOUT_*`, `INVITATION_TOKEN_TTL_DAYS` are equally unbounded).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-11-password-policy.md`
  summary: `PasswordResetService.confirmReset` never re-checks the target `Usuario.status === ACTIVE` before resetting a password.
  evidence: Pre-existing since Story 1.6, not introduced by spec-1-11 (only surfaced during its review, which added the `Usuario` fetch for the policy check but didn't add or remove this check). Bounded impact: `confirmReset` never touches `status` itself, so a deactivated target stays unable to log in regardless — `LoginService` independently gates on `status === ACTIVE`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-immutable-audit-log.md`
  summary: `AuditService.record()`'s central atomicity guarantee (an audit row lives or dies with the transaction it accompanies) is asserted by the spec but never exercised against a real `prisma.$transaction` — the unit test only proves a rejected `tx` call propagates rather than being swallowed, not that a real rollback actually leaves zero rows.
  evidence: Every existing test in this codebase runs against a fully mocked `PrismaService` with no live-DB dependency; adding one test that requires a reachable Postgres would break that portability property for `npm test`. Needs dedicated integration-test infrastructure (e.g. a `test:e2e`-style suite gated behind `DATABASE_URL`) rather than an ad-hoc addition to the unit-test file — worth building once a real domain module (Epic 3+) becomes the first actual caller and there's a concrete write path to test end-to-end.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-immutable-audit-log.md`
  summary: `Prisma.TransactionClient` is a structural subtype of `PrismaClient`, and `PrismaService extends PrismaClient` — so a future caller can pass the plain top-level `PrismaService` to `AuditService.record(tx, ...)` instead of a real transaction client, and TypeScript will not catch it. This would silently defeat the atomicity guarantee that is this story's entire reason to exist.
  evidence: No cheap fix exists — a nominal/branded wrapper type would need Prisma-level type machinery not used anywhere else in this codebase, and would not stop a determined caller from casting around it either. This is fundamentally a code-review-discipline concern for whoever writes the first real caller (Epic 3+): reviewers of that PR must verify `record()` is called with a value actually obtained from `prisma.$transaction(async (tx) => ...)`, not `PrismaService` itself.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-immutable-audit-log.md`
  summary: No plan yet for how Epic 7's bulk-reimport exception ("audits its run as one event, not per item," per AD-3) will fit `RegistroAuditoria`'s current one-row-per-entity shape.
  evidence: Speculative this far out — Epics 3 through 6 come first, and Epic 7 hasn't been specced yet. Revisit when that story is actually planned rather than guessing at a batch-event shape (a batch id column? a new `TipoAccion` value? a different `entidadId` convention?) now.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-query-audit-history.md`
  summary: No note anywhere flags that a future module's `cambios` payload (Epic 3+, caller-shaped JSON per `AuditService.record`) will be visible to every authenticated role via `GET /audit`, with no redaction mechanism.
  evidence: Speculative — no real `record()` caller exists yet (spec-2-1). Worth a conscious check by whoever builds the first real caller (Inventory/Relations/Change Requests/Import) on what's appropriate to put in `cambios`, given it's readable by Editor/Read-only too.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-query-audit-history.md`
  summary: RESOLVED by spec-3-2's review — `AuditController.list`'s `usuarioId`/`entidad`/`entidadId` now reject a repeated query key (parsed as an array) with a clean `400` via a shared `parseOptionalStringFilter` helper, fixed alongside the identical bug found in the new `InventoryController.list`.
  evidence: n/a — fixed, not deferred.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-search-list-items.md`
  summary: `GET /items`'s `texto` filter (`contains`/`mode: insensitive` substring search across `nombre`/`descripcion`) has no supporting index — a leading-wildcard scan that no B-tree index (including `nombre`'s unique index) can serve efficiently as the catalog grows.
  evidence: Closing it needs a `pg_trgm`/GIN trigram index, infrastructure not used anywhere else in this codebase yet. Worth building once the catalog's real size makes the scan cost concrete, not speculatively now.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-search-list-items.md`
  summary: `InventoryService.list`'s `findMany`/`count` run via `Promise.all`, not inside a transaction — `total` can drift from the returned page under concurrent writes.
  evidence: Same pre-existing pattern already logged for `AuditService.list`/`UsersService.list` (spec-2-2/1-8 entries) — not a new gap introduced by this story. A proper fix is the same codebase-wide transactional convention noted there.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-search-list-items.md`
  summary: `GET /items`'s `page` cap of 200 (copied from `AuditController`, where "recent-first" access makes it a reasonable ceiling) is unexamined for an alphabetically-ordered catalog with no "jump to record" mechanism — items beyond `200 * pageSize` become permanently unreachable through this endpoint.
  evidence: Requires an inventory of tens of thousands of items to matter in practice for this CMDB's stated scale (≥19 types, not ≥19 thousand items) — revisit if real usage approaches that size.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-delete-item.md`
  summary: `JwtAuthGuard`'s by-design tolerance for a stale role claim (never re-queries the DB; a demoted user's still-unexpired token keeps its old role until expiry) previously only ever gated recoverable actions (create/update). Story 3.4 extends the same guard/`@Roles()` posture to `DELETE /items/:id`, a hard, non-recoverable delete with no soft-delete/trash — a just-demoted user can now permanently destroy inventory data until their token naturally expires.
  evidence: Fixing this needs either DB-backed role re-verification on every request (defeats the point of a stateless JWT) or a narrower reauth-for-destructive-actions step — both are auth-architecture decisions affecting every mutating endpoint, not a single-story fix. Revisit if this access-token TTL, or the blast radius of what a compromised/stale token can irreversibly destroy, becomes a real operational concern.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-edit-delete-relation.md`
  summary: `InventoryService.update`'s and `RelationsService.update`'s audit `cambios.before` is read via a plain `findUnique` before the transaction starts, not re-derived from anything read inside it — two concurrent edits to the SAME field of the SAME row (e.g. two `PATCH`es changing a relation's `tipo` to two different new values) can both read the same pre-edit "before" state, so whichever commits second records a `before` value that no longer matches what was actually in the row immediately before its own write. The DB ends up correct (last writer wins); the audit trail does not.
  evidence: This story explicitly fixed the equivalent staleness for `remove()` (building `cambios` from the transactional delete's own return value instead of an earlier read) because that fix was cheap — a one-line swap of which variable to read. Fixing `update()`'s "before" value properly needs real row-level locking (e.g. `SELECT ... FOR UPDATE` inside the transaction, re-reading the current state under the lock immediately before the write) — an architectural change affecting every `update` method in this codebase (`UsersService`, `InventoryService`, now `RelationsService`), not a targeted one-story fix. Matches the same non-atomic read-check-write class already logged repeatedly (spec-1-5/1-6/1-7/1-8/1-9/2-1/3-2 entries above) but called out specifically here because it concerns audit-trail *fidelity* (FR-27–30's whole purpose), not just data-correctness.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-edit-delete-relation.md`
  summary: `descripcion` (on both `ItemConfiguracion` and now `Relacion`) can never be cleared back to `null` via a `PATCH`/`update` call — `assertValidOptionalDescripcion`'s shape check (`typeof value !== 'string'`) rejects an explicit `null`, so a caller who set a `descripcion` has no way to unset it; only overwriting with another string (including `''`, which is a different DB value than `null`) is possible.
  evidence: Inherited unmodified from `InventoryController`'s identical helper (this story copied the pattern verbatim for `RelationsController`, per its own Code Map instruction to reuse it directly) — not introduced by this story, but now present in two modules. Fixing it needs a real "clear this field" convention (e.g. treating an explicit JSON `null` in the body as "unset," distinct from "field absent") applied consistently across every optional string field in both modules — a small but cross-cutting design decision better made once, deliberately, than piecemeal per-story.
