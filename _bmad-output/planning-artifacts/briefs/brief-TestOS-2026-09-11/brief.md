---
title: TestOS Product Brief
status: complete
created: 2026-09-11
updated: 2026-09-11
---

# Product Brief: TestOS

## Resumen ejecutivo

TestOS es la reconstrucción, desde cero y con arquitectura limpia, de **NexOS**: una aplicación web tipo **CMDB (Configuration Management Database)** que centraliza el inventario de activos tecnológicos de una organización de TI (aplicaciones, servicios, bases de datos, servidores, clústeres, integraciones, jobs programados, etc.), modela las relaciones y dependencias entre ellos, y mantiene un historial de auditoría inmutable de todo cambio.

Este no es un producto para el mercado ni un reemplazo inmediato de NexOS en producción: es un **ejercicio deliberado de reconstrucción técnica**, usando el método BMAD y agentes de IA (Claude Code) de punta a punta — brief → PRD → arquitectura → épicas/historias → build. El conocimiento funcional de NexOS ya existe y está probado; lo que se reconstruye es la base técnica, partiendo de una hoja en blanco pero sin perder ese conocimiento acumulado (preservado íntegro en `addendum.md`).

## El problema

En el dominio original (equipo de infraestructura/TI), el inventario de activos vive disperso en hojas de cálculo y herramientas desconectadas entre sí, sin trazabilidad de cambios ni visibilidad de dependencias. Eso dificulta el análisis de impacto ante incidentes ("¿qué se cae si apago esto?"), auditar quién cambió qué, y formalizar solicitudes de cambio sobre la infraestructura.

TestOS conserva ese problema como el que el sistema debe resolver funcionalmente — es el mismo que ya resolvía NexOS (el motivo de reconstruirlo se explica en el Resumen ejecutivo).

## La solución

Una aplicación web con: inventario de ítems de configuración con propiedades dinámicas por tipo, relaciones dirigidas y tipadas con sugerencia automática, una vista de topología/árbol de dependencias navegable, y un registro de auditoría inmutable que cubre toda escritura. Sobre ese núcleo, capas adicionales (solicitudes de cambio, reportes, importación masiva, integración externa, asistente de IA) se suman en el orden que describe **Alcance**, más abajo.

## Qué cambia respecto a NexOS

No hay una ventaja de mercado que reclamar — no compite con nada, no tiene usuarios que ganarle a alguien más. Lo que cambia es:

- **Arquitectura decidida a propósito**, no heredada: el stack, el modelo de datos y los límites de servicio se deciden en la fase de arquitectura de este proyecto (BMAD `bmad-architecture`), informados por el conocimiento funcional de NexOS pero sin arrastrar sus decisiones técnicas previas.
- **Proceso spec-driven documentado**: cada decisión de alcance, diseño y prioridad queda trazada (brief → PRD → arquitectura → épicas/historias), a diferencia del conocimiento de NexOS, que solo quedó explícito al extraerse en la especificación fuente.
- **Alcance deliberadamente escalonado** (ver más abajo), en vez de construir las ~63 capacidades de NexOS de una sola vez.

## A quién sirve

Los roles son los mismos que en NexOS, conservados porque reflejan necesidades reales de un equipo de infraestructura, aunque en este ejercicio no haya usuarios reales todavía:

| Rol | Necesidad central |
|---|---|
| **Administrador** | Control total: usuarios, roles, importación masiva/externa, panel de administración de la plataforma |
| **Gestor** | Responsable funcional del inventario + gestión de usuarios (invitar, desactivar, resetear contraseña) |
| **Editor** (rol por defecto) | Mantener el inventario al día: crear, modificar, eliminar ítems y relaciones |
| **Consulta** | Solo lectura: inventario, topología, auditoría, reportes |

## Criterios de éxito

Este es un ejercicio, así que el éxito no se mide en "cuántos de los 63 requisitos originales quedaron implementados", sino en:

1. **El núcleo del CMDB funciona de verdad**: inventario, relaciones, topología y auditoría cubren el caso de uso real (no una maqueta) — alguien podría usarlo para responder "¿qué depende de este servidor?" con confianza.
2. **La arquitectura resultante es defendible**: decisiones documentadas y justificadas en la fase de arquitectura, no improvisadas sobre la marcha.
3. **El flujo BMAD completo se recorrió de extremo a extremo** (brief → PRD → arquitectura → épicas/historias → build) como validación del método en un proyecto de tamaño real, no trivial.
4. **El sistema queda en un estado extensible**: añadir las capas diferidas (integración externa, asistente de IA, etc.) más adelante no debería requerir rehacer el núcleo.

