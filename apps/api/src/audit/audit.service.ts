import { Injectable } from '@nestjs/common';
import { Prisma, TipoAccion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
 * Optional AND-combined filters for `list` (spec-2-2 Boundaries). All are
 * caller-supplied via `AuditController`, which has already validated
 * `tipoAccion` against the `TipoAccion` enum and parsed `desde`/`hasta` into
 * real `Date`s before this service ever sees them — `list` trusts its
 * caller's shape rather than re-validating.
 */
export type AuditListFilters = {
  usuarioId?: string;
  entidad?: string;
  entidadId?: string;
  tipoAccion?: TipoAccion;
  desde?: Date;
  hasta?: Date;
};

// Mirrors `RegistroAuditoria` plus the joined `usuario.id`/`usuario.email`
// (spec-2-2 Boundaries: "a bare usuarioId UUID isn't useful"). `cambios`
// stays `Prisma.JsonValue` — read-back mirror of the caller-shaped envelope
// `record` accepts, per spec-2-1 Design Notes.
export type AuditListItem = {
  id: string;
  usuarioId: string;
  usuario: { id: string; email: string };
  tipoAccion: TipoAccion;
  entidad: string;
  entidadId: string;
  cambios: Prisma.JsonValue;
  fecha: Date;
};

export type AuditListResult = {
  data: AuditListItem[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * `AuditModule`'s write and read paths (spec-2-1/spec-2-2, FR-27–FR-30).
 * `record` writes go through the caller's own `Prisma.TransactionClient` —
 * never a fresh top-level `PrismaService` client — so the audit row lives or
 * dies with the domain write it accompanies inside the same transaction.
 * There is no separate async path to fail silently, and no write path is
 * ever exposed over HTTP. `list`, added in spec-2-2, is the one read path and
 * goes through the injected `PrismaService` directly (no transaction needed
 * for a read).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

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

  /**
   * Paginated, most-recent-first (`fecha desc`) listing of `RegistroAuditoria`
   * (spec-2-2, FR-29), with every supplied filter AND-combined into a single
   * `where` clause — omitting a filter's key entirely (rather than passing
   * `undefined` through) is what makes "no filter supplied" behave as "match
   * everything" under Prisma.
   */
  async list(
    filters: AuditListFilters,
    page: number,
    pageSize: number,
  ): Promise<AuditListResult> {
    const where: Prisma.RegistroAuditoriaWhereInput = {
      ...(filters.usuarioId !== undefined && {
        usuarioId: filters.usuarioId,
      }),
      ...(filters.entidad !== undefined && { entidad: filters.entidad }),
      ...(filters.entidadId !== undefined && {
        entidadId: filters.entidadId,
      }),
      ...(filters.tipoAccion !== undefined && {
        tipoAccion: filters.tipoAccion,
      }),
      ...((filters.desde !== undefined || filters.hasta !== undefined) && {
        fecha: {
          ...(filters.desde !== undefined && { gte: filters.desde }),
          ...(filters.hasta !== undefined && { lte: filters.hasta }),
        },
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.registroAuditoria.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        // `id` as a tie-breaker: two rows sharing an identical `fecha`
        // (millisecond precision) would otherwise risk being skipped or
        // duplicated across paginated pages.
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        include: { usuario: { select: { id: true, email: true } } },
      }),
      this.prisma.registroAuditoria.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        usuarioId: row.usuarioId,
        usuario: row.usuario,
        tipoAccion: row.tipoAccion,
        entidad: row.entidad,
        entidadId: row.entidadId,
        cambios: row.cambios,
        fecha: row.fecha,
      })),
      total,
      page,
      pageSize,
    };
  }
}
