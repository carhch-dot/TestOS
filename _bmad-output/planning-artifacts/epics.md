---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: ['_bmad-output/planning-artifacts/prds/prd-TestOS-2026-09-11/prd.md', '_bmad-output/planning-artifacts/prds/prd-TestOS-2026-09-11/addendum.md', '_bmad-output/planning-artifacts/architecture/architecture-TestOS-2026-09-11/ARCHITECTURE-SPINE.md']
---

# TestOS - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for TestOS, decomposing the requirements from the PRD and Architecture Spine into implementable stories. No UX design contract exists for this project (internal tool, no `bmad-ux` run) — no UX Design Requirements section applies.

## Requirements Inventory

### Functional Requirements

**Feature 4.1 — Autenticación, sesión y gestión de usuarios (RBAC)**
- FR1: El sistema emite una sesión/token válida por un periodo configurable al autenticar con email y contraseña.
- FR2: El sistema bloquea la cuenta tras un número configurable de intentos fallidos consecutivos, y notifica por correo.
- FR3: Logout invalida la sesión de inmediato.
- FR4: Mientras la sesión siga vigente, el sistema la renueva sin exigir nuevo login.
- FR5: Recuperación de contraseña vía enlace de un solo uso, expiración corta, respuesta uniforme que no revela si el correo existe.
- FR6: Si no existe ningún usuario, el sistema crea automáticamente el primer usuario Administrador al arrancar (bootstrap).
- FR7: Invitación de usuarios vía enlace de activación de un solo uso por correo.
- FR8: Listar, desactivar y reactivar usuarios (Gestor y Administrador).
- FR9: Cambiar rol de usuario (exclusivo de Administrador).
- FR10: Forzar reseteo de contraseña de otro usuario (Administrador y Gestor).
- FR11: Política de contraseña — no reutilizar últimas N contraseñas, complejidad mínima configurable.

**Feature 4.2 — Inventario de ítems de configuración**
- FR12: CRUD de ítems de configuración, sujeto a permisos por rol.
- FR13: Tipos de ítem extensibles (≥19 predefinidos), agregar tipo nuevo por configuración/catálogo, no por cambio de esquema.
- FR14: Propiedades dinámicas por tipo, además de campos comunes.
- FR15: Búsqueda y filtrado por tipo y texto libre.
- FR16: Actualización parcial de propiedades por merge.
- FR17: Paginación configurable en listados.

**Feature 4.3 — Relaciones entre ítems**
- FR18: Crear relación dirigida y tipada (origen → destino, tipo).
- FR19: Prevención de duplicados — clave natural (origen, destino, tipo).
- FR20: Sugerencia automática de tipo/descripción de relación según tipos de ítems.
- FR21: Editar y eliminar relaciones existentes.
- FR22: Catálogo extensible de tipos de relación.

**Feature 4.4 — Topología y árbol de dependencias**
- FR23: Vista de árbol/grafo navegable desde ítem raíz o tipo, profundidad configurable.
- FR24: Consulta de vecinos directos de un ítem.
- FR25: Búsqueda global dentro de la topología.
- FR26: Límite de nodos configurable.

**Feature 4.5 — Auditoría inmutable**
- FR27: Registro inmutable de toda creación/modificación/eliminación de ítems y relaciones.
- FR28: Cada entrada incluye usuario, tipo de acción, entidad afectada, fecha/hora, payload del cambio.
- FR29: Auditoría consultable y filtrable; no editable ni borrable manualmente (excepción: reimportación masiva completa).
- FR30: Ninguna escritura sobre el inventario puede completarse sin su registro de auditoría (atomicidad).

**Feature 4.6 — Solicitudes de cambio *(Extendido v1.1)***
- FR31: Cualquier usuario autenticado puede crear una solicitud de cambio sobre un ítem existente.
- FR32: Notificación por correo a destinatarios configurados al crear una solicitud.
- FR33: Flujo de estados Nueva → En ejecución → Completada, o Nueva → Rechazada; estados terminales.
- FR34: Transiciones de estado validadas en servidor.
- FR35: Notificación por correo en cambios de estado relevantes.
- FR36: Baja lógica de solicitud conservando historial.
- FR37: Snapshot de nombre/tipo del ítem al crearse la solicitud.

**Feature 4.7 — Reportes y exportación *(Extendido v1.1)***
- FR38: Reporte en hoja de cálculo con hojas de activos y relaciones.
- FR39: Reporte en PDF con plantilla predefinida.

**Feature 4.8 — Importación masiva desde archivo *(Extendido v1.1)***
- FR40: Reemplazo total del inventario (activos, relaciones, jerarquías) desde archivo.
- FR41: Proceso por pasos reportados — validación, limpieza, carga de activos, reconstrucción de relaciones explícitas, inferencia de relaciones jerárquicas implícitas.
- FR42: Confirmación explícita e inequívoca antes de ejecutar (operación destructiva).

