import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsuarioRole } from '@prisma/client';
import {
  UsersService,
  USER_NOT_FOUND_MESSAGE,
  PENDING_VERIFICATION_CONFLICT_MESSAGE,
  FORCE_RESET_CONFLICT_MESSAGE,
} from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { PasswordResetService } from './password-reset.service';

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
  let passwordResetService: {
    requestReset: jest.Mock<Promise<void>, [string]>;
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
    passwordResetService = {
      requestReset: jest
        .fn<Promise<void>, [string]>()
        .mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: PasswordResetService, useValue: passwordResetService },
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

  describe('changeRole', () => {
    it('updates Usuario.role and revokes all refresh tokens', async () => {
      const usuario = makeUsuario({ role: 'EDITOR' });
      prisma.usuario.findUnique.mockResolvedValue(usuario);
      prisma.usuario.update.mockResolvedValue({
        ...usuario,
        role: 'MANAGER',
      });

      const result = await service.changeRole('user-1', UsuarioRole.MANAGER);

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: 'MANAGER' },
      });
      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(result.role).toBe('MANAGER');
    });

    it('applies to a PENDING_VERIFICATION target (no status restriction)', async () => {
      const usuario = makeUsuario({
        role: 'EDITOR',
        status: 'PENDING_VERIFICATION',
      });
      prisma.usuario.findUnique.mockResolvedValue(usuario);
      prisma.usuario.update.mockResolvedValue({
        ...usuario,
        role: 'READ_ONLY',
      });

      const result = await service.changeRole('user-1', UsuarioRole.READ_ONLY);

      expect(prisma.usuario.update).toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(result.role).toBe('READ_ONLY');
    });

    it('applies to a DEACTIVATED target (no status restriction)', async () => {
      const usuario = makeUsuario({
        role: 'EDITOR',
        status: 'DEACTIVATED',
      });
      prisma.usuario.findUnique.mockResolvedValue(usuario);
      prisma.usuario.update.mockResolvedValue({
        ...usuario,
        role: 'ADMINISTRATOR',
      });

      const result = await service.changeRole(
        'user-1',
        UsuarioRole.ADMINISTRATOR,
      );

      expect(prisma.usuario.update).toHaveBeenCalled();
      expect(result.role).toBe('ADMINISTRATOR');
    });

    it('is a no-op on Usuario.role when the target already has the requested role, but still revokes tokens', async () => {
      const usuario = makeUsuario({ role: 'EDITOR' });
      prisma.usuario.findUnique.mockResolvedValue(usuario);

      const result = await service.changeRole('user-1', UsuarioRole.EDITOR);

      expect(result.role).toBe('EDITOR');
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('rejects an unknown id with a 404, mutating nothing and revoking nothing', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(
        service.changeRole('unknown', UsuarioRole.MANAGER),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.changeRole('unknown', UsuarioRole.MANAGER),
      ).rejects.toThrow(USER_NOT_FOUND_MESSAGE);
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('forcePasswordReset', () => {
    it('delegates to PasswordResetService.requestReset(email) for an ACTIVE target', async () => {
      const usuario = makeUsuario({
        status: 'ACTIVE',
        email: 'target@example.com',
      });
      prisma.usuario.findUnique.mockResolvedValue(usuario);

      const result = await service.forcePasswordReset('user-1');

      expect(passwordResetService.requestReset).toHaveBeenCalledWith(
        'target@example.com',
      );
      expect(result.status).toBe('ACTIVE');
      expect(result.id).toBe('user-1');
    });

    it('never mutates the Usuario row itself', async () => {
      const usuario = makeUsuario({ status: 'ACTIVE' });
      prisma.usuario.findUnique.mockResolvedValue(usuario);

      await service.forcePasswordReset('user-1');

      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('rejects a PENDING_VERIFICATION target with a conflict, calling PasswordResetService for nothing', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ status: 'PENDING_VERIFICATION' }),
      );

      await expect(service.forcePasswordReset('user-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.forcePasswordReset('user-1')).rejects.toThrow(
        FORCE_RESET_CONFLICT_MESSAGE,
      );
      expect(passwordResetService.requestReset).not.toHaveBeenCalled();
    });

    it('rejects a DEACTIVATED target with a conflict, calling PasswordResetService for nothing', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ status: 'DEACTIVATED' }),
      );

      await expect(service.forcePasswordReset('user-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.forcePasswordReset('user-1')).rejects.toThrow(
        FORCE_RESET_CONFLICT_MESSAGE,
      );
      expect(passwordResetService.requestReset).not.toHaveBeenCalled();
    });

    it('applies to a currently-LOCKED (still ACTIVE) target', async () => {
      const usuario = makeUsuario({
        status: 'ACTIVE',
        lockedUntil: new Date(Date.now() + 60_000),
      });
      prisma.usuario.findUnique.mockResolvedValue(usuario);

      const result = await service.forcePasswordReset('user-1');

      expect(passwordResetService.requestReset).toHaveBeenCalledWith(
        usuario.email,
      );
      expect(result.status).toBe('ACTIVE');
    });

    it('rejects an unknown id with a 404, calling PasswordResetService for nothing', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.forcePasswordReset('unknown')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.forcePasswordReset('unknown')).rejects.toThrow(
        USER_NOT_FOUND_MESSAGE,
      );
      expect(passwordResetService.requestReset).not.toHaveBeenCalled();
    });
  });
});
