import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  UsersService,
  USER_NOT_FOUND_MESSAGE,
  PENDING_VERIFICATION_CONFLICT_MESSAGE,
} from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

type Usuario = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  status: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
};

type PrismaMock = {
  usuario: {
    findUnique: jest.Mock<Promise<Usuario | null>, [unknown]>;
    findMany: jest.Mock<Promise<Usuario[]>, [unknown]>;
    count: jest.Mock<Promise<number>, [unknown?]>;
    update: jest.Mock<Promise<Usuario>, [unknown]>;
  };
};

function makeUsuario(overrides: Partial<Usuario> = {}): Usuario {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    passwordHash: 'a-hash',
    role: 'EDITOR',
    status: 'ACTIVE',
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('UsersService', () => {
  let prisma: PrismaMock;
  let refreshTokenService: {
    revokeAllForUser: jest.Mock<Promise<void>, [string]>;
  };
  let service: UsersService;

  beforeEach(async () => {
    prisma = {
      usuario: {
        findUnique: jest.fn<Promise<Usuario | null>, [unknown]>(),
        findMany: jest.fn<Promise<Usuario[]>, [unknown]>(),
        count: jest.fn<Promise<number>, [unknown?]>(),
        update: jest.fn<Promise<Usuario>, [unknown]>(),
      },
    };
    refreshTokenService = {
      revokeAllForUser: jest
        .fn<Promise<void>, [string]>()
        .mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: RefreshTokenService, useValue: refreshTokenService },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('list', () => {
    it('returns the pagination envelope with data/total/page/pageSize', async () => {
      const rows = [makeUsuario({ id: 'a' }), makeUsuario({ id: 'b' })];
      prisma.usuario.findMany.mockResolvedValue(rows);
      prisma.usuario.count.mockResolvedValue(2);

      const result = await service.list(1, 20);

      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.data).toHaveLength(2);
    });

    it('applies skip/take derived from page/pageSize', async () => {
      prisma.usuario.findMany.mockResolvedValue([]);
      prisma.usuario.count.mockResolvedValue(0);

      await service.list(3, 10);

      expect(prisma.usuario.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('never includes passwordHash on any list entry', async () => {
      prisma.usuario.findMany.mockResolvedValue([makeUsuario()]);
      prisma.usuario.count.mockResolvedValue(1);

      const result = await service.list(1, 20);

      expect(result.data[0]).not.toHaveProperty('passwordHash');
    });

    it.each([
      ['ACTIVE, no lock', { status: 'ACTIVE', lockedUntil: null }, 'ACTIVE'],
      [
        'PENDING_VERIFICATION',
        { status: 'PENDING_VERIFICATION', lockedUntil: null },
        'PENDING_VERIFICATION',
      ],
      [
        'DEACTIVATED',
        { status: 'DEACTIVATED', lockedUntil: null },
        'DEACTIVATED',
      ],
      [
        'ACTIVE with a future lockedUntil',
        {
          status: 'ACTIVE',
          lockedUntil: new Date(Date.now() + 60_000),
        },
        'LOCKED',
      ],
      [
        'ACTIVE with a past (expired) lockedUntil',
        {
          status: 'ACTIVE',
          lockedUntil: new Date(Date.now() - 60_000),
        },
        'ACTIVE',
      ],
      [
        'DEACTIVATED takes priority over a future lockedUntil',
        {
          status: 'DEACTIVATED',
          lockedUntil: new Date(Date.now() + 60_000),
        },
        'DEACTIVATED',
      ],
    ])(
      'computes effectiveStatus for %s',
      async (_label, overrides, expected) => {
        prisma.usuario.findMany.mockResolvedValue([makeUsuario(overrides)]);
        prisma.usuario.count.mockResolvedValue(1);

        const result = await service.list(1, 20);

        expect(result.data[0].effectiveStatus).toBe(expected);
      },
    );
  });

  describe('deactivate', () => {
    it('transitions an ACTIVE user to DEACTIVATED and revokes all refresh tokens', async () => {
      const usuario = makeUsuario({ status: 'ACTIVE' });
      prisma.usuario.findUnique.mockResolvedValue(usuario);
      prisma.usuario.update.mockResolvedValue({
        ...usuario,
        status: 'DEACTIVATED',
      });

      const result = await service.deactivate('user-1');

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: 'DEACTIVATED' },
      });
      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(result.status).toBe('DEACTIVATED');
    });

    it('transitions a currently-LOCKED (still ACTIVE) user to DEACTIVATED and revokes tokens', async () => {
      const usuario = makeUsuario({
        status: 'ACTIVE',
        lockedUntil: new Date(Date.now() + 60_000),
      });
      prisma.usuario.findUnique.mockResolvedValue(usuario);
      prisma.usuario.update.mockResolvedValue({
        ...usuario,
        status: 'DEACTIVATED',
      });

      const result = await service.deactivate('user-1');

      expect(result.status).toBe('DEACTIVATED');
      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('is idempotent on an already-DEACTIVATED target: no mutation', async () => {
      const usuario = makeUsuario({ status: 'DEACTIVATED' });
      prisma.usuario.findUnique.mockResolvedValue(usuario);

      const result = await service.deactivate('user-1');

      expect(result.status).toBe('DEACTIVATED');
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('rejects a PENDING_VERIFICATION target with a conflict, mutating nothing', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ status: 'PENDING_VERIFICATION' }),
      );

      await expect(service.deactivate('user-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.deactivate('user-1')).rejects.toThrow(
        PENDING_VERIFICATION_CONFLICT_MESSAGE,
      );
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('rejects an unknown id with a 404, mutating nothing', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.deactivate('unknown')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.deactivate('unknown')).rejects.toThrow(
        USER_NOT_FOUND_MESSAGE,
      );
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('reactivate', () => {
    it('transitions a DEACTIVATED user to ACTIVE, clearing failedLoginAttempts/lockedUntil', async () => {
      const usuario = makeUsuario({
        status: 'DEACTIVATED',
        failedLoginAttempts: 2,
        lockedUntil: new Date(Date.now() + 60_000),
      });
      prisma.usuario.findUnique.mockResolvedValue(usuario);
      prisma.usuario.update.mockResolvedValue({
        ...usuario,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      });

      const result = await service.reactivate('user-1');

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          status: 'ACTIVE',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      expect(result.status).toBe('ACTIVE');
    });

    it('is idempotent on an already-ACTIVE target: no mutation', async () => {
      const usuario = makeUsuario({ status: 'ACTIVE' });
      prisma.usuario.findUnique.mockResolvedValue(usuario);

      const result = await service.reactivate('user-1');

      expect(result.status).toBe('ACTIVE');
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('is idempotent on a currently-LOCKED (still ACTIVE) target: no mutation, lock left untouched', async () => {
      const usuario = makeUsuario({
        status: 'ACTIVE',
        lockedUntil: new Date(Date.now() + 60_000),
      });
      prisma.usuario.findUnique.mockResolvedValue(usuario);

      const result = await service.reactivate('user-1');

      expect(result.status).toBe('ACTIVE');
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('rejects a PENDING_VERIFICATION target with a conflict, mutating nothing', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ status: 'PENDING_VERIFICATION' }),
      );

      await expect(service.reactivate('user-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.reactivate('user-1')).rejects.toThrow(
        PENDING_VERIFICATION_CONFLICT_MESSAGE,
      );
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown id with a 404, mutating nothing', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.reactivate('unknown')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.reactivate('unknown')).rejects.toThrow(
        USER_NOT_FOUND_MESSAGE,
      );
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });
  });
});
