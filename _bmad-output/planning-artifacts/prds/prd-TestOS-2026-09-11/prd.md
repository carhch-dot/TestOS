---
title: TestOS PRD
status: final
created: 2026-09-11
updated: 2026-09-11
---

# PRD: TestOS

## 0. Propósito de este documento

Este PRD es para quien construya TestOS (el propio usuario, con Claude Code / agentes BMAD) y para las fases downstream del método (`bmad-architecture`, `bmad-create-epics-and-stories`, `bmad-build`). Se apoya en [`brief.md`](../../briefs/brief-TestOS-2026-09-11/brief.md) y su [`addendum.md`](../../briefs/brief-TestOS-2026-09-11/addendum.md) — ese addendum contiene la especificación funcional original íntegra (63 RFs, modelo de datos, flujos, reglas de negocio); este PRD no la repite, la reorganiza en features con FRs re-numerados y trazables (`FR-N (deriva de RF-xx)`), y la acota al alcance real de este ejercicio (ver §6 MVP Scope). Vocabulario anclado en el Glosario (§3); las Features (§4) agrupan Requisitos Funcionales anidados; los `[ASSUMPTION]` inline quedan indexados en §9.

## 1. Visión

TestOS es un CMDB (Configuration Management Database) web: centraliza el inventario de activos de TI de una organización (aplicaciones, servicios, bases de datos, servidores, clústeres, integraciones, jobs), modela sus relaciones y dependencias, y mantiene un historial de auditoría inmutable de todo cambio. Resuelve el mismo problema real que resolvía su predecesor, NexOS — inventario disperso en hojas de cálculo, sin trazabilidad ni visibilidad de dependencias.

Pero TestOS no se construye porque un negocio lo necesite hoy: es una reconstrucción deliberada, desde cero, con arquitectura decidida a propósito y un flujo spec-driven de punta a punta (brief → PRD → arquitectura → épicas/historias → build) apoyado en agentes de IA. El éxito no se mide en paridad de features con NexOS, sino en si el núcleo funciona de verdad, si la arquitectura resultante es defendible, y si el sistema queda en un estado que se pueda extender sin reescribirse (detalle completo en `brief.md` §Criterios de éxito).

Forma: aplicación web responsive, instalable como PWA. Sin app móvil nativa en el horizonte de este PRD.

## 2. Usuario objetivo

### 2.1 Jobs To Be Done

- **Como Administrador**, necesito controlar quién tiene acceso y con qué rol, y poder activar/desactivar la plataforma completa, para responder ante incidentes de seguridad o mantenimiento sin depender de otro sistema.
- **Como Gestor**, necesito mantener la fuerza de trabajo del inventario (invitar, desactivar, resetear credenciales) sin escalar cada solicitud al administrador.
- **Como Editor** (rol por defecto), necesito crear, modificar y relacionar ítems de inventario rápido, con la confianza de que cada cambio queda auditado sin esfuerzo extra de mi parte.
- **Como perfil de Consulta**, necesito ver el inventario, la topología y el historial de auditoría sin riesgo de modificarlo por accidente.
- **Como constructor del sistema (el propio usuario)**, necesito que el ejercicio de reconstrucción deje un núcleo real y verificable, no una maqueta — este JTBD es tan válido como los de rol de negocio, dado que es un proyecto de aprendizaje.

### 2.2 No-usuarios (v1)

No hay usuarios reales de una organización todavía — `[ASSUMPTION: brief.md confirma que este es un ejercicio personal sin despliegue en producción planeado]`. Los roles y necesidades se preservan tal como los tenía NexOS porque reflejan un dominio real, no porque haya un equipo esperando usarlo.

### 2.3 Recorridos clave de usuario

*Alcance ligero — proyecto hobby/solo; los tres recorridos son escenas de una frase salvo el de importación masiva, que por ser destructivo amerita más detalle.*