### NonFunctional Requirements

- NFR1 (Seguridad): contraseñas siempre con hash seguro de un solo sentido; sesiones revocables explícitamente sin esperar expiración natural; el secreto de sesión/token debe poder rotarse.
- NFR2 (Auditabilidad): ninguna escritura sobre el inventario puede omitir su registro de auditoría.
- NFR3 (Consistencia de datos): emails de usuario y nombres de ítem normalizados de forma consistente (evitar duplicados por capitalización); propiedades dinámicas por tipo deben crecer sin migraciones de esquema.
- NFR4 (Rendimiento): listados de inventario acotados a un máximo configurable; árboles de topología acotados en profundidad y cantidad de nodos.
- NFR5 (Disponibilidad): el sistema inicia de forma ordenada, verificando dependencias críticas antes de aceptar tráfico.
- NFR6 (Aislamiento de datos): si el sistema se compone de varios módulos/servicios, cada uno es responsable de sus propios datos.
- NFR7 (Escalabilidad): los componentes deben poder escalar de forma independiente según carga.
- NFR8 (Usabilidad): interfaz responsive; feedback de error no bloqueante.
- NFR9 (Portabilidad): desplegable de forma reproducible en distintos entornos, sin configuración manual específica de un proveedor único.
- NFR10 (Resiliencia ante integraciones externas): el correo (usado en Núcleo v1) debe degradarse de forma controlada si el servidor falla o es lento — timeout configurable, sin bloquear la operación de negocio.
- NFR11 (Guardrail — operaciones destructivas): toda operación irreversible (reemplazo total del inventario) exige confirmación explícita e inequívoca del usuario.
- NFR12 (Guardrail — privacidad): no aplica activamente al Núcleo v1 (no hay analítica en esta capa); principio documentado para cuando se retome esa capa Diferida.

### Additional Requirements

*(De la Architecture Spine — `ARCHITECTURE-SPINE.md`, status: final)*

- **Sin starter/boilerplate específico**: Epic 1 / Story 1 debe inicializar el monorepo desde cero — `apps/api` (NestJS 11 + Prisma 7 + PostgreSQL 18.x) y `apps/web` (React 19 + Vite 8 + XyFlow) — según el árbol de fuente y el Stack de la arquitectura (AD-1, AD-2).
- **Paradigma (AD-1)**: monolito modular con un dueño por entidad — `ItemConfiguracion`→Inventory, `Relacion`→Relations, `RegistroAuditoria`→Audit, `SolicitudCambio`→ChangeRequests, `Usuario`/`RefreshToken`→Auth. Ningún módulo escribe la entidad de otro inyectando `PrismaService` directamente.
- **Frontera API (AD-2)**: `web` solo se comunica con `api` vía HTTP; nunca acceso directo a Postgres ni a código de servidor desde el frontend.
- **Atomicidad de auditoría (AD-3)**: toda escritura de dominio + su registro de auditoría en la misma transacción de Prisma; el cliente de transacción se propaga explícitamente entre llamadas de módulo; forma de payload de auditoría canónica (`{ usuario, tipoAccion, entidad, entidadId, cambios, fecha }`); excepción documentada para reimportación masiva.
- **RBAC declarativo (AD-4)**: guard global + decorador `@Roles(...)` en cada endpoint; un solo controller por entidad.
- **Autenticación (AD-5)**: JWT de acceso de vida corta + refresh token rotado, persistido en Postgres, con detección de reuso y revocación explícita en logout/cambio de contraseña.
- **Instancia única (AD-6)**: sin entidad Organización/Tenant; roles globales a la instancia.
- **Config y secretos (AD-7)**: toda configuración sensible vía variables de entorno inyectadas por Dokploy en runtime; repo solo versiona `.env.example`.
- **Propiedades dinámicas (AD-8)**: columna `properties` JSONB en `ItemConfiguracion`; nuevo tipo de ítem = entrada de catálogo, no migración de esquema.
- **Correo saliente (AD-9)**: `MailModule` común con timeout configurable y degradación no bloqueante; usado por AuthModule y ChangeRequestsModule.
- **Despliegue**: Dokploy sobre VPS de Hostinger — dos aplicaciones separadas (`api`, `web`, cada una con su Dockerfile) + recurso de base de datos PostgreSQL provisto por Dokploy. Requiere `docker/api.Dockerfile` y `docker/web.Dockerfile`.
- **Convenciones**: UUID v4 en toda entidad; fechas ISO-8601 UTC; paginación `{ data, total, page, pageSize }`; mutaciones de dominio solo en la capa de servicio (ningún controller llama a Prisma directamente); logging estructurado (JSON) a stdout.
- **Fuera de alcance de esta ronda de épicas** (Deferred en la arquitectura, Diferido en el PRD): integración con CMDB externo, asistente de IA, preferencias/push/analítica, panel de administración de plataforma, proveedor SMTP específico, separación en servicios independientes, entornos de staging/CI, versionado por concurrencia en `ItemConfiguracion`.

