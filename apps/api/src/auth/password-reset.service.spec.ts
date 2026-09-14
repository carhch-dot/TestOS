import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as argon2 from 'argon2';
import { PasswordResetService } from './password-reset.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { MailService } from '../mail/mail.service';
import { PASSWORD_REUSED_MESSAGE } from '../common/password-policy';

type Usuario = {
  id: string;
  email: string;
  passwordHash: string;
  previousPasswordHashes: string[];
  role: string;
  status: string;
};

type PasswordResetTokenRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
};

type PrismaMock = {
  usuario: {
    findUnique: jest.Mock<Promise<Usuario | null>, [unknown]>;
    update: jest.Mock<Promise<Usuario>, [unknown]>;
  };
  passwordResetToken: {
    create: jest.Mock<Promise<unknown>, [unknown]>;
    findUnique: jest.Mock<Promise<PasswordResetTokenRow | null>, [unknown]>;
    updateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
};

function hashOf(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

describe('PasswordResetService', () => {
  const ORIGINAL_ENV = process.env;

  let prisma: PrismaMock;
  let refreshTokenService: {
    revokeAllForUser: jest.Mock<Promise<void>, [string]>;
  };
  let mailService: { send: jest.Mock<Promise<void>, [string, string, string]> };
  let service: PasswordResetService;

  const PASSWORD = 'a-new-password';

  // A real, well-formed argon2 hash (not the literal string 'old-hash') —
  // enforcePasswordPolicy's reuse check runs argon2.verify against it, and
  // argon2 throws on a malformed hash rather than returning false.
  let OLD_HASH: string;
  let HASH_A: string;
  let HASH_B: string;
  let HASH_C: string;

  beforeAll(async () => {
    OLD_HASH = await argon2.hash('the-current-password');
    HASH_A = await argon2.hash('history-password-a');
    HASH_B = await argon2.hash('history-password-b');
    HASH_C = await argon2.hash('history-password-c');
  });

  function makeUsuario(overrides: Partial<Usuario> = {}): Usuario {
    return {
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: OLD_HASH,
      previousPasswordHashes: [],
      role: 'READ_ONLY',
      status: 'ACTIVE',
      ...overrides,
    };
  }

  function makeResetToken(
    overrides: Partial<PasswordResetTokenRow> = {},
  ): PasswordResetTokenRow {
    return {
      id: 'reset-token-1',
      userId: 'user-1',
      tokenHash: hashOf('raw-token'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      used: false,
      createdAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.PASSWORD_MIN_LENGTH;
    delete process.env.PASSWORD_HISTORY_COUNT;

    prisma = {
      usuario: {
        findUnique: jest.fn<Promise<Usuario | null>, [unknown]>(),
        update: jest.fn<Promise<Usuario>, [unknown]>(),
      },
      passwordResetToken: {
        create: jest.fn<Promise<unknown>, [unknown]>(),
        findUnique: jest.fn<Promise<PasswordResetTokenRow | null>, [unknown]>(),
        updateMany: jest
          .fn<Promise<{ count: number }>, [unknown]>()
          .mockResolvedValue({ count: 1 }),
      },
    };
    refreshTokenService = {
      revokeAllForUser: jest
        .fn<Promise<void>, [string]>()
        .mockResolvedValue(undefined),
    };
    mailService = {
      send: jest
        .fn<Promise<void>, [string, string, string]>()
        .mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = moduleRef.get(PasswordResetService);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('requestReset', () => {
    // Scenario 1: email belongs to a real ACTIVE user.
    it('creates a token row and sends an email for a real ACTIVE user', async () => {
      const usuario = makeUsuario();
      prisma.usuario.findUnique.mockResolvedValue(usuario);

      await service.requestReset('user@example.com');

      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.passwordResetToken.create.mock.calls[0][0] as {
        data: { userId: string; tokenHash: string; expiresAt: Date };
      };
      expect(data.userId).toBe(usuario.id);
      expect(data.tokenHash).toHaveLength(64);
      expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(data.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 60 * 60 * 1000 + 1000,
      );

      expect(mailService.send).toHaveBeenCalledTimes(1);
      expect(mailService.send).toHaveBeenCalledWith(
        usuario.email,
        expect.any(String),
        expect.any(String),
      );
    });

    it('resolves to the same user regardless of email capitalization', async () => {
      const usuario = makeUsuario({ email: 'user@example.com' });
      prisma.usuario.findUnique.mockResolvedValue(usuario);

      await service.requestReset('User@Example.COM');

      expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    });

    it('does not wait on a slow MailService.send before resolving', async () => {
      prisma.usuario.findUnique.mockResolvedValue(makeUsuario());
      mailService.send.mockReturnValue(new Promise(() => {}));

      await expect(
        service.requestReset('user@example.com'),
      ).resolves.toBeUndefined();
    });

    // Scenario 2a: unknown email.
    it('creates no token row and sends no email for an unknown email', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await service.requestReset('nobody@example.com');

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailService.send).not.toHaveBeenCalled();
    });

    // Scenario 2b: non-ACTIVE status.
    it.each(['PENDING_VERIFICATION', 'DEACTIVATED'])(
      'creates no token row and sends no email when status is %s',
      async (status) => {
        prisma.usuario.findUnique.mockResolvedValue(makeUsuario({ status }));

        await service.requestReset('user@example.com');

        expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
        expect(mailService.send).not.toHaveBeenCalled();
      },
    );
  });

  describe('confirmReset', () => {
    // Scenario 3: valid, unused, unexpired token + non-empty new password.
    it('resets the password, marks the token used, and revokes every refresh token', async () => {
      const resetToken = makeResetToken();
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      prisma.usuario.findUnique.mockResolvedValue(makeUsuario());
      prisma.usuario.update.mockResolvedValue(makeUsuario());

      const result = await service.confirmReset('raw-token', PASSWORD);

      expect(result).toBe(true);
      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hashOf('raw-token') },
      });
      expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { id: resetToken.userId },
      });
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { id: resetToken.id, used: false },
        data: { used: true },
      });
      // Any other still-unused reset token for the same user is invalidated
      // too, so a stale token from an earlier request can't be replayed
      // after this reset already succeeded.
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: resetToken.userId, used: false },
        data: { used: true },
      });

      expect(prisma.usuario.update).toHaveBeenCalledTimes(1);
      const { where, data } = prisma.usuario.update.mock.calls[0][0] as {
        where: { id: string };
        data: {
          passwordHash: string;
          previousPasswordHashes: string[];
          failedLoginAttempts: number;
          lockedUntil: null;
        };
      };
      expect(where).toEqual({ id: resetToken.userId });
      expect(typeof data.passwordHash).toBe('string');
      expect(data.passwordHash).not.toBe(PASSWORD);
      // The old hash it's replacing joins the reuse-check history (FR11).
      expect(data.previousPasswordHashes).toEqual([OLD_HASH]);
      // A successful reset also clears any active lockout (Story 1.4) — a
      // locked-out user who proves ownership via the emailed token can log
      // in immediately rather than waiting out the lockout timer.
      expect(data.failedLoginAttempts).toBe(0);
      expect(data.lockedUntil).toBeNull();

      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        resetToken.userId,
      );
    });

    // spec-1-11: the pushed history is capped to PASSWORD_HISTORY_COUNT,
    // prepending the old hash and dropping the oldest entry once full.
    it('caps previousPasswordHashes to PASSWORD_HISTORY_COUNT, dropping the oldest', async () => {
      const resetToken = makeResetToken();
      const existingHistory = [HASH_A, HASH_B, HASH_C];
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ previousPasswordHashes: existingHistory }),
      );
      prisma.usuario.update.mockResolvedValue(makeUsuario());

      await service.confirmReset('raw-token', PASSWORD);

      const { data } = prisma.usuario.update.mock.calls[0][0] as {
        data: { previousPasswordHashes: string[] };
      };
      expect(data.previousPasswordHashes).toEqual([OLD_HASH, HASH_A, HASH_B]);
    });

    it('honors a custom PASSWORD_HISTORY_COUNT when capping previousPasswordHashes', async () => {
      process.env.PASSWORD_HISTORY_COUNT = '1';
      const resetToken = makeResetToken();
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ previousPasswordHashes: [HASH_A, HASH_B] }),
      );
      prisma.usuario.update.mockResolvedValue(makeUsuario());

      await service.confirmReset('raw-token', PASSWORD);

      const { data } = prisma.usuario.update.mock.calls[0][0] as {
        data: { previousPasswordHashes: string[] };
      };
      expect(data.previousPasswordHashes).toEqual([OLD_HASH]);
    });

    it('falls back to the default PASSWORD_HISTORY_COUNT (3) for a non-positive/non-numeric value', async () => {
      process.env.PASSWORD_HISTORY_COUNT = 'not-a-number';
      const resetToken = makeResetToken();
      const existingHistory = [HASH_A, HASH_B, HASH_C];
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ previousPasswordHashes: existingHistory }),
      );
      prisma.usuario.update.mockResolvedValue(makeUsuario());

      await service.confirmReset('raw-token', PASSWORD);

      const { data } = prisma.usuario.update.mock.calls[0][0] as {
        data: { previousPasswordHashes: string[] };
      };
      expect(data.previousPasswordHashes).toEqual([OLD_HASH, HASH_A, HASH_B]);
    });

    // Scenario 4a: unknown token.
    it('rejects an unknown token without touching any row', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      const result = await service.confirmReset('unknown-token', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    // Scenario 4b: already-used token.
    it('rejects an already-used token and does not change the password again', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        makeResetToken({ used: true }),
      );

      const result = await service.confirmReset('raw-token', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    // Scenario 4c: expired token.
    it('rejects an expired token without touching any row', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        makeResetToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      const result = await service.confirmReset('raw-token', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('rejects an empty new password without looking up the token', async () => {
      const result = await service.confirmReset('raw-token', '');

      expect(result).toBe(false);
      expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a non-string token without looking up anything', async () => {
      const result = await service.confirmReset(
        12345 as unknown as string,
        PASSWORD,
      );

      expect(result).toBe(false);
      expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an empty token without looking up the token', async () => {
      const result = await service.confirmReset('', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
    });

    // Scenario 5: two concurrent requests presenting the same valid token.
    // Both pass the (non-atomic) usuario fetch and policy check; only the
    // atomic consume actually decides the winner.
    it('rejects the loser of a concurrent race on the same token (lost the atomic consume)', async () => {
      const resetToken = makeResetToken();
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      prisma.usuario.findUnique.mockResolvedValue(makeUsuario());
      // Simulates the second request's updateMany finding the row already
      // flipped to used:true by the winner, so the where clause matches zero
      // rows.
      prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.confirmReset('raw-token', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    // spec-1-11 I/O matrix row 1: password shorter than PASSWORD_MIN_LENGTH.
    // The token must remain unused so the same link can be retried.
    it('rejects a too-short password with a BadRequestException, without consuming the token', async () => {
      const resetToken = makeResetToken();
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      prisma.usuario.findUnique.mockResolvedValue(makeUsuario());

      await expect(
        service.confirmReset('raw-token', 'short1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.confirmReset('raw-token', 'short1'),
      ).rejects.toThrow(/at least 8 characters/);

      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    // spec-1-11 I/O matrix row 2: new password matches the current password.
    it('rejects a new password matching the current password, without consuming the token', async () => {
      const resetToken = makeResetToken();
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      prisma.usuario.findUnique.mockResolvedValue(makeUsuario());

      await expect(
        service.confirmReset('raw-token', 'the-current-password'),
      ).rejects.toThrow(PASSWORD_REUSED_MESSAGE);

      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    // spec-1-11 I/O matrix row 2: new password matches one of the last N
    // (not just the current) passwords.
    it('rejects a new password matching one of the last N previous passwords, without consuming the token', async () => {
      const resetToken = makeResetToken();
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ previousPasswordHashes: [HASH_A, HASH_B, HASH_C] }),
      );

      await expect(
        service.confirmReset('raw-token', 'history-password-b'),
      ).rejects.toThrow(PASSWORD_REUSED_MESSAGE);

      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    // spec-1-11 AC 3: a policy-rejected attempt against a still-valid token
    // never consumes it — the same token can then succeed with a compliant
    // password.
    it('lets the same token succeed on retry after an earlier policy-rejected attempt', async () => {
      const resetToken = makeResetToken();
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      prisma.usuario.findUnique.mockResolvedValue(makeUsuario());

      await expect(
        service.confirmReset('raw-token', 'short1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();

      prisma.usuario.update.mockResolvedValue(makeUsuario());

      const result = await service.confirmReset('raw-token', PASSWORD);

      expect(result).toBe(true);
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { id: resetToken.id, used: false },
        data: { used: true },
      });
    });

    // Defensive edge case: the Usuario referenced by a valid reset token no
    // longer exists.
    it('rejects when the target Usuario cannot be found, without consuming the token', async () => {
      const resetToken = makeResetToken();
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      prisma.usuario.findUnique.mockResolvedValue(null);

      const result = await service.confirmReset('raw-token', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });
  });
});
