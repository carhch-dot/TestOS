import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Server } from 'http';
import type { Test as SupertestTest } from 'supertest';
import { UsuarioRole } from '@prisma/client';
import { UsersController, SELF_DEACTIVATION_MESSAGE } from './users.controller';
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
// hoisted once so the three routes can't drift out of sync between them.
const THREE_ROUTES: Array<[HttpMethod, string]> = [
  ['get', '/users'],
  ['post', '/users/target-1/deactivate'],
  ['post', '/users/target-1/reactivate'],
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

  describe('RBAC rejection (overridden guards)', () => {
    const routes = THREE_ROUTES;

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
    it('lets MANAGER/ADMINISTRATOR tokens reach the service and rejects EDITOR/READ_ONLY with 403, for all three routes', async () => {
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

      for (const [method, path] of THREE_ROUTES) {
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
  });
});
