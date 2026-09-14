---
title: 'Automatic, immutable audit logging'
type: 'feature'
created: '2026-09-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'fadae5a14c2f387d1acd2005e4984ade622326e8'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No audit trail exists anywhere in the system yet, and future domain modules (Inventory, Relations, Change Requests, Bulk Import — Epics 3/4/5/7) need one shared, atomic way to record every write before their own code is built, per AD-3.

**Approach:** A new `AuditModule` owns one model, `RegistroAuditoria` (FR-27–FR-30), and exposes exactly one write path: `AuditService.record(tx, params)`. Callers pass their own `Prisma.TransactionClient` — the audit row is written inside the caller's own transaction, so a failure anywhere rolls both back together; there is no separate async path to fail silently. This story has no real caller yet (AD-3 doesn't bind `AuthModule`, and no Inventory/Relations module exists yet) — it is purely the reusable recording mechanism plus the guarantee that no endpoint anywhere can write to it, verified by its own tests standing in as the caller.

## Boundaries & Constraints

**Always:**
- `RegistroAuditoria` lives under `apps/api/src/audit/`, owned exclusively by `AuditModule` — no other module ever writes it directly via Prisma (AD-1/AD-3).
- `AuditService.record(tx: Prisma.TransactionClient, params): Promise<void>` is the only write path — `params` is exactly the canonical shape `{ usuarioId, tipoAccion, entidad, entidadId, cambios }` (`fecha` is a DB default, `now()`, never caller-supplied — nothing can backdate an entry).
- `entidad` is a plain string (not an enum) — new entity types added by future epics never require a migration to this module (mirrors AD-8's JSONB rationale for the same reason).
- `entidadId` is a plain string with no Prisma-level FK constraint — `RegistroAuditoria` spans many different entity tables (`ItemConfiguracion`, `Relacion`, `SolicitudCambio`, none of which exist yet), so it can't be a single typed relation.
- `usuarioId` **is** a real FK to `Usuario` (`@relation`, matches the ERD's `USUARIO ||--o{ REGISTRO_AUDITORIA`) — always a real acting user, never nullable; there is no "system actor" case in this story's scope.
- `cambios` is a `Json` column, caller-shaped — `AuditService` does not enforce any before/after structure inside it, only the outer envelope (matches AD-3's "no module invents its own reporting shape" concern, which is about the envelope, not its payload contents).
- `TipoAccion` enum starts with exactly `CREATE`, `UPDATE`, `DELETE` (FR-27's three action kinds) — extended by a later epic if it ever needs another value (e.g. Epic 7's bulk-reimport-as-one-event case), not invented here.
- Indexed from the start (matching the pattern Story 1.5 had to retrofit after review): `@@index([usuarioId])`, `@@index([entidad])`, `@@index([fecha])` — Story 2.2's actual query/filter shape may add more later.

**Never:**
- No controller, no HTTP endpoint of any kind in this story — reading is Story 2.2's job; writing is never exposed over HTTP at all, by design (FR-29's "no editable ni borrable" is satisfied by the absence of any write endpoint, not a guard rejecting one).
- No DB-level trigger/constraint enforcing immutability — same posture as every other append-only table in this codebase (`RefreshToken`, `PasswordResetToken`, `InvitationToken`): enforced by there being no code path that ever updates or deletes a row, not by database machinery.
- No retrofitting `AuditService.record()` into any existing Epic 1 (`AuthModule`) write — AD-3 explicitly binds only `InventoryModule`, `RelationsModule`, `ChangeRequestsModule`, `ImportModule`.
- No async queue/event for recording — always synchronous, inside the caller's transaction (AD-3, explicit for both Núcleo v1 and Extendido v1.1).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| A caller's transaction calls `record(tx, params)` and the transaction commits | valid params, real `tx` | One `RegistroAuditoria` row persisted with `fecha` set to write time | N/A |
| A caller's transaction calls `record(tx, params)` and the transaction later rolls back (any reason) | valid params, real `tx`, transaction fails after the call | No `RegistroAuditoria` row persists — same all-or-nothing outcome as the domain write it accompanied | N/A |
| `record()` is called with a `tx` argument | any params | The write goes through the passed `tx`, never through a fresh top-level `PrismaService` client | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/prisma/schema.prisma` -- existing: add `TipoAccion` enum + `RegistroAuditoria` model + `Usuario.registrosAuditoria` relation; new migration
- `apps/api/src/audit/audit.service.ts` -- new: `record(tx, params)`
- `apps/api/src/audit/audit.module.ts` -- new: registers `AuditService`, exports it for future modules to import
- `apps/api/src/app.module.ts` -- existing: import `AuditModule`

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma` -- `TipoAccion` + `RegistroAuditoria` + relation + indexes -- backs FR-27/FR-28
- [x] `apps/api/src/audit/audit.service.ts` -- `record(tx, params)` implementing the I/O matrix -- backs FR-30
- [x] `apps/api/src/audit/audit.module.ts` -- module wiring, `AuditService` exported
- [x] `apps/api/src/app.module.ts` -- register `AuditModule`
- [x] Unit tests: `audit.service.spec.ts` covering all I/O matrix rows, asserting `record()` writes through the passed `tx` and never through `PrismaService` directly

**Acceptance Criteria:**
- Given a canonical `{ usuarioId, tipoAccion, entidad, entidadId, cambios }` payload, when `record(tx, params)` is called inside a transaction that commits, then exactly one `RegistroAuditoria` row exists with all five fields plus a server-set `fecha`.
- Given no controller exists anywhere for `RegistroAuditoria`, when the full route table is inspected, then no route can create, update, or delete an audit entry.

## Implementation Notes

`RegistroAuditoria` was added to `apps/api/prisma/schema.prisma` alongside a new `TipoAccion` enum (`CREATE`/`UPDATE`/`DELETE`) and a `Usuario.registrosAuditoria RegistroAuditoria[]` back-relation. `usuarioId` is a real FK (`@relation`, non-nullable); `entidad`/`entidadId` are plain strings with no FK; `cambios` is `Json`; `fecha` is `DateTime @default(now())`. Indexes added exactly as specified: `@@index([usuarioId])`, `@@index([entidad])`, `@@index([fecha])`.

Migration `20260914231343_add_audit_log` was generated with `prisma migrate dev` against the real local Postgres (`testos-postgres` Docker container) rather than hand-written, and applied successfully. Its SQL was diffed against `prisma migrate diff --from-empty` output and matches byte-for-byte.

`apps/api/src/audit/audit.service.ts` exports `AuditService` with `record(tx: Prisma.TransactionClient, params: RecordAuditParams): Promise<void>`, plus the `RecordAuditParams` type (`{ usuarioId, tipoAccion, entidad, entidadId, cambios: Prisma.InputJsonValue }`, `fecha` intentionally omitted). The implementation is a single `tx.registroAuditoria.create({ data: {...} })` call — no logic branches, no fallback to `PrismaService`, so the "always writes through the passed `tx`" guarantee holds by construction rather than by a runtime check.

`apps/api/src/audit/audit.module.ts` registers and exports `AuditService`; no controller is registered, so no route exists anywhere for `RegistroAuditoria` (verified by grepping the module tree — `AuditModule` is the only module importing/touching `RegistroAuditoria`, and it declares zero `controllers`). `AuditModule` was added to `apps/api/src/app.module.ts`'s `imports`.

`apps/api/src/audit/audit.service.spec.ts` covers all three I/O matrix rows via a mocked `Prisma.TransactionClient`: (1) `record()` writes exactly one row through the passed `tx` with all five canonical fields; (2) a `tx`-level failure (standing in for the enclosing transaction rolling back) propagates out of `record()` rather than being swallowed; (3) a separately-mocked `PrismaService` instance is asserted to never be called, proving the write never goes through a fresh top-level client. An additional test exercises all three `TipoAccion` values.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | `Prisma.TransactionClient` is a structural subtype of `PrismaClient` (`Omit<PrismaClient, ITXClientDenyList>`), and `PrismaService extends PrismaClient` — so `record(this.prisma, params)` (passing the plain top-level client, not a real transaction) type-checks with no error, silently bypassing the atomicity guarantee this story exists to provide (blind-hunter) | medium | Verified against `Prisma.TransactionClient`'s generated type and `prisma.service.ts`. Real and consequential, but no cheap fix exists — a nominal/branded wrapper type would need Prisma-level machinery not used anywhere else in this codebase, and wouldn't stop a determined caller from casting around it anyway. This is fundamentally a code-review-discipline concern for whoever writes the first real caller (Epic 3+), not something this story's code alone can close. |
| 2 | `epic-2-context.md`'s Technical Decisions section says the write path is `AuditModule.record(tx, ...)`, but the real method is `AuditService.record()` — `AuditModule` has no such method (blind-hunter) | low | Verified — a documentation bug in the compiled context file every future Epic 2/3/4/5/7 story reads as primary context. |
| 3 | Spec frontmatter `status: 'done'` vs. `sprint-status.yaml`'s `review` for the same story (blind-hunter) | false | Matches this project's established, intentional convention (confirmed across every prior story 1.6–1.11): spec status reaches `done` on implementation completion; `sprint-status.yaml` deliberately stays at `review` until a separate code-review gate — not a contradiction. |
| 4 | `usuarioId`'s `ON DELETE RESTRICT` FK means a `Usuario` who ever performed an audited action can never be hard-deleted — not documented anywhere (blind-hunter, edge-case-hunter) | low | Verified in the migration SQL. Currently unreachable (no delete-user feature exists anywhere in this codebase — only deactivate), but a real, foreseeable, permanent consequence worth a comment for whoever eventually builds one. |
| 5 | No index supports "history of this one entity" (`entidad` + `entidadId` together) — the epic's own stated goal and FR-28 strongly imply this as a primary Story 2.2 query shape (blind-hunter, edge-case-hunter's implicit entidadId gap) | low | Verified — only individual-column indexes exist. This specific composite was fully predictable now, unlike Story 2.2's still-unknown broader filter combinations. |
| 6 | `record()` performs no input validation — an empty-string `entidad`/`entidadId` is accepted and persisted permanently (immutable table, no fix-up path ever) (blind-hunter, edge-case-hunter) | low | Verified — real, and the table's own immutability (by design) makes a bad row unusually costly to have shipped. |
| 7 | The I/O matrix's rollback-atomicity row (the epic's central AD-3 claim) is asserted but never actually exercised against a real `prisma.$transaction` — `audit.service.spec.ts` only proves a rejected `tx` call propagates rather than being swallowed, not that a real transaction rollback leaves zero rows (blind-hunter) | medium | Verified — real gap in the story's most important guarantee. Not fixed here: every existing test in this codebase (23 suites) runs against a fully mocked `PrismaService` with no live-DB dependency, and adding one test that requires a reachable Postgres would break that portability property for anyone running `npm test` without a database — needs dedicated integration-test infrastructure (e.g. a `test:e2e`-style suite gated behind `DATABASE_URL`), not an ad-hoc addition to the unit-test file. |
| 8 | No plan yet for how Epic 7's "bulk-reimport audits as one event, not per item" exception will fit `RegistroAuditoria`'s current one-row-per-entity shape (blind-hunter) | low | Real but speculative this far out — Epic 7 hasn't been planned yet (Epics 3–6 come first) and inventing a batch-event shape now, before that story defines its actual requirements, risks guessing wrong. Better decided when Epic 7 is actually specced. |
| 9 | `record()` throws a raw `TypeError` if called with `tx` as `null`/`undefined` rather than a clear error (edge-case-hunter) | low (rejected) | `tx` is a required, compile-time-enforced TypeScript parameter with no dynamic/JS caller anywhere in this codebase — matches this project's existing convention of not adding runtime guards for compile-time-enforced internal-API parameters. |
| 10 | An unknown `usuarioId` surfaces as a raw Prisma FK-violation error rather than a clear validation error (edge-case-hunter) | low (rejected) | Every intended caller derives `usuarioId` from an already-authenticated `request.user.sub`; Prisma's own FK-violation error already names the failing constraint, which is informative enough for what would be a caller-side programming error, not a reachable user-facing case. |



## Design Notes

`record()`'s TypeScript parameter type intentionally omits `fecha` (DB-default-only) and leaves `cambios` typed as `Prisma.InputJsonValue` — a caller-shaped JSON blob, not a project-defined interface, consistent with AD-8's precedent for `ItemConfiguracion.properties`.

## Verification

**Commands:**
- `npx prisma generate` (in `apps/api`) -- expected: clean generate. Ran clean.
- `npx prisma migrate diff --from-empty --to-schema ./prisma/schema.prisma --script` -- expected: matches the hand-written migration (no live DB reachability guaranteed in every environment — same caveat as prior stories; this session does have a real local Postgres available if needed). Ran against the real local Postgres via `prisma migrate dev --name add_audit_log` instead of a hand-written migration; the applied migration's SQL matches the `--from-empty` diff output byte-for-byte.
- `npm run -w apps/api build` -- expected: exit 0. Passed.
- `npm run -w apps/api test` -- expected: all suites pass, including new `audit.service.spec.ts`. Passed: 23 suites, 272 tests, 0 failures.
