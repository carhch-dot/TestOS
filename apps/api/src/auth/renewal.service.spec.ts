import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { RenewalService, REFRESH_FAILED_MESSAGE } from './renewal.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

type Usuario = {
  id: string;
  email: string;
  role: string;
  status: string;
  lockedUntil: Date | null;
};

type RefreshTokenRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revoked: boolean;
  createdAt: Date;
};

type PrismaUsuarioMock = {
  usuario: {
    findUnique: jest.Mock<Promise<Usuario | null>, [unknown]>;
  };
};

type RefreshTokenServiceMock = {
  findByRawToken: jest.Mock<Promise<RefreshTokenRow | null>, [string]>;
  consume: jest.Mock<Promise<{ count: number }>, [string]>;
  revokeAllForUser: jest.Mock<Promise<void>, [string]>;
  issue: jest.Mock<Promise<string>, [string]>;
};

describe('RenewalService', () => {
  let prisma: PrismaUsuarioMock;
  let jwtService: { signAsync: jest.Mock<Promise<string>, [unknown]> };
  let refreshTokenService: RefreshTokenServiceMock;
  let service: RenewalService;

  function makeUsuario(overrides: Partial<Usuario> = {}): Usuario {
    return {
      id: 'user-1',
      email: 'user@example.com',
      role: 'READ_ONLY',
      status: 'ACTIVE',
      lockedUntil: null,
      ...overrides,
    };
  }

  function makeRow(overrides: Partial<RefreshTokenRow> = {}): RefreshTokenRow {
    return {
      id: 'token-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      revoked: false,
      createdAt: new Date(),
      ...overrides,
    };
  }

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
      findByRawToken: jest.fn<Promise<RefreshTokenRow | null>, [string]>(),
      consume: jest
        .fn<Promise<{ count: number }>, [string]>()
        .mockResolvedValue({ count: 1 }),
      revokeAllForUser: jest
        .fn<Promise<void>, [string]>()
        .mockResolvedValue(undefined),
      issue: jest
        .fn<Promise<string>, [string]>()
        .mockResolvedValue('new-raw-refresh-token'),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RenewalService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
      ],
    }).compile();

    service = moduleRef.get(RenewalService);
  });

  // Scenario 1: valid, unexpired, not-yet-used refresh token.
  it('rotates a valid token into a new access+refresh pair', async () => {
    const row = makeRow();
    refreshTokenService.findByRawToken.mockResolvedValue(row);
    prisma.usuario.findUnique.mockResolvedValue(makeUsuario());

    const result = await service.renew('raw-token');

    expect(result.accessToken).toBe('signed-jwt');
    expect(result.refreshToken).toBe('new-raw-refresh-token');
    expect(refreshTokenService.consume).toHaveBeenCalledWith(row.id);
    expect(refreshTokenService.issue).toHaveBeenCalledWith('user-1');
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'READ_ONLY',
    });
    expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
  });

  // Scenario 2: unknown token (no matching row).
  it('rejects an unknown token without touching anything', async () => {
    refreshTokenService.findByRawToken.mockResolvedValue(null);

    await expect(service.renew('unknown')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.renew('unknown')).rejects.toThrow(
      REFRESH_FAILED_MESSAGE,
    );
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(refreshTokenService.consume).not.toHaveBeenCalled();
    expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
  });

  // Scenario 3: expired but not revoked.
  it('rejects an expired token without any chain revocation', async () => {
    const row = makeRow({ expiresAt: new Date(Date.now() - 1000) });
    refreshTokenService.findByRawToken.mockResolvedValue(row);

    await expect(service.renew('raw-token')).rejects.toThrow(
      REFRESH_FAILED_MESSAGE,
    );
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(refreshTokenService.consume).not.toHaveBeenCalled();
    expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
  });

  // Scenario 4: already-revoked token presented again (reuse/replay).
  it('revokes every token for the user when a reused/replayed token is presented, without ever consulting Usuario or consume', async () => {
    const row = makeRow({ revoked: true });
    refreshTokenService.findByRawToken.mockResolvedValue(row);

    await expect(service.renew('raw-token')).rejects.toThrow(
      REFRESH_FAILED_MESSAGE,
    );
    expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(refreshTokenService.consume).not.toHaveBeenCalled();
    expect(refreshTokenService.issue).not.toHaveBeenCalled();
  });

  // A token that is BOTH already-revoked AND expired must still trigger
  // chain revocation: reuse/replay takes priority over the plain-expiry
  // rejection, since presenting an already-consumed token is itself the
  // signal of compromise regardless of what else is true about it.
  it('revokes the chain for a token that is already revoked even when it is also expired', async () => {
    const row = makeRow({
      revoked: true,
      expiresAt: new Date(Date.now() - 1000),
    });
    refreshTokenService.findByRawToken.mockResolvedValue(row);

    await expect(service.renew('raw-token')).rejects.toThrow(
      REFRESH_FAILED_MESSAGE,
    );
    expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith('user-1');
  });

  // Scenario 5: two concurrent requests present the same valid token.
  it('treats the loser of a concurrent race as reuse and revokes the chain', async () => {
    const row = makeRow();
    refreshTokenService.findByRawToken.mockResolvedValue(row);
    prisma.usuario.findUnique.mockResolvedValue(makeUsuario());

    // First call: wins the atomic consume.
    refreshTokenService.consume.mockResolvedValueOnce({ count: 1 });
    const first = await service.renew('raw-token');
    expect(first.accessToken).toBe('signed-jwt');
    expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();

    // Second call against the same underlying row: loses the race.
    refreshTokenService.consume.mockResolvedValueOnce({ count: 0 });
    await expect(service.renew('raw-token')).rejects.toThrow(
      REFRESH_FAILED_MESSAGE,
    );
    expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith('user-1');
  });

  // Scenario 6: token belongs to a user whose status is no longer ACTIVE.
  it.each(['PENDING_VERIFICATION', 'DEACTIVATED'])(
    'rejects a token belonging to a %s user without any chain revocation',
    async (status) => {
      const row = makeRow();
      refreshTokenService.findByRawToken.mockResolvedValue(row);
      prisma.usuario.findUnique.mockResolvedValue(makeUsuario({ status }));

      await expect(service.renew('raw-token')).rejects.toThrow(
        REFRESH_FAILED_MESSAGE,
      );
      expect(refreshTokenService.consume).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    },
  );

  // Story 1.4 lockout: a currently-locked-out user cannot renew either, but
  // this is not reuse/theft, so no chain revocation.
  it('rejects a token belonging to a currently locked-out user without any chain revocation', async () => {
    const row = makeRow();
    refreshTokenService.findByRawToken.mockResolvedValue(row);
    prisma.usuario.findUnique.mockResolvedValue(
      makeUsuario({ lockedUntil: new Date(Date.now() + 60_000) }),
    );

    await expect(service.renew('raw-token')).rejects.toThrow(
      REFRESH_FAILED_MESSAGE,
    );
    expect(refreshTokenService.consume).not.toHaveBeenCalled();
    expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('allows renewal for a user whose lock has already expired', async () => {
    const row = makeRow();
    refreshTokenService.findByRawToken.mockResolvedValue(row);
    prisma.usuario.findUnique.mockResolvedValue(
      makeUsuario({ lockedUntil: new Date(Date.now() - 60_000) }),
    );

    const result = await service.renew('raw-token');

    expect(result.accessToken).toBe('signed-jwt');
  });

  // Every failure path must be byte-identical to the caller.
  it('produces the exact same error across every failure scenario', async () => {
    async function captureFailure(): Promise<UnauthorizedException> {
      try {
        await service.renew('raw-token');
        throw new Error('expected service.renew to reject');
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) {
          throw error;
        }
        return error;
      }
    }

    refreshTokenService.findByRawToken.mockResolvedValueOnce(null);
    const unknown = await captureFailure();

    refreshTokenService.findByRawToken.mockResolvedValueOnce(
      makeRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const expired = await captureFailure();

    refreshTokenService.findByRawToken.mockResolvedValueOnce(makeRow());
    prisma.usuario.findUnique.mockResolvedValueOnce(
      makeUsuario({ status: 'DEACTIVATED' }),
    );
    const inactive = await captureFailure();

    refreshTokenService.findByRawToken.mockResolvedValueOnce(makeRow());
    prisma.usuario.findUnique.mockResolvedValueOnce(
      makeUsuario({ lockedUntil: new Date(Date.now() + 60_000) }),
    );
    const lockedOut = await captureFailure();

    refreshTokenService.findByRawToken.mockResolvedValueOnce(makeRow());
    prisma.usuario.findUnique.mockResolvedValueOnce(makeUsuario());
    refreshTokenService.consume.mockResolvedValueOnce({ count: 0 });
    const reused = await captureFailure();

    refreshTokenService.findByRawToken.mockResolvedValueOnce(
      makeRow({ revoked: true }),
    );
    const revokedReuse = await captureFailure();

    const responses = [
      unknown,
      expired,
      inactive,
      lockedOut,
      reused,
      revokedReuse,
    ];
    for (const failure of responses) {
      expect(failure.getResponse()).toEqual(unknown.getResponse());
      expect(failure.getStatus()).toBe(unknown.getStatus());
    }
  });
});
