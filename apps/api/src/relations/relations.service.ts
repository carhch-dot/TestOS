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

export const INVALID_TIPO_MESSAGE = (tipo: string): string =>
  `'${tipo}' is not a recognized relation type.`;

export const SELF_RELATION_MESSAGE =
  'origenId and destinoId must be different items.';

export const ORIGEN_NOT_FOUND_MESSAGE = 'origenId does not match any item.';

export const DESTINO_NOT_FOUND_MESSAGE = 'destinoId does not match any item.';

export const RELATION_ALREADY_EXISTS_MESSAGE = 'This relation already exists.';

export const RELATION_ITEM_VANISHED_MESSAGE =
  'origenId or destinoId no longer matches an existing item.';

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
