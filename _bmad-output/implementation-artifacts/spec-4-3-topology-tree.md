---
title: 'View the dependency tree and direct neighbors from an item'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '50361c11559d762cb0c16aee4b108e2b15e83116'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 4 can create and edit relationships (4.1/4.2), but there is still no way to see the resulting graph — a user investigating an item has no way to answer "what does this connect to, directly or transitively?" (FR23/FR24), which is the entire point of building a CMDB instead of a flat inventory.

**Approach:** Add a new, read-only `TopologyModule` (`apps/api/src/topology`) with `GET /topology/:itemId/tree` (BFS traversal of the `Relacion` graph from a root item, up to an env-configured max depth and node count) and `GET /topology/:itemId/neighbors` (a lighter-weight, always-1-hop lookup, per FR24's explicit "more lightweight than the full tree" requirement). Both return a flat `{nodes, edges}` graph shape (not a nested tree, not the paginated-list envelope used elsewhere) — matching what the epic's own planned frontend library (XyFlow) consumes directly.

## Boundaries & Constraints

**Always:**
- Traversal follows a `Relacion` edge from EITHER side (a node's outgoing AND incoming relations both count as "connected") — a relation's `tipo` (HOSTS, DEPENDS_ON, ...) encodes what kind of link it is, not which traversal direction is "the" dependency direction; different types point opposite ways for "what breaks if this goes down" (e.g. HOSTS: destino depends on origen; DEPENDS_ON: origen depends on destino). Resolving that per-type would require semantics nothing in the planning docs defines. Traversing both directions and returning every edge's real `origenId`/`destinoId`/`tipo` is a strict superset of any one-directional choice — the caller (a human or a future frontend rendering arrows) loses no information and can filter by direction itself if it ever needs to.
- Breadth-first, level by level, with a `visited` node-id set from the start — the `Relacion` graph can contain cycles (e.g. A HOSTS B, B DEPENDS_ON A), so a node already added is never re-added or re-expanded.
- Two independent env-configured limits (mirroring `LOGIN_LOCKOUT_MAX_ATTEMPTS`'s exact `Number(process.env.X)` + `Number.isInteger`/`> 0` + fallback-constant pattern — no `ConfigService`, this codebase reads `process.env` directly everywhere): `TOPOLOGY_MAX_DEPTH` (default `5`, FR23's reference assumption) caps how many BFS levels run; `TOPOLOGY_MAX_NODES` (default `5000`, FR26's reference assumption) caps total nodes returned — once reached, stop admitting new nodes immediately (mid-level if necessary) and set `truncated: true` in the response, rather than erroring or attempting to finish the level (FR26: "acota la vista... en vez de intentar renderizar todo").
- `GET /topology/:itemId/tree` response: `{ rootId, nodes: {id, nombre, tipo}[], edges: {id, origenId, destinoId, tipo}[], truncated: boolean }`. Node projection is lean (no `descripcion`/`properties`/`dominioPropietario`/`direccionRed`) — this feeds a graph visualization, not an item detail view. An edge between two already-visited nodes (found while expanding a later level) is still included — the response is the full induced subgraph on the visited node set, not just BFS-tree edges.
- `GET /topology/:itemId/neighbors` is the same traversal with depth fixed at 1 (always exactly the root's direct relations, ignoring `TOPOLOGY_MAX_DEPTH`) — a single `findMany` query, no BFS loop, which is what makes it lighter than `tree` (FR24). Same response shape.
- Unknown `itemId` on either endpoint -> `404`.
- An item with zero relations is not an error — the response is a single-node graph (`nodes: [root]`, `edges: []`).
- Both endpoints require only `JwtAuthGuard` (no `RolesGuard`/`@Roles(...)`) — any authenticated role may read, matching `GET /items`'s posture (`FR23`/`FR24`'s "usuario autenticado, cualquier rol").
- `TopologyModule` reads `ItemConfiguracion`/`Relacion` directly via `PrismaService` — it owns neither entity (AD-1 restricts writes to the owning module; a read-only cross-module lookup is not a write, same reasoning `RelationsService` already established for its own `ItemConfiguracion` existence checks).

**Never:**
- No writes anywhere in this module, no `RegistroAuditoria` entries — nothing here is a domain mutation (matches the established convention that no `GET` endpoint in this codebase ever produces an audit row).
- No `{data, total, page, pageSize}` pagination envelope — this is a bounded graph structure (capped by depth/node-count), not a paginated list; inventing a page/pageSize over a BFS traversal would be meaningless.
- No per-request `?depth=` override — depth is env-fixed only, per the epic's own Technical Decisions ("env-driven, not hardcoded... not a per-call parameter").
- No search/filter within the topology view — that is Story 4.4's own scope entirely.
- No new `schema.prisma` migration — `Relacion`'s existing `@@index([origenId])`/`@@index([destinoId])` (from spec-4-1) already serve every query this story needs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path, tree | Root item with direct + indirect relations, graph smaller than both limits | `200`; full connected subgraph up to `TOPOLOGY_MAX_DEPTH`, `truncated: false` | N/A |
| Cyclic graph | Root's reachable graph contains a cycle | `200`; each node appears exactly once, traversal terminates | N/A |
| Node-count limit hit | Reachable graph exceeds `TOPOLOGY_MAX_NODES` before `TOPOLOGY_MAX_DEPTH` is reached | `200`; exactly `TOPOLOGY_MAX_NODES` nodes, `truncated: true` | N/A |
| Isolated item | Root has zero relations | `200`; `nodes: [root]`, `edges: []` | N/A |
| Direct neighbors | `GET .../neighbors` on an item with relations at depth 1 and 2 | `200`; only depth-1 nodes/edges, none from depth 2, regardless of `TOPOLOGY_MAX_DEPTH` | N/A |
| Unknown root item | `itemId` matches no `ItemConfiguracion`, either endpoint | N/A | `404` |
| Unauthenticated | No/invalid `Authorization` header, either endpoint | N/A | `401` |

</frozen-after-approval>

## Code Map

- `apps/api/src/topology/topology.service.ts` (new) -- `TopologyService.tree(itemId)` (BFS per Boundaries) and `.neighbors(itemId)` (single-level, sharing the same node/edge-shaping helper as `tree`). Both start with a `prisma.itemConfiguracion.findUnique({where:{id: itemId}})` 404 check, then query `prisma.relacion.findMany({where: {OR: [{origenId: {in: ringIds}}, {destinoId: {in: ringIds}}]}})` per ring (existing indexes serve this directly).
- `apps/api/src/topology/topology.controller.ts` (new) -- `GET /topology/:itemId/tree`, `GET /topology/:itemId/neighbors`, `@UseGuards(JwtAuthGuard)` only. Mirrors `InventoryController`'s minimal-validation style for the `itemId` route param (no extra shape validation needed beyond what `findUnique` already handles cleanly, per the established "malformed id just misses in Prisma, clean 404" precedent from spec-3-4/4-2's reviews).
- `apps/api/src/topology/topology.module.ts` (new) -- imports `AuthModule` only (for `JwtAuthGuard`, transitively `JwtModule`, same wiring `InventoryModule`/`RelationsModule` already use); no `AuditModule` import (nothing here is audited).
- `apps/api/src/app.module.ts` -- register `TopologyModule` in `imports`, same as `InventoryModule`/`RelationsModule`.
- `apps/api/src/relations/relations.service.ts` -- read-only reference for the exact Prisma read patterns to mirror; no changes to this file.
- No `schema.prisma` change.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/topology/topology.service.ts` -- `tree`/`neighbors` -- BFS traversal with cycle-safety, depth/node-count limits, lean node/edge projection
- [x] `apps/api/src/topology/topology.controller.ts` -- both `GET` endpoints -- `JwtAuthGuard`-only RBAC, 404 dispatch
- [x] `apps/api/src/topology/topology.module.ts` + `apps/api/src/app.module.ts` -- module wiring
- [x] `apps/api/src/topology/topology.service.spec.ts` -- unit tests covering every I/O matrix row, including an explicit cyclic-graph fixture and a node-count-truncation fixture
- [x] `apps/api/src/topology/topology.controller.spec.ts` -- dispatch + auth tests (401 unauthenticated, 200 for any role since there is no `RolesGuard`), including at least one real-`JwtAuthGuard` chain test per the established precedent

**Acceptance Criteria:**
- Given a root item with direct and indirect relations, when its topology tree is requested, then the navigable graph up to the configured depth is returned.
- Given an item whose reachable graph would exceed the configured node limit, when its tree is requested, then the response is capped at that limit rather than attempting to return everything.
- Given a specific item, when only its direct neighbors are requested, then that bounded list is returned via a lighter-weight query than the full tree.

## Implementation Notes

`TopologyModule` was built as a new module (`topology.service.ts`, `topology.controller.ts`, `topology.module.ts`) registered in `app.module.ts`, importing only `AuthModule` (no `AuditModule` — nothing here writes or is audited). `tree()` runs a BFS loop level by level from a `visited` `Map<id, TopologyNode>` seeded with the root; each ring queries `relacion.findMany` for every relation touching the current ring's ids (either side), and a shared `admitCandidates` helper finds not-yet-visited endpoint ids, admits as many as fit under `TOPOLOGY_MAX_NODES` (slicing and flagging `truncated: true` when a ring has more candidates than remaining capacity), and hydrates them via `itemConfiguracion.findMany`. After the loop, a separate `induceEdges` query re-fetches every relation whose both endpoints ended up in the final visited set — this is what guarantees the response is the full induced subgraph, not just edges the BFS loop's own per-ring queries happened to find (see Design Notes for a worked example of why this matters). `neighbors()` shares the same node-shaping helpers but does a single root-anchored query with no loop, which is what makes it lighter per FR24. Both `TOPOLOGY_MAX_DEPTH`/`TOPOLOGY_MAX_NODES` are read via the codebase's established `Number(process.env.X)` + `Number.isInteger && > 0` + fallback-constant pattern (mirroring `LOGIN_LOCKOUT_MAX_ATTEMPTS`), now also documented in `.env.example`.

Review pass: fixed a real semantic gap where `truncated` only ever reflected the node-count limit, never the depth limit — hitting `TOPOLOGY_MAX_DEPTH` with more of the graph left unexplored previously reported `truncated: false`, indistinguishable from "this is the complete graph." Fixed by checking, after the BFS loop exits, whether `currentRing` is still non-empty (meaning the loop stopped because `depth` hit `maxDepth`, not because there was nothing left to explore) and setting `truncated: true` in that case too. This is deliberately conservative: when the depth cap lands exactly on the graph's true boundary (the last-admitted ring genuinely has no further connections), the implementation still reports `truncated: true`, because confirming otherwise would require querying past the depth limit — exactly what `TOPOLOGY_MAX_DEPTH` exists to prevent. Also added a `select` projection (`id`/`nombre`/`tipo` only) to the `itemConfiguracion` queries, matching the lean node shape the response already returns. Both fixes are covered by new regression tests.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | `truncated` only ever reflected the node-count limit, never the depth limit — hitting `TOPOLOGY_MAX_DEPTH` with more graph left unexplored reported `truncated: false`, indistinguishable from "complete graph" (blind-hunter) | medium-high (patched) | Real, correctly flagged as "worth a human decision, not a silent implementation call." Fixed: `truncated` now also becomes `true` when the BFS loop exits with `currentRing` still non-empty (depth cap reached with more to explore). Deliberately conservative at the exact boundary case — see Design Notes. |
| 2 | Loop condition only checked `currentRing.length`, so a ring that partially filled the node cap still triggered one wasted extra `relacion.findMany` round trip before naturally draining to empty (blind-hunter) | medium (attempted, reverted) | Initially patched by adding `visited.size < maxNodes` to the loop condition — but this broke the ability to distinguish "node cap hit with more beyond it" from "node cap hit exactly at the graph's natural end" (2 tests failed, including the "exact fit" case). Reverted: the extra round trip is real but is what makes accurate `truncated` reporting possible without a redesign: relying on the loop's own natural drain-to-empty (a ring after a maxed-out capacity finds zero remaining room and returns an empty next ring) is what lets `truncated` stay correctly `false` in the exact-fit case. Correctness over micro-optimization. |
| 3 | New `TOPOLOGY_MAX_DEPTH`/`TOPOLOGY_MAX_NODES` env vars undocumented in `.env.example`, unlike every other configurable env var in this codebase (blind-hunter) | medium (patched) | Real, cheap gap. Added both to `.env.example` with an explanatory comment, matching the file's existing style. |
| 4 | No test exercised the depth-limit cutoff on a graph deeper than the default depth, so the `truncated`-on-depth-cutoff gap (finding #1) was completely unverified either way (blind-hunter) | medium-high (patched) | Resolved as part of #1's fix — added both a genuine-cutoff test (depth=1, N2 exists beyond it, `truncated: true`) and a boundary-case test (depth=2 landing exactly on the graph's true end, still `truncated: true` by design). |
| 5 | Sequential N+1-style query pattern (~11 round trips at default depth) and no `select` projection on `itemConfiguracion.findMany`/`findUnique` calls, fetching full rows including unused `properties`/`descripcion` (blind-hunter) | low (projection patched; round-trip count deferred) | The `select` projection was a clean, low-risk win — patched (`LEAN_ITEM_SELECT` now used on every item query). The sequential-BFS-round-trip-count concern is inherent to the algorithm the spec itself mandates (one ring at a time, each depending on the last) — not a defect against the spec, no action taken. |
| 6 | `induceEdges` re-fetches edges already seen during BFS rings — deliberate, not incorrect, but undocumented as a cost trade-off at `TOPOLOGY_MAX_NODES` scale (blind-hunter) | low (rejected) | Deliberate design choice, already documented in code comments and this spec's own Design Notes as necessary for correctness (guarantees full induced-subgraph capture). Not worth optimizing away at the cost of correctness risk. |
| 7 | `ROOT_ITEM_NOT_FOUND_MESSAGE` duplicates `ITEM_NOT_FOUND_MESSAGE`'s text instead of importing it (blind-hunter, minor) | very low (rejected) | Matches the established per-module message-constant convention (e.g. `RELATION_NOT_FOUND_MESSAGE` in spec-4-2 didn't import `ITEM_NOT_FOUND_MESSAGE` either, despite identical wording) — modules deliberately don't share message constants across boundaries. |
| 8 | Truncation is non-deterministic which specific nodes get admitted (no `orderBy`), since Postgres doesn't guarantee row order — reloading a truncated view could show a different partial graph each time (edge-case-hunter) | low (deferred) | Real, but only matters at extreme scale (graphs actually hitting the 5000-node default cap). New `deferred-work.md` entry added. |
| 9 | Returned `nodes`/`edges` array order is similarly non-deterministic (edge-case-hunter) | low (rejected, folded into #8) | Harmless for the planned XyFlow consumer (order-agnostic); same root cause as #8, not tracked as a separate item. |
| 10 | No transaction/consistent snapshot spans `tree()`'s multi-query BFS — a relation deleted between the ring query that admitted a node and the later `induceEdges` query can leave a "floating" node with no edges, silently contradicting the "full induced subgraph" guarantee (edge-case-hunter) | medium (deferred) | Real, and a uniquely confusing failure mode for a graph endpoint specifically. Proper fix needs a consistent-snapshot isolation level this codebase has never used anywhere — new `deferred-work.md` entry added. |
| 11 | No DB-level defense against a self-referencing `Relacion` row (`origenId === destinoId`) reaching `TopologyService` — only `RelationsService.create`'s application-level check prevents it today (edge-case-hunter) | low (rejected) | Speculative — no current path creates one, and adding a DB constraint would require a schema migration this story's own Boundaries/Never section explicitly rules out. |
| 12 | A NUL-byte (or similarly pathological) `itemId` could bypass the "malformed id just misses in Prisma, clean 404" assumption and surface a raw 500, since no global exception filter exists anywhere in this app (edge-case-hunter) | low (rejected) | Matches an identical, pre-existing, codebase-wide gap (no global exception filter anywhere) — not new or specific to this story. Extremely low practical likelihood (most HTTP stacks reject NUL bytes before reaching Nest). |
| 13 | The "cyclic graph terminates" test asserted `relacionFindMany.mock.calls.length < 10`, which can't actually distinguish real cycle-safety from merely hitting the default `TOPOLOGY_MAX_DEPTH` (5) — a broken dedup guard would still pass this test (verification-gap, HIGH) | high (patched) | Real, important false-positive risk — the most valuable single finding from this review pass. Added a test setting `TOPOLOGY_MAX_DEPTH=20` and asserting an exact, small call count (3), which only cycle-dedup (not the depth cap) can explain. |
| 14 | `induceEdges`'s unique contribution (an edge between two nodes jointly admitted in the same final ring, never touched by any BFS ring query) was never proven by a test specifically constructed to isolate it from what the BFS loop's own per-ring queries would find anyway (verification-gap) | medium (patched) | Real, valuable gap. Added a fixture (`TOPOLOGY_MAX_DEPTH=2`, two siblings admitted together in the final ring with a direct edge between them) and asserted that edge is still present, with an exact query-count assertion proving it could only have come from `induceEdges`. |
| 15 | `neighbors()` was only ever tested with the root as `origenId` — the bidirectional query's `destinoId` clause was never exercised for this specific method (verification-gap) | medium (patched) | Real, cheap gap. Added a test with an incoming relation (root as `destinoId`). |
| 16 | The real-`JwtAuthGuard`-chain test's own comment claimed "any role reaches the service," but only ever minted a `READ_ONLY` token — diverging from the established `GET /items` precedent of looping over all four roles (verification-gap) | low-medium (patched) | Real, matches an established precedent this story's own Tasks & Acceptance pointed to but didn't follow. Rewrote the test to loop over all four roles, asserting the service was called 4 times per endpoint. |
| 17 | The env-var "unset" case (as opposed to "present but invalid") was only ever exercised incidentally, never asserted as its own case in the dedicated env-var-edge-cases block (verification-gap) | low (patched) | Cheap, real completeness gap. Added an explicit "both env vars entirely unset" test alongside the existing invalid-value cases. |

## Design Notes

- **Why traverse both edge directions instead of picking "the" dependency direction:** the reference relation types don't encode a consistent impact direction — `HOSTS` (origen keeps destino alive) and `DEPENDS_ON` (destino keeps origen alive) point opposite ways relative to "what breaks if this goes down." Nothing in the PRD/architecture resolves this, and guessing wrong would silently hide half the graph. Returning the full bidirectional subgraph with real edge metadata is strictly more useful and never wrong — a future frontend (or Story 4.4) can apply directional filtering on top of complete data, but can never recover data this endpoint didn't return.
- **Why a flat `{nodes, edges}` shape instead of a nested tree:** the graph can have cycles and multiple paths to the same node, both of which break a naive nested-children structure (either infinite nesting or duplicated node data). A flat shape has no such problem, and it's exactly what the epic's own planned frontend library (XyFlow) expects as input — no server-side-to-client-side reshaping needed later.
- **Why node-count truncation stops immediately rather than finishing the in-progress level:** simpler and more predictable to implement, test, and reason about ("exactly N nodes, or fewer") than "N nodes, or up to N + (one level's worth) nodes" — and FR26's own wording ("acota la vista a ese límite") reads as a hard cap, not a soft one.
- **Why `truncated` is conservative at the depth boundary (post-review fix):** the BFS loop deliberately does not query past `TOPOLOGY_MAX_DEPTH` — that's the entire point of the limit. This means when the loop stops because `depth` reached `maxDepth`, there is no way to know whether the last-admitted ring actually has further connections without running exactly the query the depth limit exists to prevent. Rather than guessing (or worse, defaulting to `false` and risking a caller trusting an incomplete view as complete — the original bug), `truncated` is set to `true` whenever nodes remain that were never explored, even in the rare case where the true graph happens to end exactly at the depth boundary and nothing was really lost. An honest "there might be more" beats a silently wrong "this is everything."
- **Why the loop still runs one extra ring after a node-cap-limited ring, rather than stopping immediately (post-review, reverted attempt):** stopping the instant `visited.size` reaches `TOPOLOGY_MAX_NODES` seemed like a free efficiency win, but it removes the only signal that distinguishes "the cap cut off real additional nodes" from "the cap happened to line up exactly with the graph's natural end" — both look identical from `visited.size` alone. Letting the loop run one more (usually cheap, often empty-result) ring is what allows `truncated` to stay accurately `false` when nothing was actually lost.

## Verification

**Commands:**
- `npm run -w apps/api build` -- expect exit 0, no TypeScript errors.
- `npm run -w apps/api test` -- **Test Suites: 31 passed, 31 total; Tests: 556 passed, 556 total** (up from 521 before this story: 35 tests across `topology.service.spec.ts`/`topology.controller.spec.ts` — 30 from implementation plus 5 added in review — covering every I/O matrix row).
- `npm run -w apps/api lint` -- expect no errors.
- Manual smoke test against the real Postgres container: create a small chain of items with a cycle (A HOSTS B, B DEPENDS_ON C, C INTEGRATES_WITH A) plus one isolated item; `GET /topology/A/tree` -> all three nodes, all three edges, `truncated: false`, no duplicate nodes despite the cycle; `GET /topology/A/neighbors` -> **both B and C** (bidirectional traversal per Boundaries: A is origen in `A HOSTS B` and destino in `C INTEGRATES_WITH A`, so both are 1 hop from A — this fixture happens to be a true 3-cycle where every pair has a direct edge, not a chain with C two hops out; corrected here after the implementation caught this Verification-section example contradicting the frozen Boundaries' own bidirectional rule); `GET /topology/<isolated-item>/tree` -> single-node graph, empty edges; `GET /topology/<unknown-uuid>/tree` -> `404`; either endpoint with no `Authorization` header -> `401`.
