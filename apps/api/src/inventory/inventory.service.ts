import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ItemConfiguracion, Prisma, TipoAccion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ITEM_TYPE_CATALOG } from './item-type-catalog';

// Caller-shaped input for `InventoryService.create` — `tipo` is validated
// against `ITEM_TYPE_CATALOG` inside the service (spec Boundaries), not by
// any type system construct here. `properties` mirrors `AuditService`'s
// `cambios` posture: a caller-shaped JSON blob, unvalidated against any
// per-type shape (AD-8).
export type CreateItemInput = {
  nombre: string;
  tipo: string;
  descripcion?: string;
  dominioPropietario?: string;
  direccionRed?: string;
  properties?: Prisma.InputJsonValue;
};

export const INVALID_TIPO_MESSAGE = (tipo: string): string =>
  `'${tipo}' is not a recognized item type.`;

export const NAME_ALREADY_EXISTS_MESSAGE =
  'An item with that name already exists.';

/**
 * `InventoryModule`'s sole write path onto `ItemConfiguracion` (spec-3-1,
 * FR-12) — the module is its exclusive owner (AD-1); no other module ever
 * writes it directly via Prisma.
 *
 * `create` is the first real caller of `AuditService.record` (Epic 2 built
 * it with no caller yet): the item insert and its `RegistroAuditoria` entry
 * happen inside one `prisma.$transaction` (AD-3), so either both persist or
 * neither does.
 *
 * Name uniqueness is case-insensitive (NFR3) and global across all types:
 * checked up front via a case-insensitive `findFirst` (cheap, avoids an
 * unnecessary transaction/DB round-trip for the common case), then backed by
 * the real case-sensitive `@unique` DB constraint as a race-condition
 * backstop, caught the same way `InviteService.invite` catches a concurrent
 * `P2002` on `Usuario.email` (spec-1-7).
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    usuarioId: string,
    dto: CreateItemInput,
  ): Promise<ItemConfiguracion> {
    if (!ITEM_TYPE_CATALOG.includes(dto.tipo)) {
      throw new BadRequestException(INVALID_TIPO_MESSAGE(dto.tipo));
    }

    // Trimmed once, up front — both the uniqueness check and the persisted
    // value must agree, or a leading/trailing-whitespace variant of an
    // existing name would be treated as distinct by both (spec Boundaries:
    // "normalizados... antes de comparar o persistir").
    const nombre = dto.nombre.trim();

    const existing = await this.prisma.itemConfiguracion.findFirst({
      where: { nombre: { equals: nombre, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException(NAME_ALREADY_EXISTS_MESSAGE);
    }

    return this.prisma.$transaction(async (tx) => {
      let item: ItemConfiguracion;
      try {
        item = await tx.itemConfiguracion.create({
          data: {
            nombre,
            descripcion: dto.descripcion,
            dominioPropietario: dto.dominioPropietario,
            direccionRed: dto.direccionRed,
            tipo: dto.tipo,
            properties: dto.properties ?? {},
          },
        });
      } catch (error) {
        // Two concurrent creates for the same (case-variant) name can both
        // pass the findFirst->null check above; the loser hits the DB's
        // unique constraint on `nombre` here. Scoped to just this call (not
        // the whole transaction) so a hypothetical future unique-constraint
        // violation from the audit insert below is never misattributed to a
        // name conflict.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(NAME_ALREADY_EXISTS_MESSAGE);
        }
        throw error;
      }

      await this.auditService.record(tx, {
        usuarioId,
        tipoAccion: TipoAccion.CREATE,
        entidad: 'ItemConfiguracion',
        entidadId: item.id,
        cambios: {
          nombre: item.nombre,
          descripcion: item.descripcion,
          dominioPropietario: item.dominioPropietario,
          direccionRed: item.direccionRed,
          tipo: item.tipo,
          properties: item.properties as Prisma.InputJsonValue,
        },
      });

      return item;
    });
  }
}