- **UJ-1. El Editor mantiene el inventario al día.** Un Editor autenticado busca un servidor por nombre, corrige su propiedad de dirección de red, y crea una relación "depende de" hacia una base de datos — el sistema sugiere el tipo de relación automáticamente y registra ambos cambios en la auditoría sin que el Editor tenga que pensar en ello. Realiza FR-12, FR-16, FR-18, FR-20, FR-27.
- **UJ-2. La Consulta investiga un incidente.** Un usuario de Consulta, sin permisos de escritura, abre la topología desde un servidor caído y navega sus vecinos directos para ver qué servicios dependen de él, sin poder alterar nada por accidente. Realiza FR-23, FR-24.
- **UJ-3. El Administrador reemplaza el inventario completo desde un archivo.**
  - **Persona + contexto:** el Administrador acaba de recibir un extracto actualizado del inventario en hoja de cálculo y quiere que sea la nueva fuente de verdad.
  - **Estado de entrada:** autenticado como Administrador, en el panel de importación.
  - **Camino:** (1) sube el archivo; (2) el sistema lo valida y muestra una advertencia explícita de que esto reemplazará todo el inventario actual; (3) el Administrador confirma de forma inequívoca; (4) el sistema limpia el inventario actual, carga los nuevos activos, reconstruye relaciones explícitas del archivo, e infiere relaciones jerárquicas implícitas razonables.
  - **Clímax:** el sistema reporta el resultado de cada paso — cuántos activos y relaciones se procesaron, y si algún paso falló.
  - **Resolución:** el Administrador puede diagnosticar cualquier fallo parcial por el reporte paso a paso, sin quedarse con un inventario en estado ambiguo.
  - **Edge case:** si la validación del archivo falla en el paso 2, el sistema no toca el inventario existente — el reemplazo es todo-o-nada desde ese punto de confirmación en adelante.
  - Realiza FR-40, FR-41, FR-42.

## 3. Glosario

- **CMDB (Configuration Management Database)** — la categoría de sistema que es TestOS: base de datos de gestión de configuración.
- **Ítem de configuración (CI)** — unidad de inventario (aplicación, servidor, base de datos, integración, etc.). Tiene un tipo, propiedades dinámicas según ese tipo, y participa en relaciones. "Activo" se usa como sinónimo informal en el resto del documento (herencia del vocabulario del documento fuente) — mismo concepto.
- **Relación** — vínculo dirigido y tipado entre dos ítems de configuración (origen → destino, tipo). Única por combinación (origen, destino, tipo).
- **Topología** — vista de árbol/grafo de relaciones navegable a partir de un ítem raíz.
- **Auditoría** — registro inmutable de quién hizo qué, cuándo, y con qué detalle, sobre ítems y relaciones.
- **Solicitud de cambio** — petición formal de modificación sobre un ítem, con flujo de estados (Nueva → En ejecución → Completada/Rechazada). Feature de v1.1, no del Núcleo.
- **RBAC** — control de acceso basado en rol. Cuatro roles: Administrador, Gestor, Editor, Consulta.
- **Núcleo v1** — el subconjunto de features sin el cual TestOS no es un CMDB: RBAC, inventario, relaciones, topología, auditoría. Es el MVP de este PRD (§6.1).
- **Extendido v1.1** — capa siguiente, construida sobre el Núcleo ya funcionando: solicitudes de cambio, reportes, importación masiva (§6.2).
- **Diferido** — capacidades reconocidas y documentadas pero explícitamente fuera de este PRD: integración con CMDB externo, asistente de IA, preferencias/push/analítica, panel de administración de plataforma (§5).

## 4. Features

### 4.1 Autenticación, sesión y gestión de usuarios (RBAC)

**Descripción:** Cubre identidad, sesión, y los cuatro roles que gobiernan todo lo demás en el sistema. Es la puerta de entrada al resto de las features — ninguna otra feature tiene sentido sin esto. Es precondición de UJ-1, UJ-2 y UJ-3 (que se realizan en las features 4.2-4.4 y 4.8, no aquí).

