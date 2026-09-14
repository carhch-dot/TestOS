import { randomBytes, createHash } from 'crypto';

/**
 * Generates a high-entropy random token as a hex string (32 random bytes /
 * 256 bits). Shared by `RefreshTokenService` and `PasswordResetService`: both
 * hand the raw value back to the caller once and persist only its hash (see
 * `hashToken`).
 */
export function generateRawToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Hashes a raw token with SHA-256, producing the value actually persisted.
 * The raw value itself is never stored — only this digest is, so a database
 * read alone can never reveal a usable token.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
