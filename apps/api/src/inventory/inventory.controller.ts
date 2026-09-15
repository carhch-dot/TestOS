import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ItemConfiguracion, Prisma, UsuarioRole } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

// Same defensive posture as every other free-text input in this codebase
// (email/token/password all have a generous, not-a-real-limit upper bound)
// — none existed for these fields until this review.
const MAX_NOMBRE_LENGTH = 255;
const MAX_TIPO_LENGTH = 100;
const MAX_DESCRIPCION_LENGTH = 2000;
const MAX_DOMINIO_PROPIETARIO_LENGTH = 255;
const MAX_DIRECCION_RED_LENGTH = 255;

export const MISSING_NOMBRE_MESSAGE = 'nombre is required';
export const INVALID_NOMBRE_LENGTH_MESSAGE = `nombre must be ${MAX_NOMBRE_LENGTH} characters or fewer`;
export const MISSING_TIPO_MESSAGE = 'tipo is required';
export const INVALID_TIPO_LENGTH_MESSAGE = `tipo must be ${MAX_TIPO_LENGTH} characters or fewer`;
export const INVALID_PROPERTIES_MESSAGE =
  'properties must be a JSON object when provided';
export const INVALID_DESCRIPCION_MESSAGE = `descripcion must be a string of ${MAX_DESCRIPCION_LENGTH} characters or fewer, when provided`;
export const INVALID_DOMINIO_PROPIETARIO_MESSAGE = `dominioPropietario must be a string of ${MAX_DOMINIO_PROPIETARIO_LENGTH} characters or fewer, when provided`;
export const INVALID_DIRECCION_RED_MESSAGE = `direccionRed must be a string of ${MAX_DIRECCION_RED_LENGTH} characters or fewer, when provided`;

export class CreateItemRequestDto {
  nombre!: string;
  tipo!: string;
  descripcion?: string;
  dominioPropietario?: string;
  direccionRed?: string;
  properties?: Prisma.InputJsonValue;
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
    if (typeof body?.nombre !== 'string' || body.nombre.trim().length === 0) {
      throw new BadRequestException(MISSING_NOMBRE_MESSAGE);
    }
    if (body.nombre.length > MAX_NOMBRE_LENGTH) {
      throw new BadRequestException(INVALID_NOMBRE_LENGTH_MESSAGE);
    }
    if (typeof body?.tipo !== 'string' || body.tipo.trim().length === 0) {
      throw new BadRequestException(MISSING_TIPO_MESSAGE);
    }
    if (body.tipo.length > MAX_TIPO_LENGTH) {
      throw new BadRequestException(INVALID_TIPO_LENGTH_MESSAGE);
    }
    if (
      body.descripcion !== undefined &&
      (typeof body.descripcion !== 'string' ||
        body.descripcion.length > MAX_DESCRIPCION_LENGTH)
    ) {
      throw new BadRequestException(INVALID_DESCRIPCION_MESSAGE);
    }
    if (
      body.dominioPropietario !== undefined &&
      (typeof body.dominioPropietario !== 'string' ||
        body.dominioPropietario.length > MAX_DOMINIO_PROPIETARIO_LENGTH)
    ) {
      throw new BadRequestException(INVALID_DOMINIO_PROPIETARIO_MESSAGE);
    }
    if (
      body.direccionRed !== undefined &&
      (typeof body.direccionRed !== 'string' ||
        body.direccionRed.length > MAX_DIRECCION_RED_LENGTH)
    ) {
      throw new BadRequestException(INVALID_DIRECCION_RED_MESSAGE);
    }
    if (
      body.properties !== undefined &&
      (typeof body.properties !== 'object' ||
        body.properties === null ||
        Array.isArray(body.properties))
    ) {
      throw new BadRequestException(INVALID_PROPERTIES_MESSAGE);
    }

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
}
