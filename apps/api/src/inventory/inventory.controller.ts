import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ItemConfiguracion, Prisma, UsuarioRole } from '@prisma/client';
import { InventoryService } from './inventory.service';
import type { InventoryListResult } from './inventory.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

// Same defensive posture/values as `AuditController.list`/`UsersController.list`
// (spec-3-2 Boundaries requires matching them exactly rather than inventing a
// separate convention: defaults 1/50, caps 200/200).
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_PAGE = 200;

// Same defensive posture as every other free-text input in this codebase
// (email/token/password all have a generous, not-a-real-limit upper bound)
// — none existed for these fields until this review.
const MAX_NOMBRE_LENGTH = 255;
const MAX_TIPO_LENGTH = 100;
const MAX_DESCRIPCION_LENGTH = 2000;
const MAX_DOMINIO_PROPIETARIO_LENGTH = 255;
const MAX_DIRECCION_RED_LENGTH = 255;
const MAX_TEXTO_LENGTH = 255;

export const MISSING_NOMBRE_MESSAGE = 'nombre is required';
export const INVALID_NOMBRE_LENGTH_MESSAGE = `nombre must be ${MAX_NOMBRE_LENGTH} characters or fewer`;
export const MISSING_TIPO_MESSAGE = 'tipo is required';
export const INVALID_TIPO_LENGTH_MESSAGE = `tipo must be ${MAX_TIPO_LENGTH} characters or fewer`;
export const INVALID_PROPERTIES_MESSAGE =
  'properties must be a JSON object when provided';
export const INVALID_DESCRIPCION_MESSAGE = `descripcion must be a string of ${MAX_DESCRIPCION_LENGTH} characters or fewer, when provided`;
export const INVALID_DOMINIO_PROPIETARIO_MESSAGE = `dominioPropietario must be a string of ${MAX_DOMINIO_PROPIETARIO_LENGTH} characters or fewer, when provided`;
export const INVALID_DIRECCION_RED_MESSAGE = `direccionRed must be a string of ${MAX_DIRECCION_RED_LENGTH} characters or fewer, when provided`;
export const INVALID_TIPO_FILTER_MESSAGE = `tipo must be a single string of ${MAX_TIPO_LENGTH} characters or fewer, when provided`;
export const INVALID_TEXTO_FILTER_MESSAGE = `texto must be a single string of ${MAX_TEXTO_LENGTH} characters or fewer, when provided`;
export const NO_FIELDS_TO_UPDATE_MESSAGE =
  'At least one recognized field (nombre, descripcion, dominioPropietario, direccionRed, tipo, properties) must be supplied.';

export class CreateItemRequestDto {
  nombre!: string;
  tipo!: string;
  descripcion?: string;
  dominioPropietario?: string;
  direccionRed?: string;
  properties?: Prisma.InputJsonValue;
}

// Every field optional (spec-3-3 Boundaries: "Every field is optional in the
// request body") — an absent key must reach `InventoryController.update` as
// `undefined` so `InventoryService.update` can tell "not supplied" apart
// from any real value.
export class UpdateItemRequestDto {
  nombre?: string;
  descripcion?: string;
  dominioPropietario?: string;
  direccionRed?: string;
  tipo?: string;
  properties?: Prisma.InputJsonValue;
}

// Shared with `create`'s nombre check (spec-3-3 Boundaries: "the exact same
// trim + case-insensitive uniqueness check as create") — `update` only calls
// this when `nombre` was actually supplied, since it is optional there.
function assertValidNombre(nombre: unknown): asserts nombre is string {
  if (typeof nombre !== 'string' || nombre.trim().length === 0) {
    throw new BadRequestException(MISSING_NOMBRE_MESSAGE);
  }
  if (nombre.length > MAX_NOMBRE_LENGTH) {
    throw new BadRequestException(INVALID_NOMBRE_LENGTH_MESSAGE);
  }
}

