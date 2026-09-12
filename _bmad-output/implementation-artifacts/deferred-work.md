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
  evidence: Raised independently in both Story 1.2's review (FK is ON DELETE RESTRICT, would eventually block user deletion) and Story 1.3's review (no purge mechanism exists for revoked/expired rows). Real for a long-lived deployment, but there is no user-deletion feature yet for the FK concern to block, and building a cleanup job now is more than this story's scope. Revisit once the table's growth or a deletion feature makes it concrete.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-lockout-after-failed-attempts.md`
  summary: Small residual timing gap — a wrong-password attempt on a real, unlocked account now performs one extra DB write that the unknown-email/non-ACTIVE paths don't.
  evidence: A single indexed primary-key UPDATE (~few ms) against argon2's ~100ms dominant verify cost — real but very hard to reliably exploit via network timing analysis. Filed by the verification-gap review layer.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-lockout-after-failed-attempts.md`
  summary: No IP-based or client-based rate limiting anywhere in the app — lockout is purely per-account, so credential stuffing across many different emails never trips any single account's threshold.
  evidence: Systemic concern spanning every endpoint, not just login; no throttling dependency (`@nestjs/throttler` or similar) exists anywhere yet. Same class of gap as the rate-limiting finding rejected in Story 1.3's review.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-lockout-after-failed-attempts.md`
  summary: The lockout mechanism itself can be weaponized against legitimate users — knowing only a victim's email, an attacker can keep re-triggering the lock indefinitely.
  evidence: An inherent, well-known trade-off of any consecutive-failed-attempt lockout design, already implicit in FR2's original requirement (which specifies exactly this mechanism without mentioning IP throttling, CAPTCHA, or an admin/self-unlock path). Worth a future product decision (e.g. an admin-unlock path, or a self-unlock-via-email link) rather than a code fix to this story.
