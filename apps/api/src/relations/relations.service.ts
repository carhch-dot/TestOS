import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Relacion, TipoAccion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  RELATION_TYPE_CATALOG,
  suggestRelation,
} from './relation-type-catalog';

// Caller-shaped input for `RelationsService.create` — `tipo` is validated
// against `RELATION_TYPE_CATALOG` inside the service (spec Boundaries), not
// by any type system construct here, mirroring `InventoryService`'s
// `CreateItemInput`.
export type CreateRelationInput = {
  origenId: string;
  destinoId: string;
  tipo: string;
  descripcion?: string;
};

// Caller-shaped input for `RelationsService.update` (spec-4-2). Every field
// is optional — `RelationsController` has already turned "absent from the
// request body" into `undefined` before this service ever sees it, so
// `!== undefined` is exactly "this field was actually supplied", mirroring
// `InventoryService`'s `UpdateItemInput`. Deliberately has no
// `origenId`/`destinoId` — those are immutable (spec Boundaries/Never).
export type UpdateRelationInput = {
  tipo?: string;
  descripcion?: string;
};

export const INVALID_TIPO_MESSAGE = (tipo: string): string =>
  `'${tipo}' is not a recognized relation type.`;

export const SELF_RELATION_MESSAGE =
  'origenId and destinoId must be different items.';

export const ORIGEN_NOT_FOUND_MESSAGE = 'origenId does not match any item.';

export const DESTINO_NOT_FOUND_MESSAGE = 'destinoId does not match any item.';

export const RELATION_ALREADY_EXISTS_MESSAGE = 'This relation already exists.';

export const RELATION_ITEM_VANISHED_MESSAGE =
  'origenId or destinoId no longer matches an existing item.';

export const RELATION_NOT_FOUND_MESSAGE = 'Relation not found.';

/**
 * `RelationsModule`'s sole write path onto `Relacion` (spec-4-1, FR-18–20/22)
 * — the module is its exclusive owner (AD-1); no other module ever writes it
 * directly via Prisma.
 *
 * `create` mirrors `InventoryService.create`'s shape throughout: `tipo`
 * validated against the static catalog before any DB access; existence of
 * both endpoints checked via `findUnique` before the transaction starts;
 * duplicate `(origenId, destinoId, tipo)` caught up front via a
 * case-sensitive `findFirst` (an exact triple match — `tipo` is a fixed
 * catalog value, not free text needing case-insensitive comparison), then
 * backed by the real `@unique` DB constraint as a `P2002` race backstop. The
 * relation insert and its `RegistroAuditoria` entry happen inside one
 * `prisma.$transaction` (AD-3).
 */
@Injectable()
export class RelationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(usuarioId: string, dto: CreateRelationInput): Promise<Relacion> {
    // Trimmed once, up front — same reasoning as `InventoryService.create`'s
    // `nombre`: the catalog/existence/duplicate checks and the persisted
    // value must all agree, or a whitespace-padded id/tipo would be
    // rejected with a confusing "not found"/"not recognized" instead of
    // just working. Must happen before the catalog check below, or a
    // padded tipo would fail validation even though its trimmed form is a
    // recognized catalog value.
    const origenId = dto.origenId.trim();
    const destinoId = dto.destinoId.trim();
    const tipo = dto.tipo.trim();

    if (!RELATION_TYPE_CATALOG.includes(tipo)) {
      throw new BadRequestException(INVALID_TIPO_MESSAGE(tipo));
    }

    if (origenId === destinoId) {
      throw new BadRequestException(SELF_RELATION_MESSAGE);
    }

    // Existence of both endpoints, checked read-only before any write
    // (spec Boundaries: "a read-only existence check on another module's
    // entity is not a write, so this does not violate AD-1"), same lookup
    // pattern as `InventoryService.update`.
    const [origen, destino] = await Promise.all([
      this.prisma.itemConfiguracion.findUnique({
        where: { id: origenId },
      }),
      this.prisma.itemConfiguracion.findUnique({
        where: { id: destinoId },
      }),
    ]);
    if (!origen) {
      throw new NotFoundException(ORIGEN_NOT_FOUND_MESSAGE);
    }
    if (!destino) {
      throw new NotFoundException(DESTINO_NOT_FOUND_MESSAGE);
    }

    const existing = await this.prisma.relacion.findFirst({
      where: {
        origenId,
        destinoId,
        tipo,
      },
    });
    if (existing) {
      throw new ConflictException(RELATION_ALREADY_EXISTS_MESSAGE);
    }