### UX Design Requirements

No aplica — no existe un documento UX (`bmad-ux`) para este proyecto. Las decisiones de interfaz quedan a criterio de implementación dentro de las convenciones de la arquitectura (interfaz responsive, feedback no bloqueante — NFR8).

### FR Coverage Map

FR1-FR11: Epic 1 - Acceso y control de usuarios
FR27-FR30: Epic 2 - Auditoría y trazabilidad
FR12-FR17: Epic 3 - Inventario de ítems de configuración
FR18-FR26: Epic 4 - Relaciones y mapa de dependencias
FR31-FR37: Epic 5 - Solicitudes de cambio
FR38-FR39: Epic 6 - Reportes y exportación
FR40-FR42: Epic 7 - Importación masiva desde archivo

## Epic List

### Epic 1: Acceso y control de usuarios
Cualquier persona puede iniciar sesión de forma segura, recuperar su contraseña, y un Administrador puede invitar, gestionar y dar de baja usuarios con el rol correcto (Administrador, Gestor, Editor, Consulta). Entrega completa por sí sola: sin inventario aún, pero el sistema ya es utilizable como gestor de acceso y demostrable end-to-end (login, invitación, cambio de rol, bloqueo por intentos fallidos).
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11

### Epic 2: Auditoría y trazabilidad
Un usuario autenticado puede consultar y filtrar el historial de auditoría del sistema — quién hizo qué y cuándo — con la garantía arquitectónica (AD-3) de que ninguna escritura futura sobre inventario o relaciones podrá completarse sin quedar registrada en la misma transacción. Se construye ahora, antes que Inventario, precisamente para que Epic 3 y 4 no tengan que volver a tocar su código de escritura para añadir auditoría después.
**FRs covered:** FR27, FR28, FR29, FR30

### Epic 3: Inventario de ítems de configuración
Un Editor puede crear, buscar, modificar y eliminar ítems de configuración de cualquiera de los ≥19 tipos, con propiedades específicas por tipo, y ver los cambios reflejados de inmediato en el historial de auditoría (Epic 2). Un perfil de Consulta puede ver el inventario sin poder modificarlo.
**FRs covered:** FR12, FR13, FR14, FR15, FR16, FR17

### Epic 4: Relaciones y mapa de dependencias
Un Editor puede vincular ítems entre sí con relaciones dirigidas y tipadas (con sugerencia automática), y cualquier usuario puede navegar el árbol de topología para responder "¿qué se cae si apago esto?" — el caso de uso central de un CMDB. Usa Inventario (Epic 3) y Auditoría (Epic 2).
**FRs covered:** FR18, FR19, FR20, FR21, FR22, FR23, FR24, FR25, FR26

### Epic 5: Solicitudes de cambio *(Extendido v1.1)*
Cualquier usuario autenticado puede formalizar un cambio deseado sobre un ítem como una solicitud con flujo de aprobación (Nueva → En ejecución → Completada/Rechazada), con notificaciones por correo, en vez de editar directamente. Usa Auth (Epic 1), Inventario (Epic 3) y Auditoría (Epic 2).
**FRs covered:** FR31, FR32, FR33, FR34, FR35, FR36, FR37

### Epic 6: Reportes y exportación *(Extendido v1.1)*
Cualquier usuario puede exportar el inventario completo a hoja de cálculo (activos + relaciones) o a un PDF con plantilla, para consumo offline o gerencial. Usa Inventario (Epic 3) y Relaciones (Epic 4).
**FRs covered:** FR38, FR39

### Epic 7: Importación masiva desde archivo *(Extendido v1.1)*
Un Administrador puede reemplazar el inventario completo desde un archivo, con confirmación explícita, proceso por pasos reportados, y reconstrucción de relaciones — la vía de resincronización masiva. Usa Inventario (Epic 3), Relaciones (Epic 4) y Auditoría (Epic 2).
**FRs covered:** FR40, FR41, FR42

## Epic 1: Acceso y control de usuarios

Cualquier persona puede iniciar sesión de forma segura, recuperar su contraseña, y un Administrador puede invitar, gestionar y dar de baja usuarios con el rol correcto (Administrador, Gestor, Editor, Consulta).

### Story 1.1: Arranque del sistema y primer administrador

As a Administrador,
I want que el sistema cree automáticamente el primer usuario Administrador si no existe ninguno,
So that pueda entrar al sistema recién desplegado sin un paso manual de setup.

**Acceptance Criteria:**

