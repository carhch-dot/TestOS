import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { LoginService, INVALID_CREDENTIALS_MESSAGE } from './login.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

type Usuario = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  status: string;
};

type PrismaUsuarioMock = {
  usuario: {
    findUnique: jest.Mock<Promise<Usuario | null>, [unknown]>;
  };
};

describe('LoginService', () => {
  let prisma: PrismaUsuarioMock;
  let jwtService: { signAsync: jest.Mock<Promise<string>, [unknown]> };
  let refreshTokenService: { issue: jest.Mock<Promise<string>, [string]> };
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

    const moduleRef = await Test.createTestingModule({
      providers: [
        LoginService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
      ],
    }).compile();

    service = moduleRef.get(LoginService);
  });

  function makeUsuario(overrides: Partial<Usuario> = {}): Usuario {
    return {
      id: 'user-1',
      email: 'user@example.com',
      passwordHash,
      role: 'READ_ONLY',
      status: 'ACTIVE',
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
});
