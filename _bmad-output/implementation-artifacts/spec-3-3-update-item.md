---
title: 'Update an existing item'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '6503abaf3a679bab38dab5fc8bf0b1e2095d91e1'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Items can be created (3.1) but never corrected or enriched afterward (FR-16) — a typo or a missing detail is permanent today.

**Approach:** `PATCH /items/:id` (Editor and above, same RBAC as create) accepts a partial body — only supplied fields change, everything else stays intact. `properties` (JSONB) is shallow-merged with the existing value (`{...existing, ...supplied}`), never replaced wholesale. The update and its `RegistroAuditoria` entry happen inside one `prisma.$transaction` (AD-3), same pattern as `create`.

## Boundaries & Constraints

**Always:**
- `InventoryService` (existing) gains `update(usuarioId, id, dto)`; `InventoryController` (existing) gains `PATCH /items/:id` — no new module/service file.
- Every field is optional in the request body: `nombre`, `descripcion`, `dominioPropietario`, `direccionRed`, `tipo`, `properties` — only keys actually present in the body are changed; an absent key leaves that column untouched (Prisma partial `update`, not a full-row replace).
- `properties`, when supplied, is shallow-merged with the item's current `properties` (`{ ...existing, ...supplied }`) — top-level keys in the supplied object overwrite the same key in the existing object; keys not mentioned survive untouched. No recursive/deep merge (matches the "no strict schema validation" posture from `create`).
- `nombre`, when supplied, goes through the exact same trim + case-insensitive uniqueness check as `create` (spec-3-1), excluding the item's own row, backed by the same `P2002` race-condition backstop.
- `tipo`, when supplied, goes through the exact same catalog validation as `create`.
- All other supplied fields (`descripcion`/`dominioPropietario`/`direccionRed`) go through the exact same type/length validation as `create`.
- `PATCH /items/:id` uses `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(EDITOR, MANAGER, ADMINISTRATOR)` — identical to `create`.
- A body with zero recognized fields is rejected (`400`) — nothing to update, and nothing worth an audit entry for.
- `RegistroAuditoria.cambios` records only the fields that were actually part of this update, as `{ before: {...old values}, after: {...new values} }` — not a full item snapshot (unlike `create`, which has no "before" state to diff against).
- Unknown `id` → `404`.