**Given** una base de datos Postgres recién migrada sin ningún usuario
**When** la API (`apps/api`) arranca
**Then** se crea automáticamente un usuario con rol Administrador
**And** sus credenciales iniciales quedan disponibles solo vía variables de entorno (AD-7), nunca en el código ni en logs

**Given** que ya existe al menos un usuario en la base de datos
**When** la API arranca
**Then** no se crea ningún administrador adicional

*Nota de implementación:* esta historia inicializa el monorepo (`apps/api` con NestJS 11 + Prisma 7 + PostgreSQL 18.x, `apps/web` con React 19 + Vite 8), el esquema inicial de `Usuario`, y el health check de arranque que verifica la conexión a Postgres antes de aceptar tráfico (NFR5).

### Story 1.2: Login con email y contraseña

As a usuario registrado,
I want iniciar sesión con mi email y contraseña,
So that pueda acceder a las funciones del sistema según mi rol.

**Acceptance Criteria:**

**Given** un usuario activo con credenciales válidas
**When** envía email y contraseña al endpoint de login
**Then** recibe un access token JWT de vida corta y un refresh token (AD-5)
**And** la contraseña se valida contra su hash almacenado, nunca en texto plano (NFR1)

**Given** credenciales inválidas (email o contraseña incorrectos)
**When** intenta iniciar sesión
**Then** el sistema responde con un error genérico, sin indicar cuál de los dos campos falló

**Given** un email de usuario con distinta capitalización a como fue registrado
**When** intenta iniciar sesión
**Then** el sistema lo reconoce como el mismo usuario (normalización, NFR3)

### Story 1.3: Cerrar sesión

As a usuario autenticado,
I want cerrar mi sesión,
So that mi acceso quede invalidado de inmediato en este dispositivo.

**Acceptance Criteria:**

**Given** una sesión activa con un refresh token válido
**When** el usuario cierra sesión
**Then** ese refresh token queda revocado de inmediato en Postgres (AD-5)
**And** cualquier intento posterior de usarlo para renovar el access token es rechazado

### Story 1.4: Bloqueo temporal por intentos fallidos

As a Administrador del sistema,
I want que una cuenta se bloquee temporalmente tras varios intentos fallidos de login consecutivos,
So that se dificulte un ataque de fuerza bruta sobre las contraseñas.

**Acceptance Criteria:**

**Given** una cuenta con `[ASSUMPTION: 3]` intentos fallidos consecutivos
**When** ocurre un intento fallido más
**Then** la cuenta queda bloqueada por `[ASSUMPTION: 30 minutos]`, configurable por variable de entorno
**And** se notifica al usuario por correo (vía `MailModule`, AD-9 — el fallo de envío no bloquea el bloqueo en sí)

**Given** una cuenta bloqueada
**When** el usuario intenta iniciar sesión con credenciales correctas antes de que expire el bloqueo
**Then** el login es rechazado indicando que la cuenta está temporalmente bloqueada

### Story 1.5: Renovación transparente de sesión

As a usuario autenticado,
I want que mi sesión se renueve automáticamente mientras siga vigente,
So that no tenga que volver a iniciar sesión constantemente mientras trabajo.

**Acceptance Criteria:**

**Given** un access token JWT expirado pero un refresh token válido y no usado
**When** el cliente solicita renovación
**Then** el sistema emite un nuevo access token y rota el refresh token (AD-5)
**And** el refresh token anterior queda invalidado

**Given** un refresh token ya usado que se presenta de nuevo (posible robo/replay)
**When** se solicita renovación con él
**Then** el sistema rechaza la solicitud y revoca toda la cadena de refresh tokens de ese usuario

### Story 1.6: Recuperación de contraseña

As a usuario que olvidó su contraseña,
I want solicitar un enlace de recuperación por correo,
So that pueda restablecer el acceso a mi cuenta sin depender de un administrador.

**Acceptance Criteria:**

**Given** un email que pertenece a un usuario registrado
**When** solicita recuperación de contraseña
**Then** recibe un correo con un enlace de un solo uso, con expiración de `[ASSUMPTION: 1 hora]`

**Given** un email que NO pertenece a ningún usuario registrado
**When** solicita recuperación de contraseña
**Then** el sistema responde con el mismo mensaje genérico que en el caso exitoso, sin revelar si el correo existe (FR5)

**Given** un enlace de recuperación ya usado o expirado
**When** se intenta usar de nuevo
**Then** el sistema lo rechaza y no permite cambiar la contraseña

### Story 1.7: Invitar usuarios y activar la cuenta

As a Gestor o Administrador,
I want invitar a una persona nueva por correo electrónico, y que esa persona pueda activar su cuenta fijando su propia contraseña,
So that pueda unirse al sistema con el rol que le corresponde sin que nadie más conozca su contraseña.

**Acceptance Criteria:**

