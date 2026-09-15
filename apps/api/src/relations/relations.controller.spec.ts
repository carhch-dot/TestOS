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
import { UsuarioRole } from '@prisma/client';
import {
  RelationsController,
  CreateRelationRequestDto,
  UpdateRelationRequestDto,
  MISSING_ORIGEN_ID_MESSAGE,
  INVALID_ORIGEN_ID_LENGTH_MESSAGE,
  MISSING_DESTINO_ID_MESSAGE,
  INVALID_DESTINO_ID_LENGTH_MESSAGE,
  MISSING_TIPO_MESSAGE,
  INVALID_TIPO_LENGTH_MESSAGE,
  INVALID_DESCRIPCION_MESSAGE,
  MISSING_ORIGEN_TIPO_MESSAGE,
  MISSING_DESTINO_TIPO_MESSAGE,
  INVALID_ORIGEN_TIPO_MESSAGE,
  INVALID_DESTINO_TIPO_MESSAGE,
  NO_FIELDS_TO_UPDATE_MESSAGE,
} from './relations.controller';
import { RelationsService } from './relations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

function makeRequest(sub: string, role: UsuarioRole): AuthenticatedRequest {
  return {
    user: { sub, email: 'caller@example.com', role },
  } as AuthenticatedRequest;
}

const CREATED_RELATION = {
  id: 'relacion-1',
  origenId: 'item-origen',
  destinoId: 'item-destino',
  tipo: 'HOSTS',
  descripcion: null,
};

const SUGGESTION = { tipo: 'HOSTS', descripcion: 'The server hosts this.' };

