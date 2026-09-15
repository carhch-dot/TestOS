---
title: TestOS — Addendum (material fuente)
source: ESPECIFICACION_INICIAL_PROYECTO.md (aportado por el usuario, 2026-09-11)
---

## Nota de origen

Este addendum conserva íntegro el documento fuente aportado por el usuario:
una especificación funcional inicial, agnóstica de tecnología, extraída y
generalizada a partir de la aplicación existente "NexOS". El brief (`brief.md`)
es una destilación de 1-2 páginas de este material; el detalle completo
(requisitos funcionales RF-01..RF-63, modelo de datos conceptual, flujos
paso a paso, riesgos, glosario) vive aquí para que el PRD y la arquitectura
lo consuman más adelante sin perder nada.

---

# Especificación Inicial de Proyecto — Sistema de Gestión de Inventario y Configuración (CMDB)

| Campo | Valor |
|---|---|
| **Tipo de documento** | Especificación funcional inicial (pre-arquitectura, agnóstica de tecnología) |
| **Estado** | Borrador para arranque de proyecto nuevo |
| **Origen** | Extraído y generalizado a partir de la aplicación existente "NexOS" |
| **Fecha** | 2026-09-11 |

> Este documento describe **qué** debe hacer el sistema y **por qué**, sin definir lenguajes, frameworks, motores de base de datos, proveedores cloud ni herramientas específicas. El objetivo es servir de punto de partida para decidir la arquitectura y el stack tecnológico del nuevo proyecto desde cero, conservando el conocimiento funcional acumulado.

---

## 1. Resumen ejecutivo

Se requiere una aplicación web empresarial tipo **CMDB (Configuration Management Database)** que centralice el inventario de activos tecnológicos de una organización (aplicaciones, servicios, bases de datos, servidores, clústeres, integraciones, jobs programados, etc.), permita modelar las relaciones y dependencias entre ellos, mantenga un historial de auditoría inmutable, formalice los cambios mediante un flujo de solicitudes, y ofrezca reportes, importación/exportación masiva, e integración con fuentes externas de inventario.

## 2. Problema de negocio

El área de infraestructura/TI no cuenta con un inventario centralizado y confiable de sus activos tecnológicos. El conocimiento vive disperso en hojas de cálculo u otras herramientas desconectadas entre sí, sin trazabilidad de cambios ni visibilidad clara de las dependencias entre sistemas. Esto dificulta:
- El análisis de impacto ante incidentes o cambios planeados ("¿qué se cae si apago este servidor?").
- Auditar quién cambió qué y cuándo.
- Formalizar y dar seguimiento a solicitudes de cambio sobre la infraestructura.
- Tener una fuente de verdad única y actualizada, en vez de múltiples copias desincronizadas.

---

## 3. Objetivos del sistema

1. Centralizar el inventario de ítems de configuración con propiedades flexibles según el tipo de activo.
2. Modelar y visualizar las **relaciones y dependencias** entre ítems (topología / árbol de impacto).
3. Registrar de forma **inmutable** toda acción de creación, modificación y borrado (auditoría).
4. Formalizar los cambios sobre ítems mediante un **flujo de solicitudes de cambio** con notificación a responsables.
5. Permitir la **carga inicial y migración** del inventario existente desde archivos de hoja de cálculo, así como la exportación periódica a formatos de oficina/reporte.
6. Permitir la **integración con sistemas externos** de inventario/CMDB ya existentes en la organización, para importar selectivamente activos sin duplicar trabajo manual.
7. Ofrecer un **asistente conversacional** que responda preguntas en lenguaje natural sobre el estado del inventario.
8. Proveer **control de acceso granular por rol** para distintos perfiles de usuario.
9. Registrar el **uso de la aplicación** (interacciones de los usuarios) con fines de mejora de producto y soporte.

---

## 4. Alcance

