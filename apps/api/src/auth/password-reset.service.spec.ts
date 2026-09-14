import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { PasswordResetService } from './password-reset.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { MailService } from '../mail/mail.service';

type Usuario = {
  id: string;
  email: string;
  passwordHash: string;
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
  let prisma: PrismaMock;
  let refreshTokenService: {
    revokeAllForUser: jest.Mock<Promise<void>, [string]>;
  };
  let mailService: { send: jest.Mock<Promise<void>, [string, string, string]> };
  let service: PasswordResetService;

  const PASSWORD = 'a-new-password';

  function makeUsuario(overrides: Partial<Usuario> = {}): Usuario {
    return {
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: 'old-hash',
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
      prisma.usuario.update.mockResolvedValue(makeUsuario());

      const result = await service.confirmReset('raw-token', PASSWORD);

      expect(result).toBe(true);
      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hashOf('raw-token') },
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
          failedLoginAttempts: number;
          lockedUntil: null;
        };
      };
      expect(where).toEqual({ id: resetToken.userId });
      expect(typeof data.passwordHash).toBe('string');
      expect(data.passwordHash).not.toBe(PASSWORD);
      // A successful reset also clears any active lockout (Story 1.4) — a
      // locked-out user who proves ownership via the emailed token can log
      // in immediately rather than waiting out the lockout timer.
      expect(data.failedLoginAttempts).toBe(0);
      expect(data.lockedUntil).toBeNull();

      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        resetToken.userId,
      );
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
    it('rejects the loser of a concurrent race on the same token (lost the atomic consume)', async () => {
      const resetToken = makeResetToken();
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      // Simulates the second request's updateMany finding the row already
      // flipped to used:true by the winner, so the where clause matches zero
      // rows.
      prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.confirmReset('raw-token', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