**Given** un Gestor o Administrador autenticado
**When** invita a un email con un rol asignado
**Then** se envía un correo con un enlace de activación de un solo uso, expiración configurable (`[ASSUMPTION: 7 días]`)
**And** se crea el usuario en estado "pendiente de verificación", sin contraseña utilizable todavía

**Given** un enlace de activación válido y no usado
**When** la persona invitada lo abre y establece su contraseña
**Then** su cuenta pasa a estado "activo" con el rol asignado, y ya puede iniciar sesión (Story 1.2)
**And** *(nota: la validación de complejidad mínima de contraseña, FR11, se endurece sobre este mismo flujo en Story 1.11 — en esta historia basta con aceptar cualquier contraseña no vacía)*

**Given** un enlace de activación expirado o ya usado
**When** se intenta usar de nuevo
**Then** el sistema lo rechaza y la cuenta permanece sin activar

**Given** un usuario con rol Editor o Consulta
**When** intenta invitar a alguien
**Then** el sistema rechaza la acción por permisos insuficientes (RBAC, AD-4)

### Story 1.8: Listar, desactivar y reactivar usuarios

As a Gestor o Administrador,
I want ver la lista de usuarios y poder desactivar o reactivar sus cuentas,
So that pueda mantener el acceso al sistema al día conforme cambia el equipo.

**Acceptance Criteria:**

**Given** un Gestor o Administrador autenticado
**When** consulta la lista de usuarios
**Then** ve todos los usuarios con su estado actual (activo/pendiente/bloqueado/desactivado)

**Given** un usuario activo
**When** un Gestor o Administrador lo desactiva
**Then** ese usuario ya no puede iniciar sesión, pero su historial de auditoría previo permanece intacto

### Story 1.9: Cambiar rol de usuario

As a Administrador,
I want cambiar el rol asignado a un usuario existente,
So that su nivel de acceso refleje su responsabilidad actual.

**Acceptance Criteria:**

**Given** un Administrador autenticado
**When** cambia el rol de un usuario a uno de los cuatro roles válidos
**Then** el cambio se aplica de inmediato a los permisos de ese usuario

**Given** un usuario con rol Gestor, Editor o Consulta
**When** intenta cambiar el rol de otro usuario
**Then** el sistema rechaza la acción — exclusivo de Administrador (FR9)

### Story 1.10: Forzar reseteo de contraseña de otro usuario

As a Administrador o Gestor,
I want forzar el restablecimiento de la contraseña de otro usuario,
So that pueda ayudarlo a recuperar el acceso sin conocer su contraseña actual.

**Acceptance Criteria:**

**Given** un Administrador o Gestor autenticado
**When** fuerza el reseteo de contraseña de un usuario
**Then** ese usuario recibe un enlace de restablecimiento por correo, igual que en la recuperación autoservicio

### Story 1.11: Política de contraseña

As a Administrador del sistema,
I want que toda contraseña nueva cumpla una complejidad mínima y no repita las últimas usadas,
So that las cuentas sean más resistentes a contraseñas débiles o reutilizadas.

**Acceptance Criteria:**

**Given** una contraseña nueva que no cumple la longitud/complejidad mínima configurada
**When** un usuario intenta establecerla (registro, reseteo, o cambio)
**Then** el sistema la rechaza con un mensaje indicando el requisito no cumplido

**Given** una contraseña nueva que coincide con alguna de las últimas `[ASSUMPTION: 3]` contraseñas del usuario
**When** intenta establecerla
**Then** el sistema la rechaza

## Epic 2: Auditoría y trazabilidad

Un usuario autenticado puede consultar y filtrar el historial de auditoría del sistema, con la garantía de que ninguna escritura futura sobre inventario o relaciones podrá completarse sin quedar registrada en la misma transacción.

### Story 2.1: Registro automático e inmutable de cada acción

As a Administrador,
I want que toda creación, modificación o eliminación quede registrada automáticamente en un historial inmutable,
So that pueda confiar en que el historial de auditoría es una fuente de verdad completa, nunca parcial.

**Acceptance Criteria:**

**Given** un módulo de dominio (Inventario, Relaciones, etc.) que ejecuta una escritura dentro de una transacción de Prisma
**When** llama a `AuditModule.record(tx, ...)` pasando el cliente de transacción recibido
**Then** el registro de auditoría se guarda dentro de esa misma transacción (AD-3) — si la transacción falla, ni la escritura de dominio ni el registro de auditoría quedan guardados

**Given** una llamada a `AuditModule.record()`
**When** se construye el registro
**Then** su forma sigue el payload canónico `{ usuario, tipoAccion, entidad, entidadId, cambios, fecha }` (AD-3), sin variantes por módulo

**Given** un registro de auditoría ya guardado
**When** cualquier cliente (incluyendo un Administrador) intenta modificarlo o borrarlo vía la API
**Then** el sistema lo rechaza — no existe ningún endpoint de escritura sobre auditoría, salvo la excepción de reimportación masiva completa (Epic 7)

