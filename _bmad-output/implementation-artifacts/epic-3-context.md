# Epic 3 Context: Inventario de ítems de configuración

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Un Editor puede crear, buscar, modificar y eliminar ítems de configuración de cualquiera de los tipos soportados (catálogo extensible de al menos 19 tipos), con propiedades dinámicas específicas por tipo además de campos comunes, viendo cada cambio reflejado de inmediato en el historial de auditoría. Un perfil de Consulta puede ver el inventario sin poder modificarlo. Este epic es el corazón del CMDB: sin él no hay inventario que relacionar (Epic 4), reportar/exportar (Epic 6) ni resincronizar por importación masiva (Epic 7) más adelante.

## Stories

- Story 3.1: Crear un ítem de configuración
- Story 3.2: Buscar, filtrar y listar ítems
- Story 3.3: Modificar un ítem existente
- Story 3.4: Eliminar un ítem

## Requirements & Constraints

- Catálogo de al menos 19 tipos de ítem predefinidos (aplicación, API, servicio, base de datos, servidor virtual, clúster, integración, job programado, servidor de jobs, balanceador, directorio LDAP, contenedor/orquestador, entre otros). Agregar un tipo nuevo es una entrada de catálogo, nunca una migración de esquema.
- Cada ítem tiene campos comunes (nombre, descripción, dominio propietario, dirección de red) más propiedades específicas de su tipo.
- Sin validación de esquema estricta por tipo en esta versión — las propiedades dinámicas no se validan contra una forma fija (no-goal explícito; posible mejora futura, no de este epic).
- CRUD sujeto a RBAC: Consulta = solo lectura; Editor y superior = escritura (crear, modificar, eliminar).
- Búsqueda y filtrado por tipo y por texto libre (nombre/descripción).
- Actualizaciones parciales se fusionan (merge) con las propiedades existentes — no se requiere reenviar el objeto completo.
- Listados paginados con tamaño de página configurable (referencia: 50 ítems).
- Los nombres de ítem se normalizan de forma consistente (p. ej. a mayúsculas) antes de comparar o persistir, para evitar duplicados por diferencia de capitalización.
- Toda creación, modificación o eliminación debe quedar registrada en auditoría de forma atómica junto con la escritura de dominio (garantía provista por Epic 2, ya construido).
- Qué ocurre con relaciones o solicitudes de cambio que referencian un ítem eliminado no se resuelve en este epic — se define en Epic 4 y Epic 5 respectivamente.

## Technical Decisions

- El módulo de Inventario es el único dueño y escritor de la entidad de ítem de configuración: ningún otro módulo la escribe inyectando el cliente de base de datos directamente; cualquier módulo que necesite crear/modificar/eliminar ítems llama a los métodos exportados del servicio de Inventario.
- Las propiedades dinámicas se almacenan en una columna JSONB; los campos comunes son columnas normales.
- Toda escritura de dominio (crear, modificar, eliminar ítem) y su registro de auditoría correspondiente ocurren dentro de la misma transacción de base de datos; el cliente de transacción se pasa explícitamente a la llamada de registro de auditoría.
- RBAC se declara vía guard global + decorador de roles en cada endpoint — sin checks de rol manuales dentro de los handlers.
- Las mutaciones de dominio solo ocurren en la capa de servicio; el controller nunca accede a la base de datos directamente.
- Un solo controller para la entidad de ítem de configuración (el del módulo de Inventario) — ningún otro módulo expone un endpoint alterno sobre ella, ni de solo lectura.
- Listados paginados con la forma `{ data, total, page, pageSize }`.
- Convenciones generales: IDs UUID v4, fechas ISO-8601 UTC, logging estructurado (JSON) a stdout.

## Cross-Story Dependencies

- Story 3.1 (crear) establece el catálogo de tipos y el modelo de propiedades dinámicas que las Stories 3.2–3.4 reutilizan.
- Las escrituras (3.1, 3.3, 3.4) dependen de que Epic 2 (Auditoría) ya esté construido para registrar cada cambio en la misma transacción.
- Epic 4 (Relaciones y topología), Epic 6 (Reportes) y Epic 7 (Importación masiva) dependen de que este epic esté completo antes de poder construirse sobre el inventario.
