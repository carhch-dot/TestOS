# Epic 2 Context: Auditoría y trazabilidad

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give any authenticated user a reliable way to see who did what and when across the system, backed by an architectural guarantee that no future write to inventory or relations can ever complete without an audit entry in the same transaction. This epic is built deliberately before Inventory (Epic 3) and Relations (Epic 4) so those modules can call the audit-recording mechanism from day one instead of retrofitting it later.

## Stories

- Story 2.1: Registro automático e inmutable de cada acción
- Story 2.2: Consultar y filtrar el historial de auditoría

## Requirements & Constraints

- Every creation, modification, and deletion of items and relations (including edit/delete variants) must be recorded — no domain write may complete without its audit entry (atomicity, not a separate process that can fail silently).
- Each audit entry captures, at minimum: the acting user, action type, affected entity (type + id), timestamp, and the change payload/detail.
- Audit history must be readable and filterable (by user, entity type, action type, date range) by any authenticated user regardless of role — audit is read-only for everyone via the API.
- No API endpoint may update or delete an existing audit entry. The single documented exception is the full bulk-reimport flow (Epic 7), which audits its run as one event rather than per item.
- List results follow the standard paginated envelope `{ data, total, page, pageSize }`; unfiltered queries return the most recent entries first.

## Technical Decisions

- `RegistroAuditoria` has exactly one owning module, `AuditModule` (`apps/api/src/audit`) — no other module writes this entity directly via Prisma; they call an exported method on the Audit service.
- Domain writes and their audit entry happen inside the same Prisma transaction (`prisma.$transaction`). The `Prisma.TransactionClient` is passed explicitly to `AuditService.record(tx, ...)` (the exported method on `AuditModule`'s service), and any further inter-module calls made during that write reuse the same transaction client rather than opening a new top-level one.
- Audit recording is always synchronous within the transaction — never via an async queue/event, for both the Núcleo (v1) and Extendido (v1.1) scope.
- `AuditModule.record()` enforces one canonical payload shape: `{ usuario, tipoAccion, entidad, entidadId, cambios, fecha }`. No module invents its own reporting shape, so later consumers (e.g. Reports in v1.1) can read audit data from any module without special-casing.
- RBAC is declarative (`@Roles(...)` decorator + global guard); there is no manual role `if` in handlers. Audit read access applies uniformly to all four roles (Administrador, Gestor, Editor, Consulta) — this is one of the few areas with no role restriction.
- One controller per entity, owned by AuditModule; no other module exposes an alternate audit endpoint, even read-only.
- Conventions to follow: UUID v4 ids, ISO-8601 UTC timestamps, structured JSON logging to stdout, domain mutations only in service layer (controllers never call Prisma directly).

## Cross-Story Dependencies

- Story 2.2 (query/filter) depends on Story 2.1 (the recording mechanism) existing and producing entries — build 2.1 first.
- Epics 3 (Inventory), 4 (Relations), 5 (Change Requests), and 7 (Bulk Import) all depend on `AuditModule.record()` from this epic being in place before their own write paths are implemented, per the atomicity rule (AD-3).
