import { Test } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Server } from 'http';
import { TipoAccion, UsuarioRole } from '@prisma/client';
import {
  AuditController,
  INVALID_TIPO_ACCION_MESSAGE,
  INVALID_DESDE_MESSAGE,
  INVALID_HASTA_MESSAGE,
} from './audit.controller';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const EMPTY_RESULT = { data: [], total: 0, page: 1, pageSize: 50 };

describe('AuditController', () => {
  let auditService: { list: jest.Mock };
  let controller: AuditController;

  beforeEach(async () => {
    auditService = {
      list: jest.fn().mockResolvedValue(EMPTY_RESULT),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: auditService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(AuditController);
  });

  describe('list (dispatch)', () => {
    it('delegates to AuditService.list with default page/pageSize and no filters when nothing is supplied', async () => {
      const result = await controller.list();

      expect(auditService.list).toHaveBeenCalledWith(
        {
          usuarioId: undefined,
          entidad: undefined,
          entidadId: undefined,
          tipoAccion: undefined,
          desde: undefined,
          hasta: undefined,
        },
        1,
        50,
      );
      expect(result).toEqual(EMPTY_RESULT);
    });

    it('parses page/pageSize query params through to the service', async () => {
      await controller.list('2', '20');

      expect(auditService.list).toHaveBeenCalledWith(expect.anything(), 2, 20);
    });

    it.each([
      ['non-numeric page', 'not-a-number', undefined, 1, 50],
      ['zero page', '0', undefined, 1, 50],
      ['negative page', '-1', undefined, 1, 50],
      ['non-numeric pageSize', undefined, 'abc', 1, 50],
      ['zero pageSize', undefined, '0', 1, 50],
      ['negative pageSize', undefined, '-1', 1, 50],
    ])(
      'falls back to defaults for %s',
      async (_label, pageRaw, pageSizeRaw, expectedPage, expectedPageSize) => {
        await controller.list(pageRaw, pageSizeRaw);

        expect(auditService.list).toHaveBeenCalledWith(
          expect.anything(),
          expectedPage,
          expectedPageSize,
        );
      },
    );

    it('clamps an oversized pageSize to the defensive upper bound', async () => {
      await controller.list('1', '999999');

      expect(auditService.list).toHaveBeenCalledWith(expect.anything(), 1, 200);
    });

    it('passes pageSize=200 through unclamped (exact upper boundary)', async () => {
      await controller.list('1', '200');

      expect(auditService.list).toHaveBeenCalledWith(expect.anything(), 1, 200);
    });

    it('clamps pageSize=201 down to 200 (one past the boundary)', async () => {
      await controller.list('1', '201');

      expect(auditService.list).toHaveBeenCalledWith(expect.anything(), 1, 200);
    });

    it('passes page=200 through unclamped (exact upper boundary)', async () => {
      await controller.list('200', '10');

      expect(auditService.list).toHaveBeenCalledWith(
        expect.anything(),
        200,
        10,
      );
    });

    it('clamps page=201 down to 200 (one past the boundary)', async () => {
      await controller.list('201', '10');

      expect(auditService.list).toHaveBeenCalledWith(
        expect.anything(),
        200,
        10,
      );
    });

    it('passes usuarioId/entidad/entidadId filters through unchanged', async () => {
      await controller.list(
        undefined,
        undefined,
        'user-1',
        'ItemConfiguracion',
        'item-1',
      );

      expect(auditService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: 'user-1',
          entidad: 'ItemConfiguracion',
          entidadId: 'item-1',
        }),
        1,
        50,
      );
    });

    it.each(['usuarioId', 'entidad', 'entidadId'] as const)(
      'treats an empty-string %s as "no filter," not "filter on the empty string"',
      async (field) => {
        const args: Array<string | undefined> = [
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        ];
        const index = { usuarioId: 2, entidad: 3, entidadId: 4 }[field];
        args[index] = '';

        await controller.list(...(args as Parameters<typeof controller.list>));

        expect(auditService.list).toHaveBeenCalledWith(
          expect.objectContaining({ [field]: undefined }),
          1,
          50,
        );
      },
    );

    it.each(['usuarioId', 'entidad', 'entidadId'] as const)(
      'rejects a repeated %s query key (parsed as an array) with a 400, never calling the service',
      async (field) => {
        const args: Array<string | string[] | undefined> = [
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        ];
        const index = { usuarioId: 2, entidad: 3, entidadId: 4 }[field];
        args[index] = ['a', 'b'];

        await expect(
          controller.list(...(args as Parameters<typeof controller.list>)),
        ).rejects.toThrow(BadRequestException);
        expect(auditService.list).not.toHaveBeenCalled();
      },
    );

    it('parses a valid tipoAccion filter into the TipoAccion enum value', async () => {
      await controller.list(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        TipoAccion.UPDATE,
      );

      expect(auditService.list).toHaveBeenCalledWith(
        expect.objectContaining({ tipoAccion: TipoAccion.UPDATE }),
        1,
        50,
      );
    });

    it('parses valid desde/hasta filters into the exact Dates supplied (not swapped)', async () => {
      await controller.list(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '2026-01-01',
        '2026-12-31',
      );

      const [filters] = auditService.list.mock.calls[0] as [
        { desde?: Date; hasta?: Date },
      ];
      expect(filters.desde).toEqual(new Date('2026-01-01'));
      expect(filters.hasta).toEqual(new Date('2026-12-31'));
    });
  });

  describe('list (validation rejections)', () => {
    it('rejects an invalid tipoAccion with a 400, never calling the service', async () => {
      await expect(
        controller.list(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'NOT_REAL',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.list(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'NOT_REAL',
        ),
      ).rejects.toThrow(INVALID_TIPO_ACCION_MESSAGE);
      expect(auditService.list).not.toHaveBeenCalled();
    });

    it('rejects an unparseable desde with a 400, never calling the service', async () => {
      await expect(
        controller.list(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'not-a-date',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.list(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'not-a-date',
        ),
      ).rejects.toThrow(INVALID_DESDE_MESSAGE);
      expect(auditService.list).not.toHaveBeenCalled();
    });

    it('rejects an unparseable hasta with a 400, never calling the service', async () => {
      await expect(
        controller.list(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'not-a-date',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.list(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'not-a-date',
        ),
      ).rejects.toThrow(INVALID_HASTA_MESSAGE);
      expect(auditService.list).not.toHaveBeenCalled();
    });
  });

  describe('RBAC (real guard chain)', () => {
    // Same posture as UsersController's/InviteController's precedent test
    // (Story 1.7/1.8): boots a real app with the real
    // `@UseGuards(JwtAuthGuard)` chain on the real compiled route, only
    // stubbing `JwtService.verifyAsync` to hand back role claims. Unlike
    // those controllers, `GET /audit` deliberately carries no `RolesGuard`/
    // `@Roles(...)` — this proves all four roles reach the service, not just
    // that the route responds.
    it('lets all four roles reach the service and none is rejected', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [AuditController],
        providers: [
          { provide: AuditService, useValue: auditService },
          JwtAuthGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();
      const server = app.getHttpServer() as Server;

      for (const role of [
        UsuarioRole.ADMINISTRATOR,
        UsuarioRole.MANAGER,
        UsuarioRole.EDITOR,
        UsuarioRole.READ_ONLY,
      ]) {
        verifyAsync.mockResolvedValueOnce({
          sub: 'caller-1',
          email: 'caller@example.com',
          role,
        });

        await request(server)
          .get('/audit')
          .set('Authorization', 'Bearer a-valid-token')
          .expect(200);
      }

      expect(auditService.list).toHaveBeenCalledTimes(4);

      await app.close();
    });

    it('rejects an unauthenticated caller with 401', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [AuditController],
        providers: [{ provide: AuditService, useValue: auditService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: () => {
            throw new UnauthorizedException(
              'Missing or invalid Authorization header',
            );
          },
        })
        .compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .get('/audit')
        .expect(401);

      expect(auditService.list).not.toHaveBeenCalled();

      await app.close();
    });

    it('returns the service payload for a successful call, with the joined usuario surfaced', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.READ_ONLY,
      });
      auditService.list.mockResolvedValue({
        data: [
          {
            id: 'audit-1',
            usuarioId: 'user-1',
            usuario: { id: 'user-1', email: 'user1@example.com' },
            tipoAccion: TipoAccion.UPDATE,
            entidad: 'ItemConfiguracion',
            entidadId: 'item-1',
            cambios: { before: null, after: { name: 'server-1' } },
            fecha: '2026-09-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      });

      const moduleRef = await Test.createTestingModule({
        controllers: [AuditController],
        providers: [
          { provide: AuditService, useValue: auditService },
          JwtAuthGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      const response = await request(app.getHttpServer() as Server)
        .get('/audit')
        .set('Authorization', 'Bearer a-valid-token')
        .expect(200);

      expect(response.body).toEqual({
        data: [
          {
            id: 'audit-1',
            usuarioId: 'user-1',
            usuario: { id: 'user-1', email: 'user1@example.com' },
            tipoAccion: TipoAccion.UPDATE,
            entidad: 'ItemConfiguracion',
            entidadId: 'item-1',
            cambios: { before: null, after: { name: 'server-1' } },
            fecha: '2026-09-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      });

      await app.close();
    });
  });
});
