---
title: 'Delete an existing configuration item'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '84f31b4d596d0c0329410ebcfe1d219a35de70c8'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way to remove an `ItemConfiguracion` that is no longer relevant — the inventory (spec-3-1/3-2/3-3) can only grow, and obsolete assets stay listed forever with no path to clean them up.

**Approach:** Add `DELETE /items/:id` (Editor and above) that permanently removes the item's row and stops it from appearing in `GET /items` (spec-3-2) and any future lookup, recording the deletion in `RegistroAuditoria` inside the same transaction as the delete (AD-3), mirroring the `create`/`update` transactional pattern exactly.

## Boundaries & Constraints

**Always:**
- Hard delete (`prisma.itemConfiguracion.delete`) — no soft-delete/`activo` flag exists on `ItemConfiguracion` (spec-3-1's schema has none), and the epic's acceptance criterion only requires the item to "stop appearing in listings and searches," which a real row removal trivially satisfies. Introducing a soft-delete column now would be new, unrequested schema surface.
- Same RBAC as `create`/`update`: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(EDITOR, MANAGER, ADMINISTRATOR)` — Consulta (READ_ONLY) is rejected with `403` (epic AC, second scenario).
- Unknown `id` -> `404` with the existing `ITEM_NOT_FOUND_MESSAGE` (`InventoryService`'s already-exported constant) — checked via `findUnique` before the transaction starts, same as `update`.
- The delete and its `RegistroAuditoria` entry (`tipoAccion: DELETE`) happen inside one `prisma.$transaction` (AD-3), via `AuditService.record(tx, ...)`.
- `cambios` for the `DELETE` audit entry is a full snapshot of the item as it existed right before deletion (`nombre`, `descripcion`, `dominioPropietario`, `direccionRed`, `tipo`, `properties`) — mirroring `create`'s full-snapshot shape (the natural "reverse" of a create), since there is no "after" state to diff against.
- Response: `204 No Content`, empty body — standard REST for a delete with nothing meaningful left to return.
- `entidadId`/`entidad` on the audit row are unaffected by the delete: `RegistroAuditoria.entidadId` is a plain `String`, not a FK (schema comment confirms this is deliberate so the audit trail can reference entities from tables spanning multiple future epics) — deleting the item does not touch or orphan its prior `CREATE`/`UPDATE` audit rows.
- Fix the now-reachable race this story exposes: with delete now existing, `InventoryService.update`'s `findUnique`-then-later-`update` sequence can hit Prisma's `P2025` ("record not found") if the item is deleted between the two steps — catch `P2025` in `update`'s transactional `tx.itemConfiguracion.update` call (same `try/catch` shape already used there for `P2002`) and rethrow as `NotFoundException(ITEM_NOT_FOUND_MESSAGE)` instead of letting the raw Prisma error surface as an unhandled `500`. `delete` must guard the identical race against itself (two concurrent deletes of the same item) the same way.

**Never:**
- No soft-delete, no `deletedAt`/`activo` column, no "trash"/recovery flow — out of scope for this story.
- No cascade behavior toward relations or change requests — those entities don't exist yet (Epic 4/5); the epic explicitly defers that question.
- No confirmation step, no dry-run/preview endpoint — a single `DELETE` call performs the deletion immediately, same posture as every other mutating endpoint in this codebase (no two-phase writes anywhere).
- No new Prisma migration — `ItemConfiguracion.id` already exists as the delete key; no schema change is needed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Existing item id, caller is EDITOR+ | `204 No Content`; row removed; `GET /items` no longer returns it | N/A |
| Unknown id | Id that matches no row | N/A | `404 Item not found.` |
| Insufficient role | Caller is READ_ONLY | N/A | `403` (RolesGuard) |
| Unauthenticated | No/invalid `Authorization` header | N/A | `401` (JwtAuthGuard) |
| Concurrent double-delete | Two `DELETE` requests for the same id race; loser's `tx.itemConfiguracion.delete` hits Prisma `P2025` | Winner: `204`, one `DELETE` audit row. Loser: no audit row | `404 Item not found.` (P2025 caught, not a raw 500) |
| Concurrent update-during-delete | `PATCH /items/:id` and `DELETE /items/:id` race; the `PATCH`'s `tx.itemConfiguracion.update` runs after the item is already gone | N/A | `404 Item not found.` (P2025 caught in `update`, not a raw 500) |

</frozen-after-approval>

## Code Map

- `apps/api/src/inventory/inventory.service.ts` -- add `InventoryService.remove(usuarioId, id)`: `findUnique` (404 if missing) -> `$transaction` -> `tx.itemConfiguracion.delete` (catch `P2025` -> `NotFoundException`) -> `AuditService.record(tx, { tipoAccion: DELETE, cambios: <full snapshot> })`. Also patch the existing `update` method's transactional `tx.itemConfiguracion.update` call to add a `P2025` catch alongside its existing `P2002` catch (same `try/catch` block, one more `if` branch).
- `apps/api/src/inventory/inventory.controller.ts` -- add `@Delete(':id')` on `InventoryController`, same `@UseGuards`/`@Roles` decorators as `create`/`update`, `@HttpCode(HttpStatus.NO_CONTENT)`, calling `inventoryService.remove(request.user.sub, id)` and returning nothing.
- `apps/api/src/inventory/inventory.service.spec.ts` -- reuse the `update` describe block's `EXISTING_ITEM` fixture/mock shape for a new `remove` describe block.
- `apps/api/src/inventory/inventory.controller.spec.ts` -- reuse `create`/`update`'s RBAC test pattern (dispatch + real-guard-chain tests) for `DELETE /items/:id`.
- `apps/api/prisma/schema.prisma` -- no change (delete uses the existing `id` primary key; `TipoAccion.DELETE` already exists in the enum).

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/inventory/inventory.service.ts` -- add `remove(usuarioId, id)` -- performs the transactional delete + audit write per Boundaries
- [x] `apps/api/src/inventory/inventory.service.ts` -- patch `update`'s existing `catch` block to also handle `P2025` -- closes the race this story makes reachable (per Boundaries/Always, carried over from spec-3-3's forward-looking Design Note)
- [x] `apps/api/src/inventory/inventory.controller.ts` -- add `DELETE /items/:id` handler -- wires RBAC + calls `remove`
- [x] `apps/api/src/inventory/inventory.service.spec.ts` -- unit tests for `remove` (happy path, 404, P2025-as-404, audit entry shape, no-audit-on-404) and for `update`'s new P2025 handling
- [x] `apps/api/src/inventory/inventory.controller.spec.ts` -- RBAC/dispatch tests for `DELETE /items/:id` (403 for READ_ONLY, 401 unauthenticated, 204 + correct service call for EDITOR+, at least one real-guard-chain test per existing `create`/`update`/`list` precedent)