`[ASSUMPTION]` No hay fecha límite ni equipo más allá del propio usuario trabajando con agentes de IA — si esto cambia (por ejemplo, si TestOS sí llega a evaluarse como reemplazo real), los criterios de éxito deben revisarse.

## Alcance

**Núcleo v1** (lo que define si esto es un CMDB o no):
- Autenticación, sesión y RBAC de los 4 roles.
- Inventario de ítems de configuración: CRUD, tipos extensibles, propiedades dinámicas.
- Relaciones dirigidas y tipadas entre ítems, con sugerencia automática de tipo/descripción.
- Topología / árbol de dependencias navegable.
- Auditoría inmutable de toda escritura sobre inventario y relaciones.

**Extendido v1.1** (siguiente capa, una vez el núcleo funciona):
- Solicitudes de cambio con flujo de estados (Nueva → En ejecución → Completada/Rechazada) y notificación por correo.
- Reportes exportables (hoja de cálculo multi-hoja y PDF).
- Importación masiva desde archivo (reemplazo total del inventario, con confirmación explícita).

**Diferido — backlog explícito, no descartado**:
- Integración con sistema externo de CMDB/inventario (tipo iTop).
- Asistente conversacional de IA sobre el inventario.
- Preferencias de interfaz por usuario, notificaciones push, analítica de uso.
- Panel de administración de plataforma (activar/desactivar acceso global).

**Fuera de alcance** (heredado de la especificación original, sigue aplicando): auto-discovery de infraestructura, integración con APM/monitoreo en tiempo real, facturación de infraestructura, app móvil nativa (sí PWA), validación de esquema estricta por tipo de ítem.

El detalle completo de cada capacidad (63 requisitos funcionales, modelo de datos conceptual, flujos paso a paso, requisitos no funcionales, reglas de negocio, riesgos y glosario) está en `addendum.md` — copia íntegra del documento fuente original (`ESPECIFICACION_INICIAL_PROYECTO.md`) aportado por el usuario; el PRD y la arquitectura lo consumen de ahí, no hace falta repetirlo aquí.

## Riesgos clave

| Riesgo | Consideración |
|---|---|
| Subestimar el tamaño real del núcleo v1 (ya es un sistema no trivial: 5 áreas funcionales con RBAC, propiedades dinámicas y auditoría atómica) | Tratar el núcleo como el verdadero **v1** del proyecto — no comprimir plazos asumiendo que es simple porque el problema ya se conoce |
| Tomar decisiones de arquitectura implícitamente durante el build, sin pasar por `bmad-architecture` | Las preguntas abiertas de la especificación original (monolito vs. servicios, motor de BD, autenticación, multi-tenant) deben resolverse explícitamente en esa fase, no de facto en el código |
| Que el ejercicio pierda foco e intente cubrir las ~63 capacidades de NexOS antes de validar el núcleo | El escalonamiento de Alcance existe justamente para evitar esto — conviene recordar el criterio de éxito #1 antes de expandir |
| Reglas de negocio finas de NexOS (p. ej. unicidad de relación por origen+destino+tipo, snapshot de ítem en solicitudes de cambio borradas, auditoría atómica con la operación) se pierdan al reconstruir desde cero | Estas reglas están listadas en `addendum.md` sección 10 — el PRD debe citarlas explícitamente, no asumir que "se recuerdan" |

## Visión

Si el núcleo v1 es sólido, TestOS crece hasta cubrir la funcionalidad completa de NexOS sin reescribir la base — y queda además como evidencia de que este método (spec-driven, con agentes de IA) sostiene proyectos de tamaño real.

## Próximos pasos

Con este brief, el siguiente paso requerido en el flujo BMAD es `bmad-prd` (Create Edit and Review PRD), que junto con `addendum.md` debe producir el PRD formal. Después: `bmad-architecture` (resuelve las preguntas abiertas de stack/persistencia/auth) → `bmad-create-epics-and-stories` → `bmad-sprint-planning` → `bmad-build`.