### 4.1 Dentro de alcance (v1)
- Autenticación, sesión y gestión de usuarios.
- Inventario de ítems de configuración (CRUD, tipos extensibles, propiedades dinámicas).
- Relaciones dirigidas y tipadas entre ítems, con sugerencias automáticas.
- Visualización de topología / árbol de dependencias.
- Auditoría inmutable de todas las operaciones de escritura.
- Solicitudes de cambio con flujo de estados y notificación por correo.
- Reportes exportables (hoja de cálculo multi-hoja y documento PDF).
- Importación masiva desde archivo de hoja de cálculo (reemplazo total del inventario).
- Importación selectiva desde un sistema externo de CMDB/inventario ya existente en la organización.
- Asistente de IA para consultas en lenguaje natural sobre el inventario.
- Preferencias de interfaz por usuario (tema visual, vista activa, paginación, orden).
- Notificaciones push para eventos relevantes.
- Registro de interacciones de usuario (analítica de uso básica).
- Panel de administración de la plataforma (activar/desactivar acceso global, configurar destinatarios de notificaciones).

### 4.2 Fuera de alcance (v1)
- Descubrimiento automático de infraestructura (auto-discovery de red).
- Integración con herramientas de monitoreo de rendimiento (APM, alerting de infraestructura en tiempo real).
- Facturación o gestión de costos de infraestructura.
- Aplicación móvil nativa (se contempla acceso web responsive / instalable tipo PWA).
- Validación de esquema estricta por tipo de ítem (se documenta como mejora futura).

---

## 5. Usuarios y roles

| Rol | Descripción | Capacidades clave |
|---|---|---|
| **Administrador** | Administra la plataforma completa | Todo lo del gestor + gestión de roles, activar/desactivar la plataforma, importación masiva/externa |
| **Gestor** | Responsable funcional del inventario | Todo lo del editor + gestión de usuarios (invitar, desactivar, resetear contraseña) |
| **Editor** | Operador de inventario (rol por defecto) | Leer, crear, modificar y eliminar ítems y relaciones |
| **Consulta / Solo lectura** | Perfil de consulta | Solo lectura de ítems, topología, auditoría y reportes |

Reglas generales de acceso:
- La lectura del inventario, topología y auditoría está disponible para todos los roles autenticados.
- La escritura (crear/editar/eliminar ítems y relaciones) está vedada al rol de solo lectura.
- La importación masiva o desde sistemas externos queda restringida al rol administrador, por su naturaleza destructiva/de alto impacto.
- La gestión de usuarios está reservada a administrador y gestor; el cambio de rol de un usuario es exclusivo del administrador.
- Activar/desactivar el acceso global a la plataforma y configurar destinatarios de notificaciones de cambio es exclusivo del administrador.
- Cuando la plataforma está deshabilitada globalmente, solo el administrador puede iniciar sesión (el resto de usuarios recibe un mensaje de "servicio no disponible").

---

## 6. Requisitos funcionales

### 6.1 Autenticación y sesión
- RF-01 — El sistema debe permitir iniciar sesión con email y contraseña, emitiendo una sesión/token válida por un periodo configurable (referencia: 7 días).
- RF-02 — El sistema debe bloquear temporalmente una cuenta tras un número configurable de intentos fallidos consecutivos (referencia: 3 intentos → bloqueo de 30 minutos), notificando al usuario por correo.
- RF-03 — El sistema debe permitir cerrar sesión, invalidando la sesión/token activo de forma inmediata.
- RF-04 — El sistema debe renovar la sesión de forma transparente para el usuario mientras la sesión siga vigente, sin exigir un nuevo login constantemente.
- RF-05 — El sistema debe permitir recuperar la contraseña mediante un enlace de un solo uso enviado por correo, con expiración corta (referencia: 1 hora), sin revelar si el correo existe o no en el sistema.

### 6.2 Gestión de usuarios
- RF-06 — El sistema debe permitir invitar nuevos usuarios por correo electrónico, con un enlace de activación de un solo uso y expiración configurable (referencia: 7 días).
- RF-07 — El sistema debe permitir listar, desactivar y reactivar usuarios.
- RF-08 — El sistema debe permitir cambiar el rol de un usuario (exclusivo de administrador).
- RF-09 — El sistema debe permitir a un administrador/gestor forzar el restablecimiento de la contraseña de otro usuario.
- RF-10 — El sistema debe impedir la reutilización de las últimas N contraseñas de un usuario (referencia: últimas 3) al cambiar su contraseña.
- RF-11 — El sistema debe aplicar una política mínima de complejidad de contraseña (longitud mínima, mayúscula, carácter especial, como referencia).
- RF-12 — El sistema debe permitir el arranque inicial (bootstrap) creando automáticamente el primer usuario administrador si no existe ninguno.