| Rol | Capacidades clave | Capa |
|---|---|---|
| **Administrador** | Gestión de roles | Núcleo v1 |
| | + activar/desactivar la plataforma | Diferido (panel, §5) |
| | + importación masiva desde archivo | Extendido v1.1 |
| | + importación desde CMDB externo | Diferido |
| **Gestor** | Todo lo del Editor + gestión de usuarios (invitar, desactivar, resetear contraseña) | Núcleo v1 |
| **Editor** (default) | Leer, crear, modificar, eliminar ítems y relaciones | Núcleo v1 |
| **Consulta** | Solo lectura: ítems, topología, auditoría | Núcleo v1 |
| | + reportes | Extendido v1.1 |

**Requisitos Funcionales:**

#### FR-1: Login con email y contraseña
El sistema emite una sesión/token válida por un periodo configurable al autenticar con email y contraseña. *(deriva de RF-01)*
**Consecuencias (verificables):**
- Contraseña verificada contra hash, nunca en texto plano (ver §10 NFRs transversales — Seguridad).
- `[ASSUMPTION: duración de sesión de referencia = 7 días, configurable]`

#### FR-2: Bloqueo temporal por intentos fallidos
El sistema bloquea la cuenta tras un número configurable de intentos fallidos consecutivos, y notifica por correo.
**Consecuencias:** `[ASSUMPTION: referencia = 3 intentos → bloqueo de 30 minutos, configurable]`. *(deriva de RF-02)*

#### FR-3: Logout invalida la sesión de inmediato
*(deriva de RF-03)*

#### FR-4: Renovación transparente de sesión
Mientras la sesión siga vigente, el sistema la renueva sin exigir nuevo login. *(deriva de RF-04)*

#### FR-5: Recuperación de contraseña
Enlace de un solo uso enviado por correo, expiración corta (`[ASSUMPTION: referencia = 1 hora]`), y respuesta uniforme que no revela si el correo existe en el sistema. *(deriva de RF-05)*

#### FR-6: Bootstrap del primer administrador
Si no existe ningún usuario, el sistema crea automáticamente el primer usuario Administrador al arrancar. *(deriva de RF-12)*

#### FR-7: Invitación de usuarios
Enlace de activación de un solo uso por correo, expiración configurable (`[ASSUMPTION: referencia = 7 días]`). *(deriva de RF-06)*

#### FR-8: Listar, desactivar y reactivar usuarios
Disponible para Gestor y Administrador. *(deriva de RF-07)*

#### FR-9: Cambiar rol de usuario
Exclusivo de Administrador. *(deriva de RF-08)*

#### FR-10: Forzar reseteo de contraseña de otro usuario
Disponible para Administrador y Gestor. *(deriva de RF-09)*

#### FR-11: Política de contraseña
No reutilizar las últimas N contraseñas (`[ASSUMPTION: N=3]`) y complejidad mínima configurable (longitud, mayúscula, carácter especial). *(deriva de RF-10, RF-11)*

**NFR específica de esta feature:** cuando la plataforma está desactivada globalmente (capacidad Diferida, §5), solo Administrador puede iniciar sesión — el resto ve "servicio no disponible". Esta regla vive aquí porque afecta el login aunque el panel de activar/desactivar en sí sea Diferido.

---

### 4.2 Inventario de ítems de configuración

**Descripción:** El corazón del CMDB — sin esto no hay inventario que relacionar, ver en topología o auditar. Realiza UJ-1.

**Requisitos Funcionales:**

#### FR-12: CRUD de ítems de configuración
Sujeto a permisos por rol (Consulta = solo lectura; Editor+ = escritura). *(deriva de RF-13)*

#### FR-13: Tipos de ítem extensibles
El sistema soporta al menos 19 tipos predefinidos (aplicación, API, servicio, base de datos, servidor virtual, clúster, integración, job programado, etc.). Agregar un tipo nuevo se hace por configuración/catálogo, no por cambio de esquema (principio de diseño ampliado en §10 — Consistencia y extensibilidad de datos). *(deriva de RF-14)*