// Shared with `create`'s tipo shape check; the catalog check itself lives in
// `InventoryService` (spec-3-3 Boundaries: "the exact same catalog
// validation as create").
function assertValidTipo(tipo: unknown): asserts tipo is string {
  if (typeof tipo !== 'string' || tipo.trim().length === 0) {
    throw new BadRequestException(MISSING_TIPO_MESSAGE);
  }
  if (tipo.length > MAX_TIPO_LENGTH) {
    throw new BadRequestException(INVALID_TIPO_LENGTH_MESSAGE);
  }
}

function assertValidOptionalString(
  value: unknown,
  maxLength: number,
  message: string,
): void {
  if (
    value !== undefined &&
    (typeof value !== 'string' || value.length > maxLength)
  ) {
    throw new BadRequestException(message);
  }
}

function assertValidOptionalProperties(value: unknown): void {
  if (
    value !== undefined &&
    (typeof value !== 'object' || value === null || Array.isArray(value))
  ) {
    throw new BadRequestException(INVALID_PROPERTIES_MESSAGE);
  }
}

/**
 * `POST /items` (spec-3-1, FR-12) — creates an `ItemConfiguracion`. Editor
 * and every role above it may write (FR-12's "Consulta = solo lectura;
 * Editor+ = escritura" reading), not Editor-exclusive. Lives under
 * `apps/api/src/inventory/` (`InventoryModule`, this story's new module) —
 * `InventoryModule` is the sole owner of `ItemConfiguracion` (AD-1).
 */