### 6.3 Inventario de ítems de configuración
- RF-13 — El sistema debe soportar operaciones CRUD completas sobre ítems de configuración.
- RF-14 — El sistema debe soportar múltiples tipos de ítem predefinidos (referencia: 19+ tipos, p. ej. aplicación, API, servicio, base de datos, servidor virtual, clúster, integración, job programado, servidor de jobs, balanceador, directorio LDAP, contenedor/orquestador, etc.), permitiendo agregar nuevos tipos sin requerir cambios estructurales profundos.
- RF-15 — Cada ítem debe soportar **propiedades dinámicas** dependientes de su tipo, además de un conjunto de campos comunes (nombre, descripción, empresa/dominio propietario, dirección de red, etc.).
- RF-16 — El sistema debe permitir búsqueda y filtrado de ítems por tipo y por texto libre.
- RF-17 — Las actualizaciones parciales de propiedades deben fusionarse (merge) con las existentes, sin requerir reenviar el objeto completo.
- RF-18 — Los listados de ítems deben soportar límites y paginación configurables para evitar respuestas excesivamente grandes.

### 6.4 Relaciones entre ítems
- RF-19 — El sistema debe permitir crear relaciones dirigidas y tipadas entre dos ítems (origen → destino, con un tipo de relación).
- RF-20 — El sistema debe impedir duplicar el mismo tipo de relación entre el mismo par de ítems.
- RF-21 — El sistema debe sugerir automáticamente el tipo y la descripción de una relación en función de los tipos de los ítems origen/destino (p. ej. "servidor aloja servicio", "aplicación depende de base de datos").
- RF-22 — El sistema debe permitir editar y eliminar relaciones existentes.
- RF-23 — El sistema debe soportar tipos de relación de referencia extensibles (aloja, depende de, alojado en, pertenece a clúster, se integra con, se conecta a, entre otros).

### 6.5 Topología y árbol de dependencias
- RF-24 — El sistema debe exponer una vista de árbol/grafo de relaciones navegable a partir de un ítem raíz o de un tipo, con profundidad configurable (referencia: máximo 5 niveles).
- RF-25 — El sistema debe permitir consultar los vecinos directos de un ítem dado.
- RF-26 — El sistema debe permitir una búsqueda global de ítems dentro de la vista de topología.
- RF-27 — Los árboles de topología deben tener un límite de nodos configurable para proteger el rendimiento (referencia: 5000 nodos).

### 6.6 Auditoría
- RF-28 — El sistema debe registrar en un historial inmutable toda operación de creación, modificación, eliminación y relación (y sus variantes de edición/eliminación) sobre ítems y relaciones.
- RF-29 — Cada entrada de auditoría debe incluir, como mínimo: usuario que ejecutó la acción, tipo de acción, entidad afectada, fecha/hora y un detalle del cambio (payload).
- RF-30 — El registro de auditoría debe ser consultable y filtrable, y no debe poder editarse ni borrarse manualmente (excepto en el contexto de una reimportación masiva completa del inventario).
- RF-31 — Ninguna operación de escritura sobre el inventario puede omitir su correspondiente registro de auditoría; dicho registro debe considerarse parte atómica de la misma operación, no un proceso aparte que pueda fallar de forma independiente y silenciosa.