#### FR-14: Propiedades dinámicas por tipo
Cada ítem soporta propiedades específicas de su tipo además de campos comunes (nombre, descripción, dominio propietario, dirección de red). *(deriva de RF-15)*

#### FR-15: Búsqueda y filtrado
Por tipo y por texto libre. *(deriva de RF-16)*

#### FR-16: Actualización parcial por merge
Las actualizaciones de propiedades se fusionan con las existentes; no se requiere reenviar el objeto completo. *(deriva de RF-17)*

#### FR-17: Paginación configurable
Los listados de ítems soportan límites y paginación para evitar respuestas excesivamente grandes. *(deriva de RF-18)*
**Consecuencias:** `[ASSUMPTION: tamaño de página por defecto = 50 ítems, configurable]`.

---

### 4.3 Relaciones entre ítems

**Descripción:** Modela las dependencias — es lo que convierte una lista de activos en un mapa de impacto. Realiza UJ-1.

**Requisitos Funcionales:**

#### FR-18: Crear relación dirigida y tipada
Origen → destino, con un tipo de relación. *(deriva de RF-19)*

#### FR-19: Prevención de duplicados
No se permite repetir el mismo tipo de relación entre el mismo par de ítems — clave natural (origen, destino, tipo). *(deriva de RF-20)*

#### FR-20: Sugerencia automática de relación
El sistema sugiere tipo y descripción según los tipos de los ítems origen/destino (p. ej. "servidor aloja servicio"). *(deriva de RF-21)*

#### FR-21: Editar y eliminar relaciones
*(deriva de RF-22)*

#### FR-22: Catálogo extensible de tipos de relación
Tipos de referencia (aloja, depende de, alojado en, pertenece a clúster, se integra con, se conecta a, entre otros), extensible. *(deriva de RF-23)*

---

### 4.4 Topología y árbol de dependencias

**Descripción:** La razón de ser del CMDB frente a una simple lista: responder "¿qué se cae si apago esto?". Realiza UJ-2.

**Requisitos Funcionales:**

#### FR-23: Vista de árbol/grafo navegable
A partir de un ítem raíz o de un tipo, con profundidad configurable. *(deriva de RF-24)*
**Consecuencias:** `[ASSUMPTION: referencia = máximo 5 niveles, configurable]`.

#### FR-24: Consulta de vecinos directos
De un ítem dado. *(deriva de RF-25)*

#### FR-25: Búsqueda global dentro de la topología
*(deriva de RF-26)*

#### FR-26: Límite de nodos configurable
Para proteger el rendimiento. *(deriva de RF-27)*
**Consecuencias:** `[ASSUMPTION: referencia = 5000 nodos, configurable]`.

---

### 4.5 Auditoría inmutable

**Descripción:** Sin esto, TestOS es un CRUD más — esto es lo que lo hace un CMDB confiable. Cross-cutting: toda escritura de las features 4.2-4.4 pasa por aquí.

**Requisitos Funcionales:**

#### FR-27: Registro inmutable de toda escritura
Toda creación, modificación y eliminación de ítems y relaciones (incluidas sus variantes de edición/eliminación) queda registrada. *(deriva de RF-28)*

#### FR-28: Contenido mínimo de cada entrada
Usuario que ejecutó la acción, tipo de acción, entidad afectada, fecha/hora, y detalle del cambio (payload). *(deriva de RF-29)*

#### FR-29: Auditoría consultable y filtrable
No editable ni borrable manualmente — única excepción documentada: una reimportación masiva completa (feature 4.8, v1.1). *(deriva de RF-30)*

#### FR-30: Atomicidad con la operación
Ninguna escritura sobre el inventario puede completarse sin su registro de auditoría correspondiente; el registro es parte atómica de la misma operación, no un proceso aparte que pueda fallar en silencio. *(deriva de RF-31)*

