import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Relacion, UsuarioRole } from '@prisma/client';
import { RelationsService } from './relations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

// Same defensive posture as every other free-text input in this codebase
// (see `InventoryController`) — none of these are a hard business rule, just
// a generous, not-a-real-limit upper bound.
const MAX_ID_LENGTH = 255;
const MAX_TIPO_LENGTH = 100;
const MAX_DESCRIPCION_LENGTH = 2000;

export const MISSING_ORIGEN_ID_MESSAGE = 'origenId is required';
export const INVALID_ORIGEN_ID_LENGTH_MESSAGE = `origenId must be ${MAX_ID_LENGTH} characters or fewer`;
export const MISSING_DESTINO_ID_MESSAGE = 'destinoId is required';
export const INVALID_DESTINO_ID_LENGTH_MESSAGE = `destinoId must be ${MAX_ID_LENGTH} characters or fewer`;
export const MISSING_TIPO_MESSAGE = 'tipo is required';
export const INVALID_TIPO_LENGTH_MESSAGE = `tipo must be ${MAX_TIPO_LENGTH} characters or fewer`;
export const INVALID_DESCRIPCION_MESSAGE = `descripcion must be a string of ${MAX_DESCRIPCION_LENGTH} characters or fewer, when provided`;
export const MISSING_ORIGEN_TIPO_MESSAGE = 'origenTipo is required';
export const MISSING_DESTINO_TIPO_MESSAGE = 'destinoTipo is required';
export const INVALID_ORIGEN_TIPO_MESSAGE = `origenTipo must be a single string of ${MAX_TIPO_LENGTH} characters or fewer`;
export const INVALID_DESTINO_TIPO_MESSAGE = `destinoTipo must be a single string of ${MAX_TIPO_LENGTH} characters or fewer`;

export class CreateRelationRequestDto {
  origenId!: string;
  destinoId!: string;
  tipo!: string;
  descripcion?: string;
}

function assertValidId(
  value: unknown,
  missingMessage: string,
  lengthMessage: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(missingMessage);
  }
  if (value.length > MAX_ID_LENGTH) {
    throw new BadRequestException(lengthMessage);
  }
}

// Mirrors `InventoryController`'s `assertValidTipo` exactly; the catalog
// check itself lives in `RelationsService` (spec Boundaries).
function assertValidTipo(tipo: unknown): asserts tipo is string {
  if (typeof tipo !== 'string' || tipo.trim().length === 0) {
    throw new BadRequestException(MISSING_TIPO_MESSAGE);
  }
  if (tipo.length > MAX_TIPO_LENGTH) {
    throw new BadRequestException(INVALID_TIPO_LENGTH_MESSAGE);
  }
}

function assertValidOptionalDescripcion(value: unknown): void {
  if (
    value !== undefined &&
    (typeof value !== 'string' || value.length > MAX_DESCRIPCION_LENGTH)
  ) {
    throw new BadRequestException(INVALID_DESCRIPCION_MESSAGE);
  }
}

// Split into two distinct failure messages (spec Boundaries): "absent or
// blank" is genuinely a missing param, while "an array" (a repeated query
// key, e.g. `?origenTipo=A&origenTipo=B`) or "too long" is a malformed one —
// conflating them under one "required" message is misleading when the
// caller did supply something. Length-capped like every other free-text
// input in this codebase (see MAX_ID_LENGTH/MAX_TIPO_LENGTH/
// MAX_DESCRIPCION_LENGTH above).
function assertValidRequiredTipoQuery(
  value: unknown,
  missingMessage: string,
  invalidMessage: string,
): asserts value is string {
  if (
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0)
  ) {
    throw new BadRequestException(missingMessage);
  }
  if (typeof value !== 'string' || value.length > MAX_TIPO_LENGTH) {
    throw new BadRequestException(invalidMessage);
  }
}

/**
 * `POST /relations` / `GET /relations/suggest` (spec-4-1, FR-18–20/22).
 * Lives under `apps/api/src/relations/` (`RelationsModule`, this story's new
 * module) — `RelationsModule` is the sole owner of `Relacion` (AD-1).
 */
@Controller('relations')
export class RelationsController {
  constructor(private readonly relationsService: RelationsService) {}

  /**
   * `POST /relations` — creates a directed, typed `Relacion` between two
   * existing items. Same RBAC as `InventoryController.create`: Editor and
   * every role above it may write.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UsuarioRole.EDITOR, UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateRelationRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Relacion> {
    assertValidId(
      body?.origenId,
      MISSING_ORIGEN_ID_MESSAGE,
      INVALID_ORIGEN_ID_LENGTH_MESSAGE,
    );
    assertValidId(
      body?.destinoId,
      MISSING_DESTINO_ID_MESSAGE,
      INVALID_DESTINO_ID_LENGTH_MESSAGE,
    );
    assertValidTipo(body?.tipo);
    assertValidOptionalDescripcion(body.descripcion);

    // `usuarioId` for the audit trail comes from the verified access token
    // (`JwtAuthGuard`), never from the request body — matches every other
    // authenticated write in this codebase. `request.user` is always set by
    // this point: `JwtAuthGuard` runs first in the `@UseGuards(...)` chain
    // and throws before this handler is ever reached otherwise; the check
    // below is defensive only.
    if (!request.user) {
      throw new UnauthorizedException();
    }

    return this.relationsService.create(request.user.sub, {
      origenId: body.origenId,
      destinoId: body.destinoId,
      tipo: body.tipo,
      descripcion: body.descripcion,
    });
  }

  /**
   * `GET /relations/suggest?origenTipo=X&destinoTipo=Y` — a pure, advisory
   * static lookup (spec-4-1, FR-20). Deliberately `@UseGuards(JwtAuthGuard)`
   * only, no `RolesGuard`/`@Roles(...)`: any authenticated role may read,
   * matching `GET /items`'s posture.
   */
  @Get('suggest')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  suggest(
    @Query('origenTipo') origenTipoRaw?: string | string[],
    @Query('destinoTipo') destinoTipoRaw?: string | string[],
  ): { tipo: string; descripcion: string } {
    assertValidRequiredTipoQuery(
      origenTipoRaw,
      MISSING_ORIGEN_TIPO_MESSAGE,
      INVALID_ORIGEN_TIPO_MESSAGE,
    );
    assertValidRequiredTipoQuery(
      destinoTipoRaw,
      MISSING_DESTINO_TIPO_MESSAGE,
      INVALID_DESTINO_TIPO_MESSAGE,
    );

    return this.relationsService.suggest(origenTipoRaw, destinoTipoRaw);
  }
}