### Story 2.2: Consultar y filtrar el historial de auditoría

As a usuario autenticado (cualquier rol),
I want consultar el historial de auditoría filtrando por usuario, entidad, tipo de acción o rango de fechas,
So that pueda investigar quién hizo qué cambio y cuándo.

**Acceptance Criteria:**

**Given** registros de auditoría existentes
**When** un usuario autenticado consulta el historial sin filtros
**Then** recibe los registros más recientes, paginados (`{ data, total, page, pageSize }`)

**Given** registros de auditoría de múltiples usuarios y entidades
**When** se filtra por usuario, tipo de entidad, tipo de acción, o rango de fechas
**Then** solo se devuelven los registros que cumplen todos los filtros aplicados

**Given** un usuario con rol Editor o Consulta
**When** consulta el historial de auditoría
**Then** puede leerlo con normalidad — la auditoría es de solo lectura para todos los roles autenticados (la escritura nunca es posible para ningún rol vía API, ver Story 2.1)

## Epic 3: Inventario de ítems de configuración

Un Editor puede crear, buscar, modificar y eliminar ítems de configuración de cualquiera de los tipos soportados, con propiedades específicas por tipo, y ver los cambios reflejados de inmediato en el historial de auditoría. Un perfil de Consulta puede ver el inventario sin poder modificarlo.

### Story 3.1: Crear un ítem de configuración

As a Editor,
I want crear un nuevo ítem de configuración eligiendo su tipo y llenando sus propiedades,
So that el inventario refleje un activo real de la organización.

**Acceptance Criteria:**

**Given** un catálogo de al menos 19 tipos predefinidos (aplicación, API, servicio, base de datos, servidor virtual, clúster, integración, job programado, etc.)
**When** un Editor crea un ítem eligiendo uno de esos tipos
**Then** el ítem se guarda con sus campos comunes (nombre, descripción, dominio propietario, dirección de red) y sus propiedades específicas del tipo en la columna `properties` (JSONB, AD-8)
**And** la creación queda registrada en auditoría dentro de la misma transacción (AD-3, Epic 2)

**Given** un nombre de ítem con distinta capitalización a uno ya existente
**When** se intenta crear
**Then** el sistema lo trata como el mismo nombre para fines de unicidad (normalización, NFR3)

**Given** un usuario con rol Consulta
**When** intenta crear un ítem
**Then** el sistema rechaza la acción por permisos insuficientes (RBAC)

**Given** que se necesita agregar un tipo de ítem nuevo al catálogo
**When** se agrega
**Then** no requiere ninguna migración de esquema — solo una entrada nueva en el catálogo de tipos (FR13, AD-8)

### Story 3.2: Buscar, filtrar y listar ítems

As a usuario autenticado (cualquier rol),
I want buscar y filtrar ítems por tipo o texto libre, con resultados paginados,
So that pueda encontrar el ítem que necesito sin cargar todo el inventario de una vez.

**Acceptance Criteria:**

**Given** un inventario con ítems de varios tipos
**When** se filtra por tipo
**Then** solo se devuelven ítems de ese tipo

**Given** un inventario con ítems cuyo nombre o descripción contiene cierto texto
**When** se busca por ese texto libre
**Then** se devuelven los ítems coincidentes

**Given** un inventario con más ítems que el tamaño de página
**When** se listan sin especificar página
**Then** se devuelve la primera página con `[ASSUMPTION: 50]` ítems y el total real (`{ data, total, page, pageSize }`)

### Story 3.3: Modificar un ítem existente

As a Editor,
I want actualizar las propiedades de un ítem existente sin tener que reenviar el objeto completo,
So that pueda corregir o enriquecer su información rápidamente.

**Acceptance Criteria:**

**Given** un ítem existente con varias propiedades
**When** un Editor envía solo las propiedades que cambian
**Then** esas propiedades se fusionan (merge) con las existentes — el resto permanece intacto
**And** la modificación queda registrada en auditoría con el detalle del cambio (AD-3)

**Given** un usuario con rol Consulta
**When** intenta modificar un ítem
**Then** el sistema rechaza la acción

### Story 3.4: Eliminar un ítem

As a Editor,
I want eliminar un ítem de configuración que ya no es relevante,
So that el inventario no acumule activos obsoletos.

**Acceptance Criteria:**

**Given** un ítem existente
**When** un Editor lo elimina
**Then** el ítem deja de aparecer en listados y búsquedas
**And** la eliminación queda registrada en auditoría (AD-3)
**And** *(nota: qué ocurre con relaciones o solicitudes de cambio que referencian este ítem se resuelve en Epic 4 y Epic 5 respectivamente, que aún no existen en este punto del build)*

**Given** un usuario con rol Consulta
**When** intenta eliminar un ítem
**Then** el sistema rechaza la acción