    return this.prisma.$transaction(async (tx) => {
      let relacion: Relacion;
      try {
        relacion = await tx.relacion.create({
          data: {
            origenId,
            destinoId,
            tipo,
            descripcion: dto.descripcion,
          },
        });
      } catch (error) {
        // Two concurrent creates for the same (origenId, destinoId, tipo)
        // triple can both pass the findFirst->null check above; the loser
        // hits the DB's unique constraint here — same P2002 race backstop
        // as `InventoryService.create`'s nombre-uniqueness pattern.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(RELATION_ALREADY_EXISTS_MESSAGE);
        }
        // The item vanishing between this method's own existence check
        // (above) and this transactional insert (e.g. a concurrent
        // `DELETE /items/:id` on an item with no other relations yet)
        // makes the FK constraint fail — Prisma reports "foreign key
        // constraint failed" (P2003) here instead of ever completing the
        // write. Surfaced as a clean 404 rather than a raw 500, mirroring
        // `InventoryService.remove`'s own P2003 catch for the reverse race.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        ) {
          throw new NotFoundException(RELATION_ITEM_VANISHED_MESSAGE);
        }
        throw error;
      }

      await this.auditService.record(tx, {
        usuarioId,
        tipoAccion: TipoAccion.CREATE,
        entidad: 'Relacion',
        entidadId: relacion.id,
        cambios: {
          origenId: relacion.origenId,
          destinoId: relacion.destinoId,
          tipo: relacion.tipo,
          descripcion: relacion.descripcion,
        },
      });