---

### 4.6 Solicitudes de cambio *(Extendido v1.1)*

**Descripción:** Formaliza el "quiero cambiar esto" como proceso, en vez de una edición directa. Se construye sobre el Núcleo ya funcionando — no bloquea el MVP.

**Requisitos Funcionales:**

#### FR-31: Crear solicitud de cambio
Cualquier usuario autenticado puede generarla sobre un ítem existente. *(deriva de RF-32)*

#### FR-32: Notificación de nueva solicitud
Por correo, a destinatarios configurados. *(deriva de RF-33)*

#### FR-33: Flujo de estados
Nueva → En ejecución → Completada, o Nueva → Rechazada; estados terminales sin más transiciones. *(deriva de RF-34)*

#### FR-34: Validación de transiciones en servidor
Nunca confiar en lo que envíe el cliente. *(deriva de RF-35)*

#### FR-35: Notificación de cambio de estado
*(deriva de RF-36)*

#### FR-36: Baja lógica
Eliminar (baja lógica) una solicitud conservando su historial. *(deriva de RF-37)*

#### FR-37: Snapshot del ítem referenciado
La solicitud conserva nombre/tipo del ítem al momento de crearse, para seguir siendo legible aunque el ítem se elimine después. *(deriva de RF-38)*

---

### 4.7 Reportes y exportación *(Extendido v1.1)*

**Descripción:** Saca el inventario del sistema para consumo offline/gerencial.

**Requisitos Funcionales:**

#### FR-38: Reporte en hoja de cálculo
Al menos dos hojas: activos y relaciones. *(deriva de RF-39)*

#### FR-39: Reporte en PDF
Con plantilla predefinida. *(deriva de RF-40)*

---

### 4.8 Importación masiva desde archivo *(Extendido v1.1)*

**Descripción:** La vía para poblar o resincronizar el inventario completo de una vez. Es intencionalmente destructiva — el archivo es la fuente de verdad en cada importación. Realiza UJ-3.

**Requisitos Funcionales:**

#### FR-40: Reemplazo total del inventario
El archivo reemplaza por completo activos, relaciones y jerarquías existentes. *(deriva de RF-41)*

#### FR-41: Proceso por pasos reportados
Validación del archivo → limpieza del inventario actual → carga de activos → reconstrucción de relaciones explícitas → inferencia de relaciones jerárquicas implícitas — cada paso reporta su resultado para diagnóstico de fallos parciales. *(deriva de RF-42, RF-44)*

#### FR-42: Confirmación explícita antes de ejecutar
Dado que es destructiva, exige confirmación explícita e inequívoca del usuario. *(deriva de RF-43)*
**Fuera de alcance de este FR:** decidir *cómo* se ve esa confirmación en la UI — eso es trabajo de `bmad-ux`/arquitectura, no de este PRD.

## 5. Non-Goals (explícitos)

- **No** se integra con ningún sistema externo de CMDB/inventario en este PRD (capacidad Diferida — ver `addendum.md` de esta carpeta).
- **No** incluye un asistente conversacional de IA sobre el inventario (Diferido).
- **No** incluye preferencias de interfaz por usuario, notificaciones push, ni analítica de uso (Diferido).
- **No** incluye panel de administración de plataforma para activar/desactivar acceso global ni configurar destinatarios de notificación (Diferido — aunque el *efecto* de "plataforma desactivada" en el login sí es NFR de §4.1).
- **No** hace auto-discovery de infraestructura, ni se integra con herramientas de monitoreo/APM en tiempo real.
- **No** gestiona facturación ni costos de infraestructura.
- **No** construye una app móvil nativa — sí se espera web responsive instalable como PWA.
- **No** valida esquema estricto por tipo de ítem en v1 (las propiedades dinámicas quedan sin validación de forma; ver Roadmap en `addendum.md`).

## 6. Alcance del MVP