**Acceptance Criteria:**
- Given an existing item, when an Editor (or Manager/Administrator) deletes it, then it is removed and no longer appears in `GET /items`, and exactly one `DELETE` `RegistroAuditoria` row is recorded with a full pre-deletion snapshot in `cambios`.
- Given a Consulta (READ_ONLY) user, when they attempt to delete an item, then the system rejects the action with `403`.
- Given an unknown item id, when `DELETE /items/:id` is called, then the system responds `404` and records no audit entry.

## Implementation Notes

`InventoryService.remove(usuarioId, id)` was added directly after `update`. It does a single `findUnique` to both supply the "before" state (the full pre-deletion snapshot needed for the audit `cambios`) and produce the `404` (`ITEM_NOT_FOUND_MESSAGE`) for an unknown `id`, exactly mirroring `update`'s own lookup. The actual row removal (`tx.itemConfiguracion.delete`) and its `RegistroAuditoria` entry (`tipoAccion: DELETE`, `cambios` = the full snapshot captured by the earlier `findUnique`) happen inside one `prisma.$transaction`, mirroring `create`/`update`. The transactional `delete` call is wrapped in the same `try/catch` shape `create`/`update` already use for `P2002`, here catching `P2025` ("record to delete does not exist") and rethrowing as `NotFoundException(ITEM_NOT_FOUND_MESSAGE)` — this is what makes the "concurrent double-delete" row of the I/O matrix return a clean `404` instead of an unhandled `500`; because the catch sits before the `AuditService.record` call, the losing request never reaches the audit write.

