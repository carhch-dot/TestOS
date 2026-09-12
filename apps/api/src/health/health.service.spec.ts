import { Test } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaQueryRawMock = {
  $queryRaw: jest.Mock<Promise<unknown>, unknown[]>;
};

describe('HealthService', () => {
  let prisma: PrismaQueryRawMock;
  let service: HealthService;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn<Promise<unknown>, unknown[]>(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [HealthService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves when the database is reachable', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(service.checkDatabaseConnection()).resolves.toBeUndefined();
  });

  it('rejects with a wrapped "Postgres is unreachable" message when the query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    await expect(service.checkDatabaseConnection()).rejects.toThrow(
      'Postgres is unreachable: connection refused',
    );
  });
});
