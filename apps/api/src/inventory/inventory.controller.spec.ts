import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Server } from 'http';
import { UsuarioRole } from '@prisma/client';
import {
  InventoryController,
  CreateItemRequestDto,
  UpdateItemRequestDto,
  MISSING_NOMBRE_MESSAGE,
  INVALID_NOMBRE_LENGTH_MESSAGE,
  MISSING_TIPO_MESSAGE,
  INVALID_TIPO_LENGTH_MESSAGE,
  INVALID_PROPERTIES_MESSAGE,
  INVALID_DESCRIPCION_MESSAGE,
  INVALID_DOMINIO_PROPIETARIO_MESSAGE,
  INVALID_DIRECCION_RED_MESSAGE,
  INVALID_TIPO_FILTER_MESSAGE,
  INVALID_TEXTO_FILTER_MESSAGE,
  NO_FIELDS_TO_UPDATE_MESSAGE,
} from './inventory.controller';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

function makeRequest(sub: string, role: UsuarioRole): AuthenticatedRequest {
  return {
    user: { sub, email: 'caller@example.com', role },
  } as AuthenticatedRequest;
}

const CREATED_ITEM = {
  id: 'item-1',
  nombre: 'core-db',
  descripcion: null,
  dominioPropietario: null,
  direccionRed: null,
  tipo: 'DATABASE',
  properties: {},
};

const EMPTY_LIST_RESULT = { data: [], total: 0, page: 1, pageSize: 50 };

