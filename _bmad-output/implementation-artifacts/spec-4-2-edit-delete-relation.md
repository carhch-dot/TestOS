---
title: 'Edit and delete an existing relationship'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '580e2f51ca0bdf228b8b70f1b2809c679fcc0ac6'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 4.1 can only create relationships — there is no way to correct a wrong `tipo`, update a `descripcion`, or remove a relationship that no longer applies, so the dependency map can only grow and never stay accurate (FR-21).

**Approach:** Add `PATCH /relations/:id` and `DELETE /relations/:id` to the existing `RelationsController`/`RelationsService` (Editor+ RBAC), mirroring `InventoryService.update`/`remove`'s exact patterns: partial-update semantics for `tipo`/`descripcion` only (never `origenId`/`destinoId` — those define the relation's identity), and a hard delete with a full pre-deletion audit snapshot.

## Boundaries & Constraints

**Always:**
- `PATCH /relations/:id` accepts only `tipo` and/or `descripcion` — `origenId`/`destinoId` are immutable (they form part of the natural key); changing what two items a relation connects is not "editing" it, it's a different relation (create a new one, delete the old).
- At least one recognized field must be supplied, checked in the controller before the service is ever called — mirrors `InventoryController.update`'s `NO_FIELDS_TO_UPDATE_MESSAGE` gate exactly (`400` otherwise).
- `tipo`, when supplied, is trimmed then validated against `RELATION_TYPE_CATALOG` — same order-of-operations as spec-4-1's `create` (trim before catalog check, not after — spec-4-1's own review caught and fixed this ordering bug once already).
- Unknown `id` -> `404` (new `RELATION_NOT_FOUND_MESSAGE`), checked via `findUnique` before any transaction starts, same as `InventoryService.update`/`remove`.
- If `tipo` changes to a value different from the relation's current `tipo`, re-check the natural-key uniqueness — `(origenId, destinoId, newTipo)` must not already exist as a *different* relation (`findFirst` excluding the relation's own id via `NOT: { id }`, mirroring `InventoryService.update`'s `nombre` self-exclusion check) — `409` on collision, backed by the real `@unique` DB constraint as a `P2002` race backstop.
- The transactional `update`/`delete` call also catches `P2025` ("record to update/delete does not exist") — reachable immediately in this story (a concurrent `PATCH`/`DELETE` on the same relation, or the other operation racing it), unlike spec-3-3/3-4 where the same race took two separate stories to become reachable. Rethrown as the same `404` (`RELATION_NOT_FOUND_MESSAGE`).
- The update/delete and its `RegistroAuditoria` entry happen inside one `prisma.$transaction` (AD-3): `update`'s `cambios` is `{before, after}` for exactly the changed field(s), mirroring `InventoryService.update`; `delete`'s `cambios` is a full snapshot (`origenId`, `destinoId`, `tipo`, `descripcion`) built from `tx.relacion.delete`'s own return value — never from an earlier read — mirroring `InventoryService.remove`'s corrected (post-3.4-review) pattern exactly.
- Same RBAC as `POST /relations`: `@Roles(EDITOR, MANAGER, ADMINISTRATOR)` on both new endpoints.
- `DELETE /relations/:id` responds `204 No Content`, empty body, same as `DELETE /items/:id`.

**Never:**
- No `origenId`/`destinoId` field in the `PATCH` request DTO at all — not merely ignored if present, but not part of the accepted shape, so there is no ambiguity about whether supplying them silently does nothing.
- No `P2003` (foreign-key violation) handling needed on `Relacion`'s own delete — nothing in this codebase yet has a foreign key referencing `Relacion.id` (only `Relacion` itself references `ItemConfiguracion`), so deleting a relation can never be blocked the way deleting an item can.
- No cascading or side effects on the related items themselves — editing or deleting a relation never touches `ItemConfiguracion` rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Edit happy path | Existing relation, valid new `tipo` and/or `descripcion`, Editor+ | `200`; relation updated; one `UPDATE` audit row with `{before, after}` | N/A |
| Delete happy path | Existing relation, Editor+ | `204`; relation removed; one `DELETE` audit row with full snapshot | N/A |
| No fields supplied | `PATCH` body has neither `tipo` nor `descripcion` | N/A | `400` |
| Unknown `tipo` on edit | `tipo` not in `RELATION_TYPE_CATALOG` | N/A | `400` |
| `tipo` collides with another relation | New `tipo` makes `(origenId, destinoId, tipo)` match a different existing relation | N/A | `409` |
| Unknown relation id | `id` matches no `Relacion` (edit or delete) | N/A | `404` |
| Insufficient role | Caller is READ_ONLY on either endpoint | N/A | `403` |
| Concurrent double-delete | Two `DELETE` requests race the same relation | Winner: `204` + 1 audit row. Loser: `404`, no audit row (P2025 caught) | `404` |
| Concurrent edit-during-delete | `PATCH` and `DELETE` race the same relation | N/A | `404` (P2025 caught in whichever loses) |

