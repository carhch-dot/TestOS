import { Test } from '@nestjs/testing';
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
  where: { tokenHash: string };
  data: { revoked: boolean };
};

type PrismaRefreshTokenMock = {
  refreshToken: {
    create: jest.Mock<Promise<unknown>, [RefreshTokenCreateArgs]>;
    updateMany: jest.Mock<
      Promise<{ count: number }>,
      [RefreshTokenUpdateManyArgs]
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
});
