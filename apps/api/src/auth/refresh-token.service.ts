import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { RefreshToken } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// `[ASSUMPTION: 15 minutes]` for the access token (AD-5); the refresh token
// itself is long-lived relative to it so a client isn't forced to
// re-authenticate with a password every 15 minutes.
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Generates and persists refresh tokens (AD-5). Kept separate from
 * `LoginService` so Story 1.5's rotation logic has one place to extend.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues a new refresh token for the given user: a random, high-entropy
   * raw value is returned to the caller (to hand back to the client once),
   * while only its SHA-256 hash is persisted.
   */
  async issue(userId: string): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(raw),
        expiresAt,
      },
    });

    return raw;
  }

  /**
   * Revokes the refresh token matching the given raw value, if any.
   * Idempotent and never reveals whether the token existed, was already
   * revoked, or never matched anything — same "never leak token state"
   * posture as login (Story 1.2, FR3/NFR1).
   */
  async revoke(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(rawToken) },
      data: { revoked: true },
    });
  }

  /**
   * Looks up the row matching the given raw token's hash, if any. Story 1.5:
   * `RenewalService` reads the row's `expiresAt`/`revoked`/`userId` itself
   * rather than this service making any accept/reject decision.
   */
  async findByRawToken(rawToken: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });
  }

  /**
   * Atomically consumes (revokes) the row with the given id, but only if it
   * is not already revoked — an `updateMany` conditional on `revoked: false`
   * rather than a plain read-then-write, so two concurrent callers racing on
   * the same id can never both win. Returns `{ count: 1 }` for the caller
   * that won, `{ count: 0 }` for one that lost the race or presented a token
   * already revoked by a prior rotation/logout (both are "reuse" to the
   * caller, per AD-5 — see Story 1.5's design notes).
   */
  async consume(id: string): Promise<{ count: number }> {
    return this.prisma.refreshToken.updateMany({
      where: { id, revoked: false },
      data: { revoked: true },
    });
  }

  /**
   * Revokes every refresh token belonging to the given user, including ones
   * unrelated to whichever token triggered the call. Used exclusively for
   * reuse/replay detection (AD-5): presenting an already-consumed refresh
   * token blocks all future renewals immediately, since it's indistinguishable
   * from token theft (an already-valid access token keeps working until its
   * own ~15-minute expiry — see `RenewalService`).
   */
  async revokeAllForUser(userId: string): Promise<void> {
    this.logger.warn(
      `Revoking all refresh tokens for user ${userId} (suspected replay)`,
    );
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
