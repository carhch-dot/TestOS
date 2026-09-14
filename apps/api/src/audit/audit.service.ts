import { Injectable } from '@nestjs/common';
import { Prisma, TipoAccion } from '@prisma/client';

/**
 * The canonical shape every caller passes to `AuditService.record` (spec-2-1
 * Boundaries). `fecha` is intentionally absent — it is a DB default
 * (`now()`), never caller-supplied, so nothing can backdate an entry.
 * `cambios` is left as `Prisma.InputJsonValue` — a caller-shaped JSON blob,
 * not a project-defined interface (spec-2-1 Design Notes, consistent with
 * AD-8's precedent for `ItemConfiguracion.properties`).
 */
export type RecordAuditParams = {
  usuarioId: string;
  tipoAccion: TipoAccion;
  entidad: string;
  entidadId: string;
  cambios: Prisma.InputJsonValue;
};

/**
 * `AuditModule`'s only write path (spec-2-1, FR-27–FR-30). Every write goes
 * through the caller's own `Prisma.TransactionClient` — never a fresh
 * top-level `PrismaService` client — so the audit row lives or dies with the
 * domain write it accompanies inside the same transaction. There is no
 * separate async path to fail silently, and no controller/HTTP endpoint
 * anywhere ever calls this: reading is a later story's job, and writing is
 * never exposed over HTTP at all.
 */
@Injectable()
export class AuditService {
  async record(
    tx: Prisma.TransactionClient,
    params: RecordAuditParams,
  ): Promise<void> {
    // A bad row here is permanent — this table is append-only by design, so
    // there is no later fix-up path (spec-2-1 Boundaries). Catch an obvious
    // caller mistake before it's baked in forever, without over-validating
    // `cambios`, whose shape is intentionally caller-defined.
    if (params.entidad.length === 0 || params.entidadId.length === 0) {
      throw new Error(
        'AuditService.record: entidad and entidadId must not be empty.',
      );
    }

    await tx.registroAuditoria.create({
      data: {
        usuarioId: params.usuarioId,
        tipoAccion: params.tipoAccion,
        entidad: params.entidad,
        entidadId: params.entidadId,
        cambios: params.cambios,
      },
    });
  }
}
