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

type PrismaRefreshTokenMock = {
  refreshToken: {
    create: jest.Mock<Promise<unknown>, [RefreshTokenCreateArgs]>;
  };
};

describe('RefreshTokenService', () => {
  let prisma: PrismaRefreshTokenMock;
  let service: RefreshTokenService;

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        create: jest.fn<Promise<unknown>, [RefreshTokenCreateArgs]>(),
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
});
