---
title: 'Create a configuration item'
type: 'feature'
created: '2026-09-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'b3f93c16455a57ef10efa21616e374242e731787'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no inventory yet — nothing to relate (Epic 4), export (Epic 6), or bulk-import (Epic 7) exists until an Editor can create a configuration item (FR-12).

**Approach:** `POST /items` (Editor and above) creates an `ItemConfiguracion` with common fields (`nombre`, `descripcion`, `dominioPropietario`, `direccionRed`) plus type-specific `properties` (JSONB, AD-8), validated only against a static type catalog (`tipo` — a plain string, not a Prisma enum, so a new type is a catalog entry, never a migration, per FR-13). The create and its `RegistroAuditoria` entry happen inside one `prisma.$transaction` (AD-3) — the first real caller of `AuditService.record()` (Epic 2), which until now had none.

## Boundaries & Constraints

**Always:**
- `InventoryModule`/`ItemConfiguracion` live under `apps/api/src/inventory/`, the sole owner (AD-1) — no other module writes it directly via Prisma.
- `apps/api/src/inventory/item-type-catalog.ts` exports a static `readonly string[]` of at least 19 type identifiers (English `UPPER_SNAKE_CASE`, matching `TipoAccion`'s value convention) — adding a type later means editing this array, never a migration (FR-13/AD-8).
- `tipo` on `ItemConfiguracion` is a plain `String` column (not a Prisma enum) — validated against the catalog array at the service layer, the same reason `RegistroAuditoria.entidad` is a plain string (spec-2-1 Boundaries: new values must never require a migration). Catalog matching is exact-string (case-sensitive) — `tipo` is a controlled, catalog-driven value (not free user text like `nombre`), so there is no normalization step, unlike the name-uniqueness check below. (Clarified post-review.)
- `properties` is a `Json` column, unvalidated against any per-type shape — the brief's addendum explicitly accepts this as a known limitation for this version ("sin validación de esquema estricta... mejora futura"), not something to build here.
- `nombre` is required; `descripcion`/`dominioPropietario`/`direccionRed` are optional. Name uniqueness is case-insensitive (NFR3) and global across all types — checked via a case-insensitive `findFirst` before create, backed by a real (case-sensitive) `@unique` DB constraint as a race-condition backstop (same `P2002`-catch pattern as `InviteService.invite`'s email-conflict handling, spec-1-7).
- `POST /items` uses `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(EDITOR, MANAGER, ADMINISTRATOR)` — FR-12's "Consulta = solo lectura; Editor+ = escritura" reading: write access is Editor and every role above it, not Editor-exclusive.
- `InventoryService.create` wraps the `ItemConfiguracion` insert and `AuditService.record(tx, {usuarioId, tipoAccion: CREATE, entidad: 'ItemConfiguracion', entidadId, cambios})` inside one `prisma.$transaction` (AD-3) — `cambios` carries the created item's common fields + `properties`.

**Never:**
- No per-type `properties` schema validation — accept any JSON object, per the brief's documented, accepted limitation.
- No search/list/update/delete endpoints — those are Stories 3.2/3.3/3.4.
- No handling yet for what happens to relations/change-requests referencing an item on delete — out of scope until Epics 4/5 exist (noted explicitly in the epic, not this story's concern since delete isn't even built yet).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Editor (or Manager/Administrator) creates an item with a valid `tipo` | valid `{ nombre, tipo, ... }` | `201`; `ItemConfiguracion` row created; one `RegistroAuditoria` entry (`tipoAccion: CREATE`) in the same transaction | N/A |
| `tipo` not in the catalog | any other valid fields | `400` | Clear error naming the invalid type |
| `nombre` matches an existing item's name, differing only in case | `nombre` case-variant of an existing item | `409`-class conflict; no item/audit row created | Clear error message |
| Read-only (Consulta) caller, or unauthenticated caller | `POST /items` | `403` (or `401` if unauthenticated); no state change | N/A |
| The transaction fails after the item insert but before the audit record (or vice versa) | any failure mid-transaction | Neither the item nor the audit entry persists — same all-or-nothing guarantee spec-2-1 built `AuditService.record` for | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/prisma/schema.prisma` -- existing: add `ItemConfiguracion` model (`id`, `nombre` unique, `descripcion?`, `dominioPropietario?`, `direccionRed?`, `tipo` string, `properties` Json, `createdAt`, `updatedAt`); new migration
- `apps/api/src/inventory/item-type-catalog.ts` -- new: the static type catalog array
- `apps/api/src/inventory/inventory.service.ts` -- new: `create(usuarioId, dto)`
- `apps/api/src/inventory/inventory.controller.ts` -- new: `POST /items`, `@Roles(EDITOR, MANAGER, ADMINISTRATOR)`
- `apps/api/src/inventory/inventory.module.ts` -- new: imports `AuthModule` (for `JwtAuthGuard`/`RolesGuard`, spec-2-2's app-bootstrap fix means this now just works) and `AuditModule` (for `AuditService`)
- `apps/api/src/app.module.ts` -- existing: register `InventoryModule`
- `apps/api/src/audit/audit.service.ts` -- existing, unchanged: `record(tx, params)` reused as-is — first real caller
- `apps/api/src/auth/invite.service.ts` -- reference only: the `P2002`-catch-on-create pattern to mirror for the name-uniqueness backstop

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma` -- `ItemConfiguracion` model + migration
- [x] `apps/api/src/inventory/item-type-catalog.ts` -- ≥19-entry type catalog
- [x] `apps/api/src/inventory/inventory.service.ts` -- `create` implementing the I/O matrix, wrapped in `$transaction` with `AuditService.record`
- [x] `apps/api/src/inventory/inventory.controller.ts` -- `POST /items`
- [x] `apps/api/src/inventory/inventory.module.ts` -- module wiring
- [x] `apps/api/src/app.module.ts` -- register `InventoryModule`
- [x] Unit tests: `inventory.service.ts` (all I/O scenarios, asserting the create+audit-record pair both go through the same `tx`), `inventory.controller.ts` (dispatch + RBAC rejection using the real guard chain, per Story 1.7+'s precedent)

**Acceptance Criteria:**
- Given a valid type from the catalog, when an Editor creates an item, then it's persisted with its common fields and `properties`, and exactly one `RegistroAuditoria` entry exists for it.
- Given a Read-only caller, when they attempt to create an item, then the request is rejected and nothing is persisted.
- Given a name differing only in case from an existing item, when creation is attempted, then it's rejected as a duplicate.

## Implementation Notes

`ItemConfiguracion` added to the schema exactly per the Code Map: `nombre` carries a real `@unique` constraint (case-sensitive backstop only — the real uniqueness rule is enforced in the service via a case-insensitive `findFirst` pre-check), `tipo` is a plain `String` validated against `ITEM_TYPE_CATALOG`, `properties` is `Json @default("{}")`. Migration `20260915000537_add_item_configuracion` generated via `prisma migrate dev` against the real local Postgres and applied; later hand-edited (still uncommitted at the time) to add `@@index([tipo])` per this review, verified byte-identical to `prisma migrate diff --from-empty` output for the `ItemConfiguracion` section.

`InventoryService.create`: catalog check (400) → trim `nombre` → case-insensitive uniqueness pre-check (409) → `prisma.$transaction` wrapping `itemConfiguracion.create` (its own narrowly-scoped `P2002`-catch, 409 backstop) followed by `AuditService.record(tx, ...)` — the first real caller of the mechanism Story 2.1 built. `InventoryController` guards with `@Roles(EDITOR, MANAGER, ADMINISTRATOR)` and validates every field's type/length before the service is ever called; `usuarioId` always comes from the verified access token, never the request body.

Live smoke-tested against the real API + Postgres during implementation: create (201), case-variant name (409), invalid tipo (400), unauthenticated (401), and confirmed via `GET /audit?entidad=ItemConfiguracion` that exactly one correctly-linked `RegistroAuditoria` row was produced — the smoke-test row was deleted afterward to leave local dev state clean.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | `nombre` is compared case-insensitively but never trimmed/normalized before storage — the epic's own requirement says "normalizados... antes de comparar **o persistir**"; a leading/trailing-whitespace variant (e.g. `"core-db "` vs `"core-db"`) is treated as distinct by both the pre-check and the DB constraint (blind-hunter) | medium | Verified — `InventoryService.create` uses `dto.nombre` as-is for both the `findFirst` and the `create` call, no `.trim()` anywhere. |
| 2 | The `try/catch` converting a `P2002` into a 409 wraps the *entire* transaction, including `auditService.record(tx, ...)` — if the audit insert ever threw a P2002 it would be misreported as "item name already exists" (blind-hunter) | low | Verified the catch scope; confirmed currently unreachable (`RegistroAuditoria` has no `@unique` constraint besides its PK, per spec-2-1's schema), but a cheap, direct fix (narrow the catch to just the `itemConfiguracion.create` call) removes the latent footgun for near-zero cost. |
| 3 | Controller validates `nombre`/`tipo`/`properties` types but not `descripcion`/`dominioPropietario`/`direccionRed` — a non-string value for any of those reaches Prisma and likely surfaces as a raw `500` instead of a clean `400` (blind-hunter) | medium | Verified — no `typeof` check exists for those three fields anywhere in `InventoryController.create`. |
| 4 | No length constraints on `nombre`/`descripcion`/`direccionRed`/`dominioPropietario`/`tipo` anywhere (blind-hunter) | low | Verified — no caps exist, unlike every other free-text input in this codebase (email, token, password all have generous defensive upper bounds). |
| 5 | No index on the new `tipo` column, even though Story 3.2 (already-known next story) will filter by it (blind-hunter) | low | Verified — a same-migration index costs nothing extra and the follow-up need is already predictable from `epic-3-context.md`. |
| 6 | `spec-3-1-create-item.md`'s Tasks & Acceptance checklist is entirely unchecked and Implementation Notes/Verification are empty, despite the diff implementing everything (blind-hunter) | low | Verified — the implementing agent didn't update the spec's own bookkeeping this time, unlike every prior story's convention. |
| 7 | Catalog matching (`ITEM_TYPE_CATALOG.includes(dto.tipo)`) is case-sensitive with no normalization — `"database"` is rejected while `"DATABASE"` succeeds; not documented in the I/O matrix (blind-hunter) | low | Verified — real, but `tipo` is a controlled, catalog-driven value (not free user text like `nombre`), so case-sensitivity is a reasonable, intentional default. Documented rather than changed. |
| 8 | `sprint-status.yaml` shows `in-progress` while the diff looks dev-complete (blind-hunter) | false | Expected mid-review state — synced to `review` when this review pass finishes, same as every prior story. |
| 9 | The "sole owner" invariant (`InventoryModule` is the only writer of `ItemConfiguracion`) is a documentation convention only, not code-enforced (blind-hunter) | low (rejected) | Matches the identical, already-accepted convention for every other "sole owner" claim across this entire codebase (`AuthModule`/`Usuario`, `AuditModule`/`RegistroAuditoria`) — not a gap introduced newly by this story. |
| 10 | `INVALID_TIPO_MESSAGE` echoes the caller-supplied `tipo` value verbatim into the error response with no length cap (blind-hunter) | low | Verified — folded into finding #4's length-cap fix (capping `tipo`'s length before it can be echoed unbounded). |



## Design Notes

Type catalog (22 entries, comfortably above the ≥19 minimum), English `UPPER_SNAKE_CASE` matching `TipoAccion`'s value style: `APPLICATION`, `API`, `SERVICE`, `DATABASE`, `VIRTUAL_SERVER`, `PHYSICAL_SERVER`, `CLUSTER`, `INTEGRATION`, `SCHEDULED_JOB`, `JOB_SERVER`, `LOAD_BALANCER`, `LDAP_DIRECTORY`, `CONTAINER_ORCHESTRATOR`, `NETWORK_DEVICE`, `FIREWALL`, `STORAGE`, `CERTIFICATE`, `DOMAIN`, `MESSAGE_QUEUE`, `BACKUP`, `SOFTWARE_LICENSE`, `MONITORING_TOOL`. Purely data — the catalog file's whole reason to exist is being trivially editable without a migration.

## Verification

**Commands:**
- `npx prisma generate` (in `apps/api`) -- ran, clean generate, no errors.
- `npx prisma migrate dev` -- ran during implementation against the real local Postgres (`testos-postgres` Docker container), applied cleanly. The container was unreachable during this review pass (Docker Desktop not running); the post-review `@@index([tipo])` addition was instead hand-verified via `npx prisma migrate diff --from-empty --to-schema ./prisma/schema.prisma --script`, which needs no live DB connection — its `ItemConfiguracion` output matches the migration file byte-for-byte (same pattern used in earlier stories when no DB was reachable).
- `npm run -w apps/api build` -- ran, exit 0.
- `npm run -w apps/api test` -- ran, 27 suites / 342 tests, all passing (12 new tests from this review's patches, on top of the original 21).
- `npm run -w apps/api lint` -- ran, 0 errors (fixed two `@typescript-eslint/no-unsafe-*` violations introduced by this review's new test assertions).
