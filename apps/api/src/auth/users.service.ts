import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Usuario, UsuarioRole, UsuarioStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { PasswordResetService } from './password-reset.service';

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

// spec-1-10: only an ACTIVE target can be forced through the reset flow —
// PENDING_VERIFICATION/DEACTIVATED targets get this explicit conflict
// instead of forgot-password's silent no-op (spec Boundaries: an
// authenticated Manager/Administrator can already see the target's status
// via GET /users, so there's no enumeration risk to hide behind).
export const FORCE_RESET_CONFLICT_MESSAGE =
  'Cannot force a password reset for a user who is not active.';

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
    private readonly passwordResetService: PasswordResetService,
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

  /**
   * Sets `Usuario.role` to `role` and unconditionally revokes every refresh
   * token for that user (spec Boundaries) — the immediacy lever that makes
   * the new role apply on the user's very next login/renewal rather than
   * waiting out their current access token's ~15-minute life. Applies to a
   * target in any `status` (unlike `deactivate`/`reactivate`, spec
   * Boundaries: "no status restriction"). Setting the same role the user
   * already has skips the Prisma write (nothing to mutate) but still revokes
   * tokens — same idempotent-but-not-inert posture the spec calls out.
   *
   * Self-role-change is rejected by `UsersController` before this service is
   * even called (it needs `request.user.sub`, which this service's
   * `changeRole(id, role)` signature deliberately does not take — mirrors
   * `deactivate`'s self-deactivation split, spec Code Map).
   */
  async changeRole(id: string, role: UsuarioRole): Promise<UserStatusResult> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });

    if (!usuario) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }

    const updated =
      usuario.role === role
        ? usuario
        : await this.prisma.usuario.update({
            where: { id },
            data: { role },
          });

    await this.refreshTokenService.revokeAllForUser(id);

    return this.toStatusResult(updated);
  }

  /**
   * spec-1-10: lets a Manager/Administrator trigger the identical
   * self-service reset flow (Story 1.6) for another user, without knowing
   * that user's password. Delegates to `PasswordResetService.requestReset`
   * unchanged — same token/email mechanism, not a parallel implementation
   * (spec Approach) — so `PasswordResetService`/`PasswordResetToken` are
   * never modified here.
   *
   * Only an `ACTIVE` target qualifies; `PENDING_VERIFICATION`/`DEACTIVATED`
   * targets get an explicit conflict instead of `requestReset`'s own silent
   * no-op for a non-ACTIVE match, because that silence exists to avoid
   * enumeration for an unauthenticated caller — irrelevant here, since the
   * caller is an authenticated Manager/Administrator who can already see the
   * target's status via `GET /users` (spec Boundaries).
   *
   * No self-targeting guard, unlike `deactivate`/`changeRole`: forcing your
   * own reset carries none of their lockout/privilege-escalation risk (spec
   * Boundaries), so any Manager/Administrator may target any user including
   * themselves.
   */
  async forcePasswordReset(id: string): Promise<UserStatusResult> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });

    if (!usuario) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }

    if (usuario.status !== UsuarioStatus.ACTIVE) {
      throw new ConflictException(FORCE_RESET_CONFLICT_MESSAGE);
    }

    await this.passwordResetService.requestReset(usuario.email);

    return this.toStatusResult(usuario);
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