## Epic 4: Relaciones y mapa de dependencias

Un Editor puede vincular ítems entre sí con relaciones dirigidas y tipadas, y cualquier usuario puede navegar el árbol de topología para responder "¿qué se cae si apago esto?".

### Story 4.1: Crear una relación entre dos ítems

As a Editor,
I want crear una relación dirigida y tipada entre dos ítems, con el tipo sugerido automáticamente,
So that el sistema modele las dependencias reales sin que tenga que escribir el tipo de memoria cada vez.

**Acceptance Criteria:**

**Given** dos ítems existentes de tipos conocidos (p. ej. un servidor y un servicio)
**When** un Editor empieza a crear una relación entre ellos
**Then** el sistema sugiere automáticamente un tipo y descripción razonables (p. ej. "servidor aloja servicio", FR20) que el Editor puede aceptar o cambiar

**Given** una relación ya existente entre dos ítems con cierto tipo
**When** se intenta crear otra relación idéntica (mismo origen, destino y tipo)
**Then** el sistema la rechaza por duplicada (FR19)

**Given** un catálogo extensible de tipos de relación (aloja, depende de, alojado en, pertenece a clúster, se integra con, se conecta a, entre otros)
**When** se crea una relación
**Then** su tipo debe pertenecer a ese catálogo
**And** la creación queda registrada en auditoría (AD-3)

### Story 4.2: Editar y eliminar relaciones

As a Editor,
I want editar o eliminar una relación existente,
So that el mapa de dependencias se mantenga correcto cuando algo cambia.

**Acceptance Criteria:**

**Given** una relación existente
**When** un Editor la edita (cambia su tipo) o la elimina
**Then** el cambio se aplica y queda registrado en auditoría (AD-3)

**Given** un usuario con rol Consulta
**When** intenta editar o eliminar una relación
**Then** el sistema rechaza la acción

### Story 4.3: Ver el árbol de topología desde un ítem

As a usuario autenticado (cualquier rol),
I want ver el árbol de dependencias a partir de un ítem raíz, y consultar sus vecinos directos,
So that pueda entender qué depende de qué antes de tomar una decisión sobre ese ítem.

**Acceptance Criteria:**

**Given** un ítem raíz con relaciones directas e indirectas
**When** un usuario abre su vista de topología
**Then** ve el árbol navegable hasta una profundidad configurable (`[ASSUMPTION: 5 niveles]`)

**Given** un ítem con muchas relaciones en cascada
**When** el árbol resultante excedería `[ASSUMPTION: 5000]` nodos
**Then** el sistema acota la vista a ese límite en vez de intentar renderizar todo (FR26)

**Given** un ítem específico
**When** se consultan solo sus vecinos directos (sin expandir el árbol completo)
**Then** el sistema devuelve esa lista acotada de forma más ligera que el árbol completo (FR24)

### Story 4.4: Buscar ítems dentro de la vista de topología

As a usuario autenticado (cualquier rol),
I want buscar un ítem por nombre directamente dentro de la vista de topología,
So that pueda saltar a un punto específico del mapa sin navegar nodo por nodo.

**Acceptance Criteria:**

**Given** la vista de topología abierta
**When** el usuario busca un ítem por nombre
**Then** el sistema lo localiza y lo centra en la vista, aunque no sea el ítem raíz actual

## Epic 5: Solicitudes de cambio *(Extendido v1.1)*

Cualquier usuario autenticado puede formalizar un cambio deseado sobre un ítem como una solicitud con flujo de aprobación, en vez de editarlo directamente.

### Story 5.1: Crear una solicitud de cambio sobre un ítem

As a usuario autenticado (cualquier rol),
I want crear una solicitud de cambio sobre un ítem existente,
So that el cambio quede formalizado y visible para quien deba ejecutarlo, en vez de perderse en una conversación informal.

**Acceptance Criteria:**

**Given** un ítem existente
**When** un usuario autenticado crea una solicitud de cambio sobre él, describiendo el cambio deseado
**Then** la solicitud se guarda con estado inicial "Nueva" y un snapshot del nombre y tipo del ítem al momento de crearla (FR37)
**And** se envía una notificación por correo a los destinatarios configurados (FR32) vía `MailModule` (AD-9) — si el correo falla o excede el timeout, la solicitud igual queda creada
**And** la creación queda registrada en auditoría (AD-3)

`[ASSUMPTION]` mientras no exista el panel de administración de plataforma (Diferido, RF-63), los destinatarios de notificación se configuran vía variable de entorno (lista de emails), no desde una UI.

**Given** que el ítem referenciado por una solicitud se elimina después
**When** se consulta esa solicitud
**Then** sigue siendo legible gracias al snapshot — no depende de que el ítem original todavía exista

### Story 5.2: Transicionar el estado de una solicitud de cambio

