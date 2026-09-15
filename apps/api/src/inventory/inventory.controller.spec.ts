import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Server } from 'http';
import { UsuarioRole } from '@prisma/client';
import {
  InventoryController,
  CreateItemRequestDto,
  MISSING_NOMBRE_MESSAGE,
  INVALID_NOMBRE_LENGTH_MESSAGE,
  MISSING_TIPO_MESSAGE,
  INVALID_TIPO_LENGTH_MESSAGE,
  INVALID_PROPERTIES_MESSAGE,
  INVALID_DESCRIPCION_MESSAGE,
  INVALID_DOMINIO_PROPIETARIO_MESSAGE,
  INVALID_DIRECCION_RED_MESSAGE,
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

describe('InventoryController', () => {
  let inventoryService: { create: jest.Mock };
  let controller: InventoryController;

  beforeEach(async () => {
    inventoryService = {
      create: jest.fn().mockResolvedValue(CREATED_ITEM),
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
  });
});
