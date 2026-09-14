import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { BootstrapService } from './bootstrap.service';
import { PrismaService } from '../prisma/prisma.service';

type UsuarioCreateArgs = {
  data: {
    email: string;
    passwordHash: string;
    role: string;
    status: string;
  };
};

type PrismaUsuarioMock = {
  usuario: {
    count: jest.Mock<Promise<number>, []>;
    create: jest.Mock<Promise<unknown>, [UsuarioCreateArgs]>;
  };
};

describe('BootstrapService', () => {
  const ORIGINAL_ENV = process.env;

  let prisma: PrismaUsuarioMock;
  let service: BootstrapService;

  beforeEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;

    prisma = {
      usuario: {
        count: jest.fn<Promise<number>, []>(),
        create: jest.fn<Promise<unknown>, [UsuarioCreateArgs]>(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BootstrapService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(BootstrapService);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  // Scenario 1: fresh DB, zero users, both env vars set.
  it('creates exactly one Administrator with an argon2 hash when the DB is empty and both env vars are set', async () => {
    process.env.ADMIN_EMAIL = 'Admin@Example.com';
    process.env.ADMIN_PASSWORD = 'super-secret-password';
    prisma.usuario.count.mockResolvedValue(0);
    prisma.usuario.create.mockResolvedValue({});

    await service.onApplicationBootstrap();

    expect(prisma.usuario.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.usuario.create.mock.calls[0][0];
    expect(data.email).toBe('admin@example.com');
    expect(data.role).toBe('ADMINISTRATOR');
    expect(data.status).toBe('ACTIVE');
    expect(data.passwordHash).not.toBe('super-secret-password');
    await expect(
      argon2.verify(data.passwordHash, 'super-secret-password'),
    ).resolves.toBe(true);
  });

  // Scenario 2 (a): fresh DB, zero users, ADMIN_EMAIL missing.
  it('exits with an error naming ADMIN_EMAIL when it is missing, and creates no user', async () => {
    process.env.ADMIN_PASSWORD = 'super-secret-password';
    prisma.usuario.count.mockResolvedValue(0);

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /ADMIN_EMAIL/,
    );
    expect(prisma.usuario.create).not.toHaveBeenCalled();
  });

  // Scenario 2 (b): fresh DB, zero users, ADMIN_PASSWORD missing.
  it('exits with an error naming ADMIN_PASSWORD when it is missing, and creates no user', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    prisma.usuario.count.mockResolvedValue(0);

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /ADMIN_PASSWORD/,
    );
    expect(prisma.usuario.create).not.toHaveBeenCalled();
  });

  // Scenario 3: DB already has >= 1 user.
  it('creates no new user and raises no error when the database already has a user', async () => {
    prisma.usuario.count.mockResolvedValue(1);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(prisma.usuario.create).not.toHaveBeenCalled();
  });

  // Scenario 4: Postgres unreachable at startup.
  it('propagates the failure and creates no user when Postgres is unreachable', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.ADMIN_PASSWORD = 'super-secret-password';
    prisma.usuario.count.mockRejectedValue(new Error('connection refused'));

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      'connection refused',
    );
    expect(prisma.usuario.create).not.toHaveBeenCalled();
  });

  // spec-1-11 I/O matrix row 4: ADMIN_PASSWORD shorter than
  // PASSWORD_MIN_LENGTH fails startup with a clear error and creates no
  // admin — the same fail-fast posture as a missing env var.
  it('exits with an error naming the length requirement when ADMIN_PASSWORD fails the password policy', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.ADMIN_PASSWORD = 'short1';
    prisma.usuario.count.mockResolvedValue(0);

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /at least 8 characters/,
    );
    expect(prisma.usuario.create).not.toHaveBeenCalled();
  });
});
