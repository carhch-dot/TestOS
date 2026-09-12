import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues a new refresh token for the given user: a random, high-entropy
   * raw value is returned to the caller (to hand back to the client once),
   * while only its SHA-256 hash is persisted.
   */
  async issue(userId: string): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return raw;
  }
}
