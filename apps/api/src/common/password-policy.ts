import { BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';

// `[ASSUMPTION: 8]` per spec-1-11 Boundaries, overridable via env var —
// mirrors LOGIN_LOCKOUT_*'s env-var-with-default pattern in login.service.ts.
const DEFAULT_PASSWORD_MIN_LENGTH = 8;

// A new password matching the account's current password or one of its last
// `PASSWORD_HISTORY_COUNT` passwords is rejected (spec-1-11 Intent/FR11).
export const PASSWORD_REUSED_MESSAGE =
  'New password must not match your current password or any of your recent passwords.';

/**
 * Enforces the password policy (FR11) shared by every password-setting
 * site — `BootstrapService`, `InviteService.activate`, and
 * `PasswordResetService.confirmReset`. Throws a `BadRequestException` naming
 * the unmet requirement on failure; resolves with no value on success.
 *
 * `priorHashes` is the set of hashes `password` must not match: `[]` for a
 * brand-new account (bootstrap, or activate — which has no real prior
 * password), or `[currentHash, ...previousPasswordHashes]` for a real
 * password reset. Each candidate is checked with `argon2.verify` in turn,
 * stopping at the first match — no character-class/complexity rules, only
 * length and reuse (spec Boundaries: "Never").
 */
export async function enforcePasswordPolicy(
  password: string,
  priorHashes: string[],
): Promise<void> {
  const minLength = getPasswordMinLength();
  // Measured on the trimmed value so a whitespace-only password (e.g. 8
  // spaces) can't satisfy a length-only policy — trimming affects only this
  // measurement, never the password that actually gets hashed/stored.
  if (password.trim().length < minLength) {
    throw new BadRequestException(
      `Password must be at least ${minLength} characters long.`,
    );
  }

  for (const priorHash of priorHashes) {
    if (await argon2.verify(priorHash, password)) {
      throw new BadRequestException(PASSWORD_REUSED_MESSAGE);
    }
  }
}

function getPasswordMinLength(): number {
  const raw = Number(process.env.PASSWORD_MIN_LENGTH);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_PASSWORD_MIN_LENGTH;
}
