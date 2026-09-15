import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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

// Caller-shaped input for `InventoryService.update` (spec-3-3). Every field
// is optional — `InventoryController` has already turned "absent from the
// request body" into `undefined` before this service ever sees it, so
// `!== undefined` is exactly "this field was actually supplied" (spec
// Boundaries: "only keys actually present in the body are changed").
export type UpdateItemInput = {
  nombre?: string;
  tipo?: string;
  descripcion?: string;
  dominioPropietario?: string;
  direccionRed?: string;
  properties?: Prisma.InputJsonValue;
};

export const INVALID_TIPO_MESSAGE = (tipo: string): string =>
  `'${tipo}' is not a recognized item type.`;

export const NAME_ALREADY_EXISTS_MESSAGE =
  'An item with that name already exists.';

export const ITEM_NOT_FOUND_MESSAGE = 'Item not found.';

/**
 * Optional AND-combined filters for `list` (spec-3-2 Boundaries). Both are
 * caller-supplied via `InventoryController`, which has already turned an
 * empty-string query param into `undefined` before this service ever sees
 * it — `list` trusts its caller's shape rather than re-validating. Unlike
 * `create`'s `tipo`, this `tipo` is deliberately NOT checked against
 * `ITEM_TYPE_CATALOG` — an unrecognized filter value is a legitimate,
 * harmless empty-result query on a read, not an error.
 */
export type InventoryListFilters = {
  tipo?: string;
  texto?: string;
};

export type InventoryListResult = {
  data: ItemConfiguracion[];
  total: number;
  page: number;
  pageSize: number;
};

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

  /**
   * Partial update of an `ItemConfiguracion` (spec-3-3, FR-16) — only keys
   * actually present in `dto` (i.e. `!== undefined`) are changed; everything
   * else stays intact (Prisma partial `update`, never a full-row replace).
   * `properties`, when supplied, is shallow-merged with the item's current
   * `properties` (`{ ...existing, ...supplied }`) — top-level keys only, no
   * recursive merge (spec Boundaries/Never).
   *
   * Mirrors `create`'s pattern throughout: `tipo` (when supplied) validated
   * against `ITEM_TYPE_CATALOG` before any DB access; `nombre` (when
   * supplied) trimmed once and checked case-insensitively for uniqueness —
   * here excluding the item's own row — backed by the same `P2002`
   * race-condition backstop; the row update and its `RegistroAuditoria`
   * entry happen inside one `prisma.$transaction` (AD-3). Unlike `create`,
   * there IS a "before" state: `cambios` records `{ before, after }` for
   * exactly the fields that changed, not a full item snapshot (spec
   * Boundaries).
   */
  async update(
    usuarioId: string,
    id: string,
    dto: UpdateItemInput,
  ): Promise<ItemConfiguracion> {
    if (dto.tipo !== undefined && !ITEM_TYPE_CATALOG.includes(dto.tipo)) {
      throw new BadRequestException(INVALID_TIPO_MESSAGE(dto.tipo));
    }

    // Trimmed once, up front — same reasoning as `create`: both the
    // uniqueness check and the persisted value must agree.
    const nombre = dto.nombre !== undefined ? dto.nombre.trim() : undefined;

    const existingItem = await this.prisma.itemConfiguracion.findUnique({
      where: { id },
    });
    if (!existingItem) {
      throw new NotFoundException(ITEM_NOT_FOUND_MESSAGE);
    }

    if (nombre !== undefined) {
      const duplicate = await this.prisma.itemConfiguracion.findFirst({
        where: {
          nombre: { equals: nombre, mode: 'insensitive' },
          NOT: { id },
        },
      });
      if (duplicate) {
        throw new ConflictException(NAME_ALREADY_EXISTS_MESSAGE);
      }
    }

    // Built up field-by-field so `data` (the Prisma partial update) and
    // `cambios.before`/`cambios.after` (the audit entry) both cover exactly
    // — and only — the fields this call actually supplied.
    const data: Prisma.ItemConfiguracionUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (nombre !== undefined) {
      data.nombre = nombre;
      before.nombre = existingItem.nombre;
      after.nombre = nombre;
    }
    if (dto.descripcion !== undefined) {
      data.descripcion = dto.descripcion;
      before.descripcion = existingItem.descripcion;
      after.descripcion = dto.descripcion;
    }
    if (dto.dominioPropietario !== undefined) {
      data.dominioPropietario = dto.dominioPropietario;
      before.dominioPropietario = existingItem.dominioPropietario;
      after.dominioPropietario = dto.dominioPropietario;
    }
    if (dto.direccionRed !== undefined) {
      data.direccionRed = dto.direccionRed;
      before.direccionRed = existingItem.direccionRed;
      after.direccionRed = dto.direccionRed;
    }
    if (dto.tipo !== undefined) {
      data.tipo = dto.tipo;
      before.tipo = existingItem.tipo;
      after.tipo = dto.tipo;
    }
    if (dto.properties !== undefined) {
      // Top-level shallow merge only (spec Boundaries/Never: "No
      // deep/recursive merge of nested objects inside properties").
      const mergedProperties = {
        ...(existingItem.properties as Record<string, unknown>),
        ...(dto.properties as Record<string, unknown>),
      };
      data.properties = mergedProperties as Prisma.InputJsonValue;
      before.properties = existingItem.properties;
      after.properties = mergedProperties;
    }

    return this.prisma.$transaction(async (tx) => {
      let item: ItemConfiguracion;
      try {
        item = await tx.itemConfiguracion.update({
          where: { id },
          data,
        });
      } catch (error) {
        // Same race-condition backstop as `create`: two concurrent updates
        // renaming different items to the same (case-variant) name can both
        // pass the findFirst->null check above; the loser hits the DB's
        // unique constraint on `nombre` here.
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
        tipoAccion: TipoAccion.UPDATE,
        entidad: 'ItemConfiguracion',
        entidadId: item.id,
        cambios: { before, after } as Prisma.InputJsonValue,
      });

      return item;
    });
  }

  /**
   * Paginated, `nombre asc` listing of `ItemConfiguracion` (spec-3-2,
   * FR-15), with `tipo` (exact match) and `texto` (case-insensitive
   * substring across `nombre` OR `descripcion`) AND-combined into a single
   * `where` clause — omitting a filter's key entirely (rather than passing
   * `undefined` through) is what makes "no filter supplied" behave as
   * "match everything" under Prisma, mirroring `AuditService.list`
   * (spec-2-2). No sort options beyond this fixed default (spec
   * Boundaries).
   */
  async list(
    filters: InventoryListFilters,
    page: number,
    pageSize: number,
  ): Promise<InventoryListResult> {
    const where: Prisma.ItemConfiguracionWhereInput = {
      ...(filters.tipo !== undefined && { tipo: filters.tipo }),
      ...(filters.texto !== undefined && {
        OR: [
          { nombre: { contains: filters.texto, mode: 'insensitive' } },
          { descripcion: { contains: filters.texto, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.itemConfiguracion.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { nombre: 'asc' },
      }),
      this.prisma.itemConfiguracion.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }
}