</frozen-after-approval>

## Code Map

- `apps/api/src/relations/relations.service.ts` -- add `RelationsService.update(usuarioId, id, dto)` and `RelationsService.remove(usuarioId, id)`, mirroring `InventoryService.update`/`remove` exactly (see Boundaries). Add `RELATION_NOT_FOUND_MESSAGE` export alongside the existing message constants.
- `apps/api/src/relations/relations.controller.ts` -- add `@Patch(':id')` and `@Delete(':id')` to the existing `RelationsController`, same `@UseGuards`/`@Roles` as `create`. Mirror `InventoryController`'s `NO_FIELDS_TO_UPDATE_MESSAGE`-style gate (new `UpdateRelationRequestDto` with only `tipo?`/`descripcion?`) and its `assertValidTipo`/`assertValidOptionalDescripcion` helpers, already defined in this file — reuse them directly rather than duplicating.
- `apps/api/src/relations/relations.service.spec.ts` + `relations.controller.spec.ts` -- new `describe('update', ...)` / `describe('remove', ...)` blocks and RBAC/dispatch tests, mirroring `inventory.service.spec.ts`/`inventory.controller.spec.ts`'s own `update`/`remove` blocks and the real-guard-chain precedent.
- No `schema.prisma` change — `Relacion` already has every field this story needs; `TipoAccion.UPDATE`/`DELETE` already exist in the enum.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/relations/relations.service.ts` -- `update` -- partial edit of `tipo`/`descripcion` with re-validated uniqueness, transactional write + `{before, after}` audit
- [x] `apps/api/src/relations/relations.service.ts` -- `remove` -- transactional delete + full-snapshot audit (built from the delete's own return value)
- [x] `apps/api/src/relations/relations.controller.ts` -- `PATCH /relations/:id`, `DELETE /relations/:id` -- RBAC + dispatch + the "at least one field" gate
- [x] `apps/api/src/relations/relations.service.spec.ts` -- unit tests covering every I/O matrix row for both methods
- [x] `apps/api/src/relations/relations.controller.spec.ts` -- RBAC/dispatch tests for both endpoints, including real-guard-chain coverage

**Acceptance Criteria:**
- Given an existing relation, when an Editor (or Manager/Administrator) changes its `tipo`, then the change is applied and exactly one `UPDATE` `RegistroAuditoria` row records `{before, after}` for `tipo` only.
- Given an existing relation, when an Editor deletes it, then it is removed and exactly one `DELETE` `RegistroAuditoria` row records its full pre-deletion snapshot.
- Given a Consulta (READ_ONLY) user, when they attempt to edit or delete a relation, then the system rejects the action with `403`.

## Implementation Notes

No `schema.prisma` change was needed — `Relacion` already had every field this story required, and `prisma migrate status` confirmed the DB schema was already up to date against the current schema before any code was written.

`RelationsService.update` mirrors `InventoryService.update`'s shape exactly: `tipo` (when supplied) trimmed then validated against `RELATION_TYPE_CATALOG` before any DB access (same trim-before-catalog-check order `create` uses); existence checked via a single `findUnique` before any transaction starts (`404` via `RELATION_NOT_FOUND_MESSAGE` if missing); when `tipo` is supplied and differs from the relation's current `tipo`, a `findFirst` re-checks `(origenId, destinoId, newTipo)` excluding the relation's own id (`NOT: { id }`); the transactional `tx.relacion.update` call catches both `P2002` (race backstop, same as `create`) and `P2025` (the relation vanishing between the up-front read and the transactional write — reachable immediately here since `remove` ships in the same story) and rethrows both as clean `409`/`404` respectively. `data`/`cambios.before`/`cambios.after` are built field-by-field so only actually-supplied keys are touched — matching `InventoryService.update`'s "re-supplying the current value still writes it through" behavior (not skipped as a no-op) rather than inventing a different convention for this story.

`RelationsService.remove` mirrors `InventoryService.remove`'s corrected (post-3.4-review) pattern: the audit `cambios` snapshot is built from `tx.relacion.delete`'s own return value, never the earlier up-front `findUnique` read, so a concurrent `update` that commits in the race window is reflected accurately in what gets audited as deleted (verified with a dedicated regression test, and confirmed live in the manual smoke test below — the `DELETE` audit row recorded `tipo: "HOSTED_IN"`, the post-`PATCH` value, not the original `"HOSTS"`). No `P2003` handling was added, per spec Boundaries/Never — nothing in this codebase yet has a foreign key referencing `Relacion.id`.

`RelationsController` reused the existing file's `assertValidTipo`/`assertValidOptionalDescripcion` helpers directly for both new endpoints, exactly as the Code Map specified, rather than duplicating them. `UpdateRelationRequestDto` has only `tipo?`/`descripcion?` — no `origenId`/`destinoId` field exists on the class at all, so there is no code path that could ever forward them even if a caller supplied them (verified by a dedicated test). The "at least one field" gate mirrors `InventoryController.update`'s `NO_FIELDS_TO_UPDATE_MESSAGE` pattern precisely, checked before the service is ever called.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | `update`'s audit `cambios.before` is read via a plain `findUnique` before the transaction starts, not re-derived from inside it — two concurrent `PATCH`es changing the SAME field to two different values can both read the same pre-edit state, so the second-to-commit's `before` doesn't reflect what was actually in the row immediately before its own write (blind-hunter, edge-case-hunter — independently converged; edge-case-hunter additionally noted this compounds the uniqueness-recheck's own use of the same stale read) | medium (deferred) | Real, but `update()`'s "before" value needs real row-level locking to fix properly (unlike `remove()`'s cheap return-value swap) — architectural change spanning every `update` method in this codebase, not a one-story fix. New `deferred-work.md` entry added, calling out the audit-fidelity angle specifically (distinct from the already-logged generic non-atomicity class). |
| 2 | A relation's uniqueness re-check can produce a spurious `409` if the colliding relation it found is itself about to be deleted by a concurrent request — the opposite failure direction from the P2002 backstop (edge-case-hunter) | low (rejected) | Matches the same non-atomic check-then-act class already accepted throughout this codebase. Fails closed (a confusing but safe, retry-able 409), not data-corrupting — not worth fixing given the established pattern of accepting this race class elsewhere. |
| 3 | `descripcion` can never be cleared back to `null` via `PATCH` — `assertValidOptionalDescripcion` rejects an explicit `null` as a type error (edge-case-hunter, blind-hunter — independently converged) | low (deferred) | Real, but inherited unmodified from `InventoryController`'s identical helper (copied per this story's own Code Map instruction to reuse it directly) — not introduced by this story. New `deferred-work.md` entry added, spanning both `ItemConfiguracion.descripcion` and `Relacion.descripcion`. |
| 4 | Re-supplying a relation's current, unchanged `tipo`/`descripcion` still writes through and records an audit entry with `before === after` (edge-case-hunter) | low (rejected) | Matches `InventoryService.update`'s established, explicitly-documented (spec-3-3) intentional behavior — not a new gap. |
| 5 | `RelationsService.update` has no internal "at least one field supplied" guard — only the controller enforces it (edge-case-hunter) | low (rejected) | Matches the same internal-trust convention already established for `InventoryService`/`UsersService`/`AuditService` — no other caller exists. |
| 6 | No length cap on the `:id` route param for `PATCH`/`DELETE /relations/:id`, unlike `origenId`/`destinoId`/`tipo` in the request body (edge-case-hunter) | low (rejected) | Matches the identical, pre-existing gap in `InventoryController.update`/`remove` — not new to this story. Functionally harmless (an oversized/malformed id just misses in `findUnique`, clean 404). |
| 7 | Same before-snapshot staleness as #1, independently found with a more detailed audit-trail-corruption scenario (blind-hunter) | medium (deferred) | Duplicate of #1 — see its evidence. |
| 8 | No test in `relations.controller.spec.ts`'s `update (dispatch)` block verifies `BadRequestException` propagation from the service (e.g. an unrecognized `tipo`, which only the service's catalog check can reject) — asymmetric with the adjacent `NotFoundException`/`ConflictException` propagation tests (blind-hunter) | low (patched) | Real, cheap gap. Added the missing propagation test. |
| 9 | No test exercises a genuine `tipo` change (triggering the uniqueness re-check) combined with a genuine `descripcion` change in the same call — the one existing multi-field test keeps `tipo` unchanged (blind-hunter, verification-gap — independently converged, verification-gap rated Medium-High) | medium (patched) | Real, valuable gap — exactly the scenario most likely to expose a field-mixing bug in the before/after construction. Added a regression test with mocked return values differing in both fields. |
| 10 | `descripcion` clearing (setting to `null`) is unconsidered by the spec's own I/O matrix/Boundaries, despite this being the first place a caller could try to clear a `Relacion.descripcion` post-creation (blind-hunter) | low (rejected, covered by #3) | Same underlying gap as #3 — the spec-level observation is folded into that deferred-work.md entry rather than tracked separately. |
| 11 | No dispatch test for a `PATCH` body containing only unrecognized fields (e.g. only `origenId`, no `tipo`/`descripcion`) — the existing "never forwards" test supplies `origenId`/`destinoId` alongside a valid `descripcion`, so the "zero recognized fields" gate is never exercised with only-immutable-fields present (blind-hunter, verification-gap — independently converged) | low (patched) | Real, cheap gap — a plausible caller mistake. Added the missing dispatch test. |
| 12 | The uniqueness re-check's "is this actually a change" decision is based on the same stale pre-transaction read as #1 — compounds it, but the real `@unique` DB constraint (`P2002` backstop) fully covers the actual collision case regardless (blind-hunter) | low (rejected, compounds #1) | No exploitable impact beyond #1's own audit-fidelity concern — not a separate action item. |
| 13 | `update`'s three up-front rejection tests (unknown tipo, unknown id, collision) asserted `$transaction` was never called rather than directly asserting `auditService.record` was never called — inconsistent rigor vs. the adjacent P2002/P2025 tests, which do assert it directly (verification-gap) | low (patched) | Real, cheap consistency fix. Added the direct assertion to all three tests. |
| 14 | The `origenId`/`destinoId`-dropped guarantee and the "no recognized field" gate are only proven via a direct TypeScript method call (with a force-cast to smuggle extra keys past the type system), never through a true HTTP round-trip — Implementation Notes' claim of "a dedicated test" overstated what was actually verified (verification-gap) | low (patched) | Real gap. Added a genuine `supertest`-driven HTTP `PATCH` test with `origenId`/`destinoId` in the JSON body, asserting the service was called without them. The Implementation Notes claim is now accurate. |
| 15 | `remove`'s audit-snapshot regression test (proving `cambios` comes from the transactional delete's own return value) only varied and asserted the `descripcion` field — an implementation that mixed sources per-field (e.g. `origenId`/`destinoId`/`tipo` from the stale read, only `descripcion` from the fresh delete result) would still have passed it (verification-gap) | medium (patched) | Real false-positive risk, same class as prior stories' identical findings (3.4, 4.1). Rewrote the test to vary and assert all four `cambios` fields independently. |
| 16 | No P2003 handling needed on `Relacion`'s own delete, per spec Boundaries/Never — independently verified against `schema.prisma` rather than assumed (blind-hunter) | n/a (verified true) | Confirmed: no foreign key anywhere in this codebase references `Relacion.id`. Not a finding — a verification check that passed. |

## Design Notes

- **Why `origenId`/`destinoId` aren't editable:** they're part of the natural key (`(origenId, destinoId, tipo)`) that makes a relation what it is — allowing them to change would mean "editing" a relation could silently turn it into an entirely different fact about the graph. The epic's own AC only ever describes editing "su tipo" (its type); deleting and recreating is the correct way to re-point a relation at different items.
- **Why `P2025` is handled from day one here, unlike `InventoryService.update`'s `P2025` fix (which took two stories):** `create` (spec-4-1) and `update`/`remove` (this story) ship together in the same review pass, so the update-vs-delete race is reachable the moment this story's code exists — there is no "story N doesn't have delete yet" window like there was between spec-3-3 and spec-3-4.
- **Why `remove` got a before-snapshot staleness fix in review but `update` didn't (post-review):** both methods read their "before" state via a plain `findUnique` outside the transaction. For `remove`, closing the gap was a one-line swap — build `cambios` from `tx.relacion.delete`'s own return value instead of the earlier read, since that return value IS the row's exact state at deletion time. `update`'s `cambios.before` has no equivalent: Prisma's `update()` only returns the POST-update row, and getting a truly race-proof "before" would require an explicit `SELECT ... FOR UPDATE` inside the transaction — real locking, not a value swap. Logged to `deferred-work.md` rather than fixed here, since it's the same class of architectural gap as every other `update` method's non-atomic read-check-write in this codebase, not something unique to `Relacion`.

## Verification

**Commands:**
- `npm run -w apps/api build` -- exit 0, no TypeScript errors.
- `npm run -w apps/api test` -- **Test Suites: 29 passed, 29 total; Tests: 521 passed, 521 total** (up from 474 in spec-4-1: 47 new tests across `relations.service.spec.ts`'s `update`/`remove` blocks and `relations.controller.spec.ts`'s `update (dispatch)`/`remove (dispatch)`/RBAC-rejection/real-guard-chain blocks — 43 from implementation plus 4 added in review (a combined tipo+descripcion field-mixing regression, a `BadRequestException` propagation test, an only-unrecognized-fields dispatch test, and a real-HTTP-round-trip proof that `origenId`/`destinoId` are dropped) — covering every I/O matrix row — corrected post-review, the original "517 total" count here was wrong).
- `npm run -w apps/api lint` -- exit 0, no errors (`--fix` reformatted a couple of long lines in the new test blocks; no logic changed).
- Manual smoke test against the real `testos-postgres` Docker container, with the compiled API (`node dist/src/main.js`, rebuilt from this story's code) running and a real login (`POST /auth/login` as the seeded `ADMINISTRATOR`, `admin@example.com`):
  - Created two real items via `POST /items`: `spec42-vs-1` (`VIRTUAL_SERVER`), `spec42-svc-1` (`SERVICE`).
  - `POST /relations` twice between them: `R1` (`tipo: HOSTS`) and `R2` (`tipo: DEPENDS_ON`, same origen/destino, used below as a collision target).
  - `PATCH /relations/R1` `{tipo: "HOSTED_IN"}` as `ADMINISTRATOR` -> `200`, relation updated.
  - `PATCH /relations/R1` `{tipo: "DEPENDS_ON"}` (colliding with `R2`'s triple) -> `409 {"message":"This relation already exists."}`.
  - `PATCH /relations/R1` `{}` (empty body) -> `400 {"message":"At least one recognized field (tipo, descripcion) must be supplied."}`.
  - `PATCH /relations/R1` `{tipo: "NOT_A_TYPE"}` -> `400 {"message":"'NOT_A_TYPE' is not a recognized relation type."}`.
  - `PATCH /relations/R1` and `DELETE /relations/R2` with a hand-crafted `READ_ONLY`-role JWT (signed with the same local `JWT_SECRET`, since no seeded `READ_ONLY` user existed) -> both `403 {"message":"You do not have permission to perform this action"}`.
  - `DELETE /relations/R1` as `ADMINISTRATOR` -> `204`, empty body.
  - `DELETE /relations/R1` again -> `404 {"message":"Relation not found."}` (double-delete race path).
  - `PATCH /relations/R1` (now deleted) -> `404 {"message":"Relation not found."}` (edit-after-delete race path).
  - `GET /audit?entidadId=R1` -> exactly 3 rows in the expected order: `CREATE` (`cambios: {tipo: "HOSTS", origenId, destinoId, descripcion: null}`), `UPDATE` (`cambios: {before: {tipo: "HOSTS"}, after: {tipo: "HOSTED_IN"}}`), `DELETE` (`cambios: {tipo: "HOSTED_IN", origenId, destinoId, descripcion: null}` -- correctly the post-`PATCH` value, confirming the snapshot came from the delete's own return value, not a stale earlier read). Confirms both Acceptance Criteria.
  - Cleaned up: deleted `R2` and both items (`204` each); a stale server process left listening on port 3000 from an earlier session was stopped before starting the freshly built one, and the smoke-test server was stopped after verification.
