import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UsuarioStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from '../common/normalize-email';
import { RefreshTokenService } from './refresh-token.service';
import { MailService } from '../mail/mail.service';

// Wrong password, unknown email, and a non-ACTIVE status must all be
// indistinguishable to the caller (I/O matrix) — same message, same shape.
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';

// Deliberately distinct from INVALID_CREDENTIALS_MESSAGE (spec-1-4): a locked
// account is meant to be visible to its owner, unlike the other three
// generic-failure states (unknown email, wrong password, non-ACTIVE).
export const ACCOUNT_LOCKED_MESSAGE =
  'Account temporarily locked due to too many failed login attempts. Please try again later.';

// `[ASSUMPTION]` defaults per spec-1-4, overridable via env vars.
const DEFAULT_LOCKOUT_MAX_ATTEMPTS = 3;
const DEFAULT_LOCKOUT_DURATION_MINUTES = 30;

// A fixed, valid argon2 hash with no corresponding real account. When the
// email lookup misses, we still run argon2.verify against this instead of
// short-circuiting, so an unknown email pays the same argon2 cost as a wrong
// password — otherwise the response-time gap would reveal account existence
// even though the response bodies are identical.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$aM53NTpDwqia4XfBPzTUqw$zji5LvDh4kW7A0gEELC7EG8tEV1BTmEhO9cOPSf9Ew0';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Verifies email + password against the stored `argon2` hash and, on
 * success, issues a short-lived JWT access token plus a persisted, hashed
 * refresh token (AD-5). Implements FR1.
 *
 * Also enforces temporary lockout after repeated failed attempts (FR2,
 * spec-1-4): a running counter + lock-until timestamp on `Usuario`. A
 * currently-locked account is checked *before* `argon2.verify` and rejected
 * immediately — "locked" is already an intentionally distinguishable
 * response, so skipping the argon2 cost there leaks nothing new. Unknown
 * email and non-ACTIVE still always pay the same argon2 cost as a real wrong
 * password. A small residual gap is accepted, not eliminated: a wrong
 * password on a real, unlocked account now costs one extra indexed-PK DB
 * write (the atomic counter increment) that the unknown-email/non-ACTIVE
 * paths don't — logged in `deferred-work.md` rather than claimed away.
 */
@Injectable()
export class LoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly mailService: MailService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: normalizeEmail(email) },
    });

    const now = new Date();
    let lockJustExpired = false;

    // Check (and clear an expired) lock *before* paying the argon2 cost. A
    // currently-locked account is already an intentionally distinguishable
    // response (a different message below), so exiting early here doesn't
    // leak anything new, and it spares a locked-out account an unnecessary
    // argon2 hash on every retry. An unknown email is unaffected — it always
    // falls through to argon2.verify below exactly as before.
    if (usuario?.lockedUntil) {
      if (usuario.lockedUntil.getTime() > now.getTime()) {
        throw new UnauthorizedException(ACCOUNT_LOCKED_MESSAGE);
      }
      // Expired: give the user a fresh set of attempts rather than staying
      // "soft-locked" forever.
      lockJustExpired = true;
    }

    // Always run argon2.verify — against the real hash when the user exists,
    // or a fixed dummy hash when they don't — so an unknown email takes the
    // same time as a wrong password and never reveals account existence via
    // a timing gap.
    const passwordMatches = await argon2.verify(
      usuario?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );

    // Unknown email and a non-ACTIVE status are unchanged from Story 1.2:
    // same generic message, no lockout bookkeeping (nothing to lock for an
    // account that doesn't exist or can never succeed anyway).
    if (!usuario || usuario.status !== UsuarioStatus.ACTIVE) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    if (!passwordMatches) {
      let newFailedLoginAttempts: number;
      if (lockJustExpired) {
        // A hard reset-to-1, not an atomic increment: this only runs the
        // instant a lock expires, a narrow one-time boundary distinct from
        // the ordinary repeated-wrong-password race below.
        newFailedLoginAttempts = 1;
        await this.prisma.usuario.update({
          where: { id: usuario.id },
          data: { failedLoginAttempts: 1, lockedUntil: null },
        });
      } else {
        // Atomic increment, reading the post-increment count off the
        // update's own return value: a plain read-then-write here would let
        // concurrent wrong-password requests race on the same starting
        // count and silently lose increments, letting an attacker exceed
        // the threshold without ever tripping the lock.
        const updated = await this.prisma.usuario.update({
          where: { id: usuario.id },
          data: { failedLoginAttempts: { increment: 1 } },
          select: { failedLoginAttempts: true },
        });
        newFailedLoginAttempts = updated.failedLoginAttempts;
      }

      const maxAttempts = this.getMaxAttempts();
      if (newFailedLoginAttempts >= maxAttempts) {
        const newLockedUntil = new Date(
          now.getTime() + this.getLockoutDurationMinutes() * 60_000,
        );
        await this.prisma.usuario.update({
          where: { id: usuario.id },
          data: { lockedUntil: newLockedUntil },
        });

        // Fire-and-forget: MailService.send already never rejects, and the
        // response must not wait on SMTP latency either way (belt-and-
        // suspenders `.catch` in case that contract is ever broken).
        void this.mailService
          .send(
            usuario.email,
            'Your account has been temporarily locked',
            `We locked your account after ${newFailedLoginAttempts} consecutive failed login attempts. ` +
              `You can try again in ${this.getLockoutDurationMinutes()} minutes.`,
          )
          .catch(() => {});
      }

      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // Success: correct password, ACTIVE, not currently locked. Reset the
    // counter (and persist an expired-lock clear) only when something
    // actually changed, to avoid a pointless write on the common case.
    if (usuario.failedLoginAttempts !== 0 || lockJustExpired) {
      await this.prisma.usuario.update({
        where: { id: usuario.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const accessToken = await this.jwtService.signAsync({
      sub: usuario.id,
      email: usuario.email,
      role: usuario.role,
    });
    const refreshToken = await this.refreshTokenService.issue(usuario.id);

    return { accessToken, refreshToken };
  }

  private getMaxAttempts(): number {
    const raw = Number(process.env.LOGIN_LOCKOUT_MAX_ATTEMPTS);
    return Number.isInteger(raw) && raw > 0
      ? raw
      : DEFAULT_LOCKOUT_MAX_ATTEMPTS;
  }

  private getLockoutDurationMinutes(): number {
    const raw = Number(process.env.LOGIN_LOCKOUT_DURATION_MINUTES);
    return Number.isFinite(raw) && raw > 0
      ? raw
      : DEFAULT_LOCKOUT_DURATION_MINUTES;
  }
}