As a Editor o superior,
I want mover una solicitud de cambio a "En ejecución", "Completada" o "Rechazada",
So that el estado del sistema refleje el progreso real del cambio solicitado.

**Acceptance Criteria:**

**Given** una solicitud en estado "Nueva"
**When** se transiciona a "En ejecución" y luego a "Completada", o directamente a "Rechazada"
**Then** el sistema valida la transición en el servidor (FR34) — nunca confía en el estado que envíe el cliente
**And** se notifica por correo el cambio de estado (FR35, vía `MailModule`)

**Given** una solicitud en un estado terminal ("Completada" o "Rechazada")
**When** se intenta transicionarla a cualquier otro estado
**Then** el sistema lo rechaza — los estados terminales no permiten más transiciones (FR33)

### Story 5.3: Dar de baja una solicitud de cambio

As a Gestor o Administrador,
I want dar de baja (lógicamente) una solicitud de cambio que ya no aplica,
So that no quede visible en el flujo activo, sin perder su historial.

**Acceptance Criteria:**

**Given** una solicitud de cambio existente
**When** un Gestor o Administrador la da de baja
**Then** deja de aparecer en los listados activos
**And** su historial (incluida la auditoría) permanece consultable (FR36)

## Epic 6: Reportes y exportación *(Extendido v1.1)*

Cualquier usuario puede exportar el inventario completo para consumo offline o gerencial.

### Story 6.1: Exportar el inventario a hoja de cálculo

As a usuario autenticado (cualquier rol),
I want descargar el inventario completo en un archivo de hoja de cálculo,
So that pueda analizarlo o compartirlo fuera del sistema.

**Acceptance Criteria:**

**Given** un inventario con ítems y relaciones
**When** un usuario solicita el reporte de hoja de cálculo
**Then** recibe un archivo descargable con al menos dos hojas: una de activos y otra de relaciones (FR38)

### Story 6.2: Exportar el inventario a PDF

As a usuario autenticado (cualquier rol),
I want descargar un resumen del inventario en PDF con una plantilla predefinida,
So that pueda presentarlo o archivarlo en un formato de lectura fija.

**Acceptance Criteria:**

**Given** un inventario con ítems
**When** un usuario solicita el reporte en PDF
**Then** recibe un archivo descargable generado a partir de una plantilla predefinida (FR39)

## Epic 7: Importación masiva desde archivo *(Extendido v1.1)*

Un Administrador puede reemplazar el inventario completo desde un archivo, con confirmación explícita y un reporte paso a paso, para resincronizar todo de una vez.

### Story 7.1: Subir y validar un archivo de importación

As a Administrador,
I want subir un archivo de inventario y que el sistema lo valide antes de tocar nada,
So that sepa si el archivo es utilizable antes de comprometerme a reemplazar el inventario actual.

**Acceptance Criteria:**

**Given** un archivo de hoja de cálculo con el formato esperado
**When** un Administrador lo sube
**Then** el sistema lo valida (estructura, tipos de ítem reconocidos, referencias internas) y reporta el resultado de la validación
**And** el inventario actual permanece intacto — la validación por sí sola no modifica nada

**Given** un archivo con errores de formato o datos inválidos
**When** se valida
**Then** el sistema reporta específicamente qué falló, sin proceder a ningún paso posterior

**Given** un usuario con rol distinto de Administrador
**When** intenta subir un archivo de importación
**Then** el sistema rechaza la acción (la importación masiva es exclusiva de Administrador)

### Story 7.2: Confirmar y ejecutar el reemplazo completo del inventario

As a Administrador,
I want confirmar explícitamente y luego ejecutar el reemplazo completo del inventario desde un archivo ya validado,
So that el archivo se convierta en la nueva fuente de verdad, con un reporte claro de cada paso.

**Acceptance Criteria:**

**Given** un archivo ya validado (Story 7.1)
**When** el Administrador confirma de forma explícita e inequívoca que quiere reemplazar el inventario
**Then** el sistema ejecuta, en orden: limpieza del inventario actual → carga de nuevos activos (vía InventoryModule, AD-1) → reconstrucción de relaciones explícitas del archivo (vía RelationsModule, AD-1) → inferencia de relaciones jerárquicas implícitas razonables
**And** cada paso reporta su propio resultado (procesados, creados, errores) para poder diagnosticar un fallo parcial (FR41)
**And** la corrida completa queda auditada como un evento único (excepción de FR29/AD-3 — no ítem por ítem)

**Given** que el Administrador no ha confirmado explícitamente
**When** intenta ejecutar la importación directamente después de validar
**Then** el sistema lo bloquea — no hay camino que salte el paso de confirmación (FR42)

**Given** que un paso intermedio falla (p. ej. la carga de activos)
**When** eso ocurre
**Then** el reporte indica exactamente en qué paso falló y qué se alcanzó a procesar antes del fallo