### 6.7 Solicitudes de cambio
- RF-32 — El sistema debe permitir a cualquier usuario autenticado generar una solicitud de cambio sobre un ítem del inventario.
- RF-33 — El sistema debe notificar por correo a los destinatarios configurados cuando se crea una nueva solicitud de cambio.
- RF-34 — El sistema debe implementar un flujo de estados para las solicitudes: *Nueva → En ejecución → Completada*, o *Nueva → Rechazada*, con estados terminales que no permiten más transiciones.
- RF-35 — Las transiciones de estado deben validarse en el servidor, sin confiar en lo que envíe el cliente.
- RF-36 — El sistema debe notificar por correo los cambios de estado relevantes de una solicitud.
- RF-37 — El sistema debe permitir eliminar (baja lógica) una solicitud de cambio, conservando su historial.
- RF-38 — Una solicitud de cambio debe conservar un "snapshot" del nombre/tipo del ítem al que se refiere, para seguir siendo legible aunque el ítem original sea eliminado posteriormente.

### 6.8 Reportes y exportación
- RF-39 — El sistema debe generar un reporte descargable en formato de hoja de cálculo con al menos dos hojas: activos y relaciones.
- RF-40 — El sistema debe generar un reporte descargable en formato de documento (PDF) con una plantilla predefinida.

### 6.9 Importación masiva (carga desde archivo)
- RF-41 — El sistema debe permitir importar un archivo de hoja de cálculo que **reemplace por completo** el inventario existente (activos, relaciones y jerarquías).
- RF-42 — El proceso de importación debe ejecutarse por pasos claramente identificables (validación del archivo, limpieza del inventario actual, carga de activos, reconstrucción de relaciones explícitas, inferencia de relaciones jerárquicas implícitas), reportando el resultado de cada paso.
- RF-43 — Dado que la importación es destructiva, el sistema debe exigir una confirmación explícita e inequívoca del usuario antes de ejecutarla.
- RF-44 — El sistema debe reportar el detalle y resultado de cada paso de la importación, para que el usuario pueda diagnosticar fallos parciales.

### 6.10 Integración con sistemas externos de inventario/CMDB
- RF-45 — El sistema debe permitir conectarse a un sistema externo de inventario/CMDB ya existente en la organización (mediante credenciales o token configurables) para descubrir sus clasificaciones/tipos de activos disponibles.
- RF-46 — El sistema debe permitir seleccionar una o varias clasificaciones específicas del sistema externo para importar, en vez de forzar una importación total.
- RF-47 — El sistema debe permitir filtrar los activos a importar por prefijo de nombre u otro criterio simple.
- RF-48 — El sistema debe permitir configurar un tiempo máximo de espera (timeout) para las operaciones contra el sistema externo.
- RF-49 — El sistema debe permitir importar únicamente relaciones entre activos ya existentes (sin reimportar los activos en sí), como modo alternativo de sincronización.
- RF-50 — El sistema debe reportar, por clasificación importada, cuántos elementos fueron procesados, creados, actualizados y cuáles tuvieron errores.
- RF-51 — El sistema debe permitir enriquecer los datos importados con información adicional relevante del dominio (p. ej. datos de middleware/plataforma de ejecución asociada) cuando esté disponible en el sistema externo.

### 6.11 Asistente conversacional (IA)
- RF-52 — El sistema debe ofrecer un asistente conversacional en lenguaje natural que responda preguntas sobre el estado actual del inventario (conteos, existencia de un ítem, relaciones, etc.), usando el contenido real del inventario como contexto de la respuesta.
- RF-53 — El asistente debe operar sobre una muestra o subconjunto acotado del inventario por motivos de rendimiento, y debe indicar de forma clara si su respuesta no puede garantizarse exhaustiva.
- RF-54 — El asistente debe mantener el hilo de la conversación (historial de turnos) dentro de una misma sesión de chat.
- RF-55 — El sistema debe informar de forma clara si el asistente no está configurado o disponible, sin afectar el resto de la funcionalidad de la aplicación.

### 6.12 Preferencias de usuario
- RF-56 — El sistema debe persistir por usuario: tema visual seleccionado, vista activa por defecto, tamaño de página de los listados y criterio de orden.
- RF-57 — Estas preferencias deben aplicarse automáticamente la próxima vez que el usuario inicie sesión, en cualquier dispositivo.

### 6.13 Notificaciones push
- RF-58 — El sistema debe poder enviar notificaciones push a los usuarios para eventos relevantes (p. ej. nueva solicitud de cambio, cambio de estado).
- RF-59 — Las notificaciones deben poder recibirse tanto con la aplicación abierta (primer plano) como cerrada o en segundo plano.

