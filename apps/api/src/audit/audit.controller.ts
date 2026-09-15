import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TipoAccion } from '@prisma/client';
import { AuditService } from './audit.service';
import type { AuditListResult } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Same defensive posture/values as `UsersController.list` (spec-1-8, incl.
// its review-fixed `page` cap) — spec-2-2 Boundaries requires matching it
// exactly rather than inventing a separate convention.
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_PAGE = 200;

export const INVALID_TIPO_ACCION_MESSAGE = 'Invalid tipoAccion';
export const INVALID_DESDE_MESSAGE = 'Invalid desde date';
export const INVALID_HASTA_MESSAGE = 'Invalid hasta date';
export const INVALID_USUARIO_ID_MESSAGE = 'usuarioId must be a single string';
export const INVALID_ENTIDAD_MESSAGE = 'entidad must be a single string';
export const INVALID_ENTIDAD_ID_MESSAGE = 'entidadId must be a single string';

/**
 * `GET /audit` (spec-2-2, FR-29) — the sole read path onto
 * `RegistroAuditoria`. Deliberately `@UseGuards(JwtAuthGuard)` only, no
 * `RolesGuard`/`@Roles(...)`: audit is read-only for every authenticated
 * role, one of the few areas with no role restriction (epic-2-context.md).
 * This is intentional, not an oversight. Lives under `apps/api/src/audit/`
 * (Story 2.1's module) alongside the existing write-only `AuditService`.
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async list(
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('usuarioId') usuarioIdRaw?: string | string[],
    @Query('entidad') entidadRaw?: string | string[],
    @Query('entidadId') entidadIdRaw?: string | string[],
    @Query('tipoAccion') tipoAccionRaw?: string,
    @Query('desde') desdeRaw?: string,
    @Query('hasta') hastaRaw?: string,
  ): Promise<AuditListResult> {
    const page = Math.min(parsePositiveInt(pageRaw, DEFAULT_PAGE), MAX_PAGE);
    const pageSize = Math.min(
      parsePositiveInt(pageSizeRaw, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );

    // An empty-string value (e.g. `?usuarioId=`) means "no filter," not "filter
    // on the empty string" — otherwise it would silently return zero results
    // instead of the unfiltered list. A repeated query key (`?usuarioId=a&
    // usuarioId=b`) parses to a string[] under Nest/Express — rejected with
    // a clean 400 rather than reaching Prisma as an unexpected type.
    const usuarioId = parseOptionalStringFilter(
      usuarioIdRaw,
      INVALID_USUARIO_ID_MESSAGE,
    );
    const entidad = parseOptionalStringFilter(
      entidadRaw,
      INVALID_ENTIDAD_MESSAGE,
    );
    const entidadId = parseOptionalStringFilter(
      entidadIdRaw,
      INVALID_ENTIDAD_ID_MESSAGE,
    );

    let tipoAccion: TipoAccion | undefined;
    if (tipoAccionRaw !== undefined) {
      if (!Object.values(TipoAccion).includes(tipoAccionRaw as TipoAccion)) {
        throw new BadRequestException(INVALID_TIPO_ACCION_MESSAGE);
      }
      tipoAccion = tipoAccionRaw as TipoAccion;
    }

    const desde = parseOptionalDate(desdeRaw, INVALID_DESDE_MESSAGE);
    const hasta = parseOptionalDate(hastaRaw, INVALID_HASTA_MESSAGE);

    return this.auditService.list(
      { usuarioId, entidad, entidadId, tipoAccion, desde, hasta },
      page,
      pageSize,
    );
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalStringFilter(
  raw: string | string[] | undefined,
  message: string,
): string | undefined {
  if (raw === undefined || raw === '') {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new BadRequestException(message);
  }
  return raw;
}

// No cross-check that desde <= hasta (spec Boundaries: "a swapped range just
// yields zero results, which is self-correcting") — only per-field
// parseability is validated here.
function parseOptionalDate(
  raw: string | undefined,
  message: string,
): Date | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(message);
  }

  return date;
}
