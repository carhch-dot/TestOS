---
title: TestOS PRD — Addendum
---

# Nota de origen y trazabilidad

El detalle técnico completo (63 requisitos funcionales originales, modelo de datos conceptual, flujos paso a paso, requisitos no funcionales, reglas de negocio, riesgos, glosario) vive en el addendum del brief, no se duplica aquí:

`../../briefs/brief-TestOS-2026-09-11/addendum.md`

Este addendum del PRD agrega solo lo que no encajaba en `prd.md` sin inflarlo: el mapeo RF→FR para no perder trazabilidad al renumerar, y el resumen de las capacidades Diferidas (fuera del Núcleo v1 y de Extendido v1.1) para que quien retome esa capa no tenga que reabrir el brief desde cero.

## Mapeo RF (documento original) → FR (este PRD)

| RF original | FR en este PRD |
|---|---|
| RF-01 | FR-1 |
| RF-02 | FR-2 |
| RF-03 | FR-3 |
| RF-04 | FR-4 |
| RF-05 | FR-5 |
| RF-12 | FR-6 |
| RF-06 | FR-7 |
| RF-07 | FR-8 |
| RF-08 | FR-9 |
| RF-09 | FR-10 |
| RF-10, RF-11 | FR-11 |
| RF-13 | FR-12 |
| RF-14 | FR-13 |
| RF-15 | FR-14 |
| RF-16 | FR-15 |
| RF-17 | FR-16 |
| RF-18 | FR-17 |
| RF-19 | FR-18 |
| RF-20 | FR-19 |
| RF-21 | FR-20 |
| RF-22 | FR-21 |
| RF-23 | FR-22 |
| RF-24 | FR-23 |
| RF-25 | FR-24 |
| RF-26 | FR-25 |
| RF-27 | FR-26 |
| RF-28 | FR-27 |
| RF-29 | FR-28 |
| RF-30 | FR-29 |
| RF-31 | FR-30 |
| RF-32 | FR-31 |
| RF-33 | FR-32 |
| RF-34 | FR-33 |
| RF-35 | FR-34 |
| RF-36 | FR-35 |
| RF-37 | FR-36 |
| RF-38 | FR-37 |
| RF-39 | FR-38 |
| RF-40 | FR-39 |
| RF-41 | FR-40 |
| RF-42 | FR-41 |
| RF-43 | FR-42 |
| RF-44 | FR-41 |
| RF-45 a RF-51 (integración CMDB externo) | No convertidos a FR — capacidad Diferida, ver abajo |
| RF-52 a RF-55 (asistente de IA) | No convertidos a FR — capacidad Diferida, ver abajo |
| RF-56, RF-57 (preferencias de usuario) | No convertidos a FR — capacidad Diferida, ver abajo |
| RF-58, RF-59 (notificaciones push) | No convertidos a FR — capacidad Diferida, ver abajo |
| RF-60, RF-61 (analítica de uso) | No convertidos a FR — capacidad Diferida, ver abajo |
| RF-62, RF-63 (administración de plataforma) | No convertidos a FR — capacidad Diferida, ver abajo |

## Capacidades Diferidas — resumen para retomar sin reabrir el brief

Estas capacidades están documentadas en detalle (RF-45 a RF-63) en el addendum del brief. Resumen de una línea cada una, para decidir cuándo retomarlas sin releer todo:

- **Integración con CMDB externo (tipo iTop)** — conectar a un sistema externo ya existente, descubrir sus clasificaciones, importar selectivamente (con filtro por nombre y timeout configurable), y reportar procesados/creados/actualizados/errores por clasificación. Requiere que el Núcleo v1 (inventario + relaciones) ya exista, porque importa hacia esas mismas estructuras.
- **Asistente conversacional de IA** — preguntas en lenguaje natural sobre el inventario, con contexto acotado por rendimiento y manejo de hilo de conversación. Depende de un proveedor de IA a decidir en `bmad-architecture` — pregunta abierta #5 del PRD.
- **Preferencias de interfaz por usuario** — tema visual, vista activa, paginación, orden — persistentes y aplicadas automáticamente en cualquier dispositivo.
- **Notificaciones push** — para eventos como nueva solicitud de cambio o cambio de estado; deben funcionar con la app abierta o en segundo plano.
- **Analítica de uso** — registro de interacciones (clic, elemento, página) sin degradar la experiencia ni bloquear funcionalidad si falla. Ver nota de privacidad en `prd.md` §10.
- **Panel de administración de plataforma** — activar/desactivar acceso global, configurar destinatarios de notificación de solicitudes de cambio. El *efecto* de "plataforma desactivada" en el login ya es NFR del Núcleo v1 (`prd.md` §4.1); lo Diferido es solo el panel para accionarlo.

Estas seis capacidades no tienen orden de prioridad relativo entre sí todavía — se decide cuando el Núcleo v1 y Extendido v1.1 estén construidos y validados.