describe('InventoryController', () => {
  let inventoryService: {
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    list: jest.Mock;
  };
  let controller: InventoryController;

  beforeEach(async () => {
    inventoryService = {
      create: jest.fn().mockResolvedValue(CREATED_ITEM),
      update: jest.fn().mockResolvedValue(CREATED_ITEM),
      remove: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue(EMPTY_LIST_RESULT),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [{ provide: InventoryService, useValue: inventoryService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(InventoryController);
  });

  describe('create (dispatch)', () => {
    it('delegates to InventoryService.create with the caller id (from the token) and the body fields', async () => {
      const body: CreateItemRequestDto = {
        nombre: 'core-db',
        tipo: 'DATABASE',
        descripcion: 'Core database',
        dominioPropietario: 'platform',
        direccionRed: '10.0.0.1',
        properties: { engine: 'postgres' },
      };

      const result = await controller.create(
        body,
        makeRequest('caller-1', UsuarioRole.EDITOR),
      );

      expect(inventoryService.create).toHaveBeenCalledWith('caller-1', {
        nombre: 'core-db',
        tipo: 'DATABASE',
        descripcion: 'Core database',
        dominioPropietario: 'platform',
        direccionRed: '10.0.0.1',
        properties: { engine: 'postgres' },
      });
      expect(result).toEqual(CREATED_ITEM);
    });

    it('rejects a missing nombre with a 400, never calling the service', async () => {
      const body = { tipo: 'DATABASE' } as CreateItemRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(MISSING_NOMBRE_MESSAGE);
      expect(inventoryService.create).not.toHaveBeenCalled();
    });

    it('rejects a blank nombre with a 400, never calling the service', async () => {
      const body = { nombre: '   ', tipo: 'DATABASE' } as CreateItemRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(MISSING_NOMBRE_MESSAGE);
      expect(inventoryService.create).not.toHaveBeenCalled();
    });

    it('rejects a missing tipo with a 400, never calling the service', async () => {
      const body = { nombre: 'core-db' } as CreateItemRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(MISSING_TIPO_MESSAGE);
      expect(inventoryService.create).not.toHaveBeenCalled();
    });

    it('rejects a nombre over the length cap, never calling the service', async () => {
      const body = {
        nombre: 'a'.repeat(256),
        tipo: 'DATABASE',
      } as CreateItemRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(INVALID_NOMBRE_LENGTH_MESSAGE);
      expect(inventoryService.create).not.toHaveBeenCalled();
    });

    it('rejects a tipo over the length cap, never calling the service', async () => {
      const body = {
        nombre: 'core-db',
        tipo: 'a'.repeat(101),
      } as CreateItemRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(INVALID_TIPO_LENGTH_MESSAGE);
      expect(inventoryService.create).not.toHaveBeenCalled();
    });

    it.each([
      ['descripcion', 123, INVALID_DESCRIPCION_MESSAGE],
      ['dominioPropietario', 123, INVALID_DOMINIO_PROPIETARIO_MESSAGE],
      ['direccionRed', 123, INVALID_DIRECCION_RED_MESSAGE],
    ])(
      'rejects a non-string %s, never calling the service',
      async (field, value, message) => {
        const body = {
          nombre: 'core-db',
          tipo: 'DATABASE',
          [field]: value,
        } as unknown as CreateItemRequestDto;

        await expect(
          controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
        ).rejects.toThrow(message);
        expect(inventoryService.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['descripcion', 2001, INVALID_DESCRIPCION_MESSAGE],
      ['dominioPropietario', 256, INVALID_DOMINIO_PROPIETARIO_MESSAGE],
      ['direccionRed', 256, INVALID_DIRECCION_RED_MESSAGE],
    ])(
      'rejects an over-length %s, never calling the service',
      async (field, length, message) => {
        const body = {
          nombre: 'core-db',
          tipo: 'DATABASE',
          [field]: 'a'.repeat(length),
        } as unknown as CreateItemRequestDto;

        await expect(
          controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
        ).rejects.toThrow(message);
        expect(inventoryService.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['a string', 'not-an-object'],
      ['an array', ['a', 'b']],
      ['null', null],
    ])(
      'rejects properties that is %s with a 400, never calling the service',
      async (_label, properties) => {
        const body = {
          nombre: 'core-db',
          tipo: 'DATABASE',
          properties,
        } as unknown as CreateItemRequestDto;

        await expect(
          controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
        ).rejects.toThrow(INVALID_PROPERTIES_MESSAGE);
        expect(inventoryService.create).not.toHaveBeenCalled();
      },
    );

    it('propagates an error raised by the service unchanged', async () => {
      inventoryService.create.mockRejectedValue(new Error('boom'));

      await expect(
        controller.create(
          { nombre: 'core-db', tipo: 'DATABASE' },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow('boom');
    });

    it('rejects when request.user is unexpectedly absent (defensive 401)', async () => {
      await expect(
        controller.create(
          { nombre: 'core-db', tipo: 'DATABASE' },
          {} as AuthenticatedRequest,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(inventoryService.create).not.toHaveBeenCalled();
    });
  });

  describe('update (dispatch)', () => {
    it('delegates to InventoryService.update with the id, caller id (from the token), and the body fields', async () => {
      const body: UpdateItemRequestDto = {
        descripcion: 'Updated description',
        properties: { version: '15' },
      };

      const result = await controller.update(
        'item-1',
        body,
        makeRequest('caller-1', UsuarioRole.EDITOR),
      );

      expect(inventoryService.update).toHaveBeenCalledWith(
        'caller-1',
        'item-1',
        {
          nombre: undefined,
          tipo: undefined,
          descripcion: 'Updated description',
          dominioPropietario: undefined,
          direccionRed: undefined,
          properties: { version: '15' },
        },
      );
      expect(result).toEqual(CREATED_ITEM);
    });

    // I/O matrix row: body has zero recognized fields -> 400, service never
    // called.
    it('rejects a body with zero recognized fields with a 400, never calling the service', async () => {
      await expect(
        controller.update(
          'item-1',
          {},
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.update(
          'item-1',
          {},
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(NO_FIELDS_TO_UPDATE_MESSAGE);
      expect(inventoryService.update).not.toHaveBeenCalled();
    });

    it('rejects a blank supplied nombre with a 400, never calling the service', async () => {
      await expect(
        controller.update(
          'item-1',
          { nombre: '   ' },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(MISSING_NOMBRE_MESSAGE);
      expect(inventoryService.update).not.toHaveBeenCalled();
    });

    it('rejects a supplied nombre over the length cap, never calling the service', async () => {
      await expect(
        controller.update(
          'item-1',
          { nombre: 'a'.repeat(256) },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(INVALID_NOMBRE_LENGTH_MESSAGE);
      expect(inventoryService.update).not.toHaveBeenCalled();
    });

    it('rejects a blank supplied tipo with a 400, never calling the service', async () => {
      await expect(
        controller.update(
          'item-1',
          { tipo: '   ' },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(MISSING_TIPO_MESSAGE);
      expect(inventoryService.update).not.toHaveBeenCalled();
    });

    it('rejects a supplied tipo over the length cap, never calling the service', async () => {
      await expect(
        controller.update(
          'item-1',
          { tipo: 'a'.repeat(101) },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(INVALID_TIPO_LENGTH_MESSAGE);
      expect(inventoryService.update).not.toHaveBeenCalled();
    });

    it.each([
      ['descripcion', 123, INVALID_DESCRIPCION_MESSAGE],
      ['dominioPropietario', 123, INVALID_DOMINIO_PROPIETARIO_MESSAGE],
      ['direccionRed', 123, INVALID_DIRECCION_RED_MESSAGE],
    ])(
      'rejects a non-string %s, never calling the service',
      async (field, value, message) => {
        const body = { [field]: value } as unknown as UpdateItemRequestDto;

        await expect(
          controller.update(
            'item-1',
            body,
            makeRequest('caller-1', UsuarioRole.EDITOR),
          ),
        ).rejects.toThrow(message);
        expect(inventoryService.update).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['a string', 'not-an-object'],
      ['an array', ['a', 'b']],
      ['null', null],
    ])(
      'rejects properties that is %s with a 400, never calling the service',
      async (_label, properties) => {
        const body = { properties } as unknown as UpdateItemRequestDto;

        await expect(
          controller.update(
            'item-1',
            body,
            makeRequest('caller-1', UsuarioRole.EDITOR),
          ),
        ).rejects.toThrow(INVALID_PROPERTIES_MESSAGE);
        expect(inventoryService.update).not.toHaveBeenCalled();
      },
    );

    it('propagates a NotFoundException raised by the service unchanged', async () => {
      inventoryService.update.mockRejectedValue(
        new NotFoundException('Item not found.'),
      );

      await expect(
        controller.update(
          'missing-item',
          { descripcion: 'x' },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates an error raised by the service unchanged', async () => {
      inventoryService.update.mockRejectedValue(new Error('boom'));

      await expect(
        controller.update(
          'item-1',
          { descripcion: 'x' },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow('boom');
    });

    it('rejects when request.user is unexpectedly absent (defensive 401)', async () => {
      await expect(
        controller.update(
          'item-1',
          { descripcion: 'x' },
          {} as AuthenticatedRequest,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(inventoryService.update).not.toHaveBeenCalled();
    });
  });

  describe('remove (dispatch)', () => {
    it('delegates to InventoryService.remove with the id and the caller id (from the token)', async () => {
      const result = await controller.remove(
        'item-1',
        makeRequest('caller-1', UsuarioRole.EDITOR),
      );

      expect(inventoryService.remove).toHaveBeenCalledWith(
        'caller-1',
        'item-1',
      );
      expect(result).toBeUndefined();
    });

    it('propagates a NotFoundException raised by the service unchanged', async () => {
      inventoryService.remove.mockRejectedValue(
        new NotFoundException('Item not found.'),
      );

      await expect(
        controller.remove(
          'missing-item',
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates an error raised by the service unchanged', async () => {
      inventoryService.remove.mockRejectedValue(new Error('boom'));

      await expect(
        controller.remove(
          'item-1',
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow('boom');
    });

    it('rejects when request.user is unexpectedly absent (defensive 401)', async () => {
      await expect(
        controller.remove('item-1', {} as AuthenticatedRequest),
      ).rejects.toThrow(UnauthorizedException);
      expect(inventoryService.remove).not.toHaveBeenCalled();
    });
  });

  describe('list (dispatch)', () => {
    it('delegates to InventoryService.list with default page/pageSize and no filters when nothing is supplied', async () => {
      const result = await controller.list();

      expect(inventoryService.list).toHaveBeenCalledWith(
        { tipo: undefined, texto: undefined },
        1,
        50,
      );
      expect(result).toEqual(EMPTY_LIST_RESULT);
    });

    it('parses page/pageSize query params through to the service', async () => {
      await controller.list('2', '20');

      expect(inventoryService.list).toHaveBeenCalledWith(
        expect.anything(),
        2,
        20,
      );
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

        expect(inventoryService.list).toHaveBeenCalledWith(
          expect.anything(),
          expectedPage,
          expectedPageSize,
        );
      },
    );

    it('clamps an oversized pageSize to the defensive upper bound', async () => {
      await controller.list('1', '999999');

      expect(inventoryService.list).toHaveBeenCalledWith(
        expect.anything(),
        1,
        200,
      );
    });

    it('passes pageSize=200 through unclamped (exact upper boundary)', async () => {
      await controller.list('1', '200');

      expect(inventoryService.list).toHaveBeenCalledWith(
        expect.anything(),
        1,
        200,
      );
    });

    it('clamps pageSize=201 down to 200 (one past the boundary)', async () => {
      await controller.list('1', '201');

      expect(inventoryService.list).toHaveBeenCalledWith(
        expect.anything(),
        1,
        200,
      );
    });

    it('passes page=200 through unclamped (exact upper boundary)', async () => {
      await controller.list('200', '10');

      expect(inventoryService.list).toHaveBeenCalledWith(
        expect.anything(),
        200,
        10,
      );
    });

    it('clamps page=201 down to 200 (one past the boundary)', async () => {
      await controller.list('201', '10');

      expect(inventoryService.list).toHaveBeenCalledWith(
        expect.anything(),
        200,
        10,
      );
    });

    it('passes tipo/texto filters through unchanged', async () => {
      await controller.list(undefined, undefined, 'DATABASE', 'core');

      expect(inventoryService.list).toHaveBeenCalledWith(
        { tipo: 'DATABASE', texto: 'core' },
        1,
        50,
      );
    });

    it.each(['tipo', 'texto'] as const)(
      'treats an empty-string %s as "no filter," not "filter on the empty string"',
      async (field) => {
        const args: Array<string | undefined> = [
          undefined,
          undefined,
          undefined,
          undefined,
        ];
        const index = { tipo: 2, texto: 3 }[field];
        args[index] = '';

        await controller.list(...(args as Parameters<typeof controller.list>));

        expect(inventoryService.list).toHaveBeenCalledWith(
          expect.objectContaining({ [field]: undefined }),
          1,
          50,
        );
      },
    );

    it('propagates an error raised by the service unchanged', async () => {
      inventoryService.list.mockRejectedValue(new Error('boom'));

      await expect(controller.list()).rejects.toThrow('boom');
    });

    it.each(['tipo', 'texto'] as const)(
      'rejects a repeated %s query key (parsed as an array) with a 400, never calling the service',
      async (field) => {
        const args: Array<string | string[] | undefined> = [
          undefined,
          undefined,
          undefined,
          undefined,
        ];
        const index = { tipo: 2, texto: 3 }[field];
        args[index] = ['A', 'B'];

        await expect(
          controller.list(...(args as Parameters<typeof controller.list>)),
        ).rejects.toThrow(BadRequestException);
        expect(inventoryService.list).not.toHaveBeenCalled();
      },
    );

    it('rejects a tipo filter over the length cap, never calling the service', async () => {
      await expect(
        controller.list(undefined, undefined, 'a'.repeat(101)),
      ).rejects.toThrow(INVALID_TIPO_FILTER_MESSAGE);
      expect(inventoryService.list).not.toHaveBeenCalled();
    });

    it('rejects a texto filter over the length cap, never calling the service', async () => {
      await expect(
        controller.list(undefined, undefined, undefined, 'a'.repeat(256)),
      ).rejects.toThrow(INVALID_TEXTO_FILTER_MESSAGE);
      expect(inventoryService.list).not.toHaveBeenCalled();
    });
  });

  describe('RBAC rejection (overridden guards)', () => {
    it('rejects POST /items with 403 when RolesGuard denies the caller (Read-only)', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [{ provide: InventoryService, useValue: inventoryService }],
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

      await request(app.getHttpServer() as Server)
        .post('/items')
        .send({ nombre: 'core-db', tipo: 'DATABASE' })
        .expect(403);

      await app.close();
    });

    it('rejects POST /items with 401 when JwtAuthGuard denies an unauthenticated caller', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [{ provide: InventoryService, useValue: inventoryService }],
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

      await request(app.getHttpServer() as Server)
        .post('/items')
        .send({ nombre: 'core-db', tipo: 'DATABASE' })
        .expect(401);

      await app.close();
    });

    it('rejects GET /items with 401 when JwtAuthGuard denies an unauthenticated caller', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [{ provide: InventoryService, useValue: inventoryService }],
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

      await request(app.getHttpServer() as Server)
        .get('/items')
        .expect(401);

      expect(inventoryService.list).not.toHaveBeenCalled();

      await app.close();
    });

    // I/O matrix's final row: Read-only (Consulta) caller rejected with 403,
    // no state change.
    it('rejects PATCH /items/:id with 403 when RolesGuard denies the caller (Read-only)', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [{ provide: InventoryService, useValue: inventoryService }],
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

      await request(app.getHttpServer() as Server)
        .patch('/items/item-1')
        .send({ descripcion: 'x' })
        .expect(403);

      expect(inventoryService.update).not.toHaveBeenCalled();

      await app.close();
    });

    it('rejects PATCH /items/:id with 401 when JwtAuthGuard denies an unauthenticated caller', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [{ provide: InventoryService, useValue: inventoryService }],
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

      await request(app.getHttpServer() as Server)
        .patch('/items/item-1')
        .send({ descripcion: 'x' })
        .expect(401);

      expect(inventoryService.update).not.toHaveBeenCalled();

      await app.close();
    });

    // spec-3-4 I/O matrix's "Insufficient role" row: Read-only (Consulta)
    // caller rejected with 403, no state change.
    it('rejects DELETE /items/:id with 403 when RolesGuard denies the caller (Read-only)', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [{ provide: InventoryService, useValue: inventoryService }],
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

      await request(app.getHttpServer() as Server)
        .delete('/items/item-1')
        .expect(403);

      expect(inventoryService.remove).not.toHaveBeenCalled();

      await app.close();
    });

    // spec-3-4 I/O matrix's "Unauthenticated" row.
    it('rejects DELETE /items/:id with 401 when JwtAuthGuard denies an unauthenticated caller', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [{ provide: InventoryService, useValue: inventoryService }],
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

      await request(app.getHttpServer() as Server)
        .delete('/items/item-1')
        .expect(401);

      expect(inventoryService.remove).not.toHaveBeenCalled();

      await app.close();
    });
  });

  describe('RBAC (real guards)', () => {
    // Same posture as UsersController's precedent test (Story 1.7+): boots a
    // real app with the real `@UseGuards(JwtAuthGuard, RolesGuard)` chain
    // (real Reflector included) on the real compiled route, only stubbing
    // `JwtService.verifyAsync` to hand back role claims. A dropped
    // `@Roles(...)` decorator or a swapped guard order would fail this test
    // even though every other test above stays green.
    it('lets EDITOR/MANAGER/ADMINISTRATOR tokens reach the service and rejects READ_ONLY with 403', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [
          { provide: InventoryService, useValue: inventoryService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();
      const server = app.getHttpServer() as Server;

      for (const role of [
        UsuarioRole.EDITOR,
        UsuarioRole.MANAGER,
        UsuarioRole.ADMINISTRATOR,
      ]) {
        verifyAsync.mockResolvedValueOnce({
          sub: 'caller-1',
          email: 'caller@example.com',
          role,
        });

        await request(server)
          .post('/items')
          .send({ nombre: 'core-db', tipo: 'DATABASE' })
          .set('Authorization', 'Bearer a-valid-token')
          .expect(201);
      }

      verifyAsync.mockResolvedValueOnce({
        sub: 'caller-2',
        email: 'readonly@example.com',
        role: UsuarioRole.READ_ONLY,
      });

      await request(server)
        .post('/items')
        .send({ nombre: 'core-db', tipo: 'DATABASE' })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(403);

      await request(server)
        .post('/items')
        .send({ nombre: 'core-db', tipo: 'DATABASE' })
        .expect(401);

      await app.close();
    });

    it('returns the created item payload and 201 for a successful create', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });

      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [
          { provide: InventoryService, useValue: inventoryService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      const response = await request(app.getHttpServer() as Server)
        .post('/items')
        .send({ nombre: 'core-db', tipo: 'DATABASE' })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(201);

      expect(response.body).toEqual(CREATED_ITEM);
      expect(inventoryService.create).toHaveBeenCalledWith('caller-1', {
        nombre: 'core-db',
        tipo: 'DATABASE',
        descripcion: undefined,
        dominioPropietario: undefined,
        direccionRed: undefined,
        properties: undefined,
      });

      await app.close();
    });

    // Same real-guard-chain posture as the POST /items test above, applied
    // to PATCH /items/:id: EDITOR/MANAGER/ADMINISTRATOR reach the service,
    // READ_ONLY is rejected with 403, unauthenticated with 401.
    it('lets EDITOR/MANAGER/ADMINISTRATOR tokens reach the service for PATCH /items/:id and rejects READ_ONLY with 403', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [
          { provide: InventoryService, useValue: inventoryService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();
      const server = app.getHttpServer() as Server;

      for (const role of [
        UsuarioRole.EDITOR,
        UsuarioRole.MANAGER,
        UsuarioRole.ADMINISTRATOR,
      ]) {
        verifyAsync.mockResolvedValueOnce({
          sub: 'caller-1',
          email: 'caller@example.com',
          role,
        });

        await request(server)
          .patch('/items/item-1')
          .send({ descripcion: 'Updated description' })
          .set('Authorization', 'Bearer a-valid-token')
          .expect(200);
      }

      verifyAsync.mockResolvedValueOnce({
        sub: 'caller-2',
        email: 'readonly@example.com',
        role: UsuarioRole.READ_ONLY,
      });

      await request(server)
        .patch('/items/item-1')
        .send({ descripcion: 'Updated description' })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(403);

      await request(server)
        .patch('/items/item-1')
        .send({ descripcion: 'Updated description' })
        .expect(401);

      await app.close();
    });

    it('returns the updated item payload and 200 for a successful update', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });

      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [
          { provide: InventoryService, useValue: inventoryService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      const response = await request(app.getHttpServer() as Server)
        .patch('/items/item-1')
        .send({ descripcion: 'Updated description' })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(200);

      expect(response.body).toEqual(CREATED_ITEM);
      expect(inventoryService.update).toHaveBeenCalledWith(
        'caller-1',
        'item-1',
        {
          nombre: undefined,
          tipo: undefined,
          descripcion: 'Updated description',
          dominioPropietario: undefined,
          direccionRed: undefined,
          properties: undefined,
        },
      );

      await app.close();
    });

    it('returns 404 for PATCH /items/:id when the service reports the item does not exist', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });
      inventoryService.update.mockRejectedValue(
        new NotFoundException('Item not found.'),
      );

      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [
          { provide: InventoryService, useValue: inventoryService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .patch('/items/missing-item')
        .send({ descripcion: 'x' })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(404);

      await app.close();
    });

    // Same real-guard-chain posture as POST/PATCH above, applied to DELETE
    // /items/:id: EDITOR/MANAGER/ADMINISTRATOR reach the service, READ_ONLY
    // is rejected with 403, unauthenticated with 401 (spec-3-4 I/O matrix).
    it('lets EDITOR/MANAGER/ADMINISTRATOR tokens reach the service for DELETE /items/:id and rejects READ_ONLY with 403', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [
          { provide: InventoryService, useValue: inventoryService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();
      const server = app.getHttpServer() as Server;

      for (const role of [
        UsuarioRole.EDITOR,
        UsuarioRole.MANAGER,
        UsuarioRole.ADMINISTRATOR,
      ]) {
        verifyAsync.mockResolvedValueOnce({
          sub: 'caller-1',
          email: 'caller@example.com',
          role,
        });

        await request(server)
          .delete('/items/item-1')
          .set('Authorization', 'Bearer a-valid-token')
          .expect(204);
      }

      verifyAsync.mockResolvedValueOnce({
        sub: 'caller-2',
        email: 'readonly@example.com',
        role: UsuarioRole.READ_ONLY,
      });

      await request(server)
        .delete('/items/item-1')
        .set('Authorization', 'Bearer a-valid-token')
        .expect(403);

      await request(server).delete('/items/item-1').expect(401);

      await app.close();
    });

    it('returns 204 with an empty body and calls the service for a successful DELETE /items/:id', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });

      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [
          { provide: InventoryService, useValue: inventoryService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      const response = await request(app.getHttpServer() as Server)
        .delete('/items/item-1')
        .set('Authorization', 'Bearer a-valid-token')
        .expect(204);

      expect(response.body).toEqual({});
      expect(inventoryService.remove).toHaveBeenCalledWith(
        'caller-1',
        'item-1',
      );

      await app.close();
    });

    it('returns 404 for DELETE /items/:id when the service reports the item does not exist', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });
      inventoryService.remove.mockRejectedValue(
        new NotFoundException('Item not found.'),
      );

      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [
          { provide: InventoryService, useValue: inventoryService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .delete('/items/missing-item')
        .set('Authorization', 'Bearer a-valid-token')
        .expect(404);

      expect(inventoryService.remove).toHaveBeenCalledWith(
        'caller-1',
        'missing-item',
      );

      await app.close();
    });

    // Same posture as AuditController's precedent test (spec-2-2): boots a
    // real app with the real `@UseGuards(JwtAuthGuard)` chain (real
    // Reflector included) on the real compiled route, only stubbing
    // `JwtService.verifyAsync` to hand back role claims. Unlike POST
    // /items, `GET /items` deliberately carries no `RolesGuard`/
    // `@Roles(...)` — this proves all four roles reach the service, not
    // just that the route responds.
    it('lets all four roles reach the service for GET /items and none is rejected', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [
          { provide: InventoryService, useValue: inventoryService },
          JwtAuthGuard,
          RolesGuard,
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
          .get('/items')
          .set('Authorization', 'Bearer a-valid-token')
          .expect(200);
      }

      expect(inventoryService.list).toHaveBeenCalledTimes(4);

      await request(server).get('/items').expect(401);

      await app.close();
    });

    it('returns the service payload for a successful GET /items call', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.READ_ONLY,
      });
      inventoryService.list.mockResolvedValue({
        data: [CREATED_ITEM],
        total: 1,
        page: 1,
        pageSize: 50,
      });

      const moduleRef = await Test.createTestingModule({
        controllers: [InventoryController],
        providers: [
          { provide: InventoryService, useValue: inventoryService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      const response = await request(app.getHttpServer() as Server)
        .get('/items')
        .query({ tipo: 'DATABASE', texto: 'core' })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(200);

      expect(response.body).toEqual({
        data: [CREATED_ITEM],
        total: 1,
        page: 1,
        pageSize: 50,
      });
      expect(inventoryService.list).toHaveBeenCalledWith(
        { tipo: 'DATABASE', texto: 'core' },
        1,
        50,
      );

      await app.close();
    });
  });
});