describe('RelationsController', () => {
  let relationsService: {
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    suggest: jest.Mock;
  };
  let controller: RelationsController;

  beforeEach(async () => {
    relationsService = {
      create: jest.fn().mockResolvedValue(CREATED_RELATION),
      update: jest.fn().mockResolvedValue(CREATED_RELATION),
      remove: jest.fn().mockResolvedValue(undefined),
      suggest: jest.fn().mockReturnValue(SUGGESTION),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RelationsController],
      providers: [{ provide: RelationsService, useValue: relationsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(RelationsController);
  });

  describe('create (dispatch)', () => {
    it('delegates to RelationsService.create with the caller id (from the token) and the body fields', async () => {
      const body: CreateRelationRequestDto = {
        origenId: 'item-origen',
        destinoId: 'item-destino',
        tipo: 'HOSTS',
        descripcion: 'The server hosts the service',
      };

      const result = await controller.create(
        body,
        makeRequest('caller-1', UsuarioRole.EDITOR),
      );

      expect(relationsService.create).toHaveBeenCalledWith('caller-1', {
        origenId: 'item-origen',
        destinoId: 'item-destino',
        tipo: 'HOSTS',
        descripcion: 'The server hosts the service',
      });
      expect(result).toEqual(CREATED_RELATION);
    });

    it('rejects a missing origenId with a 400, never calling the service', async () => {
      const body = {
        destinoId: 'item-destino',
        tipo: 'HOSTS',
      } as CreateRelationRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(MISSING_ORIGEN_ID_MESSAGE);
      expect(relationsService.create).not.toHaveBeenCalled();
    });

    it('rejects a blank origenId with a 400, never calling the service', async () => {
      const body = {
        origenId: '   ',
        destinoId: 'item-destino',
        tipo: 'HOSTS',
      } as CreateRelationRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(MISSING_ORIGEN_ID_MESSAGE);
      expect(relationsService.create).not.toHaveBeenCalled();
    });

    it('rejects an origenId over the length cap, never calling the service', async () => {
      const body = {
        origenId: 'a'.repeat(256),
        destinoId: 'item-destino',
        tipo: 'HOSTS',
      } as CreateRelationRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(INVALID_ORIGEN_ID_LENGTH_MESSAGE);
      expect(relationsService.create).not.toHaveBeenCalled();
    });

    it('rejects a missing destinoId with a 400, never calling the service', async () => {
      const body = {
        origenId: 'item-origen',
        tipo: 'HOSTS',
      } as CreateRelationRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(MISSING_DESTINO_ID_MESSAGE);
      expect(relationsService.create).not.toHaveBeenCalled();
    });

    it('rejects a destinoId over the length cap, never calling the service', async () => {
      const body = {
        origenId: 'item-origen',
        destinoId: 'a'.repeat(256),
        tipo: 'HOSTS',
      } as CreateRelationRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(INVALID_DESTINO_ID_LENGTH_MESSAGE);
      expect(relationsService.create).not.toHaveBeenCalled();
    });

    it('rejects a missing tipo with a 400, never calling the service', async () => {
      const body = {
        origenId: 'item-origen',
        destinoId: 'item-destino',
      } as CreateRelationRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(MISSING_TIPO_MESSAGE);
      expect(relationsService.create).not.toHaveBeenCalled();
    });

    it('rejects a blank tipo with a 400, never calling the service', async () => {
      const body = {
        origenId: 'item-origen',
        destinoId: 'item-destino',
        tipo: '   ',
      } as CreateRelationRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(MISSING_TIPO_MESSAGE);
      expect(relationsService.create).not.toHaveBeenCalled();
    });

    it('rejects a tipo over the length cap, never calling the service', async () => {
      const body = {
        origenId: 'item-origen',
        destinoId: 'item-destino',
        tipo: 'a'.repeat(101),
      } as CreateRelationRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(INVALID_TIPO_LENGTH_MESSAGE);
      expect(relationsService.create).not.toHaveBeenCalled();
    });

    it('rejects a non-string descripcion with a 400, never calling the service', async () => {
      const body = {
        origenId: 'item-origen',
        destinoId: 'item-destino',
        tipo: 'HOSTS',
        descripcion: 123,
      } as unknown as CreateRelationRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(INVALID_DESCRIPCION_MESSAGE);
      expect(relationsService.create).not.toHaveBeenCalled();
    });

    it('rejects an over-length descripcion, never calling the service', async () => {
      const body = {
        origenId: 'item-origen',
        destinoId: 'item-destino',
        tipo: 'HOSTS',
        descripcion: 'a'.repeat(2001),
      } as CreateRelationRequestDto;

      await expect(
        controller.create(body, makeRequest('caller-1', UsuarioRole.EDITOR)),
      ).rejects.toThrow(INVALID_DESCRIPCION_MESSAGE);
      expect(relationsService.create).not.toHaveBeenCalled();
    });

    it('propagates a NotFoundException raised by the service unchanged', async () => {
      relationsService.create.mockRejectedValue(
        new NotFoundException('origenId does not match any item.'),
      );

      await expect(
        controller.create(
          { origenId: 'missing', destinoId: 'item-destino', tipo: 'HOSTS' },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates a ConflictException raised by the service unchanged', async () => {
      relationsService.create.mockRejectedValue(
        new ConflictException('This relation already exists.'),
      );

      await expect(
        controller.create(
          {
            origenId: 'item-origen',
            destinoId: 'item-destino',
            tipo: 'HOSTS',
          },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('propagates an error raised by the service unchanged', async () => {
      relationsService.create.mockRejectedValue(new Error('boom'));

      await expect(
        controller.create(
          {
            origenId: 'item-origen',
            destinoId: 'item-destino',
            tipo: 'HOSTS',
          },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow('boom');
    });

    it('rejects when request.user is unexpectedly absent (defensive 401)', async () => {
      await expect(
        controller.create(
          {
            origenId: 'item-origen',
            destinoId: 'item-destino',
            tipo: 'HOSTS',
          },
          {} as AuthenticatedRequest,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(relationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('update (dispatch)', () => {
    it('delegates to RelationsService.update with the id, caller id (from the token), and the body fields', async () => {
      const body: UpdateRelationRequestDto = { descripcion: 'Updated' };

      const result = await controller.update(
        'relacion-1',
        body,
        makeRequest('caller-1', UsuarioRole.EDITOR),
      );

      expect(relationsService.update).toHaveBeenCalledWith(
        'caller-1',
        'relacion-1',
        { tipo: undefined, descripcion: 'Updated' },
      );
      expect(result).toEqual(CREATED_RELATION);
    });

    // I/O matrix row: body has zero recognized fields -> 400, service never
    // called.
    it('rejects a body with zero recognized fields with a 400, never calling the service', async () => {
      await expect(
        controller.update(
          'relacion-1',
          {},
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.update(
          'relacion-1',
          {},
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(NO_FIELDS_TO_UPDATE_MESSAGE);
      expect(relationsService.update).not.toHaveBeenCalled();
    });

    // Same gate, but with a body that has ONLY unrecognized keys (a
    // plausible caller mistake: assuming the immutable id fields are still
    // part of the edit shape) rather than an empty body — proves
    // origenId/destinoId presence never satisfies "at least one field".
    it('rejects a body containing only origenId/destinoId (no tipo/descripcion) with a 400, never calling the service', async () => {
      const body = {
        origenId: 'item-origen',
        destinoId: 'item-destino',
      } as UpdateRelationRequestDto & { origenId: string; destinoId: string };

      await expect(
        controller.update(
          'relacion-1',
          body,
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(NO_FIELDS_TO_UPDATE_MESSAGE);
      expect(relationsService.update).not.toHaveBeenCalled();
    });

    it('rejects a blank supplied tipo with a 400, never calling the service', async () => {
      await expect(
        controller.update(
          'relacion-1',
          { tipo: '   ' },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(MISSING_TIPO_MESSAGE);
      expect(relationsService.update).not.toHaveBeenCalled();
    });

    it('rejects a supplied tipo over the length cap, never calling the service', async () => {
      await expect(
        controller.update(
          'relacion-1',
          { tipo: 'a'.repeat(101) },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(INVALID_TIPO_LENGTH_MESSAGE);
      expect(relationsService.update).not.toHaveBeenCalled();
    });

    it('rejects a non-string descripcion with a 400, never calling the service', async () => {
      const body = { descripcion: 123 } as unknown as UpdateRelationRequestDto;

      await expect(
        controller.update(
          'relacion-1',
          body,
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(INVALID_DESCRIPCION_MESSAGE);
      expect(relationsService.update).not.toHaveBeenCalled();
    });

    it('rejects an over-length descripcion, never calling the service', async () => {
      const body: UpdateRelationRequestDto = { descripcion: 'a'.repeat(2001) };

      await expect(
        controller.update(
          'relacion-1',
          body,
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(INVALID_DESCRIPCION_MESSAGE);
      expect(relationsService.update).not.toHaveBeenCalled();
    });

    // Never part of the accepted shape (spec Boundaries/Never): a body
    // containing origenId/destinoId still reaches the service without
    // them, proving they are silently dropped rather than forwarded.
    it('never forwards origenId/destinoId to the service even if present on the body', async () => {
      const body = {
        origenId: 'should-be-ignored',
        destinoId: 'should-be-ignored',
        descripcion: 'Updated',
      } as UpdateRelationRequestDto & { origenId: string; destinoId: string };

      await controller.update(
        'relacion-1',
        body,
        makeRequest('caller-1', UsuarioRole.EDITOR),
      );

      expect(relationsService.update).toHaveBeenCalledWith(
        'caller-1',
        'relacion-1',
        { tipo: undefined, descripcion: 'Updated' },
      );
    });

    it('propagates a NotFoundException raised by the service unchanged', async () => {
      relationsService.update.mockRejectedValue(
        new NotFoundException('Relation not found.'),
      );

      await expect(
        controller.update(
          'missing-relation',
          { descripcion: 'x' },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates a ConflictException raised by the service unchanged', async () => {
      relationsService.update.mockRejectedValue(
        new ConflictException('This relation already exists.'),
      );

      await expect(
        controller.update(
          'relacion-1',
          { tipo: 'DEPENDS_ON' },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(ConflictException);
    });

    // The catalog check lives only in RelationsService (the controller's
    // own assertValidTipo checks shape/length, not catalog membership), so
    // a BadRequestException for an unrecognized tipo is a real propagation
    // path from the service, not just a controller-level validation —
    // asymmetric with the NotFound/Conflict coverage above until now.
    it('propagates a BadRequestException raised by the service (e.g. unrecognized tipo) unchanged', async () => {
      relationsService.update.mockRejectedValue(
        new BadRequestException(
          "'NOT_A_TYPE' is not a recognized relation type.",
        ),
      );

      await expect(
        controller.update(
          'relacion-1',
          { tipo: 'NOT_A_TYPE' },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates an error raised by the service unchanged', async () => {
      relationsService.update.mockRejectedValue(new Error('boom'));

      await expect(
        controller.update(
          'relacion-1',
          { descripcion: 'x' },
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow('boom');
    });

    it('rejects when request.user is unexpectedly absent (defensive 401)', async () => {
      await expect(
        controller.update(
          'relacion-1',
          { descripcion: 'x' },
          {} as AuthenticatedRequest,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(relationsService.update).not.toHaveBeenCalled();
    });
  });

  describe('remove (dispatch)', () => {
    it('delegates to RelationsService.remove with the id and the caller id (from the token)', async () => {
      const result = await controller.remove(
        'relacion-1',
        makeRequest('caller-1', UsuarioRole.EDITOR),
      );

      expect(relationsService.remove).toHaveBeenCalledWith(
        'caller-1',
        'relacion-1',
      );
      expect(result).toBeUndefined();
    });

    it('propagates a NotFoundException raised by the service unchanged', async () => {
      relationsService.remove.mockRejectedValue(
        new NotFoundException('Relation not found.'),
      );

      await expect(
        controller.remove(
          'missing-relation',
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates an error raised by the service unchanged', async () => {
      relationsService.remove.mockRejectedValue(new Error('boom'));

      await expect(
        controller.remove(
          'relacion-1',
          makeRequest('caller-1', UsuarioRole.EDITOR),
        ),
      ).rejects.toThrow('boom');
    });

    it('rejects when request.user is unexpectedly absent (defensive 401)', async () => {
      await expect(
        controller.remove('relacion-1', {} as AuthenticatedRequest),
      ).rejects.toThrow(UnauthorizedException);
      expect(relationsService.remove).not.toHaveBeenCalled();
    });
  });

  describe('suggest (dispatch)', () => {
    it('delegates to RelationsService.suggest with the query params and returns its result', () => {
      const result = controller.suggest('VIRTUAL_SERVER', 'SERVICE');

      expect(relationsService.suggest).toHaveBeenCalledWith(
        'VIRTUAL_SERVER',
        'SERVICE',
      );
      expect(result).toEqual(SUGGESTION);
    });

    it('rejects a missing origenTipo with a 400, never calling the service', () => {
      expect(() => controller.suggest(undefined, 'SERVICE')).toThrow(
        MISSING_ORIGEN_TIPO_MESSAGE,
      );
      expect(relationsService.suggest).not.toHaveBeenCalled();
    });

    it('rejects a missing destinoTipo with a 400, never calling the service', () => {
      expect(() => controller.suggest('VIRTUAL_SERVER', undefined)).toThrow(
        MISSING_DESTINO_TIPO_MESSAGE,
      );
      expect(relationsService.suggest).not.toHaveBeenCalled();
    });

    it('rejects a repeated origenTipo query key (parsed as an array) with a distinct "invalid" 400, never calling the service', () => {
      expect(() => controller.suggest(['A', 'B'], 'SERVICE')).toThrow(
        INVALID_ORIGEN_TIPO_MESSAGE,
      );
      expect(relationsService.suggest).not.toHaveBeenCalled();
    });

    it('rejects a repeated destinoTipo query key (parsed as an array) with a distinct "invalid" 400, never calling the service', () => {
      expect(() => controller.suggest('VIRTUAL_SERVER', ['A', 'B'])).toThrow(
        INVALID_DESTINO_TIPO_MESSAGE,
      );
      expect(relationsService.suggest).not.toHaveBeenCalled();
    });

    it('rejects an origenTipo longer than the max length with a 400, never calling the service', () => {
      expect(() => controller.suggest('A'.repeat(101), 'SERVICE')).toThrow(
        INVALID_ORIGEN_TIPO_MESSAGE,
      );
      expect(relationsService.suggest).not.toHaveBeenCalled();
    });

    it('never errors — an unmapped pair still returns a value from the service', () => {
      relationsService.suggest.mockReturnValue({
        tipo: 'CONNECTS_TO',
        descripcion: 'generic',
      });

      const result = controller.suggest('NOT_A_TYPE', 'ALSO_NOT_A_TYPE');

      expect(result).toEqual({ tipo: 'CONNECTS_TO', descripcion: 'generic' });
    });
  });

  describe('RBAC rejection (overridden guards)', () => {
    it('rejects POST /relations with 403 when RolesGuard denies the caller (Read-only)', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [{ provide: RelationsService, useValue: relationsService }],
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
        .post('/relations')
        .send({
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        })
        .expect(403);

      await app.close();
    });

    it('rejects POST /relations with 401 when JwtAuthGuard denies an unauthenticated caller', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [{ provide: RelationsService, useValue: relationsService }],
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
        .post('/relations')
        .send({
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        })
        .expect(401);

      await app.close();
    });

    it('rejects PATCH /relations/:id with 403 when RolesGuard denies the caller (Read-only)', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [{ provide: RelationsService, useValue: relationsService }],
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
        .patch('/relations/relacion-1')
        .send({ descripcion: 'x' })
        .expect(403);

      expect(relationsService.update).not.toHaveBeenCalled();

      await app.close();
    });

    it('rejects PATCH /relations/:id with 401 when JwtAuthGuard denies an unauthenticated caller', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [{ provide: RelationsService, useValue: relationsService }],
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
        .patch('/relations/relacion-1')
        .send({ descripcion: 'x' })
        .expect(401);

      expect(relationsService.update).not.toHaveBeenCalled();

      await app.close();
    });

    it('rejects DELETE /relations/:id with 403 when RolesGuard denies the caller (Read-only)', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [{ provide: RelationsService, useValue: relationsService }],
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
        .delete('/relations/relacion-1')
        .expect(403);

      expect(relationsService.remove).not.toHaveBeenCalled();

      await app.close();
    });

    it('rejects DELETE /relations/:id with 401 when JwtAuthGuard denies an unauthenticated caller', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [{ provide: RelationsService, useValue: relationsService }],
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
        .delete('/relations/relacion-1')
        .expect(401);

      expect(relationsService.remove).not.toHaveBeenCalled();

      await app.close();
    });

    it('rejects GET /relations/suggest with 401 when JwtAuthGuard denies an unauthenticated caller', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [{ provide: RelationsService, useValue: relationsService }],
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
        .get('/relations/suggest')
        .query({ origenTipo: 'VIRTUAL_SERVER', destinoTipo: 'SERVICE' })
        .expect(401);

      expect(relationsService.suggest).not.toHaveBeenCalled();

      await app.close();
    });
  });

  describe('RBAC (real guards)', () => {
    // Same posture as InventoryController's precedent test: boots a real
    // app with the real `@UseGuards(JwtAuthGuard, RolesGuard)` chain (real
    // Reflector included) on the real compiled route, only stubbing
    // `JwtService.verifyAsync` to hand back role claims.
    it('lets EDITOR/MANAGER/ADMINISTRATOR tokens reach the service for POST /relations and rejects READ_ONLY with 403', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
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
          .post('/relations')
          .send({
            origenId: 'item-origen',
            destinoId: 'item-destino',
            tipo: 'HOSTS',
          })
          .set('Authorization', 'Bearer a-valid-token')
          .expect(201);
      }

      verifyAsync.mockResolvedValueOnce({
        sub: 'caller-2',
        email: 'readonly@example.com',
        role: UsuarioRole.READ_ONLY,
      });

      await request(server)
        .post('/relations')
        .send({
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(403);

      await request(server)
        .post('/relations')
        .send({
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        })
        .expect(401);

      await app.close();
    });

    it('returns the created relation payload and 201 for a successful create', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      const response = await request(app.getHttpServer() as Server)
        .post('/relations')
        .send({
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(201);

      expect(response.body).toEqual(CREATED_RELATION);
      expect(relationsService.create).toHaveBeenCalledWith('caller-1', {
        origenId: 'item-origen',
        destinoId: 'item-destino',
        tipo: 'HOSTS',
        descripcion: undefined,
      });

      await app.close();
    });

    it('returns 404 for POST /relations when the service reports an unknown item', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });
      relationsService.create.mockRejectedValue(
        new NotFoundException('origenId does not match any item.'),
      );

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .post('/relations')
        .send({
          origenId: 'missing-item',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(404);

      await app.close();
    });

    it('returns 409 for POST /relations when the service reports a duplicate relation', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });
      relationsService.create.mockRejectedValue(
        new ConflictException('This relation already exists.'),
      );

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .post('/relations')
        .send({
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(409);

      await app.close();
    });

    // Same real-guard-chain posture as the POST /relations test above,
    // applied to PATCH /relations/:id: EDITOR/MANAGER/ADMINISTRATOR reach
    // the service, READ_ONLY is rejected with 403, unauthenticated with 401.
    it('lets EDITOR/MANAGER/ADMINISTRATOR tokens reach the service for PATCH /relations/:id and rejects READ_ONLY with 403', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
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
          .patch('/relations/relacion-1')
          .send({ descripcion: 'x' })
          .set('Authorization', 'Bearer a-valid-token')
          .expect(200);
      }

      verifyAsync.mockResolvedValueOnce({
        sub: 'caller-2',
        email: 'readonly@example.com',
        role: UsuarioRole.READ_ONLY,
      });

      await request(server)
        .patch('/relations/relacion-1')
        .send({ descripcion: 'x' })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(403);

      await request(server)
        .patch('/relations/relacion-1')
        .send({ descripcion: 'x' })
        .expect(401);

      await app.close();
    });

    // True black-box HTTP proof (not just a direct TS method call) that a
    // body containing origenId/destinoId never reaches the service with
    // those fields, over the real guard chain and Nest's actual JSON body
    // parsing/binding.
    it('never forwards origenId/destinoId to the service over a real HTTP PATCH, even when present in the JSON body', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .patch('/relations/relacion-1')
        .send({
          origenId: 'should-be-ignored',
          destinoId: 'should-be-ignored',
          descripcion: 'Updated over real HTTP',
        })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(200);

      expect(relationsService.update).toHaveBeenCalledWith(
        'caller-1',
        'relacion-1',
        { tipo: undefined, descripcion: 'Updated over real HTTP' },
      );

      await app.close();
    });

    it('returns 400 for PATCH /relations/:id when the body has no recognized fields', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .patch('/relations/relacion-1')
        .send({})
        .set('Authorization', 'Bearer a-valid-token')
        .expect(400);

      expect(relationsService.update).not.toHaveBeenCalled();

      await app.close();
    });

    it('returns 409 for PATCH /relations/:id when the service reports a tipo collision', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });
      relationsService.update.mockRejectedValue(
        new ConflictException('This relation already exists.'),
      );

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .patch('/relations/relacion-1')
        .send({ tipo: 'DEPENDS_ON' })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(409);

      await app.close();
    });

    it('returns 404 for PATCH /relations/:id when the service reports the relation does not exist', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });
      relationsService.update.mockRejectedValue(
        new NotFoundException('Relation not found.'),
      );

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .patch('/relations/missing-relation')
        .send({ descripcion: 'x' })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(404);

      await app.close();
    });

    // Same real-guard-chain posture as PATCH /relations/:id above, applied
    // to DELETE /relations/:id.
    it('lets EDITOR/MANAGER/ADMINISTRATOR tokens reach the service for DELETE /relations/:id and rejects READ_ONLY with 403', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
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
          .delete('/relations/relacion-1')
          .set('Authorization', 'Bearer a-valid-token')
          .expect(204);
      }

      verifyAsync.mockResolvedValueOnce({
        sub: 'caller-2',
        email: 'readonly@example.com',
        role: UsuarioRole.READ_ONLY,
      });

      await request(server)
        .delete('/relations/relacion-1')
        .set('Authorization', 'Bearer a-valid-token')
        .expect(403);

      await request(server).delete('/relations/relacion-1').expect(401);

      await app.close();
    });

    it('returns 204 with an empty body and calls the service for a successful DELETE /relations/:id', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      const response = await request(app.getHttpServer() as Server)
        .delete('/relations/relacion-1')
        .set('Authorization', 'Bearer a-valid-token')
        .expect(204);

      expect(response.body).toEqual({});
      expect(relationsService.remove).toHaveBeenCalledWith(
        'caller-1',
        'relacion-1',
      );

      await app.close();
    });

    it('returns 404 for DELETE /relations/:id when the service reports the relation does not exist', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.EDITOR,
      });
      relationsService.remove.mockRejectedValue(
        new NotFoundException('Relation not found.'),
      );

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .delete('/relations/missing-relation')
        .set('Authorization', 'Bearer a-valid-token')
        .expect(404);

      await app.close();
    });

    // Same posture as AuditController/InventoryController's GET-endpoint
    // precedent test: `GET /relations/suggest` deliberately carries no
    // `RolesGuard`/`@Roles(...)` — this proves all four roles reach the
    // service, not just that the route responds.
    it('lets all four roles reach the service for GET /relations/suggest and none is rejected', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
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
          .get('/relations/suggest')
          .query({ origenTipo: 'VIRTUAL_SERVER', destinoTipo: 'SERVICE' })
          .set('Authorization', 'Bearer a-valid-token')
          .expect(200);
      }

      expect(relationsService.suggest).toHaveBeenCalledTimes(4);

      await request(server)
        .get('/relations/suggest')
        .query({ origenTipo: 'VIRTUAL_SERVER', destinoTipo: 'SERVICE' })
        .expect(401);

      await app.close();
    });

    it('returns the service payload for a successful GET /relations/suggest call', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({
        sub: 'caller-1',
        email: 'caller@example.com',
        role: UsuarioRole.READ_ONLY,
      });

      const moduleRef = await Test.createTestingModule({
        controllers: [RelationsController],
        providers: [
          { provide: RelationsService, useValue: relationsService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      const response = await request(app.getHttpServer() as Server)
        .get('/relations/suggest')
        .query({ origenTipo: 'VIRTUAL_SERVER', destinoTipo: 'SERVICE' })
        .set('Authorization', 'Bearer a-valid-token')
        .expect(200);

      expect(response.body).toEqual(SUGGESTION);
      expect(relationsService.suggest).toHaveBeenCalledWith(
        'VIRTUAL_SERVER',
        'SERVICE',
      );

      await app.close();
    });
  });
});
