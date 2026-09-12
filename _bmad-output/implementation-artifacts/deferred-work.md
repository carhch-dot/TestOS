- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-system-bootstrap-and-first-admin.md`
  summary: PrismaService's fail-fast on a missing DATABASE_URL has no unit test.
  evidence: One-line guard clause on a hard-to-misconfigure path; no existing pattern in this repo for testing Prisma-extending service constructors in isolation, so the added test scaffolding would be disproportionate to the risk right now.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-system-bootstrap-and-first-admin.md`
  summary: Centralize email normalization (trim + lowercase) into one shared helper instead of leaving it inline in bootstrap.service.ts.
  evidence: RESOLVED by Story 1.2 — `apps/api/src/common/normalize-email.ts` now backs both `bootstrap.service.ts` and `login.service.ts`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-login-with-email-and-password.md`
  summary: AuthModule's JWT_SECRET fail-fast and the 15-minute access-token TTL are never exercised by any test.
  evidence: Mirrors the pre-existing, already-accepted PrismaService/DATABASE_URL fail-fast convention from Story 1.1, which is likewise untested — no existing pattern in this repo for testing a NestJS module's async factory in isolation, disproportionate to the risk right now.
