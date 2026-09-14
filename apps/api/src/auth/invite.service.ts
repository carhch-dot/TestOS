import { ConflictException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma, Usuario, UsuarioRole, UsuarioStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from '../common/normalize-email';
import { generateRawToken, hashToken } from '../common/hash-token';
import { MailService } from '../mail/mail.service';
import { enforcePasswordPolicy } from '../common/password-policy';

// `[ASSUMPTION: 7 days]` per spec Boundaries, overridable via env var —
// mirrors LOGIN_LOCKOUT_*'s pattern in login.service.ts.
const DEFAULT_INVITATION_TTL_DAYS = 7;

// Inviting an email already belonging to an ACTIVE or DEACTIVATED Usuario is
// a clear conflict — this is an authenticated admin action, not the
// anti-enumeration posture of forgot-password (spec I/O matrix).
export const EMAIL_ALREADY_REGISTERED_MESSAGE =
  'An account with that email already exists.';

/**
 * Implements the invite/activate flow (spec-1-7): `invite` creates a
 * `PENDING_VERIFICATION` Usuario with an unusable placeholder password hash
 * and emails a one-time activation token; `activate` atomically consumes a
 * valid token, sets the real password, and flips status to `ACTIVE`.
 *
 * `activate`'s atomic-consume pattern mirrors `PasswordResetService.confirmReset`
 * exactly (`updateMany` on `used: false`, checking the affected count) so two
 * concurrent requests presenting the same token can never both win.
 */
@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async invite(email: string, role: UsuarioRole): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const existing = await this.prisma.usuario.findUnique({
      where: { email: normalizedEmail },
    });

    let usuario: Usuario;

    if (existing) {
      // An ACTIVE or DEACTIVATED account already owns this email: reject,
      // no Usuario/token mutation (spec I/O matrix).
      if (existing.status !== UsuarioStatus.PENDING_VERIFICATION) {
        throw new ConflictException(EMAIL_ALREADY_REGISTERED_MESSAGE);
      }

      // Already invited, not yet activated: this is a resend. No duplicate
      // Usuario row — apply the (possibly corrected) role and invalidate any
      // prior unused token for this user (same sibling-invalidation pattern
      // as PasswordResetService.confirmReset), then issue a fresh one below.
      usuario = await this.prisma.usuario.update({
        where: { id: existing.id },
        data: { role },
      });
      await this.prisma.invitationToken.updateMany({
        where: { userId: usuario.id, used: false },
        data: { used: true },
      });
    } else {
      // A valid-format argon2 hash of a random, unguessable value — never
      // usable to log in (matches LoginService's DUMMY_PASSWORD_HASH
      // posture: a well-formed hash so argon2.verify never throws, just
      // always returns false).
      const placeholderPasswordHash = await argon2.hash(generateRawToken());

      try {
        usuario = await this.prisma.usuario.create({
          data: {
            email: normalizedEmail,
            passwordHash: placeholderPasswordHash,
            role,
            status: UsuarioStatus.PENDING_VERIFICATION,
          },
        });
      } catch (error) {
        // Two concurrent invites for the same brand-new email can both pass
        // the findUnique->null check above; the loser hits the DB's unique
        // constraint on `email` here. Surface it the same way as the
        // already-ACTIVE/DEACTIVATED conflict path, not a raw 500.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(EMAIL_ALREADY_REGISTERED_MESSAGE);
        }
        throw error;
      }
    }

    const raw = generateRawToken();
    const expiresAt = new Date(Date.now() + this.getTtlMs());

    await this.prisma.invitationToken.create({
      data: {
        userId: usuario.id,
        tokenHash: hashToken(raw),
        expiresAt,
      },
    });

    // Fire-and-forget (Stories 1.4/1.6's pattern): MailService.send already
    // never rejects, and the response must not wait on SMTP latency either
    // way (belt-and-suspenders `.catch` in case that contract is ever
    // broken).
    void this.mailService
      .send(
        usuario.email,
        'You have been invited to TestOS',
        `Use this token to activate your account: ${raw}\n\n` +
          `This token expires in ${this.getTtlDays()} days and can only be used once.`,
      )
      .catch(() => {});
  }

  /**
   * Returns `true` on a successful activation, `false` for every
   * token/credential rejection case (unknown/already-used/expired token, an
   * empty password, or a stale token whose target Usuario is no longer
   * PENDING_VERIFICATION) — the controller maps every `false` to the same
   * generic 401, never revealing which case occurred. A password-policy
   * violation (spec-1-11) is a distinct case: it *throws* a
   * `BadRequestException` (400) instead of returning `false`, and — because
   * the check runs before the token is atomically consumed — never burns the
   * token, so the same link can be retried with a compliant password.
   */
  async activate(token: string, password: string): Promise<boolean> {
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      typeof password !== 'string' ||
      password.length === 0
    ) {
      return false;
    }

    const invitationToken = await this.prisma.invitationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!invitationToken || invitationToken.used) {
      return false;
    }

    // A merely expired token is rejected without touching any row, mirroring
    // PasswordResetService.confirmReset's handling of an expired-but-not-
    // yet-consumed reset token.
    if (invitationToken.expiresAt.getTime() <= Date.now()) {
      return false;
    }

    // Re-check the target Usuario's current status, and enforce the password
    // policy (spec-1-11), before ever consuming the token: a stale-but-still-
    // valid InvitationToken must never be able to silently reset an
    // already-ACTIVE (or DEACTIVATED) user's password with no
    // re-authentication (e.g. a token issued just before a resend race, or
    // replayed against a user activated by another token since), and a
    // policy-rejected attempt must never burn the token (spec-1-11
    // Boundaries) — so both checks run before the atomic consume below, not
    // after.
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: invitationToken.userId },
    });

    if (!usuario || usuario.status !== UsuarioStatus.PENDING_VERIFICATION) {
      return false;
    }

    // This sets the user's *first* real password, replacing the unusable
    // placeholder (spec-1-7) — there is no real prior password to protect
    // against reuse of, so priorHashes is just the (unguessable) placeholder
    // hash (spec-1-11 Code Map).
    await enforcePasswordPolicy(password, [usuario.passwordHash]);

    // Atomic conditional update, never a plain read-then-write: only the
    // request that actually flips `used` from false to true wins. The other
    // of two concurrent requests presenting the same token gets `count: 0`
    // and is rejected (same pattern as PasswordResetService.confirmReset /
    // RefreshTokenService.consume).
    const { count } = await this.prisma.invitationToken.updateMany({
      where: { id: invitationToken.id, used: false },
      data: { used: true },
    });

    if (count === 0) {
      return false;
    }

    const passwordHash = await argon2.hash(password);
    await this.prisma.usuario.update({
      where: { id: invitationToken.userId },
      data: {
        passwordHash,
        status: UsuarioStatus.ACTIVE,
      },
    });

    return true;
  }

  private getTtlDays(): number {
    const raw = Number(process.env.INVITATION_TOKEN_TTL_DAYS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INVITATION_TTL_DAYS;
  }

  private getTtlMs(): number {
    return this.getTtlDays() * 24 * 60 * 60 * 1000;
  }
}
