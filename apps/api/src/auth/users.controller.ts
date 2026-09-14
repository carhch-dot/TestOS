import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsuarioRole } from '@prisma/client';
import {
  UsersService,
  UserStatusResult,
  UsersListResult,
} from './users.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';

// `[ASSUMPTION: pageSize=50]` — matches the architecture's pagination
// convention (ARCHITECTURE-SPINE.md Consistency Conventions), no story-1-8
// specific override given.
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;

// Generous upper bound to reject an obviously-abusive pageSize cheaply, same
// defensive posture as the length caps in InviteController/LoginController —
// not a real limit.
const MAX_PAGE_SIZE = 200;

// Same defensive posture as MAX_PAGE_SIZE — caps an absurdly large `page`
// value so it can't produce a huge `skip` passed straight to Prisma.
const MAX_PAGE = 200;

export const SELF_DEACTIVATION_MESSAGE =
  'You cannot deactivate your own account.';

/**
 * `GET /users`, `POST /users/:id/deactivate`, `POST /users/:id/reactivate` —
 * all RBAC-protected (Manager or Administrator), reusing
 * `JwtAuthGuard`/`RolesGuard`/`@Roles(...)` exactly as built in Story 1.7
 * (spec Boundaries: no new auth infrastructure). Lives under
 * `apps/api/src/auth/` and is registered in `AuthModule` — `AuthModule`
 * remains the only writer of `Usuario` (AD-1) — but is deliberately its own
 * top-level `/users` route, not nested under `/auth`.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR)
  @HttpCode(HttpStatus.OK)
  async list(
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ): Promise<UsersListResult> {
    const page = Math.min(
      parsePositiveInt(pageRaw, DEFAULT_PAGE),
      MAX_PAGE,
    );
    const pageSize = Math.min(
      parsePositiveInt(pageSizeRaw, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );

    return this.usersService.list(page, pageSize);
  }

  @Post(':id/deactivate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR)
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserStatusResult> {
    // Self-deactivation is blocked before ever touching the service/DB
    // (Resolved Open Question, spec Boundaries) — `request.user.sub` is only
    // available here in the controller, not in `UsersService.deactivate(id)`.
    if (request.user?.sub === id) {
      throw new ConflictException(SELF_DEACTIVATION_MESSAGE);
    }

    return this.usersService.deactivate(id);
  }

  @Post(':id/reactivate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR)
  @HttpCode(HttpStatus.OK)
  async reactivate(@Param('id') id: string): Promise<UserStatusResult> {
    return this.usersService.reactivate(id);
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
