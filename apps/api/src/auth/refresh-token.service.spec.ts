import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { RefreshTokenService } from './refresh-token.service';
import { PrismaService } from '../prisma/prisma.service';

type RefreshTokenCreateArgs = {
  data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  };
};

type RefreshTokenUpdateManyArgs = {
  where: {
    tokenHash?: string;
    id?: string;
    revoked?: boolean;
    userId?: string;
  };
  data: { revoked: boolean };
};

type RefreshTokenRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revoked: boolean;
  createdAt: Date;
};

type PrismaRefreshTokenMock = {
  refreshToken: {
    create: jest.Mock<Promise<unknown>, [RefreshTokenCreateArgs]>;
    updateMany: jest.Mock<
      Promise<{ count: number }>,
      [RefreshTokenUpdateManyArgs]
    >;
    findUnique: jest.Mock<
      Promise<RefreshTokenRow | null>,
      [{ where: { tokenHash: string } }]
    >;
  };
};

describe('RefreshTokenService', () => {
  let prisma: PrismaRefreshTokenMock;
  let service: RefreshTokenService;

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        create: jest.fn<Promise<unknown>, [RefreshTokenCreateArgs]>(),
        updateMany: jest
          .fn<Promise<{ count: number }>, [RefreshTokenUpdateManyArgs]>()
          .mockResolvedValue({ count: 1 }),
        findUnique: jest.fn<
          Promise<RefreshTokenRow | null>,
          [{ where: { tokenHash: string } }]
        >(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(RefreshTokenService);
  });

  it('persists the SHA-256 hash of the returned raw token, never the raw value itself', async () => {
    prisma.refreshToken.create.mockResolvedValue({});

    const raw = await service.issue('user-1');

    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.refreshToken.create.mock.calls[0][0];

    expect(data.userId).toBe('user-1');
    expect(data.tokenHash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(data.tokenHash).not.toBe(raw);
    expect(data.expiresAt).toBeInstanceOf(Date);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('generates a different raw token (and hash) on each call', async () => {
    prisma.refreshToken.create.mockResolvedValue({});

    const first = await service.issue('user-1');
    const second = await service.issue('user-1');

    expect(first).not.toBe(second);
  });

  describe('revoke', () => {
    it('marks the row matching the raw token as revoked', async () => {
      const raw = 'some-raw-refresh-token';

      await service.revoke(raw);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      const { where, data } = prisma.refreshToken.updateMany.mock.calls[0][0];
      expect(where.tokenHash).toBe(
        createHash('sha256').update(raw).digest('hex'),
      );
      expect(data.revoked).toBe(true);
    });

    it('is idempotent when nothing matches (no error, no distinguishable outcome)', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revoke('unknown-token')).resolves.toBeUndefined();
    });
  });

  describe('findByRawToken', () => {
    it('looks up the row by the SHA-256 hash of the raw token', async () => {
      const raw = 'some-raw-refresh-token';
      const row: RefreshTokenRow = {
        id: 'token-1',
        userId: 'user-1',
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        revoked: false,
        createdAt: new Date(),
      };
      prisma.refreshToken.findUnique.mockResolvedValue(row);

      const result = await service.findByRawToken(raw);

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: createHash('sha256').update(raw).digest('hex') },
      });
      expect(result).toBe(row);
    });

    it('returns null when no row matches', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.findByRawToken('unknown')).resolves.toBeNull();
    });
  });

  describe('consume', () => {
    it('atomically revokes the row only if it is not already revoked', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.consume('token-1');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'token-1', revoked: false },
        data: { revoked: true },
      });
      expect(result).toEqual({ count: 1 });
    });

    it('returns a zero count when the row is already revoked (lost race or replay)', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.consume('token-1');

      expect(result).toEqual({ count: 0 });
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every not-yet-revoked refresh token row for the given user', async () => {
      await service.revokeAllForUser('user-1');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revoked: false },
        data: { revoked: true },
      });
    });

    it('logs a warning naming the user id, without leaking any token value', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await service.revokeAllForUser('user-1');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = String(warnSpy.mock.calls[0][0]);
      expect(message).toContain('user-1');

      warnSpy.mockRestore();
    });
  });
});
