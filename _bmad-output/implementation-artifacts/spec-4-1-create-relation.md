---
title: 'Create a directed, typed relationship between two items'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'fa457f7616000713ff0661be11011df1b77b4d2e'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The inventory (Epic 3) is a flat list of items with no way to express how they depend on each other — there is no data model or endpoint for the directed, typed links ("server hosts service", "service depends on database") that turn an inventory into a map of impact (FR-18).

**Approach:** Add a new `RelationsModule` (`apps/api/src/relations`) owning a new `Relacion` entity: `POST /relations` (Editor+) creates a directed `(origen, destino, tipo)` link, rejecting exact duplicates (FR-19) and validating `tipo` against an extensible catalog (FR-22); a companion `GET /relations/suggest` (any authenticated role) returns a reasonable `{tipo, descripcion}` suggestion from the origin/destination item types that the caller may accept or override before submitting the create (FR-20). Both endpoints follow the exact module/RBAC/transaction conventions `InventoryModule` established in Epic 3.

## Boundaries & Constraints

**Always:**
- `Relacion` is a new Prisma model: `id` (uuid), `origenId`/`destinoId` (FKs to `ItemConfiguracion.id`), `tipo` (`String`, catalog-validated, never a Prisma enum — AD-8), `descripcion` (`String?`), `createdAt`/`updatedAt`. Unique constraint on `(origenId, destinoId, tipo)` — the natural key from FR-19.
- `origenId`/`destinoId` FKs use `onDelete: Restrict` (Prisma's default for a required relation, matching the existing `RegistroAuditoria.usuarioId -> Usuario` precedent): a hard-deleting `DELETE /items/:id` on an item that still has any relationship must fail cleanly rather than silently cascading. A DB-level `Cascade` would delete `Relacion` rows with no `RegistroAuditoria` entry for them, violating AD-3's absolute "every write has an audit entry in the same transaction" guarantee — not worth the cross-module orchestration needed to do a cascade properly. Resolves the "what happens to relations on item delete" question spec-3-4 explicitly deferred to this epic.
- Because of the `Restrict` FK above, `InventoryService.remove` (spec-3-4) must additionally catch Prisma's `P2003` (foreign key violation) on its transactional `tx.itemConfiguracion.delete` call and rethrow as a `ConflictException` ("Cannot delete an item that still has relationships.") instead of a raw `500` — the exact same shape as its existing `P2025` catch, one more `if` branch.
- `RelationsModule` owns `Relacion` exclusively (AD-1) — no other module ever writes it via Prisma.
- `origenId`/`destinoId` must each reference an existing `ItemConfiguracion` — checked via `findUnique` on both before the transaction starts (404 if either is missing), same as `InventoryService.update`'s own lookup pattern. A read-only existence check on another module's entity is not a write, so this does not violate AD-1.
- `origenId !== destinoId` — an item cannot relate to itself; rejected with `400` before any DB access.
- `tipo` must belong to a new static `RELATION_TYPE_CATALOG` array (mirrors `ITEM_TYPE_CATALOG`'s shape/rationale exactly) — `400` if not.
- Same RBAC as `InventoryController.create`: `POST /relations` requires `@Roles(EDITOR, MANAGER, ADMINISTRATOR)`; `GET /relations/suggest` requires only `JwtAuthGuard` (any authenticated role may read), matching `GET /items`'s posture.
- The relation insert and its `RegistroAuditoria` entry (`tipoAccion: CREATE`, `entidad: 'Relacion'`, `cambios` = full snapshot: `origenId`, `destinoId`, `tipo`, `descripcion`) happen inside one `prisma.$transaction` (AD-3), via `AuditService.record(tx, ...)` — identical shape to `InventoryService.create`.
- Duplicate `(origenId, destinoId, tipo)` -> up-front case-sensitive `findFirst` check (an exact triple match, not case-insensitive text — `tipo` is a fixed catalog value, not free text), then the real `@unique` DB constraint as a `P2002` race backstop, mirroring `InventoryService.create`'s `nombre`-uniqueness pattern exactly.
- `GET /relations/suggest?origenTipo=X&destinoTipo=Y` is a pure static lookup (no DB access, no item lookup) over a small hardcoded map of known type pairs, falling back to a generic default (`CONNECTS_TO`) for any unmapped pair — advisory only, never blocks or validates anything.

**Never:**
- No `GET /relations` list endpoint, no `GET /relations/:id` — out of scope for this story (topology/read endpoints belong to Stories 4.3/4.4; edit/delete belongs to 4.2).
- No validation that `origen`/`destino` item *types* are "compatible" — any two existing items may be related regardless of type; the suggestion is advisory, never a constraint.
- No new Prisma enum for `tipo` — same catalog-array rationale as `ItemConfiguracion.tipo` (AD-8).
- No changes to `InventoryController`/`InventoryService.update` — only `remove`'s existing `try/catch` gains the one new branch described above.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Two existing items, valid catalog `tipo`, Editor+ caller | `201`; relation created; one `CREATE` audit row | N/A |
| Duplicate relation | Same `(origenId, destinoId, tipo)` already exists | N/A | `409` conflict |
| Unknown `tipo` | `tipo` not in `RELATION_TYPE_CATALOG` | N/A | `400` |
| Self-relation | `origenId === destinoId` | N/A | `400` |
| Unknown item | `origenId` or `destinoId` matches no `ItemConfiguracion` | N/A | `404` |
| Insufficient role | Caller is READ_ONLY on `POST /relations` | N/A | `403` |
| Suggest, known pair | `origenTipo`/`destinoTipo` matches a mapped pair (e.g. `VIRTUAL_SERVER`/`SERVICE`) | `{tipo: 'HOSTS', descripcion: '...'}` | N/A |
| Suggest, unknown pair | Types not in the suggestion map | `{tipo: 'CONNECTS_TO', descripcion: '...'}` (generic fallback) | N/A |
| Delete a related item | `DELETE /items/:id` on an item with >=1 relation | N/A | `409` (P2003 caught, not raw `500`) |

</frozen-after-approval>

## Code Map

- `apps/api/prisma/schema.prisma` -- add `Relacion` model (see Boundaries for fields) + reverse relations on `ItemConfiguracion` (`relacionesOrigen`, `relacionesDestino`); new migration.
- `apps/api/src/relations/relation-type-catalog.ts` (new) -- `RELATION_TYPE_CATALOG` (mirror `item-type-catalog.ts`'s style exactly): `HOSTS`, `DEPENDS_ON`, `HOSTED_IN`, `BELONGS_TO_CLUSTER`, `INTEGRATES_WITH`, `CONNECTS_TO` (the epic's reference examples); plus `suggestRelation(origenTipo, destinoTipo): { tipo: string; descripcion: string }` — a small static lookup table over common `ItemConfiguracion` type pairs (e.g. `(VIRTUAL_SERVER|PHYSICAL_SERVER, SERVICE) -> HOSTS`, `(SERVICE, DATABASE) -> DEPENDS_ON`, `(*, CLUSTER) -> BELONGS_TO_CLUSTER`), falling back to `CONNECTS_TO` with a generic description for anything unmapped.
- `apps/api/src/relations/relations.service.ts` (new) -- `RelationsService.create(usuarioId, dto)` (existence + self-relation + catalog + duplicate checks, then transactional insert + audit, mirroring `InventoryService.create`) and `RelationsService.suggest(origenTipo, destinoTipo)` (thin wrapper over the catalog's `suggestRelation`).
- `apps/api/src/relations/relations.controller.ts` (new) -- `POST /relations` (Editor+), `GET /relations/suggest` (any authenticated role), mirroring `InventoryController`'s validator-helper style (`assertValid*` functions) and defensive length caps on `descripcion`.
- `apps/api/src/relations/relations.module.ts` (new) -- imports `AuthModule`, `AuditModule`; exports `RelationsService`; mirrors `inventory.module.ts` exactly.
- `apps/api/src/app.module.ts` -- register `RelationsModule` in `imports`, same as `InventoryModule`.
- `apps/api/src/inventory/inventory.service.ts` -- patch `remove`'s existing `try/catch` (spec-3-4) to add a `P2003` branch alongside its `P2025` branch, throwing `ConflictException('Cannot delete an item that still has relationships.')`.
- Test files: `relations.service.spec.ts`, `relations.controller.spec.ts` (new, mirroring `inventory.*.spec.ts`'s patterns exactly, including real-guard-chain RBAC tests), plus one new `inventory.service.spec.ts` test for the `P2003` branch.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma` -- add `Relacion` model + reverse relations, run migration -- establishes the entity and its `Restrict` FKs
- [x] `apps/api/src/relations/relation-type-catalog.ts` -- catalog array + `suggestRelation` -- backs both FR-20 and FR-22
- [x] `apps/api/src/relations/relations.service.ts` -- `create` + `suggest` -- core logic per Boundaries
- [x] `apps/api/src/relations/relations.controller.ts` -- `POST /relations`, `GET /relations/suggest` -- wires RBAC + dispatch
- [x] `apps/api/src/relations/relations.module.ts` + `apps/api/src/app.module.ts` -- module wiring
- [x] `apps/api/src/inventory/inventory.service.ts` -- `P2003` catch in `remove` -- closes the race this story makes reachable
- [x] `apps/api/src/relations/relations.service.spec.ts` + `relations.controller.spec.ts` -- unit + RBAC/dispatch tests covering every I/O matrix row
- [x] `apps/api/src/inventory/inventory.service.spec.ts` -- one new test for `remove`'s `P2003` -> `409` path

**Acceptance Criteria:**
- Given two existing items, when an Editor (or Manager/Administrator) creates a relation between them with a valid catalog `tipo`, then it is created and exactly one `CREATE` `RegistroAuditoria` row is recorded with a full snapshot.
- Given an existing `(origen, destino, tipo)` relation, when the same triple is submitted again, then the system rejects it as a duplicate (`409`), no new row or audit entry.
- Given two item types with a known suggestion mapping, when `GET /relations/suggest` is called with those types, then it returns a reasonable `tipo`/`descripcion` pair; given an unmapped pair, it returns the generic fallback — never an error.
- Given an item that participates in at least one relation, when `DELETE /items/:id` is called on it, then the system rejects it with `409` rather than a raw `500`, and the item is not deleted.

## Implementation Notes

`Relacion` was added to `schema.prisma` with reverse relations `relacionesOrigen`/`relacionesDestino` on `ItemConfiguracion`, matching the field names the Code Map specified. The migration was generated and applied a little differently than prior stories: `prisma migrate dev` refused to run because the previously-applied `20260915000537_add_item_configuracion` migration's on-disk checksum no longer matched what was recorded in `_prisma_migrations` (a pre-existing drift in this dev environment, unrelated to this story — `prisma migrate status` reported the schema as up to date, only `migrate dev`'s stricter re-hash caught it, and its remediation path is a destructive `migrate reset`). To avoid touching prior migrations or losing dev data, the new migration's SQL was instead generated non-destructively via `prisma migrate diff --from-config-datasource ... --to-schema ...` (diffing the live DB against the updated schema), written by hand into a new `prisma/migrations/20260915143345_add_relacion/migration.sql`, and applied with `prisma migrate deploy`, which applies pending migrations without re-validating already-applied ones the way `migrate dev` does. The resulting SQL is byte-identical to what `migrate dev` would have generated (`CREATE TABLE "Relacion"`, both FK indexes, the `(origenId, destinoId, tipo)` unique index, and both FKs with `ON DELETE RESTRICT`), confirmed applied via `prisma migrate status` and a live Prisma Client generate.

`RelationsService.create` mirrors `InventoryService.create`'s shape exactly: catalog check -> self-relation check -> parallel `findUnique` existence checks on both endpoints -> case-sensitive exact-triple `findFirst` duplicate check -> `$transaction` with `tx.relacion.create` (catching `P2002` as the race backstop) -> `AuditService.record(tx, ...)` with a full `{origenId, destinoId, tipo, descripcion}` snapshot. `suggest` is a synchronous, side-effect-free wrapper over `relation-type-catalog.ts`'s `suggestRelation`, which tries an exact `origenTipo|destinoTipo` key, then a `*|destinoTipo` wildcard (used for the `CLUSTER` destination examples), then falls back to a generic `CONNECTS_TO` suggestion — it never throws.

`RelationsController` mirrors `InventoryController`'s validator-helper style: `assertValidId` (shared by `origenId`/`destinoId`, required + length-capped at 255), `assertValidTipo` (required + capped at 100, same as Inventory's), and an optional-string cap on `descripcion` (2000, same as Inventory's). `POST /relations` carries the same `@Roles(EDITOR, MANAGER, ADMINISTRATOR)` RBAC as `POST /items`; `GET /relations/suggest` carries only `JwtAuthGuard`, matching `GET /items`'s any-authenticated-role posture, and validates that `origenTipo`/`destinoTipo` are present, non-blank, single (non-repeated) query values before calling the service.

`InventoryService.remove`'s existing `try/catch` (from spec-3-4) gained one more `if` branch: a Prisma `P2003` (foreign-key violation) is now caught and rethrown as `ConflictException(ITEM_HAS_RELATIONSHIPS_MESSAGE)`, the exact same shape as its pre-existing `P2025` branch, placed immediately after it.

`RelationsModule` imports `AuthModule`/`AuditModule` and exports `RelationsService`, mirroring `InventoryModule` exactly, per the Code Map's explicit instruction.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | `RelationsService.create`'s transactional `try/catch` only handled `P2002` — a concurrent `DELETE /items/:id` on an item with no other relations yet, racing between this method's up-front existence check and its transactional insert, would surface Prisma's `P2003` (FK violation) as a raw `500` instead of a clean error. This is the exact symmetric case to the `P2003` catch this very story added to `InventoryService.remove` (blind-hunter: HIGH, edge-case-hunter: MAJOR — independently converged) | high (patched) | Real, confirmed by two independent reviewers converging on the same defect. Fixed: added a `P2003` branch (mirroring the existing `P2025`/`P2002` shape) rethrowing as `NotFoundException(RELATION_ITEM_VANISHED_MESSAGE)`. Added a regression test. |
| 2 | No test exercised the race in #1 — the "rethrows a non-P2002 error unchanged" test only used a generic `Error`, never a `P2003` `PrismaClientKnownRequestError` (blind-hunter) | medium (patched) | Resolved as part of #1's fix — added `'converts a concurrent foreign-key violation (P2003...) into a 404...'` test. |
| 3 | `GET /relations/suggest`'s `origenTipo`/`destinoTipo` query params had no upper length bound, unlike every other free-text input in this codebase (`origenId`/`destinoId` capped at 255, `tipo`/`descripcion` capped elsewhere) (blind-hunter) | medium (patched) | Real, cheap fix. Added a `MAX_TIPO_LENGTH` cap to `assertValidRequiredTipoQuery`, plus a test. |
| 4 | `InventoryService.remove`'s new `P2003` branch always reports "still has relationships" without inspecting `error.meta.field_name` — if a future migration ever adds a second `Restrict` FK onto `ItemConfiguracion`, a delete blocked by *that* FK would be misreported (blind-hunter) | low (rejected) | Speculative — no second FK exists today; `Relacion` is the only one. Revisit if/when a second `onDelete: Restrict` FK onto `ItemConfiguracion` is ever added. |
| 5 | Only `origenTipo`'s repeated-query-key case had a test; no mirror test for `destinoTipo` despite identical validation logic (blind-hunter) | low (patched) | Cheap, real coverage gap. Added the mirror test. |
| 6 | `Array.isArray(value)` inside the original `assertValidRequiredTipoQuery` was dead code — `typeof value !== 'string'` already covers the array case (blind-hunter) | very low (rejected, superseded) | Moot: the function was rewritten as part of fixing #3/finding-edge-case-hunter-#4 below; the rewrite no longer has this redundant clause. |
| 7 | Same `P2003` gap as #1, found independently (edge-case-hunter: MAJOR) | high (patched) | Duplicate of #1 — see its evidence. |
| 8 | `RelationsService.create`'s existence checks report only the first missing item (`origenId` before `destinoId`) — a request with both invalid only ever learns about `origenId` (edge-case-hunter) | low (rejected) | Matches the established, codebase-wide convention: every validation path in this project (Inventory's controllers included) short-circuits on the first failure rather than batch-reporting every error at once. Not a new gap. |
| 9 | `suggestRelation`'s naive `${origenTipo}\|${destinoTipo}` key concatenation could theoretically let a value containing a literal `\|` character collide with a different mapped pair (edge-case-hunter) | low (rejected) | Not exploitable today (no catalog value contains `\|`), and the endpoint is purely advisory — a collision would only ever produce a wrong-but-harmless suggestion, never affect anything persisted, authorized, or validated. Speculative hardening disproportionate to the (non-existent) real consequence. |
| 10 | A repeated query key (`?origenTipo=A&origenTipo=B`) was rejected with the same message used for a genuinely absent param ("origenTipo is required"), which is misleading — the caller did supply something (edge-case-hunter) | low (patched) | Real, cheap DX fix. Split into distinct "missing" vs. "invalid" messages in `assertValidRequiredTipoQuery`; also closes blind-hunter's dead-code finding #6 as a side effect. |
| 11 | No `.trim()` on `origenId`/`destinoId`/`tipo`, inconsistent with `InventoryService.create`'s trimming of `nombre` — a whitespace-padded value fails existence/catalog checks confusingly (edge-case-hunter) | low (patched) | Real inconsistency, cheap fix. Added `.trim()` for all three, matching `InventoryService.create`'s pattern; also caught and fixed an ordering bug this introduced (see Design Notes) via a regression test. |
| 12 | The frozen Boundaries section lists checks (existence, self-relation, catalog) in a different narrative order than the actual code's check order (catalog, self-relation, existence, duplicate) — a latent doc trap (edge-case-hunter) | low (rejected) | The Boundaries section is a bulleted list of independent rules, not a mandated enforcement sequence — no bullet claims ordering, and every individual rule is correctly enforced regardless of order. Not a contradiction requiring renegotiation. |
| 13 | The happy-path audit-snapshot test's mocked `tx.relacion.create` return value was field-for-field identical to the input `dto`, so it couldn't distinguish "cambios built from the persisted row" from "cambios built from an echo of the input" (verification-gap) | medium (patched) | Real test-quality gap, same class as a prior story's (3.4) identical finding. Added a regression test with a mocked return value that differs from the input in `descripcion`. |
| 14 | "No audit entry on a rejected duplicate" (AC2) was only indirectly verified via `$transaction` not being called, never a direct `auditService.record` assertion — inconsistent rigor vs. the P2002 race-backstop test a few lines below, which does assert it directly (verification-gap) | low (patched) | Real, cheap fix. Added the direct assertion to the up-front-duplicate test. |
| 15 | `suggestRelation`'s `*\|CLUSTER` wildcard branch (named explicitly in the spec's own Code Map) had zero test coverage — only the exact-match and generic-fallback branches were tested (verification-gap) | medium (patched) | Real gap. Added a test exercising the wildcard branch directly. |
| 16 | The repeated-query-key rejection test only asserted `toThrow(BadRequestException)`, not the specific message, unlike its sibling tests (verification-gap) | low (patched) | Resolved as part of #10's fix — the test now asserts the new, distinct `INVALID_ORIGEN_TIPO_MESSAGE`. |

## Design Notes

- **Why `Restrict`, not `Cascade`, on the item FKs:** a DB-level cascade delete would remove `Relacion` rows entirely outside application code, meaning no `RegistroAuditoria` entry would ever exist for those deletions — a silent, permanent hole in the audit trail AD-3 treats as non-negotiable everywhere else in this codebase. Making a cascade properly audited would require `InventoryService.remove` to call into `RelationsService` to delete each relation (with its own audit entry) inside the same transaction as the item delete — real cross-module orchestration, disproportionate to this story's scope. `Restrict` (blocking the delete with a clear error) is the same choice already made for `RegistroAuditoria.usuarioId -> Usuario`, for the same reason: protect data whose loss would otherwise be silent.
- **Why `GET /relations/suggest` takes types, not item ids:** the suggestion is purely a function of `(origenTipo, destinoTipo)` — accepting item ids would require a DB round-trip (two `findUnique` calls) to do nothing but look up a value the caller likely already has (having just picked the two items from the inventory list). Taking types directly keeps the endpoint a pure, trivially-testable static lookup with no Prisma dependency at all.
- **Why the suggestion catalog is small and falls back to a generic default:** FR-20 only requires "a reasonable suggestion the editor can accept or change" — it is explicitly advisory, never authoritative. A handful of the epic's own reference examples plus one sane fallback satisfies that; exhaustively mapping all ~22×22 item-type pairs would be speculative effort for a feature nothing requires to be exhaustive.
- **Trim-before-catalog-check ordering (post-review fix):** adding `.trim()` for `origenId`/`destinoId`/`tipo` (review finding #11) initially landed *after* the existing `RELATION_TYPE_CATALOG.includes(dto.tipo)` check, which meant a whitespace-padded `tipo` (e.g. `'  HOSTS  '`) would still fail catalog validation before ever reaching the trim — defeating the fix's own purpose. Caught while writing the regression test (the test failed against the first version of the patch) and corrected by moving the trim to the very top of `create`, before any validation reads `tipo`. Worth noting because it's exactly the kind of ordering mistake that's easy to introduce silently when retrofitting a cross-cutting normalization step into an existing sequential check chain.
- **Why the `RelationsService.create` `P2003` catch uses one generic message rather than disambiguating `origenId` vs. `destinoId`:** Prisma's `P2003` error does carry `error.meta.field_name` (the failing constraint's name), which could in principle identify which FK failed. `InventoryService.remove`'s own `P2003` catch (this same story) doesn't disambiguate either — it uses one generic message for "the item still has relationships." Matching that precedent keeps both catches the same shape; a caller hitting this race (extremely narrow — the item must vanish in the exact window between the existence check and the transactional insert) gets a clear "something you referenced is gone" signal either way.

## Verification

**Commands:**
- `npm run -w apps/api build` -- exit 0, no TypeScript errors.
- `npm run -w apps/api test` -- **Test Suites: 29 passed, 29 total; Tests: 474 passed, 474 total** (up from 424 before this story: new `relations.service.spec.ts` and `relations.controller.spec.ts` suites — 49 tests total, including 6 added in review (a `RelationsService.create` `P2003`->`404` regression, a trim regression, a wildcard-suggestion test, an audit-snapshot-comes-from-the-persisted-row regression, and two `GET /relations/suggest` query-validation tests) — covering every I/O matrix row including the real-`JwtAuthGuard`+`RolesGuard`+`Reflector` chain tests, plus 2 new `InventoryService.remove` tests — the `P2003`->`409` conversion and a "non-P2025/P2003 error rethrown unchanged" regression check — corrected post-review, the original "468 total" count here was wrong).
- `npm run -w apps/api lint` -- exit 0, no errors (`--fix` reformatted a few long lines/import wraps across the new files; no logic changed).
- Manual smoke test against the real `testos-postgres` Docker container, with the API running via `npm run start` and a real login (`POST /auth/login` as the seeded `ADMINISTRATOR`, `admin@example.com`):
  - Created two real items via `POST /items`: `smoke-vs-1` (`VIRTUAL_SERVER`) and `smoke-svc-1` (`SERVICE`).
  - `POST /relations` `{origenId: vs-1, destinoId: svc-1, tipo: HOSTS}` as `ADMINISTRATOR` -> `201` with the created `Relacion` row.
  - Repeated the identical request -> `409 {"message":"This relation already exists."}`.
  - `POST /relations` with `tipo: "NOT_A_TYPE"` -> `400 {"message":"'NOT_A_TYPE' is not a recognized relation type."}`.
  - `POST /relations` with `origenId === destinoId` -> `400 {"message":"origenId and destinoId must be different items."}`.
  - `GET /relations/suggest?origenTipo=VIRTUAL_SERVER&destinoTipo=SERVICE` -> `200 {"tipo":"HOSTS","descripcion":"The virtual server hosts this service."}`.
  - `GET /relations/suggest?origenTipo=FIREWALL&destinoTipo=CERTIFICATE` (unmapped pair) -> `200 {"tipo":"CONNECTS_TO","descripcion":"These items are connected."}` (generic fallback, no error).
  - `POST /relations` with `origenId` a well-formed but non-existent UUID -> `404 {"message":"origenId does not match any item."}`.
  - `DELETE /items/:id` on the origin item (`vs-1`, still has the `HOSTS` relation) -> `409 {"message":"Cannot delete an item that still has relationships."}`, item left intact.
  - `SELECT ... FROM "RegistroAuditoria" WHERE entidad = 'Relacion'` -> exactly one `CREATE` row with `cambios` = `{"tipo":"HOSTS","origenId":...,"destinoId":...,"descripcion":null}`, confirming the first Acceptance Criterion.
  - Deleted the relation row directly via `psql` (simulating the spec's "delete the relation's underlying rows" cleanup step), then `DELETE /items/:id` on the same origin item -> `204`, and `DELETE /items/:id` on the destination item -> `204`. Both items and the relation are now gone from the dev DB.
  - Server stopped after verification.
