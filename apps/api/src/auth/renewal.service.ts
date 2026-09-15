import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsuarioStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

// Unknown token, expired token, non-ACTIVE user, and reuse/replay must all be
// indistinguishable to the caller (spec Boundaries) — same message, same
// status, same shape as LoginService's INVALID_CREDENTIALS_MESSAGE.
export const REFRESH_FAILED_MESSAGE = 'Invalid refresh token';

export interface RenewalResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Implements `POST /auth/refresh` (FR4, AD-5): rotates a valid, unexpired,
 * not-yet-used refresh token into a new access+refresh pair. Presenting a
 * token that was already consumed — whether from a lost race between two
 * concurrent requests or actual theft — revokes every refresh token
 * belonging to that user, blocking all future renewals immediately. This
 * does not force an immediate re-login everywhere: access tokens are
 * stateless JWTs with their own independent ~15-minute expiry, so a still-
 * valid access token from the compromised session keeps working until it
 * naturally expires.
 *
 * No timing-safety machinery here (unlike `LoginService`): a refresh token
 * is a 256-bit secret, not a guessable identifier, so there's no enumerable
 * secondary state for a timing side-channel to leak (spec Boundaries).
 */
@Injectable()
export class RenewalService {
  private readonly logger = new Logger(RenewalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async renew(rawToken: string): Promise<RenewalResult> {
    const row = await this.refreshTokenService.findByRawToken(rawToken);
    if (!row) {
      throw new UnauthorizedException(REFRESH_FAILED_MESSAGE);
    }

    // Reuse/replay takes priority over expiry: a token that is already
    // revoked must always trigger chain revocation, even if it also happens
    // to be expired — presenting an already-consumed token is the signal of
    // compromise, regardless of whatever else is also true about it.
    if (row.revoked) {
      this.logger.warn(
        `Refresh token reuse detected for user ${row.userId} (suspected replay)`,
      );
      await this.refreshTokenService.revokeAllForUser(row.userId);
      throw new UnauthorizedException(REFRESH_FAILED_MESSAGE);
    }

    // A merely expired (and not already revoked) token is the ordinary
    // outcome of an idle session, not a signal of compromise: reject without
    // touching any row, including this one — no chain revocation.
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(REFRESH_FAILED_MESSAGE);
    }

    // Claims are read fresh from the Usuario row at renewal time, never
    // carried over from an access token (this endpoint never receives one).
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: row.userId },
    });
    const isCurrentlyLockedOut =
      !!usuario?.lockedUntil && usuario.lockedUntil.getTime() > Date.now();
    if (
      !usuario ||
      usuario.status !== UsuarioStatus.ACTIVE ||
      isCurrentlyLockedOut
    ) {
      // Neither a non-ACTIVE status nor an active lockout (Story 1.4) is
      // reuse/theft — just an account that can't renew right now — so no
      // chain revocation here.
      throw new UnauthorizedException(REFRESH_FAILED_MESSAGE);
    }

    // Atomic conditional consume, never a plain read-then-write: exactly one
    // of two concurrent requests presenting the same token can win. A losing
    // `count: 0` is indistinguishable here from a token already revoked by a
    // prior legitimate rotation or a logout — all three are "reuse" per
    // AD-5, so the whole chain is revoked.
    const { count } = await this.refreshTokenService.consume(row.id);
    if (count === 0) {
      this.logger.warn(
        `Refresh token reuse detected for user ${row.userId} (suspected replay)`,
      );
      await this.refreshTokenService.revokeAllForUser(row.userId);
      throw new UnauthorizedException(REFRESH_FAILED_MESSAGE);
    }

    const accessToken = await this.jwtService.signAsync({
      sub: usuario.id,
      email: usuario.email,
      role: usuario.role,
    });
    const refreshToken = await this.refreshTokenService.issue(usuario.id);

    return { accessToken, refreshToken };
  }
}