Per the spec's own Boundaries item, `update`'s existing transactional `try/catch` (which already handled `P2002`) gained one more `if` branch for `P2025`, converting it to the same `NotFoundException(ITEM_NOT_FOUND_MESSAGE)` every other unknown-id path in this module returns. This closes the race spec-3-3's Design Notes flagged as real-but-then-unreachable: with `remove` now existing, an item can be deleted between `update`'s own up-front `findUnique` and its later transactional `update`, and Prisma's `P2025` is exactly what surfaces when that happens.

`InventoryController.remove` adds `DELETE /items/:id` with the same `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(EDITOR, MANAGER, ADMINISTRATOR)` as `create`/`update`, `@HttpCode(HttpStatus.NO_CONTENT)`, and the same defensive `if (!request.user) throw new UnauthorizedException()` guard as the other two mutating handlers (dead in practice since `JwtAuthGuard` always runs first, but kept for the same reason it exists there). The handler takes no request body and returns nothing (`Promise<void>`), matching the spec's "empty body" requirement — NestJS's `@HttpCode(204)` combined with returning `undefined` produces a response with no body.

No new Prisma migration, no schema changes: `TipoAccion.DELETE` already existed in the enum (defined but unused until this story), and the delete key is the existing `id` primary key.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | `remove()`'s audit `cambios` snapshot was built from the pre-transaction `findUnique` read, not from `tx.itemConfiguracion.delete`'s own return value — a concurrent `PATCH` committing between the two would make the `DELETE` audit row record stale, wrong field values instead of what was actually deleted (blind-hunter, edge-case-hunter — same defect, converged independently) | medium (patched) | Real, verified against the code. Fixed: `remove()` now captures `tx.itemConfiguracion.delete`'s return value and builds `cambios` from it, mirroring how `create`/`update` already build their audit payload from their own mutation's result rather than an earlier read. Added a regression test (`inventory.service.spec.ts`) proving the snapshot reflects the transactional delete result even when it differs from the up-front read. |
| 2 | The DELETE `404` real-guard-chain controller test only asserted the HTTP status, never that `inventoryService.remove` was called with the expected `(callerId, id)` pair — unlike its sibling `204` success test a few lines above (blind-hunter) | low (patched) | Real gap, cheap fix. Added the missing `toHaveBeenCalledWith('caller-1', 'missing-item')` assertion. |
| 3 | Verification section miscounted new tests: claimed "6 new `InventoryService.remove` unit tests," actually 5 (blind-hunter) | low (patched) | Verified by counting `it(...)` blocks in the `remove` describe block directly — documentation-accuracy error only. Corrected (now also reflects the 1 test added by this review, for 6 total). |
| 4 | `P2025`-catch logic (6-line `if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') throw NotFoundException(...)`) is duplicated near-verbatim between `update` and `remove`, no shared helper extracted (blind-hunter) | low (rejected) | Real duplication, but only 2 occurrences of a small, simple block — matches this codebase's established practice of not abstracting until a third occurrence exists (mirrors the pre-existing, still-unextracted `P2002` duplication between `create` and `update`). Not worth a refactor for this story's scope. |
| 5 | Same finding as #1 above, independently found by edge-case-hunter with additional framing (`tx.itemConfiguracion.delete`'s return value discarded) | medium (patched) | Duplicate of #1 — see its evidence. |
| 6 | `InventoryService.list`'s `findMany`/`count` run as two independent, non-transactional queries — a concurrent `DELETE` committing between them can make `total` drift from the returned page; pre-existing from spec-3-2, but this story's `DELETE` is the first mutation likely to race against `list()` at meaningful frequency (edge-case-hunter) | low (deferred) | Real, but pre-existing and already logged in `deferred-work.md` (`InventoryService.list`'s `findMany`/`count` non-atomicity entry) — not introduced by this story, no new entry needed. |
| 7 | `AuditService.record` inside `remove()`'s transaction sits outside the `P2025` `try/catch`, so a hypothetical future failure there (e.g. an FK violation once a delete-user feature exists) would surface as an unhandled 500 rather than a typed exception (edge-case-hunter) | low (rejected) | Matches the identical, pre-existing posture in `create`/`update` — the audit call is never wrapped in either method's `try/catch` there either. Not a new gap introduced by this story. Currently unreachable (no delete-user feature exists anywhere in this codebase). |
| 8 | A demoted-but-still-token-valid user (stale JWT role claim, `JwtAuthGuard`'s documented by-design behavior) can perform this story's now-irreversible hard delete, whereas the same stale-claims tolerance was previously only ever exposed to recoverable actions (create/update) (edge-case-hunter) | medium (deferred) | Real, legitimate escalation-in-consequence point. Fixing it (DB-backed role re-verification, or reauth-for-destructive-actions) is an auth-architecture change well beyond this story's scope. Logged to `deferred-work.md` as a new entry. |
| 9 | `@HttpCode(204)` + `Promise<void>` correctness depends on the handler never explicitly returning a value and the service continuing to resolve `void` — neither is runtime-enforced, only by convention/TypeScript (edge-case-hunter) | low (rejected) | Speculative — describes a future-refactor risk, not a present defect. Both `create`/`update` (`return ...`) and `remove` (no `return`) are correct as written for their respective HTTP semantics today; guarding against a hypothetical future mistake isn't in scope. |
| 10 | "Item no longer appears in `GET /items`" (first Acceptance Criterion) is only checked by a manual Docker smoke test, never an automated test — no e2e/integration suite exists anywhere in this repo, only unit tests against a fully mocked `PrismaService` (verification-gap) | medium (deferred, systemic) | Real, but pre-existing and already logged in `deferred-work.md` (the "every test runs against a fully mocked PrismaService, no live-DB integration suite exists" entry from spec-2-1's review). Not new to this story. |
| 11 | The literal `"Item not found."` message text is never asserted at the HTTP-response-body layer for `DELETE /items/:id` — only the status code (`.expect(404)`) is checked via supertest (verification-gap) | low (rejected) | Matches the identical, pre-existing test-style convention already used for `PATCH /items/:id`'s own 404 test — not new to this story. |
| 12 | The "Concurrent double-delete" matrix row's two halves (winner gets 204+1 audit row, loser gets 404+0 audit rows) are each tested independently with freshly-reset mocks, never as one coherent two-call sequence proving the actual race interaction (verification-gap) | low (rejected) | Matches the exact precedent set by `create`/`update`'s own `P2002` race tests (also tested as independent halves, never a true two-call sequence) — systemic testing-style choice, not a story-specific shortcut. |

## Design Notes

- **Why hard delete over soft delete:** `ItemConfiguracion` has no `activo`/`deletedAt` column today, and adding one now would be speculative schema surface for a feature (undo/recovery) nobody has asked for. The epic's own acceptance criterion ("deja de aparecer en listados y búsquedas") is fully satisfied by a real row removal. If a future epic needs recoverability, that is its own story with its own migration.
- **Why the audit `cambios` is a full snapshot, not `{before, after}`:** `update` uses `{before, after}` because both states exist simultaneously. `delete` has no "after" — the item ceases to exist — so a full snapshot (mirroring `create`'s shape) is the only structure that preserves "what was lost," which is exactly what an audit trail for a destructive action needs to be useful.
- **Why `update` gets a `P2025` catch as part of this story, not a separate one:** spec-3-3's own review flagged this race as real but *currently unreachable* because no delete capability existed yet; this story is precisely what makes it reachable, so fixing it here (rather than deferring again) closes the gap at the moment it actually opens up.
- **Why `remove`'s audit snapshot is built from `tx.itemConfiguracion.delete`'s return value, not the up-front `findUnique` (post-review correction):** the initial implementation built `cambios` from the pre-transaction `findUnique` read. Two independent reviewers (blind-hunter, edge-case-hunter) converged on the same real defect: a concurrent `PATCH` committing between that read and the transactional delete would make the `DELETE` audit row record stale, wrong values instead of what was actually removed. Fixed by using `tx.itemConfiguracion.delete`'s own return value for `cambios` instead — this also brings `remove` in line with `create`/`update`, both of which already build their audit payload from their own mutation's result rather than an earlier read.
- **Known, accepted limitation carried forward from this review (not fixed here):** extending this module's existing stale-JWT-role-claim tolerance (`JwtAuthGuard` never re-checks the DB) to a now-irreversible hard delete is a real escalation in consequence versus the same tolerance gating only recoverable create/update actions. Logged in `deferred-work.md` rather than fixed — the real fix is an auth-architecture decision (DB-backed re-verification or reauth-for-destructive-actions) spanning every mutating endpoint, well beyond this story's scope.

## Verification

**Commands:**
- `npm run -w apps/api build` -- exit 0, no TypeScript errors.
- `npm run -w apps/api test` -- **Test Suites: 27 passed, 27 total; Tests: 424 passed, 424 total** (up from 408 before this story: 5 `InventoryService.remove` unit tests from implementation plus 1 added in review — 6 total — 1 new `InventoryService.update` P2025 unit test, and new `InventoryController` `DELETE /items/:id` dispatch + RBAC tests, 2 of which use the real `JwtAuthGuard`+`RolesGuard`+`Reflector` chain per the existing `create`/`update`/`list` precedent — corrected post-review, the original "6 new remove tests"/423-total counts here were wrong). All existing `create`/`update`/`list` tests still pass unmodified.
- `npm run -w apps/api lint` -- no errors (`--fix` reformatted a couple of long lines in the new tests; no logic changed).
- Manual smoke test against the real `testos-postgres` Docker container, with the API running via `npm run start` and a real login (`POST /auth/login` as the seeded `ADMINISTRATOR`, `admin@example.com`):
  - Created a real item via `POST /items` (`spec-3-4-smoke-item`).
  - `DELETE /items/:id` as `ADMINISTRATOR` -> `204` with an empty body.
  - `GET /items?texto=spec-3-4-smoke-item` afterward -> `{"data":[],"total":0,...}` — the item no longer appears in listings/search.
  - `GET /audit?entidadId=<id>` afterward -> two rows, most-recent-first: a `DELETE` row with `cambios` equal to the full pre-deletion snapshot (`{tipo, nombre, properties, descripcion, direccionRed, dominioPropietario}`) exactly matching the item as created, plus the original `CREATE` row untouched — confirms the audit trail and that the prior `CREATE` entry is unaffected by the delete (per Boundaries).
  - `DELETE /items/:id` again on the same (now-deleted) id -> `404 Item not found.` (confirms the concurrent-double-delete-style race path, exercised here as a straightforward re-delete rather than true concurrency, returns the same clean 404 the P2025 catch produces).
  - Created a second item (`spec-3-4-smoke-item-2`), then temporarily downgraded the admin user's role to `READ_ONLY` in the DB and re-logged-in for a token carrying that role: `DELETE /items/:id` as `READ_ONLY` -> `403 You do not have permission to perform this action`, item left intact.
  - `DELETE /items/:id` with no `Authorization` header -> `401 Missing or invalid Authorization header`.
  - Restored the admin user's role to `ADMINISTRATOR`, deleted the leftover `spec-3-4-smoke-item-2` as `ADMINISTRATOR` (`204`), and stopped the server. `docker exec testos-postgres psql ... SELECT count(*) ... WHERE nombre LIKE 'spec-3-4-smoke%'` confirmed `0` rows remain, and the admin's role was confirmed restored to `ADMINISTRATOR`.