@Controller('items')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UsuarioRole.EDITOR, UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateItemRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ItemConfiguracion> {
    assertValidNombre(body?.nombre);
    assertValidTipo(body?.tipo);
    assertValidOptionalString(
      body.descripcion,
      MAX_DESCRIPCION_LENGTH,
      INVALID_DESCRIPCION_MESSAGE,
    );
    assertValidOptionalString(
      body.dominioPropietario,
      MAX_DOMINIO_PROPIETARIO_LENGTH,
      INVALID_DOMINIO_PROPIETARIO_MESSAGE,
    );
    assertValidOptionalString(
      body.direccionRed,
      MAX_DIRECCION_RED_LENGTH,
      INVALID_DIRECCION_RED_MESSAGE,
    );
    assertValidOptionalProperties(body.properties);

    // `usuarioId` for the audit trail comes from the verified access token
    // (`JwtAuthGuard`), never from the request body — matches every other
    // authenticated write in this codebase. `request.user` is always set by
    // this point: `JwtAuthGuard` runs first in the `@UseGuards(...)` chain
    // and throws before this handler is ever reached otherwise; the check
    // below is defensive only.
    if (!request.user) {
      throw new UnauthorizedException();
    }

    return this.inventoryService.create(request.user.sub, {
      nombre: body.nombre,
      tipo: body.tipo,
      descripcion: body.descripcion,
      dominioPropietario: body.dominioPropietario,
      direccionRed: body.direccionRed,
      properties: body.properties,
    });
  }

  /**
   * `PATCH /items/:id` (spec-3-3, FR-16) — partial update of an
   * `ItemConfiguracion`. Same RBAC as `create` (Editor and above). Every
   * field in the body is optional; only keys actually present are forwarded
   * to `InventoryService.update` (as non-`undefined` values) — a body with
   * none of the recognized fields is rejected here with a `400` before the
   * service (or the DB) is ever touched, since there would be nothing to
   * update and nothing worth an audit entry for (spec Boundaries).
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UsuarioRole.EDITOR, UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR)
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() body: UpdateItemRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ItemConfiguracion> {
    const hasRecognizedField = [
      body?.nombre,
      body?.descripcion,
      body?.dominioPropietario,
      body?.direccionRed,
      body?.tipo,
      body?.properties,
    ].some((value) => value !== undefined);
    if (!hasRecognizedField) {
      throw new BadRequestException(NO_FIELDS_TO_UPDATE_MESSAGE);
    }

    if (body.nombre !== undefined) {
      assertValidNombre(body.nombre);
    }
    if (body.tipo !== undefined) {
      assertValidTipo(body.tipo);
    }
    assertValidOptionalString(
      body.descripcion,
      MAX_DESCRIPCION_LENGTH,
      INVALID_DESCRIPCION_MESSAGE,
    );
    assertValidOptionalString(
      body.dominioPropietario,
      MAX_DOMINIO_PROPIETARIO_LENGTH,
      INVALID_DOMINIO_PROPIETARIO_MESSAGE,
    );
    assertValidOptionalString(
      body.direccionRed,
      MAX_DIRECCION_RED_LENGTH,
      INVALID_DIRECCION_RED_MESSAGE,
    );
    assertValidOptionalProperties(body.properties);

    // Same defensive posture as `create`: `request.user` is always set by
    // this point (`JwtAuthGuard` runs first and throws otherwise); the check
    // below is defensive only.
    if (!request.user) {
      throw new UnauthorizedException();
    }

    return this.inventoryService.update(request.user.sub, id, {
      nombre: body.nombre,
      tipo: body.tipo,
      descripcion: body.descripcion,
      dominioPropietario: body.dominioPropietario,
      direccionRed: body.direccionRed,
      properties: body.properties,
    });
  }

  /**
   * `DELETE /items/:id` (spec-3-4) — permanently removes an
   * `ItemConfiguracion`. Same RBAC as `create`/`update` (Editor and above).
   * `204 No Content` with an empty body — standard REST for a delete with
   * nothing meaningful left to return (spec Boundaries).
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UsuarioRole.EDITOR, UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    // Same defensive posture as `create`/`update`: `request.user` is always
    // set by this point (`JwtAuthGuard` runs first and throws otherwise);
    // the check below is defensive only.
    if (!request.user) {
      throw new UnauthorizedException();
    }

    await this.inventoryService.remove(request.user.sub, id);
  }

  /**
   * `GET /items` (spec-3-2, FR-15) — deliberately `@UseGuards(JwtAuthGuard)`
   * only, no `RolesGuard`/`@Roles(...)`: matches `GET /audit`'s posture
   * (spec-2-2) — read access has no role restriction (FR-12 "Consulta =
   * solo lectura" means Consulta *can* read, not that only Consulta can).
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async list(
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('tipo') tipoRaw?: string | string[],
    @Query('texto') textoRaw?: string | string[],
  ): Promise<InventoryListResult> {
    const page = Math.min(parsePositiveInt(pageRaw, DEFAULT_PAGE), MAX_PAGE);
    const pageSize = Math.min(
      parsePositiveInt(pageSizeRaw, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );

    const tipo = parseOptionalStringFilter(
      tipoRaw,
      MAX_TIPO_LENGTH,
      INVALID_TIPO_FILTER_MESSAGE,
    );
    const texto = parseOptionalStringFilter(
      textoRaw,
      MAX_TEXTO_LENGTH,
      INVALID_TEXTO_FILTER_MESSAGE,
    );

    return this.inventoryService.list({ tipo, texto }, page, pageSize);
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// An empty-string value (e.g. `?tipo=`) means "no filter," not "filter on
// the empty string" — otherwise it would silently return zero results
// instead of the unfiltered list (matches AuditController.list). A repeated
// query key (`?tipo=A&tipo=B`) parses to a string[] under Nest/Express —
// rejected with a clean 400 rather than reaching Prisma as an unexpected
// type. Also enforces the same defensive length cap every other free-text
// input in this codebase has.
function parseOptionalStringFilter(
  raw: string | string[] | undefined,
  maxLength: number,
  message: string,
): string | undefined {
  if (raw === undefined || raw === '') {
    return undefined;
  }
  if (typeof raw !== 'string' || raw.length > maxLength) {
    throw new BadRequestException(message);
  }
  return raw;
}