### 6.14 Analítica de uso
- RF-60 — El sistema debe registrar eventos de interacción del usuario (clics/acciones relevantes en la interfaz), identificando usuario, elemento interactuado y página, con fines de mejora de producto y soporte.
- RF-61 — El registro de analítica de uso no debe degradar la experiencia del usuario ni bloquear la funcionalidad principal si falla.

### 6.15 Administración de la plataforma
- RF-62 — El sistema debe permitir a un administrador activar o desactivar el acceso a la plataforma de forma global.
- RF-63 — El sistema debe permitir a un administrador configurar la lista de destinatarios de las notificaciones de solicitudes de cambio.

---

## 7. Requisitos no funcionales

| Categoría | Requisito |
|---|---|
| **Seguridad** | Las contraseñas deben almacenarse siempre mediante un algoritmo de hash seguro y de un solo sentido (nunca en texto plano ni reversible). Las sesiones deben poder revocarse de forma explícita (logout, cambio de contraseña) sin esperar a su expiración natural. |
| **Aislamiento de datos** | Si el sistema se compone de varios servicios/módulos independientes, cada uno debe ser responsable de sus propios datos; la consistencia entre módulos debe resolverse a nivel de aplicación, no mediante dependencias rígidas de esquema entre ellos. |
| **Disponibilidad** | El sistema debe iniciar de forma ordenada, verificando que sus dependencias críticas estén operativas antes de aceptar tráfico de usuarios. |
| **Escalabilidad** | Los componentes del sistema deben poder escalar de forma independiente según la carga de cada uno. |
| **Rendimiento** | Los listados de inventario deben acotarse a un número máximo configurable de resultados por consulta; los árboles de topología deben acotarse en profundidad y cantidad de nodos. |
| **Mantenibilidad** | La documentación funcional y técnica debe mantenerse viva y sincronizada con el estado real del sistema. |
| **Usabilidad** | La interfaz debe ser responsive, con temas visuales seleccionables y persistentes por usuario, y feedback no bloqueante ante errores (evitar interrumpir el flujo del usuario con alertas nativas). |
| **Portabilidad** | El sistema debe poder desplegarse de forma reproducible en distintos entornos, sin depender de configuraciones manuales específicas de un único proveedor. |
| **Auditabilidad** | Ninguna acción de escritura sobre el inventario puede omitir su registro de auditoría correspondiente. |
| **Privacidad** | Los datos de analítica de uso (clics, interacciones) deben tratarse conforme a las políticas internas de privacidad de la organización; su recolección no debe exponer información sensible del usuario más allá de lo estrictamente necesario. |
| **Resiliencia ante integraciones externas** | Las fallas o lentitud de sistemas externos (CMDB externo, proveedor de IA, servidor de correo) no deben tumbar ni bloquear el resto de la aplicación; deben degradarse de forma controlada, con timeouts y mensajes claros. |

---

## 8. Modelo de datos conceptual (agnóstico de motor de base de datos)

### 8.1 Entidades principales

- **Usuario**: identidad de una persona que accede al sistema. Atributos clave: identificador único, email (único), contraseña (hash), rol, estado (activo/pendiente de verificación/bloqueado/desactivado), tema visual preferido, contador de intentos fallidos, historial de contraseñas previas (hashes).
- **Ítem de configuración**: unidad de inventario. Atributos clave: identificador único, tipo/clasificación, nombre, descripción, empresa/dominio propietario, dirección de red (cuando aplique), propiedades específicas del tipo (estructura flexible/semi-estructurada).
- **Relación entre ítems**: vínculo dirigido y tipado entre dos ítems de configuración. Clave natural: (origen, destino, tipo) — no debe repetirse.
- **Registro de auditoría**: entrada inmutable de log. Atributos clave: identificador, usuario que ejecutó la acción, tipo de acción, entidad afectada, detalle/payload del cambio, fecha/hora.
- **Solicitud de cambio**: petición formal de modificación sobre un ítem. Atributos clave: identificador, referencia al ítem (con snapshot de nombre/tipo), estado, solicitante, fecha, marca de baja lógica.
- **Sesión revocada / token invalidado**: registro de sesiones que ya no deben considerarse válidas aunque no hayan expirado por tiempo.
- **Configuración de la plataforma**: parámetros globales clave-valor (plataforma activa/inactiva, destinatarios de notificaciones de cambio, etc.).
- **Evento de interacción de usuario**: registro de analítica de uso (usuario, elemento, página, fecha/hora).

