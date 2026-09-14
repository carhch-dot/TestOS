import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UsuarioStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from '../common/normalize-email';
import { generateRawToken, hashToken } from '../common/hash-token';
import { RefreshTokenService } from './refresh-token.service';
import { MailService } from '../mail/mail.service';

// `[ASSUMPTION: 1 hour]` per spec Intent.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Implements FR5 (password recovery).
 *
 * `requestReset` never reveals whether `email` matched a real ACTIVE
 * account: an unknown email and a non-ACTIVE match both silently do nothing,
 * exactly like a real match from the caller's point of view (the controller
 * returns the same response regardless). No timing-safety machinery is
 * needed here (spec Boundaries): a reset token is a 256-bit secret, not a
 * guessable identifier, so the residual DB-write timing gap between "found"
 * and "not found" is the same already-accepted class as login's.
 *
 * `confirmReset` atomically consumes a token — the same conditional-update
 * pattern as `RefreshTokenService.consume` (`updateMany` on `used: false`,
 * checking the affected count) rather than a plain read-then-write, so two
 * concurrent requests presenting the same token can never both win. On
 * success it sets the new password hash with `argon2` and revokes every
 * refresh token for the user (NFR1: a password change invalidates every
 * existing session, not just this token).
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly mailService: MailService,
  ) {}

  async requestReset(email: string): Promise<void> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: normalizeEmail(email) },
    });

    // Unknown email or non-ACTIVE status: do nothing, indistinguishably from
    // the caller's perspective (the controller responds the same either
    // way). No token row, no email.
    if (!usuario || usuario.status !== UsuarioStatus.ACTIVE) {
      return;
    }

    const raw = generateRawToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: usuario.id,
        tokenHash: hashToken(raw),
        expiresAt,
      },
    });

    // Fire-and-forget (Story 1.4's fix): MailService.send already never
    // rejects, and the response must not wait on SMTP latency either way
    // (belt-and-suspenders `.catch` in case that contract is ever broken).
    void this.mailService
      .send(
        usuario.email,
        'Reset your password',
        `Use this token to reset your password: ${raw}\n\n` +
          'This token expires in 1 hour and can only be used once. ' +
          'If you did not request a password reset, you can safely ignore this email.',
      )
      .catch(() => {});
  }

  /**
   * Returns `true` on a successful reset, `false` for every rejection case
   * (unknown/already-used/expired token, or an empty new password) — the
   * controller maps every `false` to the same generic 401, never revealing
   * which case occurred.
   */
  async confirmReset(token: string, newPassword: string): Promise<boolean> {
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      typeof newPassword !== 'string' ||
      newPassword.length === 0
    ) {
      return false;
    }

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!resetToken || resetToken.used) {
      return false;
    }

    // A merely expired token is rejected without touching any row, mirroring
    // RenewalService's handling of an expired-but-not-yet-consumed refresh
    // token.
    if (resetToken.expiresAt.getTime() <= Date.now()) {
      return false;
    }

    // Atomic conditional update, never a plain read-then-write: only the
    // request that actually flips `used` from false to true wins. The other
    // of two concurrent requests presenting the same token gets `count: 0`
    // and is rejected (same pattern as RefreshTokenService.consume).
    const { count } = await this.prisma.passwordResetToken.updateMany({
      where: { id: resetToken.id, used: false },
      data: { used: true },
    });

    if (count === 0) {
      return false;
    }

    // Any other still-unused reset token issued for this user (e.g. from an
    // earlier forgot-password retry) is invalidated alongside the one just
    // consumed, so a stale token can't be used to overwrite the password
    // again after this reset succeeds.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: resetToken.userId, used: false },
      data: { used: true },
    });

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.usuario.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash,
        // A successful reset is a stronger identity proof than a password,
        // so it also clears any active lockout (Story 1.4) — otherwise a
        // locked-out user who just reset their password still can't log in.
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    // A password change invalidates every existing session (NFR1), not just
    // the token that was just consumed.
    await this.refreshTokenService.revokeAllForUser(resetToken.userId);

    return true;
  }
}
