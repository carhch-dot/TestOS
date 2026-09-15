# Epic 4 Context: Relaciones y mapa de dependencias

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let an Editor link configuration items with directed, typed relationships (with an auto-suggested type/description), and let any authenticated user navigate the resulting dependency tree to answer "what breaks if I turn this off?" — the central use case of a CMDB. This epic builds on the item catalog from Epic 3 and the mandatory audit trail from Epic 2; it has no value on its own until both exist.

## Stories

- Story 4.1: Crear una relación entre dos ítems
- Story 4.2: Editar y eliminar relaciones
- Story 4.3: Ver el árbol de topología desde un ítem
- Story 4.4: Buscar ítems dentro de la vista de topología

## Requirements & Constraints

- Relationships are directed and typed: origin item → destination item, with a relationship type drawn from an extensible catalog (examples: hosts, depends on, hosted in, belongs to cluster, integrates with, connects to).
- Natural key (origin, destination, type) must be unique — creating a duplicate relationship is rejected, not silently ignored or overwritten.
- When a relationship is being created between two items of known types, the system proposes a reasonable type and description (e.g., "server hosts service") that the user can accept or override; it never forces the suggestion.
- Relationship type and description edits, and deletions, are supported on existing relationships.
- Only Editor role and above can create, edit, or delete relationships; Consulta (read-only) is rejected via RBAC. Any authenticated role can read topology and search it.
- Topology view: navigable tree/graph from a root item, to a configurable max depth (reference assumption: 5 levels).
- Direct-neighbor lookup for a given item must be a lighter-weight query than expanding the full tree.
- Global search within the topology view locates an item by name and centers the view on it, even when it isn't the current root.
- Node count in a rendered topology is capped at a configurable limit (reference assumption: 5000 nodes) to protect performance — the system truncates rather than attempting to render everything.
- Item names/types normalization and pagination envelope conventions follow the same rules established for Inventory (Epic 3); nothing new is introduced here.
- Realizes user journey UJ-2 (a read-only user investigates an incident by opening topology from a failed item and walking its direct neighbors) and the relationship-creation half of UJ-1.

## Technical Decisions

- Owning module boundaries (monolithic modular backend, one deployable): `RelationsModule` owns the `Relacion` entity exclusively — no other module writes it directly via Prisma. `TopologyModule` is a separate module that reads relationship/item data (graph traversal, neighbor queries, search) but does not own or write any entity itself.
- Every relationship write (create, edit, delete) must run inside the same Prisma transaction as its audit record — the transaction client is passed explicitly into `AuditModule.record(tx, ...)`; no async/queued audit writes.
- Audit payload shape is fixed and canonical: `{ usuario, tipoAccion, entidad, entidadId, cambios, fecha }` — RelationsModule does not invent its own variant.
- RBAC is enforced via a global guard plus a `@Roles(...)` decorator on each endpoint; no manual role checks in handlers.
- One controller per entity — the controller lives in the owning module (Relations); Topology exposes its own read-only endpoints (tree, neighbors, search) rather than piggybacking on the Relations controller.
- Domain mutations happen only in the service layer; controllers never call Prisma directly.
- IDs are UUID v4; dates are ISO-8601 UTC; any paginated/bounded list response uses the `{ data, total, page, pageSize }` envelope convention used elsewhere in the system.
- Frontend topology visualization uses XyFlow (React) inside the `web` app, which talks to `api` only over HTTP — no direct DB or backend-code access from the frontend (API boundary rule, applies system-wide).
- Depth limit and node-count limit for topology rendering should be configurable (env-driven), not hardcoded, consistent with how other configurable limits (e.g., page size) are handled elsewhere in the system.

## Cross-Story Dependencies

- Depends on Inventory (Epic 3) for the set of items that can be related and for item type metadata used by relationship-type suggestion.
- Depends on Audit (Epic 2) — every relationship write must produce an audit record in the same transaction; Epic 4 does not implement its own audit mechanism.
- Story 4.3 and 4.4 (topology) depend on relationships already existing (Story 4.1); topology is read-only over data Story 4.1/4.2 produce.
- Downstream epics build on this one: Reports/export (Epic 6) reads Relations for its relationships sheet; Import (Epic 7) reconstructs explicit relationships and infers implicit hierarchical ones through RelationsModule during full inventory replacement.
- Epic 3's item-deletion story explicitly deferred the question of what happens to relationships referencing a deleted item to this epic — implementers should confirm/handle that behavior here (e.g., cascade, block, or orphan-and-flag) since Epic 3 did not resolve it.
