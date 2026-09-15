import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  LoginService,
  INVALID_CREDENTIALS_MESSAGE,
  ACCOUNT_LOCKED_MESSAGE,
} from './login.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { MailService } from '../mail/mail.service';

type Usuario = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  status: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
};

type PrismaUsuarioMock = {
  usuario: {
    findUnique: jest.Mock<Promise<Usuario | null>, [unknown]>;
    update: jest.Mock<Promise<Usuario>, [unknown]>;
  };
};

describe('LoginService', () => {
  let prisma: PrismaUsuarioMock;
  let jwtService: { signAsync: jest.Mock<Promise<string>, [unknown]> };
  let refreshTokenService: { issue: jest.Mock<Promise<string>, [string]> };
  let mailService: { send: jest.Mock<Promise<void>, [string, string, string]> };
  let service: LoginService;

  const PASSWORD = 'correct-horse-battery-staple';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash(PASSWORD);
  });

  beforeEach(async () => {
    prisma = {
      usuario: {
        findUnique: jest.fn<Promise<Usuario | null>, [unknown]>(),
        // Default: simulates Prisma's atomic increment starting from 0 (a
        // fresh first failure). Tests exercising a specific starting count
        // override this with their own mockResolvedValueOnce.
        update: jest
          .fn<Promise<Usuario>, [unknown]>()
          .mockResolvedValue(makeUsuario({ failedLoginAttempts: 1 })),
      },
    };
    jwtService = {
      signAsync: jest
        .fn<Promise<string>, [unknown]>()
        .mockResolvedValue('signed-jwt'),
    };
    refreshTokenService = {
      issue: jest
        .fn<Promise<string>, [string]>()
        .mockResolvedValue('raw-refresh-token'),
    };
    mailService = {
      send: jest
        .fn<Promise<void>, [string, string, string]>()
        .mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LoginService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = moduleRef.get(LoginService);
  });

  afterEach(() => {
    delete process.env.LOGIN_LOCKOUT_MAX_ATTEMPTS;
    delete process.env.LOGIN_LOCKOUT_DURATION_MINUTES;
  });

  function makeUsuario(overrides: Partial<Usuario> = {}): Usuario {
    return {
      id: 'user-1',
      email: 'user@example.com',
      passwordHash,
      role: 'READ_ONLY',
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      lockedUntil: null,
      ...overrides,
    };
  }

  // Scenario 1: correct email + password, user ACTIVE.
  it('returns an access token and a refresh token for correct credentials on an ACTIVE user', async () => {
    const usuario = makeUsuario();
    prisma.usuario.findUnique.mockResolvedValue(usuario);

    const result = await service.login('user@example.com', PASSWORD);

    expect(result.accessToken).toBe('signed-jwt');
    expect(result.refreshToken).toBe('raw-refresh-token');
    expect(refreshTokenService.issue).toHaveBeenCalledTimes(1);
    expect(refreshTokenService.issue).toHaveBeenCalledWith(usuario.id);
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: usuario.id, email: usuario.email }),
    );
    // No pending attempts/lock to clear: no extra write.
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });

  // Scenario 4: email with different capitalization than stored resolves to the same user.
  it('resolves to the same user regardless of email capitalization', async () => {
    const usuario = makeUsuario({ email: 'user@example.com' });
    prisma.usuario.findUnique.mockResolvedValue(usuario);

    await service.login('User@Example.COM', PASSWORD);

    expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
    });
    expect(refreshTokenService.issue).toHaveBeenCalledWith(usuario.id);
  });

  // Scenario 2: correct email, wrong password.
  it('throws the generic invalid-credentials error for a wrong password', async () => {
    prisma.usuario.findUnique.mockResolvedValue(makeUsuario());

    await expect(
      service.login('user@example.com', 'totally-wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.login('user@example.com', 'totally-wrong-password'),
    ).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    expect(refreshTokenService.issue).not.toHaveBeenCalled();
  });

  // Scenario 3: unknown email.
  it('throws the same generic invalid-credentials error for an unknown email', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null);

    await expect(
      service.login('nobody@example.com', PASSWORD),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login('nobody@example.com', PASSWORD)).rejects.toThrow(
      INVALID_CREDENTIALS_MESSAGE,
    );
    expect(refreshTokenService.issue).not.toHaveBeenCalled();
    // Unknown email: no Usuario row to update, and never should be.
    expect(prisma.usuario.update).not.toHaveBeenCalled();
    expect(mailService.send).not.toHaveBeenCalled();
  });

  // Scenario 5: non-ACTIVE status (PENDING_VERIFICATION and DEACTIVATED).
  it.each(['PENDING_VERIFICATION', 'DEACTIVATED'])(
    'throws the same generic invalid-credentials error when status is %s',
    async (status) => {
      prisma.usuario.findUnique.mockResolvedValue(makeUsuario({ status }));

      await expect(
        service.login('user@example.com', PASSWORD),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.login('user@example.com', PASSWORD)).rejects.toThrow(
        INVALID_CREDENTIALS_MESSAGE,
      );
      expect(refreshTokenService.issue).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(mailService.send).not.toHaveBeenCalled();
    },
  );

  // Byte-identical failure bodies: all three failure paths throw the exact
  // same exception type/message, so Nest's exception filter serializes them
  // identically.
  it('produces the exact same error message across all three failure scenarios', async () => {
    async function captureFailure(
      email: string,
      password: string,
    ): Promise<UnauthorizedException> {
      try {
        await service.login(email, password);
        throw new Error('expected service.login to reject');
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) {
          throw error;
        }
        return error;
      }
    }

    prisma.usuario.findUnique.mockResolvedValueOnce(makeUsuario());
    const wrongPassword = await captureFailure('user@example.com', 'wrong');

    prisma.usuario.findUnique.mockResolvedValueOnce(null);
    const unknownEmail = await captureFailure('nobody@example.com', PASSWORD);

    prisma.usuario.findUnique.mockResolvedValueOnce(
      makeUsuario({ status: 'DEACTIVATED' }),
    );
    const inactiveUser = await captureFailure('user@example.com', PASSWORD);

    expect(wrongPassword.getResponse()).toEqual(unknownEmail.getResponse());
    expect(unknownEmail.getResponse()).toEqual(inactiveUser.getResponse());
  });

  // --- spec-1-4: lockout after failed attempts ---------------------------

  describe('lockout', () => {
    it('increments failedLoginAttempts atomically on a wrong-password attempt below the threshold', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ failedLoginAttempts: 1 }),
      );
      // Simulates Prisma's server-side atomic increment: 1 -> 2.
      prisma.usuario.update.mockResolvedValueOnce(
        makeUsuario({ failedLoginAttempts: 2 }),
      );

      await expect(
        service.login('user@example.com', 'wrong-password'),
      ).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('locks the account and sends a lockout email once the configured threshold is reached', async () => {
      process.env.LOGIN_LOCKOUT_MAX_ATTEMPTS = '3';
      process.env.LOGIN_LOCKOUT_DURATION_MINUTES = '30';
      const before = Date.now();
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ failedLoginAttempts: 2 }),
      );
      // Simulates Prisma's server-side atomic increment: 2 -> 3.
      prisma.usuario.update.mockResolvedValueOnce(
        makeUsuario({ failedLoginAttempts: 3 }),
      );

      await expect(
        service.login('user@example.com', 'wrong-password'),
      ).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);

      expect(prisma.usuario.update).toHaveBeenCalledTimes(2);
      expect(prisma.usuario.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'user-1' },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      const lockUpdateArg = prisma.usuario.update.mock.calls[1][0] as {
        where: { id: string };
        data: { lockedUntil: Date };
      };
      expect(lockUpdateArg.where).toEqual({ id: 'user-1' });
      expect(lockUpdateArg.data.lockedUntil.getTime()).toBeGreaterThanOrEqual(
        before + 30 * 60_000,
      );
      expect(mailService.send).toHaveBeenCalledTimes(1);
      expect(mailService.send).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
        expect.any(String),
      );
    });

    it('does not wait on a slow MailService.send before returning the response', async () => {
      process.env.LOGIN_LOCKOUT_MAX_ATTEMPTS = '3';
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ failedLoginAttempts: 2 }),
      );
      prisma.usuario.update.mockResolvedValueOnce(
        makeUsuario({ failedLoginAttempts: 3 }),
      );
      // A mail send that never settles: the response must not depend on it.
      mailService.send.mockReturnValue(new Promise(() => {}));

      await expect(
        service.login('user@example.com', 'wrong-password'),
      ).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    });

    it('rejects a login attempt on a locked account with the distinct locked message, even with the correct password', async () => {
      const lockedUntil = new Date(Date.now() + 10 * 60_000);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ failedLoginAttempts: 3, lockedUntil }),
      );

      await expect(service.login('user@example.com', PASSWORD)).rejects.toThrow(
        ACCOUNT_LOCKED_MESSAGE,
      );
      expect(refreshTokenService.issue).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('clears an expired lock and evaluates a correct-password attempt normally', async () => {
      const lockedUntil = new Date(Date.now() - 60_000);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ failedLoginAttempts: 3, lockedUntil }),
      );

      const result = await service.login('user@example.com', PASSWORD);

      expect(result.accessToken).toBe('signed-jwt');
      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });

    it('clears an expired lock and evaluates a wrong-password attempt as a fresh first failure', async () => {
      const lockedUntil = new Date(Date.now() - 60_000);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ failedLoginAttempts: 3, lockedUntil }),
      );

      await expect(
        service.login('user@example.com', 'wrong-password'),
      ).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failedLoginAttempts: 1, lockedUntil: null },
      });
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('resets failedLoginAttempts to 0 on a successful login after prior failures', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ failedLoginAttempts: 2 }),
      );

      await service.login('user@example.com', PASSWORD);

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });
  });
});