### 6.1 Dentro de alcance (Núcleo v1 — el MVP de este PRD)
- Feature 4.1 — Autenticación, sesión y RBAC (FR-1 a FR-11)
- Feature 4.2 — Inventario de ítems de configuración (FR-12 a FR-17)
- Feature 4.3 — Relaciones entre ítems (FR-18 a FR-22)
- Feature 4.4 — Topología y árbol de dependencias (FR-23 a FR-26)
- Feature 4.5 — Auditoría inmutable (FR-27 a FR-30)

### 6.2 Fuera de alcance del MVP (Extendido v1.1 — siguiente capa, no bloquea el MVP)
- Feature 4.6 — Solicitudes de cambio (FR-31 a FR-37)
- Feature 4.7 — Reportes y exportación (FR-38, FR-39)
- Feature 4.8 — Importación masiva desde archivo (FR-40 a FR-42)

`[NOTE FOR PM]` Extendido v1.1 ya tiene FRs completos en este mismo PRD porque el brief los detalló — no hace falta un segundo PRD para arrancarlos, pero **no deben empezarse en `bmad-build` antes de que el Núcleo v1 esté funcionando de verdad** (criterio de éxito #1 del brief). `bmad-create-epics-and-stories` debe reflejar esta secuencia en el orden de épicas.

## 7. Métricas de éxito

Proyecto hobby/aprendizaje — las métricas son de validación personal, no de negocio.

**Primaria**
- **SM-1**: El Núcleo v1 (features 4.1-4.5) funciona end-to-end con datos reales de prueba — se puede crear un ítem, relacionarlo, verlo en topología, y confirmar que cada paso quedó en la auditoría, sin intervención manual fuera de la UI. Valida FR-12, FR-18, FR-23, FR-27.
- **SM-2**: El flujo BMAD completo (brief → PRD → arquitectura → épicas/historias → build) se recorre de punta a punta sin abandonar el proyecto a medio camino.

**Secundaria**
- **SM-3**: Las decisiones de arquitectura quedan documentadas y justificadas en `bmad-architecture`, no improvisadas durante el build.
- **SM-4**: Añadir una capacidad de Extendido v1.1 o Diferido (§5, §6.2) no requiere modificar el modelo de datos ni la arquitectura del Núcleo v1 — solo agregar sobre lo ya construido. Valida que el Núcleo quedó extensible, no solo funcional.

**Contra-métricas (no optimizar)**
- **SM-C1**: Cobertura de los 63 RFs originales de NexOS. Optimizar por "cuántos RFs quedaron implementados" en vez de por "el núcleo funciona bien" es exactamente el riesgo de pérdida de foco que el brief ya identificó. Contrapesa a SM-1.

## 8. Preguntas abiertas

Estas son de arquitectura/tecnología — se resuelven en `bmad-architecture`, no bloquean el cierre de este PRD:

1. ¿Arquitectura monolítica o de múltiples servicios independientes?
2. ¿Qué motor de base de datos y estrategia de persistencia (relacional, documental, híbrida)?
3. ¿Qué mecanismo de autenticación/sesión (tokens, sesiones de servidor, proveedor externo de identidad)?
4. ¿El sistema debe soportar múltiples organizaciones/tenants o es de instancia única?
5. Cuando se retome la capa Diferida: ¿se mantiene el conector a un CMDB externo tipo iTop, o se generaliza desde el inicio a múltiples orígenes?

## 9. Índice de supuestos

- §4.1 FR-1 — duración de sesión de referencia: 7 días, configurable.
- §4.1 FR-2 — bloqueo tras 3 intentos fallidos, 30 minutos, configurable.
- §4.1 FR-5 — expiración del enlace de recuperación: 1 hora.
- §4.1 FR-7 — expiración del enlace de invitación: 7 días.
- §4.1 FR-11 — no reutilizar últimas 3 contraseñas.
- §4.2 FR-17 — tamaño de página por defecto: 50 ítems, configurable.
- §4.4 FR-23 — profundidad máxima de topología: 5 niveles, configurable.
- §4.4 FR-26 — límite de nodos en topología: 5000, configurable.
- §2.2 — no hay usuarios reales ni intención de despliegue en producción en el horizonte de este PRD.

## 10. NFRs transversales y restricciones

*Aplican a través de todas las features del Núcleo v1; el detalle técnico de cómo satisfacerlas (proveedor de hash, motor de BD, etc.) se decide en `bmad-architecture`, no aquí.*

**Seguridad**
- Contraseñas siempre almacenadas mediante hash seguro de un solo sentido — nunca texto plano ni reversible.
- Las sesiones deben poder revocarse explícitamente (logout, cambio de contraseña) sin esperar su expiración natural.
- El mecanismo de sesión/token es un secreto de infraestructura y debe poder rotarse sin depender de que expire por tiempo — es un único punto de compromiso si no se gestiona así (riesgo heredado del brief).

**Auditabilidad**
- Ninguna acción de escritura sobre el inventario puede omitir su registro de auditoría correspondiente (principio ya capturado como FR-30, elevado aquí a principio de diseño transversal).

**Consistencia y extensibilidad de datos**
- Emails de usuario y nombres de ítems deben normalizarse de forma consistente (p. ej. a mayúsculas) antes de comparar o persistir, para evitar duplicados por variación de capitalización (afecta FR-1/FR-7 y FR-12).
- Las propiedades específicas de cada tipo de ítem se modelan de forma flexible (semi-estructurada): la lista de tipos (FR-13) debe poder crecer sin requerir migraciones de esquema.

**Rendimiento**
- Listados de inventario acotados a un máximo configurable de resultados por consulta (FR-17).
- Árboles de topología acotados en profundidad y cantidad de nodos (FR-23, FR-26).

**Disponibilidad**
- El sistema debe iniciar de forma ordenada, verificando que sus dependencias críticas estén operativas antes de aceptar tráfico.

**Aislamiento de datos**
- Si el sistema se compone de varios servicios/módulos independientes (pregunta abierta #1, §8), cada uno es responsable de sus propios datos; la consistencia entre módulos se resuelve a nivel de aplicación, no con dependencias rígidas de esquema entre ellos.

**Escalabilidad**
- Los componentes del sistema deben poder escalar de forma independiente según la carga de cada uno (relevante sobre todo si la arquitectura resulta ser de múltiples servicios).

**Usabilidad**
- Interfaz responsive; feedback de error no bloqueante (evitar alertas nativas que interrumpan el flujo).

**Portabilidad**
- Desplegable de forma reproducible en distintos entornos, sin depender de configuración manual específica de un proveedor único. Decisión de mecanismo en `bmad-architecture`.

**Resiliencia ante integraciones externas**
- El correo (usado ya en el Núcleo v1: FR-2 aviso de bloqueo, FR-5 recuperación de contraseña, FR-7 invitaciones) debe degradarse de forma controlada si el servidor de correo falla o es lento — timeout configurable y mensaje claro, sin bloquear el resto de la aplicación. Cuando se retomen las capacidades Diferidas (CMDB externo, proveedor de IA), el mismo principio aplica a esas integraciones.

**Guardrails — Seguridad de operaciones destructivas**
- Toda operación irreversible o de alto impacto (reemplazo total del inventario vía importación masiva, FR-40 a FR-42) exige confirmación explícita e inequívoca del usuario antes de ejecutarse. No aplica a ninguna operación del Núcleo v1, que no tiene endpoints destructivos masivos — queda documentado aquí porque el guardrail es un principio de diseño, no solo un FR de la feature 4.8.

**Guardrails — Privacidad**
- No aplica activamente al Núcleo v1 (no hay recolección de analítica en esta capa). Cuando se retome la capa Diferida (analítica de uso), su recolección debe tratarse conforme a políticas de privacidad y no exponer información sensible del usuario más allá de lo estrictamente necesario — dejado como principio para no perderlo, aunque hoy no hay política real que aplicar.