      return relacion;
    });
  }

  /**
   * Partial update of a `Relacion` (spec-4-2, FR-21) — only `tipo` and/or
   * `descripcion` may change; `origenId`/`destinoId` are immutable (spec
   * Boundaries/Never — not part of `UpdateRelationInput`'s shape at all, so
   * there is no ambiguity about whether supplying them silently does
   * nothing). Only keys actually present in `dto` (i.e. `!== undefined`) are
   * changed, mirroring `InventoryService.update`.
   *
   * Mirrors `InventoryService.update`'s pattern throughout: `tipo` (when
   * supplied) trimmed then validated against `RELATION_TYPE_CATALOG` before
   * any DB access (same trim-before-catalog-check order as `create`);
   * existence of the relation checked via `findUnique` before any
   * transaction starts; when `tipo` actually changes, the natural-key
   * uniqueness `(origenId, destinoId, tipo)` is re-checked via `findFirst`
   * excluding the relation's own id (`NOT: { id }`), backed by the real
   * `@unique` DB constraint as a `P2002` race backstop. The row update and
   * its `RegistroAuditoria` entry happen inside one `prisma.$transaction`
   * (AD-3); `cambios` is `{ before, after }` for exactly the changed
   * field(s), never a full snapshot.
   */
  async update(
    usuarioId: string,
    id: string,
    dto: UpdateRelationInput,
  ): Promise<Relacion> {
    // Trimmed once, up front — same reasoning as `create`'s tipo: the
    // catalog check and the persisted value must agree, or a
    // whitespace-padded tipo would be rejected as "not recognized" even
    // though its trimmed form is a valid catalog value. Must happen before
    // the catalog check below (spec Boundaries: "trim before catalog check,
    // not after").
    const tipo = dto.tipo !== undefined ? dto.tipo.trim() : undefined;

    if (tipo !== undefined && !RELATION_TYPE_CATALOG.includes(tipo)) {
      throw new BadRequestException(INVALID_TIPO_MESSAGE(tipo));
    }

    const existingRelation = await this.prisma.relacion.findUnique({
      where: { id },
    });
    if (!existingRelation) {
      throw new NotFoundException(RELATION_NOT_FOUND_MESSAGE);
    }

    // Only re-check uniqueness when tipo is actually changing — re-supplying
    // the relation's own current tipo (unchanged) is not a collision, and
    // running the check anyway is not incorrect, but "different from the
    // relation's current tipo" (spec Boundaries) is the precise trigger.
    if (tipo !== undefined && tipo !== existingRelation.tipo) {
      const duplicate = await this.prisma.relacion.findFirst({
        where: {
          origenId: existingRelation.origenId,
          destinoId: existingRelation.destinoId,
          tipo,
          NOT: { id },
        },
      });
      if (duplicate) {
        throw new ConflictException(RELATION_ALREADY_EXISTS_MESSAGE);
      }
    }

    // Built up field-by-field so `data` (the Prisma partial update) and
    // `cambios.before`/`cambios.after` (the audit entry) both cover exactly
    // — and only — the fields this call actually supplied, mirroring
    // `InventoryService.update`.
    const data: Prisma.RelacionUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (tipo !== undefined) {
      data.tipo = tipo;
      before.tipo = existingRelation.tipo;
      after.tipo = tipo;
    }
    if (dto.descripcion !== undefined) {
      data.descripcion = dto.descripcion;
      before.descripcion = existingRelation.descripcion;
      after.descripcion = dto.descripcion;
    }

    return this.prisma.$transaction(async (tx) => {
      let relacion: Relacion;
      try {
        relacion = await tx.relacion.update({
          where: { id },
          data,
        });
      } catch (error) {
        // Race-condition backstop, mirroring create's: two concurrent
        // updates re-pointing different relations to the same
        // (origenId, destinoId, tipo) triple can both pass the
        // findFirst->null check above; the loser hits the DB's real unique
        // constraint here.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(RELATION_ALREADY_EXISTS_MESSAGE);
        }
        // The relation vanishing between this method's own up-front
        // findUnique and this transactional update (a concurrent
        // `PATCH`/`DELETE` on the same relation racing it) makes Prisma
        // report "record not found" (P2025) here instead of ever completing
        // the write. Surfaced as the same 404 every other unknown-id path
        // returns, not a raw 500 (spec Boundaries).
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new NotFoundException(RELATION_NOT_FOUND_MESSAGE);
        }
        throw error;
      }

      await this.auditService.record(tx, {
        usuarioId,
        tipoAccion: TipoAccion.UPDATE,
        entidad: 'Relacion',
        entidadId: relacion.id,
        cambios: { before, after } as Prisma.InputJsonValue,
      });

      return relacion;
    });
  }

  /**
   * Permanent removal of a `Relacion` (spec-4-2) — hard delete
   * (`prisma.relacion.delete`); no soft-delete flag exists on `Relacion`
   * (spec Boundaries). `prisma.relacion.findUnique` supplies the up-front
   * 404 check, exactly as `update` does — but the audit `cambios` snapshot
   * is built from `tx.relacion.delete`'s own return value, not this earlier
   * read, so a concurrent `update` that commits between the two can never
   * make the audit entry record stale pre-delete field values, mirroring
   * `InventoryService.remove`'s corrected (post-3.4-review) pattern exactly.
   * The row delete and its `RegistroAuditoria` entry happen inside one
   * `prisma.$transaction` (AD-3). Unlike `update`, there is no "after"
   * state — `cambios` is a full snapshot of the relation as it existed right
   * before deletion, mirroring `create`'s shape.
   *
   * No `P2003` handling needed here (spec Boundaries/Never): nothing in this
   * codebase yet has a foreign key referencing `Relacion.id`.
   */
  async remove(usuarioId: string, id: string): Promise<void> {
    const existingRelation = await this.prisma.relacion.findUnique({
      where: { id },
    });
    if (!existingRelation) {
      throw new NotFoundException(RELATION_NOT_FOUND_MESSAGE);
    }

    await this.prisma.$transaction(async (tx) => {
      let deletedRelation: Relacion;
      try {
        deletedRelation = await tx.relacion.delete({ where: { id } });
      } catch (error) {
        // Concurrent double-delete, or a PATCH/DELETE race (spec I/O
        // matrix): the loser's tx.relacion.delete hits Prisma's "record not
        // found" (P2025) once the winner has already removed/updated the
        // row — surfaced as the same 404 rather than a raw 500.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new NotFoundException(RELATION_NOT_FOUND_MESSAGE);
        }
        throw error;
      }

      await this.auditService.record(tx, {
        usuarioId,
        tipoAccion: TipoAccion.DELETE,
        entidad: 'Relacion',
        entidadId: deletedRelation.id,
        cambios: {
          origenId: deletedRelation.origenId,
          destinoId: deletedRelation.destinoId,
          tipo: deletedRelation.tipo,
          descripcion: deletedRelation.descripcion,
        },
      });
    });
  }

  /**
   * Pure, static lookup over `(origenTipo, destinoTipo)` (spec-4-1, FR-20) —
   * no DB access, no item lookup, thin wrapper over `suggestRelation`.
   * Advisory only, never blocks or validates anything (spec Boundaries).
   */
  suggest(
    origenTipo: string,
    destinoTipo: string,
  ): { tipo: string; descripcion: string } {
    return suggestRelation(origenTipo, destinoTipo);
  }
}