**Never:**
- No deep/recursive merge of nested objects inside `properties` — top-level shallow merge only.
- No create/list/delete here — `InventoryService.create`/`list` (3.1/3.2) are untouched.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Editor (or above) updates one or more fields on an existing item | valid partial body | `200`; only supplied fields change; `properties` shallow-merged if supplied; one `RegistroAuditoria` entry (`tipoAccion: UPDATE`) with `{before, after}` for exactly the changed fields | N/A |
| `properties` supplied, item already has other top-level keys | `{ properties: { version: '15' } }` on an item with `{ engine: 'postgres', version: '14' }` | `200`; resulting `properties` is `{ engine: 'postgres', version: '15' }` | N/A |
| Body has zero recognized fields | `{}` | `400` | Clear error message |
| `nombre` collides (case-insensitively) with a different existing item | valid otherwise | `409`; no state change | Clear error message |
| `tipo` not in the catalog | valid otherwise | `400` | Clear error naming the invalid type |
| Unknown item `id` | any valid body | `404` | Clear error message |
| Read-only (Consulta) caller, or unauthenticated caller | `PATCH /items/:id` | `403` (or `401` if unauthenticated); no state change | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/inventory/inventory.service.ts` -- existing: add `update(usuarioId, id, dto)`
- `apps/api/src/inventory/inventory.controller.ts` -- existing: add `PATCH /items/:id`
- `apps/api/src/inventory/inventory.service.ts`'s `create` -- reference only: the trim/uniqueness/catalog-validation/transaction+audit pattern to mirror

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/inventory/inventory.service.ts` -- `update(usuarioId, id, dto)` implementing the I/O matrix
- [x] `apps/api/src/inventory/inventory.controller.ts` -- `PATCH /items/:id`
- [x] Unit tests: `inventory.service.ts` (all I/O scenarios, incl. shallow-merge behavior and the `{before, after}` audit payload), `inventory.controller.ts` (dispatch + RBAC rejection using the real guard chain, per prior inventory stories' precedent)

**Acceptance Criteria:**
- Given an item with several `properties`, when an Editor supplies only some of them, then those are merged with the existing ones and the rest survive unchanged, with the change recorded in audit.
- Given a Read-only caller, when they attempt to update an item, then the request is rejected and nothing changes.

## Implementation Notes

`InventoryService.update(usuarioId, id, dto)` was added directly after `create`. It validates a supplied `tipo` against `ITEM_TYPE_CATALOG` before any DB access (same as `create`), then does a single `findUnique` to both fetch the "before" state and produce the `404` (`ITEM_NOT_FOUND_MESSAGE`) for an unknown `id`. A supplied `nombre` is trimmed once and checked case-insensitively for uniqueness via `findFirst` with `NOT: { id }` (excludes the item's own row), throwing `409` (`NAME_ALREADY_EXISTS_MESSAGE`) on a collision — backed by the same `P2002` catch inside the transaction as a race-condition backstop. The `data` object handed to `tx.itemConfiguracion.update` and the `before`/`after` objects handed to `AuditService.record` are built field-by-field, gated on `!== undefined`, so only keys the caller actually supplied are ever touched — an absent key never appears in either. `properties`, when supplied, is shallow-merged (`{ ...existingItem.properties, ...dto.properties }`) before being written; nested objects under a shared top-level key are replaced wholesale, never deep-merged. The item update and its `RegistroAuditoria` entry (`tipoAccion: UPDATE`, `cambios: { before, after }`) happen inside one `prisma.$transaction`, mirroring `create`.

`InventoryController.update` adds `PATCH /items/:id` with the same `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(EDITOR, MANAGER, ADMINISTRATOR)` as `create`. A body with none of the six recognized fields (`nombre`, `descripcion`, `dominioPropietario`, `direccionRed`, `tipo`, `properties`) all `undefined` is rejected with `400` (`NO_FIELDS_TO_UPDATE_MESSAGE`) before the service or DB is ever touched. Per-field validation reuses `create`'s exact logic: the inline checks in `create` were extracted into four shared functions (`assertValidNombre`, `assertValidTipo`, `assertValidOptionalString`, `assertValidOptionalProperties`) so both handlers run identical validation — `update` simply skips a check when the corresponding field is `undefined`, since every field is optional there. `create`'s own behavior/messages are unchanged by this refactor (all of its existing tests still pass unmodified).

Two small deviations from a literal reading of the spec, both judgment calls: (1) the "zero recognized fields" `400` check lives in the controller, not the service — matching where all other request-shape validation already lives in this codebase (`create`'s `nombre`/`tipo` requiredness checks are controller-side too); the service itself has no independent guard against an all-`undefined` `dto` since the controller is its only caller. (2) tipo-catalog validation runs before the `404` lookup (same order `create` uses: cheap validation before any DB access) — the spec's I/O matrix doesn't specify precedence between simultaneous `400`/`404` conditions, so this preserves `create`'s existing fail-fast ordering.

`TipoAccion.UPDATE` (already defined in `schema.prisma`, unused until now) is the first real caller.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | The Verification section's test counts don't match the actual test files — "12 dispatch/validation tests" is really 15, "2 of which use the real chain" is really 3, and the stated "17" new controller tests total is really 20 (blind-hunter) | low (patched) | Verified by counting `it`/`it.each` rows directly — documentation-accuracy error only, no code defect. Verification section corrected. |
| 2 | `update`'s "before" snapshot (`findUnique`) is read outside the `$transaction` that performs the actual write — two concurrent updates to *different* fields of the same item can both read the same pre-update state, so the audit `before` for whichever commits second won't reflect what the first write actually changed (blind-hunter, edge-case-hunter) | medium | Verified — real, but the same pre-existing "no `$transaction` wrapping the whole read-check-write sequence" class already logged repeatedly (spec-1-5/1-6/1-7/1-8/1-9/2-1/3-2 entries in `deferred-work.md`), not a new pattern introduced by this story specifically. |
| 3 | Supplying a field with its current, unchanged value still writes the row and records an audit entry whose `before` equals `after` (blind-hunter) | low (documented, not fixed) | Real, but intentional per this story's own planning: detecting "did anything actually change" would need diffing logic deliberately left out for simplicity (spec Design Notes now says so explicitly). |
| 4 | No test re-supplies an item's own *current* `nombre` unchanged, to confirm the uniqueness check's `NOT: { id }` exclusion actually lets it through rather than spuriously self-conflicting — only "different name" and "collision with a different item" are tested (blind-hunter) | low (patched) | Verified gap — real, cheap, valuable test to add. Added `InventoryService.update` test asserting the self-exclusion query and successful update. |
| 5 | `properties` merge semantics for an explicit `null` value inside the supplied object (e.g. `{ properties: { version: null } }`) are undocumented — falls out of the `{...existing, ...supplied}` spread as "the key is set to `null`," not deleted, but nothing says so (blind-hunter) | low | Verified — well-defined by JS spread semantics, just not documented as intentional. Documented, not changed. |
| 6 | Spec frontmatter `status: 'done'` set before this code-review pass (which this triage log is part of) completes (blind-hunter) | false | Matches this project's established, intentional convention (confirmed across every prior story): the implementing agent sets spec `status: 'done'` on completion; `sprint-status.yaml` deliberately stays at `review` until a separate review pass (this one) finishes — not a contradiction. |
| 7 | No test exercises two concurrent `PATCH` requests on different fields of the same item (blind-hunter) | medium | Same underlying gap as #2 — would exercise the same non-atomic-read issue, not a separate defect. |
| 8 | If the target item is deleted between `findUnique` and the transactional `update` (Prisma's `P2025`), the raw error propagates as an unhandled `500` instead of a clean `404` (edge-case-hunter) | false (for now) | Checked — no delete capability exists anywhere in this codebase yet (Story 3.4, "eliminar un ítem," is still `backlog`), so this race is currently unreachable. Flagged in Design Notes as something Story 3.4's own review must re-check once delete exists. |
| 9 | `InventoryService.update` has no internal guard against being called directly with every `dto` field `undefined`, bypassing the controller's "zero recognized fields" gate (edge-case-hunter) | low (rejected) | No other caller exists — matches the same internal-trust convention `UsersService`/`AuditService`/`InventoryService.list` already established. |



## Design Notes

- **No-op field values still write and audit.** Supplying a field with its current, unchanged value (e.g. re-sending the same `descripcion`) still performs the Prisma update and records a `RegistroAuditoria` entry whose `before` equals `after`. Intentional: detecting "did the value actually change" needs diffing logic this story deliberately leaves out for simplicity, matching the same posture `create` already has (no dedup/no-op detection anywhere in this module).
- **`properties` and explicit `null` values.** `{...existing, ...supplied}` is a plain object spread — a supplied key with value `null` (e.g. `{ properties: { version: null } }`) sets that key to `null` in the stored result, it does **not** delete/omit the key. This is well-defined, unremarkable spread behavior, not a special "delete" convention — noted here only because it wasn't spelled out anywhere else.
- **Forward-looking note for Story 3.4 (delete an item, still `backlog`):** once delete exists, `update`'s `findUnique`-then-later-`update` sequence will have a real (if narrow) race — the item could be deleted between the two, and Prisma's own "record not found" error (`P2025`) on the transactional `update` would propagate as an unhandled `500` today. Currently unreachable (no delete capability exists anywhere in this codebase yet), but Story 3.4's own review should re-check this once it lands, potentially by having `update` catch `P2025` the same way it already catches `P2002`.

## Verification

**Commands:**
- `npm run -w apps/api build` -- exit 0, no TypeScript errors.
- `npm run -w apps/api test` -- **Test Suites: 27 passed, 27 total; Tests: 408 passed, 408 total** (includes 11 `InventoryService.update` unit tests — 10 from implementation plus 1 added in review for nombre self-exclusion — and 20 `InventoryController` update/`PATCH` tests — 15 dispatch/validation tests plus 5 RBAC tests, 3 of which use the real `JwtAuthGuard`+`RolesGuard`+`Reflector` chain per the existing `create`/`list` precedent — corrected post-review, the original count here was wrong). All existing `create`/`list` tests still pass unmodified after the shared-validator refactor.
- Real Postgres smoke test against the `testos-postgres` Docker container (per `apps/api/.env`'s `DATABASE_URL`), with the API running via `npm run start` and a real login (`POST /auth/login` as the seeded `ADMINISTRATOR`):
  - Created two real items via `POST /items`, then ran the full I/O matrix against the live DB via `curl`:
    - `PATCH /items/:id` with `{ descripcion, properties: { version: '15' } }` on an item whose `properties` was `{ engine: 'postgres', version: '14' }` → `200`; response `properties` was `{ engine: 'postgres', version: '15' }` (shallow merge confirmed: `engine` survived untouched).
    - `PATCH /items/:id` with `{}` → `400 At least one recognized field (...) must be supplied.`
    - `PATCH /items/:id` with `{ tipo: 'NOT_A_TYPE' }` → `400 'NOT_A_TYPE' is not a recognized item type.`
    - `PATCH /items/00000000-0000-0000-0000-000000000000` → `404 Item not found.`
    - `PATCH /items/:id` with a `nombre` colliding case-insensitively with a different real item → `409 An item with that name already exists.`
    - `PATCH /items/:id` with no `Authorization` header → `401`.
    - `PATCH /items/:id` as a caller temporarily downgraded to `READ_ONLY` in the DB (then restored to `ADMINISTRATOR` afterward) → `403 You do not have permission to perform this action`.
  - Queried `GET /audit?entidadId=<id>` afterward and confirmed exactly one `UPDATE` `RegistroAuditoria` row with `cambios: { before: { descripcion: 'smoke test item', properties: { engine: 'postgres', version: '14' } }, after: { descripcion: 'updated description', properties: { engine: 'postgres', version: '15' } } }` — only the two changed fields, not a full item snapshot, alongside the item's original `CREATE` entry.
  - Cleaned up: deleted the smoke-test `ItemConfiguracion`/`RegistroAuditoria` rows, restored the admin user's role, and stopped the server. `docker exec testos-postgres psql ... SELECT count(*) ... WHERE nombre LIKE 'spec-3-3-smoke%'` confirmed `0` rows remain.
