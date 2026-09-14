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