### 8.2 Relaciones entre entidades

- Un **usuario** genera múltiples **registros de auditoría** (relación lógica, no necesariamente una dependencia estructural estricta).
- Un **ítem de configuración** participa como origen o destino de múltiples **relaciones entre ítems**.
- Un **ítem de configuración** puede tener múltiples **solicitudes de cambio** asociadas (referencia "suave", debe sobrevivir a la eliminación del ítem original).
- Un **ítem de configuración** puede ser objeto de múltiples **registros de auditoría**.

### 8.3 Consideraciones de diseño de datos a preservar

- Las propiedades específicas de cada tipo de ítem deben modelarse de forma flexible (estructura semi-estructurada), dado que existen 19+ tipos con atributos heterogéneos y se espera que la lista de tipos siga creciendo sin requerir migraciones constantes de esquema.
- La auditoría y el historial no deben permitir actualización ni borrado bajo operación normal (solo se considera excepción válida una reimportación masiva completa, documentada como tal).
- Los nombres de usuarios (email) y de ítems deben normalizarse de forma consistente (p. ej. mayúsculas) para evitar duplicados por variación de capitalización.
- Las referencias entre entidades que deben "sobrevivir" a la eliminación de la entidad original (p. ej. una solicitud de cambio sobre un ítem que luego se borra) deben resolverse mediante snapshot de los datos relevantes en el momento del evento, no mediante una dependencia estructural rígida.

---

## 9. Flujos clave (descripción funcional, no técnica)

### 9.1 Creación de un ítem de configuración
1. El usuario con permisos de escritura solicita crear un ítem, indicando tipo y propiedades.
2. El sistema valida el permiso del usuario según su rol.
3. El sistema crea el ítem.
4. El sistema registra la auditoría de la creación como parte de la misma operación (no como paso independiente que pueda omitirse).
5. El sistema confirma la creación al usuario.

### 9.2 Solicitud de cambio
1. Un usuario autenticado crea una solicitud de cambio sobre un ítem existente.
2. El sistema notifica por correo a los destinatarios configurados.
3. Un responsable revisa la solicitud y la mueve a "en ejecución" (transición validada en servidor).
4. El sistema notifica el cambio de estado.
5. El responsable marca la solicitud como completada o rechazada (estado terminal).

### 9.3 Importación masiva desde archivo
1. El usuario administrador sube un archivo de inventario.
2. El sistema valida el archivo y solicita confirmación explícita, advirtiendo que el inventario actual será reemplazado.
3. El sistema limpia el inventario actual.
4. El sistema carga los nuevos activos.
5. El sistema reconstruye las relaciones explícitas del archivo.
6. El sistema infiere relaciones jerárquicas implícitas razonables (p. ej. "alojado en", "pertenece a clúster").
7. El sistema reporta el resultado de cada paso para diagnóstico.

### 9.4 Importación selectiva desde sistema externo
1. El usuario administrador configura la conexión al sistema externo (credenciales/token, tiempo de espera).
2. El sistema descubre las clasificaciones disponibles en el sistema externo.
3. El usuario selecciona una o varias clasificaciones a importar, y opcionalmente un filtro por nombre.
4. El sistema importa los activos (y, si se solicita, sus relaciones), reportando procesados/creados/actualizados/errores por clasificación.
5. Opcionalmente, el sistema enriquece los activos importados con información adicional del dominio disponible en el sistema externo.

### 9.5 Consulta al asistente de IA
1. El usuario formula una pregunta en lenguaje natural sobre el inventario.
2. El sistema recopila un contexto relevante y acotado del inventario actual.
3. El sistema genera una respuesta basada en ese contexto, manteniendo el hilo de la conversación.
4. Si el asistente no está disponible o configurado, el sistema lo informa claramente sin afectar el resto de la aplicación.

