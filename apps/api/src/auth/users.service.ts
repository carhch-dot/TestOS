import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Usuario, UsuarioRole, UsuarioStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

// Not a real `UsuarioStatus` enum value anywhere in the schema (spec
// Boundaries) — folds the lockout timer into the four-state view the epic's
// AC asks for ("activo/pendiente/bloqueado/desactivado").
export type EffectiveStatus =
  'ACTIVE' | 'PENDING_VERIFICATION' | 'LOCKED' | 'DEACTIVATED';

export interface UserListItem {
  id: string;
  email: string;
  role: UsuarioRole;
  effectiveStatus: EffectiveStatus;
  createdAt: Date;
}

export interface UsersListResult {
  data: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// The raw `status` column, deliberately distinct from `effectiveStatus`
// above: deactivate/reactivate report what they actually changed on the row
// (spec I/O matrix: "status: DEACTIVATED" / "status: ACTIVE"), not the
// derived lockout-aware view that only GET /users needs.
export interface UserStatusResult {
  id: string;
  email: string;
  role: UsuarioRole;
  status: UsuarioStatus;
}

export const USER_NOT_FOUND_MESSAGE = 'User not found';

// Shared by both deactivate and reactivate — a PENDING_VERIFICATION target is
// out of scope for either (spec Boundaries: "canceling a pending invite is
// not this story's job").
export const PENDING_VERIFICATION_CONFLICT_MESSAGE =
  'Cannot change the status of a user pending verification.';

/**
 * Implements spec-1-8: `list` returns every `Usuario` (paginated, no
 * `passwordHash`, `effectiveStatus` computed) and `deactivate`/`reactivate`
 * flip `status` between `ACTIVE`/`DEACTIVATED`. Both mutations are
 * idempotent no-ops on a target already in the destination state — see the
 * spec I/O matrix — and both reject a `PENDING_VERIFICATION` target with a
 * conflict, same posture either direction.
 *
 * Self-deactivation is rejected by `UsersController` before this service is
 * even called (it needs `request.user.sub`, which this service's `deactivate(id)`
 * signature deliberately does not take — see spec Code Map).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async list(page: number, pageSize: number): Promise<UsersListResult> {
    const [rows, total] = await Promise.all([
      this.prisma.usuario.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.usuario.count(),
    ]);

    return {
      data: rows.map((usuario) => this.toListItem(usuario)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Transitions `ACTIVE`/`LOCKED` (still `status === ACTIVE`) → `DEACTIVATED`,
   * revoking every refresh token for that user so an already-issued one can't
   * keep a session alive (mirrors Story 1.6's password-change revocation).
   * A no-op, not an error, when the target is already `DEACTIVATED`.
   */
  async deactivate(id: string): Promise<UserStatusResult> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });

    if (!usuario) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }

    if (usuario.status === UsuarioStatus.PENDING_VERIFICATION) {
      throw new ConflictException(PENDING_VERIFICATION_CONFLICT_MESSAGE);
    }

    if (usuario.status === UsuarioStatus.DEACTIVATED) {
      return this.toStatusResult(usuario);
    }

    const updated = await this.prisma.usuario.update({
      where: { id },
      data: { status: UsuarioStatus.DEACTIVATED },
    });
    await this.refreshTokenService.revokeAllForUser(id);

    return this.toStatusResult(updated);
  }

  /**
   * Transitions `DEACTIVATED` → `ACTIVE`, also clearing any stale
   * `failedLoginAttempts`/`lockedUntil` so the account isn't handed back into
   * a lock (mirrors Story 1.6's reset-clears-lockout fix). A no-op, not an
   * error, when the target is already `ACTIVE` (including currently-`LOCKED`
   * — its `status` column is still `ACTIVE`, so no lockout-clearing mutation
   * happens here either; that only runs on the real `DEACTIVATED → ACTIVE`
   * transition).
   */
  async reactivate(id: string): Promise<UserStatusResult> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });

    if (!usuario) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }

    if (usuario.status === UsuarioStatus.PENDING_VERIFICATION) {
      throw new ConflictException(PENDING_VERIFICATION_CONFLICT_MESSAGE);
    }

    if (usuario.status === UsuarioStatus.ACTIVE) {
      return this.toStatusResult(usuario);
    }

    const updated = await this.prisma.usuario.update({
      where: { id },
      data: {
        status: UsuarioStatus.ACTIVE,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    return this.toStatusResult(updated);
  }

  private toListItem(usuario: Usuario): UserListItem {
    return {
      id: usuario.id,
      email: usuario.email,
      role: usuario.role,
      effectiveStatus: this.computeEffectiveStatus(usuario),
      createdAt: usuario.createdAt,
    };
  }

  private toStatusResult(usuario: Usuario): UserStatusResult {
    return {
      id: usuario.id,
      email: usuario.email,
      role: usuario.role,
      status: usuario.status,
    };
  }

  private computeEffectiveStatus(usuario: Usuario): EffectiveStatus {
    if (usuario.status === UsuarioStatus.DEACTIVATED) {
      return 'DEACTIVATED';
    }
    if (usuario.status === UsuarioStatus.PENDING_VERIFICATION) {
      return 'PENDING_VERIFICATION';
    }
    if (usuario.lockedUntil && usuario.lockedUntil.getTime() > Date.now()) {
      return 'LOCKED';
    }
    return 'ACTIVE';
  }
}
