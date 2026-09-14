import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Server } from 'http';
import type { Test as SupertestTest } from 'supertest';
import { UsuarioRole } from '@prisma/client';
import {
  UsersController,
  SELF_DEACTIVATION_MESSAGE,
  SELF_ROLE_CHANGE_MESSAGE,
  INVALID_ROLE_MESSAGE,
} from './users.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

function makeRequest(sub: string): AuthenticatedRequest {
  return {
    user: { sub, email: 'caller@example.com', role: UsuarioRole.MANAGER },
  } as AuthenticatedRequest;
}

type HttpMethod = 'get' | 'post';

// Shared by the RBAC rejection tests and the real-guard-chain test below —
// hoisted once so the Manager-or-Administrator routes can't drift out of
// sync between them.
const MANAGER_OR_ADMIN_ROUTES: Array<[HttpMethod, string]> = [
  ['get', '/users'],
  ['post', '/users/target-1/deactivate'],
  ['post', '/users/target-1/reactivate'],
  ['post', '/users/target-1/force-reset-password'],
];

// `POST /users/:id/role` (spec-1-9) is Administrator-only, unlike the routes
// above — kept out of MANAGER_OR_ADMIN_ROUTES so the real-guard-chain test's
// "MANAGER succeeds" expectation isn't accidentally applied to it. Still
// exercised by the overridden-guard RBAC rejection tests below, since those
// only assert on guard wiring (401/403), not on which roles pass.
const ROLE_ROUTE: Array<[HttpMethod, string]> = [
  ['post', '/users/target-1/role'],
];

// A typed stand-in for `request(server)[method](path)` — indexing a real
// `SuperTest<Test>` by a `string`-typed variable degrades every subsequent
// `.expect(...)`/`.set(...)` call to `any` under
// `@typescript-eslint/no-unsafe-*`. This keeps the dynamic dispatch (used by
// the route-table-driven tests below) fully typed.
function sendRequest(
  server: Server,
  method: HttpMethod,
  path: string,
): SupertestTest {
  const agent = request(server);
  return method === 'get' ? agent.get(path) : agent.post(path);
}