---

## 10. Reglas de negocio a preservar

- La importación masiva desde archivo es **destructiva** (reemplaza todo el inventario) — decisión de diseño intencional para que el archivo sea la fuente de verdad en cada importación; debe exigir confirmación explícita.
- Una relación entre dos ítems es única por combinación de (origen, destino, tipo); no se permiten duplicados exactos.
- Ninguna mutación del inventario puede quedar sin su correspondiente registro de auditoría.
- Las transiciones de estado de una solicitud de cambio se validan siempre en el servidor, nunca confiando en lo enviado por el cliente.
- Cuando la plataforma está desactivada globalmente, solo el administrador puede seguir accediendo.
- No debe revelarse si un correo electrónico está o no registrado en el sistema al solicitar recuperación de contraseña (respuesta uniforme).
- Una cuenta se bloquea temporalmente tras varios intentos fallidos de inicio de sesión consecutivos.

---

## 11. Riesgos y consideraciones de diseño

| Riesgo | Consideración de mitigación |
|---|---|
| La importación masiva desde archivo borra todo el inventario existente | Exigir confirmación explícita en la interfaz + reporte detallado por pasos para diagnóstico |
| Ausencia de dependencias estructurales rígidas entre entidades puede generar referencias "huérfanas" (p. ej. auditoría de un usuario eliminado) | Los registros deben conservar snapshots de los datos relevantes en el momento del evento, no depender de una consulta en vivo al registro original |
| Las propiedades flexibles por tipo de ítem no tienen validación de esquema estricta | Documentar el catálogo de tipos y sus campos esperados; considerar validación de esquema como mejora futura |
| Dependencia de sistemas externos (CMDB externo, proveedor de IA, correo) | Definir timeouts, mensajes de error claros y degradación controlada sin afectar el resto de la aplicación |
| Un único punto de compromiso en el mecanismo de sesión/token | Debe gestionarse como secreto de infraestructura, con posibilidad de rotación |

---

## 12. Preguntas abiertas para el nuevo proyecto

Estas decisiones se dejan deliberadamente fuera de este documento por ser de arquitectura/tecnología, pero deben resolverse antes de avanzar:

1. ¿Arquitectura monolítica o de múltiples servicios independientes?
2. ¿Qué motor de base de datos y estrategia de persistencia (relacional, documental, híbrida)?
3. ¿Qué mecanismo de autenticación/sesión se usará (tokens, sesiones de servidor, proveedor externo de identidad)?
4. ¿Se mantiene la integración con un sistema externo de CMDB tipo iTop, o se generaliza a un conector configurable para múltiples orígenes?
5. ¿Qué proveedor (o ninguno) se usará para el asistente conversacional de IA?
6. ¿Dónde y por cuánto tiempo se retienen los datos de analítica de uso, y bajo qué política de privacidad?
7. ¿El sistema debe soportar múltiples organizaciones/tenants o es de instancia única por organización?

---

## 13. Roadmap / evolución futura sugerida

- Validación de esquema por tipo de ítem (reglas específicas de campos esperados según clasificación).
- Descubrimiento automático de infraestructura (auto-discovery).
- Métricas y dashboards operativos sobre el propio inventario (uso, cambios por período, ítems sin dueño).
- Generalización de la integración externa a múltiples orígenes de CMDB, no solo uno.
- Rotación de credenciales/secretos de sesión sin tiempo de inactividad.

---

## 14. Glosario

| Término | Definición |
|---|---|
| CMDB | Configuration Management Database — base de datos de gestión de configuración |
| Ítem de configuración (CI) | Unidad de inventario: aplicación, servidor, base de datos, integración, etc. |
| Solicitud de cambio | Petición formal de modificación sobre un ítem, con flujo de aprobación/ejecución |
| Auditoría | Registro inmutable de quién hizo qué y cuándo sobre el inventario |
| Topología | Representación visual de las relaciones/dependencias entre ítems |
| RBAC | Control de acceso basado en roles |
