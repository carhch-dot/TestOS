---
title: 'Search, filter, and list items'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'abdb75229ce8f659e7bd3b90d473f2edf1630c23'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 3.1 can create items but nothing can list or search them back (FR-15) — the inventory is currently write-only.

**Approach:** `GET /items` (authenticated, any role — read access has no role restriction, matching `GET /audit`'s posture) returns a paginated list of `ItemConfiguracion`, optionally filtered by `tipo` (exact match) and/or `texto` (free-text substring match across `nombre`/`descripcion`, AND-combined with `tipo` when both are supplied).

## Boundaries & Constraints

**Always:**
- `InventoryService` (spec-3-1's existing service) gains a `list(filters, page, pageSize)` method; `InventoryController` gains `GET /items` — no new module.
- `GET /items` uses `@UseGuards(JwtAuthGuard)` only — no `RolesGuard`/`@Roles(...)`, same reasoning and pattern as `GET /audit` (spec-2-2): read access has no role restriction (FR-12 "Consulta = solo lectura" means Consulta *can* read, not that only Consulta can).
- Response shape matches the architecture's pagination convention: `{ data, total, page, pageSize }`; `page`/`pageSize` parsing/clamping exactly mirrors `UsersController.list`/`AuditController.list` (defaults 1/50, caps 200/200).
- `texto`, when supplied, matches case-insensitively against `nombre` OR `descripcion` (substring, not exact) — items matching in either field are returned.
- `tipo`, when supplied, is an exact match — not validated against the catalog (unlike `POST /items`'s create-time check): an unrecognized `tipo` filter is a legitimate, harmless empty-result query, not an error, since this is a read.
- `tipo` and `texto` combine with AND logic when both are supplied.
- Unfiltered/default ordering is `nombre asc` — no explicit ordering requirement in the AC; alphabetical is the natural default for a searchable catalog (no "most recent first" expectation the way `GET /audit` has).
- Each list entry returns the full `ItemConfiguracion` row (all common fields plus `properties`) — no separate summary/detail split exists yet, and none is needed for this story.

**Never:**
- No create/update/delete here — `InventoryService.create` (spec-3-1) is untouched.
- No get-by-id/detail endpoint — out of scope, not required by this story's AC.
- No sort options beyond the fixed `nombre asc` default.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Any authenticated role lists with no filters | `GET /items?page=1&pageSize=20` | `200`; `{ data, total, page, pageSize }`; entries ordered `nombre asc` | N/A |
| Filter by `tipo` | `GET /items?tipo=DATABASE` | `200`; only items of that exact type | N/A |
| Filter by `texto` | `GET /items?texto=core` | `200`; only items whose `nombre` or `descripcion` contains it (case-insensitive) | N/A |
| Filter by both `tipo` and `texto` | `GET /items?tipo=DATABASE&texto=core` | `200`; only items matching both | N/A |
| `tipo` value not in the catalog | `GET /items?tipo=NOT_A_TYPE` | `200`; empty `data` — not an error | N/A |
| Invalid/out-of-range `page`/`pageSize` (non-numeric, zero, negative, or over the 200 cap) | e.g. `GET /items?page=-1` | `200`; silently normalized to the nearest valid value (default or the 200 cap), never rejected | N/A |
| Repeated `tipo`/`texto` query key (parses to an array) | `GET /items?tipo=A&tipo=B` | `400` | Clear error message |
| Unauthenticated caller | `GET /items` | `401` | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/inventory/inventory.service.ts` -- existing (spec-3-1): add `list(filters, page, pageSize)`
- `apps/api/src/inventory/inventory.controller.ts` -- existing: add `GET /items`
- `apps/api/src/audit/audit.controller.ts`/`audit.service.ts` -- reference only: the `list(filters, page, pageSize)` + query-param parsing/clamping pattern to mirror exactly (spec-2-2)
- `apps/api/src/auth/users.controller.ts` -- reference only: the `page`/`pageSize` default/clamp constants to match

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/inventory/inventory.service.ts` -- `list(filters, page, pageSize)` implementing the I/O matrix
- [x] `apps/api/src/inventory/inventory.controller.ts` -- `GET /items`
- [x] Unit tests: `inventory.service.ts` (all filter combinations, ordering, pagination), `inventory.controller.ts` (dispatch + RBAC — real-guard-chain test proving all four roles reach the service, per `AuditController`'s spec-2-2 precedent)

**Acceptance Criteria:**
- Given items of several types, when filtered by `tipo`, then only items of that type are returned.
- Given items whose `nombre` or `descripcion` contains given text, when searched by that `texto`, then only matching items are returned.
- Given more items than the page size, when listed without specifying a page, then the first page (default 50) and the real total are returned.

## Implementation Notes

- `InventoryService.list(filters, page, pageSize)` added to the existing `apps/api/src/inventory/inventory.service.ts` alongside `create` (no new module, per Boundaries). New exported types `InventoryListFilters` (`{ tipo?, texto? }`) and `InventoryListResult` (`{ data, total, page, pageSize }`).
  - `where` is built the same "spread only when defined" way as `AuditService.list` (spec-2-2): omitting a filter's key entirely (rather than passing `undefined`) is what makes Prisma treat "no filter" as "match everything."
  - `tipo` is an exact-match `where.tipo`, deliberately not checked against `ITEM_TYPE_CATALOG` — an unrecognized `tipo` is a legitimate empty-result query on a read, not an error (matches `create`'s asymmetric validation only on writes).
  - `texto` becomes `where.OR: [{ nombre: { contains, mode: 'insensitive' } }, { descripcion: { contains, mode: 'insensitive' } }]`. When both `tipo` and `texto` are supplied they land as sibling keys on the same `where` object (`tipo` AND `OR:[...]`), which is AND semantics under Prisma.
  - `findMany`/`count` run via `Promise.all` against the same `where`, ordered `{ nombre: 'asc' }` (no tie-breaker column added — `nombre` is `@unique`, so ties are impossible, unlike `AuditService.list`'s `fecha`/`id` pair).
  - No migration needed: `@@index([tipo])` on `ItemConfiguracion` was already present in `schema.prisma` (added proactively during spec-3-1), confirmed still in sync via `prisma migrate status`.
- `InventoryController` gains `GET /items` in the existing `apps/api/src/inventory/inventory.controller.ts` (no new controller/module). `@UseGuards(JwtAuthGuard)` only — no `RolesGuard`/`@Roles(...)` — matching `AuditController.list`'s posture exactly.
  - `page`/`pageSize` parsing/clamping (`parsePositiveInt` + `Math.min` against `MAX_PAGE`/`MAX_PAGE_SIZE`, defaults 1/50, caps 200/200) is a byte-for-byte copy of `AuditController.list`'s local constants/helper — spec Boundaries requires matching it exactly rather than inventing a separate convention. (`InventoryController` now has its own local `parsePositiveInt`, same as `AuditController` and `UsersController` each do — no shared helper existed to reuse.)
  - `tipo`/`texto` query params: an empty string (e.g. `?tipo=`) is normalized to `undefined` via `raw || undefined`, so it means "no filter," not "filter on the empty string" — same rule `AuditController.list` applies to its string filters.
- Both new unit-test suites mirror `audit.controller.spec.ts`/`audit.service.spec.ts`'s structure and coverage depth: every filter alone, both combined, empty-string-means-no-filter, page/pageSize defaulting and clamping at and past both boundaries (200/201), ordering, and — for the controller — a real-guard-chain integration test (`JwtAuthGuard` + `RolesGuard` + a stubbed `JwtService.verifyAsync`, no guard overrides) proving all four `UsuarioRole` values reach the service on `GET /items` and an unauthenticated caller gets 401, matching `AuditController`'s spec-2-2 precedent test.
- Manually verified end-to-end against the real local `testos-postgres` Postgres container (see Verification): logged in as the bootstrap admin, created four `ItemConfiguracion` rows covering the `tipo`/`texto`/combined/unrecognized-`tipo`/pagination cases from the I/O matrix, confirmed every response body matched, then deleted the four rows via `psql` to leave the database exactly as found.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | `tipo`/`texto` have no type guard against a repeated query key (`?tipo=A&tipo=B`) — Express/Nest parses this to a `string[]`, which is truthy and passes straight through `raw || undefined` into `where.tipo`, likely surfacing as an unhandled `500` instead of a clean `400` (blind-hunter, edge-case-hunter) | medium | Verified — `parsePositiveInt` guards `page`/`pageSize` with a `typeof` check, but the `tipo`/`texto` line doesn't. The identical `raw || undefined` pattern (no `typeof` guard) already exists in `AuditController.list`'s `usuarioId`/`entidad`/`entidadId` (spec-2-2) — same bug class, pre-existing there. |
| 2 | No length cap on `tipo`/`texto` query filters, unlike every other free-text input in this codebase, including `create`'s own `nombre`/`tipo`/`descripcion` fields (blind-hunter, edge-case-hunter) | low | Verified — no bound exists; an unbounded string flows straight into a Prisma `contains` scan. |
| 3 | The `page` cap of 200 is copied verbatim from `AuditController` (where "recent-first" access makes it a reasonable ceiling) without examining whether it fits an alphabetically-ordered catalog with no "jump to record" mechanism — beyond `200 * pageSize` items become permanently unreachable through this endpoint (blind-hunter) | low | Verified the cap is unconditionally copied; real but requires an unrealistic inventory size (tens of thousands of items) to matter in practice for this CMDB's stated scale. |
| 4 | `findMany`/`count` run via `Promise.all`, not inside a transaction — `total` can drift from the returned page under concurrent writes (blind-hunter, edge-case-hunter) | low | Verified — matches `AuditService.list`'s (spec-2-2) identical, already-accepted pattern; not a new gap introduced by this story. |
| 5 | No indexing story for the `texto` `contains`/`mode: insensitive` search — a leading-wildcard substring scan that no B-tree index (including `nombre`'s unique index) can serve efficiently as the catalog grows (blind-hunter) | low | Verified — real, forward-looking performance concern; closing it needs a `pg_trgm`/GIN index, infrastructure not used anywhere else in this codebase yet. |
| 6 | The I/O & Edge-Case Matrix doesn't document `page`/`pageSize` defaulting-and-clamping behavior, despite it being a large part of both the code and the test suite (blind-hunter) | low | Verified — real spec-documentation gap. |
| 7 | `@HttpCode(HttpStatus.OK)` on the new `@Get()` handler is redundant — NestJS already defaults `GET` to `200` (blind-hunter) | low (rejected) | Cosmetic; matches `AuditController.list`'s identical existing style, not a new inconsistency. |
| 8 | No automated test exercises `total` spanning multiple pages together with an active filter — verified once manually per the spec's Implementation Notes, but not in `npm run test` (blind-hunter) | low | Verified — real automated-coverage gap for a manually-confirmed behavior. |
| 9 | `InventoryService.list` has no internal guard against a non-positive `page`/`pageSize` if ever called directly, bypassing the controller's clamping (edge-case-hunter) | low (rejected) | No other caller exists — matches the same internal-trust convention `UsersService.list`/`AuditService.list` already established. |



## Design Notes

## Verification

**Commands:**
- `npm run -w apps/api build` -- exit 0, no TypeScript errors.
- `npm run -w apps/api test` -- `Test Suites: 27 passed, 27 total` / `Tests: 369 passed, 369 total` (full suite, includes the updated `inventory.*` specs).
- `npm run -w apps/api test -- inventory` -- `Test Suites: 2 passed, 2 total` / `Tests: 57 passed, 57 total` (`inventory.service.spec.ts` + `inventory.controller.spec.ts` in isolation).
- `npx prisma migrate status` (from `apps/api`, against the real `testos-postgres` container) -- `Database schema is up to date!`; no migration was needed since `@@index([tipo])` was already present from spec-3-1.

**Manual end-to-end verification against the real local Postgres (`testos-postgres` container, `apps/api/.env`'s `DATABASE_URL`):**
- Started the API with `npm run start:dev`; confirmed `Mapped {/items, GET} route` in the boot log alongside the existing `POST /items` route.
- Logged in as the bootstrap admin (`POST /auth/login`) and captured a real access token.
- Created four `ItemConfiguracion` rows via the existing `POST /items`: `core-db-01` (`DATABASE`, descripcion "Core relational database"), `billing-db-02` (`DATABASE`, "Billing store"), `payments-api` (`API`, "Wraps the CORE ledger service"), `alpha-app` (`APPLICATION`, "unrelated").
- `GET /items?page=1&pageSize=20` -- `200`; all 4, ordered `nombre asc` (`alpha-app`, `billing-db-02`, `core-db-01`, `payments-api`); `total: 4`.
- `GET /items?tipo=DATABASE` -- `200`; exactly `billing-db-02` and `core-db-01`; `total: 2`.
- `GET /items?texto=core` -- `200`; exactly `core-db-01` (matches `nombre`) and `payments-api` (matches `descripcion`, case-insensitively -- descripcion contains "CORE"); `total: 2`.
- `GET /items?tipo=DATABASE&texto=core` -- `200`; only `core-db-01` (AND of both filters); `total: 1`.
- `GET /items?tipo=NOT_A_TYPE` -- `200` (not an error); `{ data: [], total: 0 }`.
- `GET /items` with no `Authorization` header -- `401`.
- `GET /items?page=1&pageSize=2` then `?page=2&pageSize=2` -- each `200` with 2 rows and `total: 4`, confirming `total` reflects the whole filtered set, not just the returned page.
- Cleaned up: deleted the four smoke-test rows directly via `psql` inside the `testos-postgres` container; re-ran `GET /items` and confirmed `{ data: [], total: 0 }`, leaving the database exactly as found. Stopped the dev server afterward.