describe('UsersController', () => {
  let usersService: {
    list: jest.Mock;
    deactivate: jest.Mock;
    reactivate: jest.Mock;
    changeRole: jest.Mock;
    forcePasswordReset: jest.Mock;
  };
  let controller: UsersController;

  beforeEach(async () => {
    usersService = {
      list: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
      }),
      deactivate: jest.fn().mockResolvedValue({
        id: 'target-1',
        email: 'target@example.com',
        role: UsuarioRole.EDITOR,
        status: 'DEACTIVATED',
      }),
      reactivate: jest.fn().mockResolvedValue({
        id: 'target-1',
        email: 'target@example.com',
        role: UsuarioRole.EDITOR,
        status: 'ACTIVE',
      }),
      changeRole: jest.fn().mockResolvedValue({
        id: 'target-1',
        email: 'target@example.com',
        role: UsuarioRole.MANAGER,
        status: 'ACTIVE',
      }),
      forcePasswordReset: jest.fn().mockResolvedValue({
        id: 'target-1',
        email: 'target@example.com',
        role: UsuarioRole.EDITOR,
        status: 'ACTIVE',
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(UsersController);
  });

  describe('list (dispatch)', () => {
    it('delegates to UsersService.list with default page/pageSize when no query params given', async () => {
      const result = await controller.list(undefined, undefined);

      expect(usersService.list).toHaveBeenCalledWith(1, 50);
      expect(result).toEqual({ data: [], total: 0, page: 1, pageSize: 50 });
    });

    it('parses page/pageSize query params through to the service', async () => {
      await controller.list('2', '20');

      expect(usersService.list).toHaveBeenCalledWith(2, 20);
    });

    it.each([
      ['non-numeric page', 'not-a-number', undefined, 1, 50],
      ['zero page', '0', undefined, 1, 50],
      ['negative page', '-1', undefined, 1, 50],
      ['non-numeric pageSize', undefined, 'abc', 1, 50],
      ['zero pageSize', undefined, '0', 1, 50],
    ])(
      'falls back to defaults for %s',
      async (_label, pageRaw, pageSizeRaw, expectedPage, expectedPageSize) => {
        await controller.list(pageRaw, pageSizeRaw);

        expect(usersService.list).toHaveBeenCalledWith(
          expectedPage,
          expectedPageSize,
        );
      },
    );

    it('clamps an oversized pageSize to the defensive upper bound', async () => {
      await controller.list('1', '999999');

      expect(usersService.list).toHaveBeenCalledWith(1, 200);
    });

    it('passes pageSize=200 through unclamped (exact upper boundary)', async () => {
      await controller.list('1', '200');

      expect(usersService.list).toHaveBeenCalledWith(1, 200);
    });

    it('clamps pageSize=201 down to 200 (one past the boundary)', async () => {
      await controller.list('1', '201');

      expect(usersService.list).toHaveBeenCalledWith(1, 200);
    });

    it('passes page=200 through unclamped (exact upper boundary)', async () => {
      await controller.list('200', '10');

      expect(usersService.list).toHaveBeenCalledWith(200, 10);
    });

    it('clamps page=201 down to 200 (one past the boundary)', async () => {
      await controller.list('201', '10');

      expect(usersService.list).toHaveBeenCalledWith(200, 10);
    });
  });

  describe('deactivate (dispatch)', () => {
    it('delegates to UsersService.deactivate when target differs from caller', async () => {
      const result = await controller.deactivate(
        'target-1',
        makeRequest('caller-1'),
      );

      expect(usersService.deactivate).toHaveBeenCalledWith('target-1');
      expect(result.status).toBe('DEACTIVATED');
    });

    it('rejects self-deactivation with a conflict, never calling the service', async () => {
      await expect(
        controller.deactivate('caller-1', makeRequest('caller-1')),
      ).rejects.toThrow(ConflictException);
      await expect(
        controller.deactivate('caller-1', makeRequest('caller-1')),
      ).rejects.toThrow(SELF_DEACTIVATION_MESSAGE);
      expect(usersService.deactivate).not.toHaveBeenCalled();
    });

    it('propagates a ConflictException raised by the service unchanged', async () => {
      usersService.deactivate.mockRejectedValue(
        new ConflictException('already pending'),
      );

      await expect(
        controller.deactivate('target-1', makeRequest('caller-1')),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('reactivate (dispatch)', () => {
    it('delegates to UsersService.reactivate', async () => {
      const result = await controller.reactivate('target-1');

      expect(usersService.reactivate).toHaveBeenCalledWith('target-1');
      expect(result.status).toBe('ACTIVE');
    });

    it('propagates errors raised by the service unchanged', async () => {
      usersService.reactivate.mockRejectedValue(
        new ConflictException('already pending'),
      );

      await expect(controller.reactivate('target-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('changeRole (dispatch)', () => {
    it('delegates to UsersService.changeRole when target differs from caller and role is valid', async () => {
      const result = await controller.changeRole(
        'target-1',
        { role: UsuarioRole.MANAGER },
        makeRequest('caller-1'),
      );

      expect(usersService.changeRole).toHaveBeenCalledWith(
        'target-1',
        UsuarioRole.MANAGER,
      );
      expect(result.role).toBe(UsuarioRole.MANAGER);
    });

    it('rejects self-role-change with a conflict, never calling the service', async () => {
      await expect(
        controller.changeRole(
          'caller-1',
          { role: UsuarioRole.MANAGER },
          makeRequest('caller-1'),
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        controller.changeRole(
          'caller-1',
          { role: UsuarioRole.MANAGER },
          makeRequest('caller-1'),
        ),
      ).rejects.toThrow(SELF_ROLE_CHANGE_MESSAGE);
      expect(usersService.changeRole).not.toHaveBeenCalled();
    });

    it.each([
      ['missing role', {} as { role: UsuarioRole }],
      ['non-string role', { role: 123 } as unknown as { role: UsuarioRole }],
      [
        'role not in the UsuarioRole enum',
        { role: 'SUPERUSER' } as unknown as { role: UsuarioRole },
      ],
    ])(
      'rejects a malformed/invalid role (%s) with a 400, never calling the service',
      async (_label, body) => {
        await expect(
          controller.changeRole('target-1', body, makeRequest('caller-1')),
        ).rejects.toThrow(BadRequestException);
        await expect(
          controller.changeRole('target-1', body, makeRequest('caller-1')),
        ).rejects.toThrow(INVALID_ROLE_MESSAGE);
        expect(usersService.changeRole).not.toHaveBeenCalled();
      },
    );

    it('propagates errors raised by the service unchanged', async () => {
      usersService.changeRole.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(
        controller.changeRole(
          'unknown',
          { role: UsuarioRole.MANAGER },
          makeRequest('caller-1'),
        ),
      ).rejects.toThrow('User not found');
    });

    it('rejects an invalid role before the self-change check when both apply (400, not 409)', async () => {
      await expect(
        controller.changeRole(
          'caller-1',
          { role: 'SUPERUSER' } as unknown as { role: UsuarioRole },
          makeRequest('caller-1'),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.changeRole(
          'caller-1',
          { role: 'SUPERUSER' } as unknown as { role: UsuarioRole },
          makeRequest('caller-1'),
        ),
      ).rejects.toThrow(INVALID_ROLE_MESSAGE);
      expect(usersService.changeRole).not.toHaveBeenCalled();
    });
  });

  describe('forcePasswordReset (dispatch)', () => {
    it('delegates to UsersService.forcePasswordReset', async () => {
      const result = await controller.forcePasswordReset('target-1');

      expect(usersService.forcePasswordReset).toHaveBeenCalledWith('target-1');
      expect(result.status).toBe('ACTIVE');
    });

    it('does not block self-targeting (unlike deactivate/changeRole)', async () => {
      await controller.forcePasswordReset('caller-1');

      expect(usersService.forcePasswordReset).toHaveBeenCalledWith('caller-1');
    });

    it('propagates a ConflictException raised by the service unchanged', async () => {
      usersService.forcePasswordReset.mockRejectedValue(
        new ConflictException('not active'),
      );

      await expect(controller.forcePasswordReset('target-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('propagates a NotFoundException raised by the service unchanged', async () => {
      usersService.forcePasswordReset.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(controller.forcePasswordReset('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('RBAC rejection (overridden guards)', () => {
    const routes = [...MANAGER_OR_ADMIN_ROUTES, ...ROLE_ROUTE];

    it.each(routes)(
      'rejects %s %s with 403 when RolesGuard denies the caller (Editor/Read-only)',
      async (method, path) => {
        const moduleRef = await Test.createTestingModule({
          controllers: [UsersController],
          providers: [{ provide: UsersService, useValue: usersService }],
        })
          .overrideGuard(JwtAuthGuard)
          .useValue({ canActivate: () => true })
          .overrideGuard(RolesGuard)
          .useValue({
            canActivate: () => {
              throw new ForbiddenException(
                'You do not have permission to perform this action',
              );
            },
          })
          .compile();

        const app = moduleRef.createNestApplication();
        await app.init();

        await sendRequest(app.getHttpServer() as Server, method, path).expect(
          403,
        );

        await app.close();
      },
    );

    it.each(routes)(
      'rejects %s %s with 401 when JwtAuthGuard denies an unauthenticated caller',
      async (method, path) => {
        const moduleRef = await Test.createTestingModule({
          controllers: [UsersController],
          providers: [{ provide: UsersService, useValue: usersService }],
        })
          .overrideGuard(JwtAuthGuard)
          .useValue({
            canActivate: () => {
              throw new UnauthorizedException(
                'Missing or invalid Authorization header',
              );
            },
          })
          .overrideGuard(RolesGuard)
          .useValue({ canActivate: () => true })
          .compile();

        const app = moduleRef.createNestApplication();
        await app.init();

        await sendRequest(app.getHttpServer() as Server, method, path).expect(
          401,
        );

        await app.close();
      },
    );
  });

  describe('RBAC (real guards)', () => {
    // Same posture as InviteController's precedent test (Story 1.7): boots a
    // real app with the real `@UseGuards(JwtAuthGuard, RolesGuard)` chain
    // (real Reflector included) on the real compiled routes, only stubbing
    // `JwtService.verifyAsync` to hand back role claims. A dropped
    // `@Roles(...)` decorator or a swapped guard order would fail this test
    // even though every other test above stays green.
    it('lets MANAGER/ADMINISTRATOR tokens reach the service and rejects EDITOR/READ_ONLY with 403, for all Manager-or-Administrator routes', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [UsersController],
        providers: [
          { provide: UsersService, useValue: usersService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();
      const server = app.getHttpServer() as Server;

      for (const [method, path] of MANAGER_OR_ADMIN_ROUTES) {
        for (const role of [UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR]) {
          verifyAsync.mockResolvedValueOnce({
            sub: 'caller-1',
            email: 'caller@example.com',
            role,
          });

          await sendRequest(server, method, path)
            .set('Authorization', 'Bearer a-valid-token')
            .expect(200);
        }

        for (const role of [UsuarioRole.EDITOR, UsuarioRole.READ_ONLY]) {
          verifyAsync.mockResolvedValueOnce({
            sub: 'caller-2',
            email: 'caller2@example.com',
            role,
          });

          await sendRequest(server, method, path)
            .set('Authorization', 'Bearer a-valid-token')
            .expect(403);
        }
      }

      await app.close();
    });

    // The table-driven test above only checks status codes across all four
    // Manager-or-Administrator routes; this confirms the real handler for
    // POST /users/:id/force-reset-password actually ran and returned the
    // service's payload, not a silently no-op'd success (same gap class
    // already flagged and patched for spec-1-9's equivalent test).
    it('returns the service payload for a successful force-reset-password call', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.ADMINISTRATOR,
      });

      const moduleRef = await Test.createTestingModule({
        controllers: [UsersController],
        providers: [
          { provide: UsersService, useValue: usersService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      const response = await request(app.getHttpServer() as Server)
        .post('/users/target-1/force-reset-password')
        .set('Authorization', 'Bearer a-valid-token')
        .expect(200);

      expect(response.body).toEqual({
        id: 'target-1',
        email: 'target@example.com',
        role: UsuarioRole.EDITOR,
        status: 'ACTIVE',
      });
      expect(usersService.forcePasswordReset).toHaveBeenCalledWith(
        'target-1',
      );

      await app.close();
    });

    // spec-1-9: `POST /users/:id/role` is Administrator-only, unlike the
    // three Manager-or-Administrator routes above — a dropped `@Roles(...)`
    // override (e.g. leaving Manager allowed) would fail this test.
    it('lets ADMINISTRATOR tokens reach the service and rejects MANAGER/EDITOR/READ_ONLY with 403, for POST /users/:id/role', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [UsersController],
        providers: [
          { provide: UsersService, useValue: usersService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();
      const server = app.getHttpServer() as Server;
      const path = '/users/target-role-user/role';

      verifyAsync.mockResolvedValueOnce({
        sub: 'admin-1',
        email: 'admin@example.com',
        role: UsuarioRole.ADMINISTRATOR,
      });
      const successResponse = await request(server)
        .post(path)
        .send({ role: UsuarioRole.EDITOR })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(200);

      // Not just the status code: confirm the real handler actually ran and
      // returned the service's payload, not a silently no-op'd success.
      expect(successResponse.body).toEqual({
        id: 'target-1',
        email: 'target@example.com',
        role: UsuarioRole.MANAGER,
        status: 'ACTIVE',
      });
      expect(usersService.changeRole).toHaveBeenCalledWith(
        'target-role-user',
        UsuarioRole.EDITOR,
      );

      for (const role of [
        UsuarioRole.MANAGER,
        UsuarioRole.EDITOR,
        UsuarioRole.READ_ONLY,
      ]) {
        verifyAsync.mockResolvedValueOnce({
          sub: 'caller-2',
          email: 'caller2@example.com',
          role,
        });

        await request(server)
          .post(path)
          .send({ role: UsuarioRole.EDITOR })
          .set('Authorization', 'Bearer a-valid-token')
          .expect(403);
      }

      await app.close();
    });
  });
});
