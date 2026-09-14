import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Server } from 'http';
import { UsuarioRole } from '@prisma/client';
import {
  InviteController,
  INVITE_SUCCESS_MESSAGE,
  INVALID_INVITE_REQUEST_MESSAGE,
  ACTIVATE_FAILED_MESSAGE,
} from './invite.controller';
import {
  InviteService,
  EMAIL_ALREADY_REGISTERED_MESSAGE,
} from './invite.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

describe('InviteController', () => {
  let inviteService: { invite: jest.Mock; activate: jest.Mock };
  let controller: InviteController;

  beforeEach(async () => {
    inviteService = {
      invite: jest.fn().mockResolvedValue(undefined),
      activate: jest.fn().mockResolvedValue(true),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [InviteController],
      providers: [{ provide: InviteService, useValue: inviteService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(InviteController);
  });

  describe('invite (dispatch)', () => {
    it('delegates to InviteService.invite and returns the success message', async () => {
      const result = await controller.invite({
        email: 'invitee@example.com',
        role: UsuarioRole.EDITOR,
      });

      expect(inviteService.invite).toHaveBeenCalledWith(
        'invitee@example.com',
        UsuarioRole.EDITOR,
      );
      expect(result).toEqual({ message: INVITE_SUCCESS_MESSAGE });
    });

    it('propagates a ConflictException raised by the service unchanged', async () => {
      inviteService.invite.mockRejectedValue(
        new ConflictException(EMAIL_ALREADY_REGISTERED_MESSAGE),
      );

      await expect(
        controller.invite({
          email: 'taken@example.com',
          role: UsuarioRole.EDITOR,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects malformed input (missing role) without calling the service', async () => {
      await expect(
        controller.invite({
          email: 'invitee@example.com',
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(inviteService.invite).not.toHaveBeenCalled();
    });

    it('rejects malformed input (invalid role string) without calling the service', async () => {
      await expect(
        controller.invite({
          email: 'invitee@example.com',
          role: 'NOT_A_REAL_ROLE',
        } as never),
      ).rejects.toThrow(INVALID_INVITE_REQUEST_MESSAGE);
      expect(inviteService.invite).not.toHaveBeenCalled();
    });

    it('rejects malformed input (missing email) without calling the service', async () => {
      await expect(
        controller.invite({ role: UsuarioRole.EDITOR } as never),
      ).rejects.toThrow(BadRequestException);
      expect(inviteService.invite).not.toHaveBeenCalled();
    });

    it('rejects malformed input (empty email) without calling the service', async () => {
      await expect(
        controller.invite({ email: '', role: UsuarioRole.EDITOR }),
      ).rejects.toThrow(BadRequestException);
      expect(inviteService.invite).not.toHaveBeenCalled();
    });

    it('rejects malformed input (oversized email) without calling the service', async () => {
      await expect(
        controller.invite({
          email: `${'a'.repeat(250)}@example.com`,
          role: UsuarioRole.EDITOR,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(inviteService.invite).not.toHaveBeenCalled();
    });

    it('rejects malformed input (whitespace-only email) without calling the service', async () => {
      await expect(
        controller.invite({ email: '   ', role: UsuarioRole.EDITOR }),
      ).rejects.toThrow(INVALID_INVITE_REQUEST_MESSAGE);
      expect(inviteService.invite).not.toHaveBeenCalled();
    });

    it('rejects malformed input (email with no @) without calling the service', async () => {
      await expect(
        controller.invite({
          email: 'not-an-email',
          role: UsuarioRole.EDITOR,
        }),
      ).rejects.toThrow(INVALID_INVITE_REQUEST_MESSAGE);
      expect(inviteService.invite).not.toHaveBeenCalled();
    });

    it('rejects malformed input (missing body) without calling the service', async () => {
      await expect(controller.invite(undefined as never)).rejects.toThrow(
        BadRequestException,
      );
      expect(inviteService.invite).not.toHaveBeenCalled();
    });
  });

  describe('invite (RBAC rejection)', () => {
    it('rejects with 403 when RolesGuard denies the caller (Editor/Read-only)', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [InviteController],
        providers: [{ provide: InviteService, useValue: inviteService }],
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
        .post('/auth/invite')
        .send({ email: 'invitee@example.com', role: UsuarioRole.EDITOR })
        .expect(403);

      await app.close();
    });

    it('rejects with 401 when JwtAuthGuard denies an unauthenticated caller', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [InviteController],
        providers: [{ provide: InviteService, useValue: inviteService }],
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
        .post('/auth/invite')
        .send({ email: 'invitee@example.com', role: UsuarioRole.EDITOR })
        .expect(401);

      await app.close();
    });
  });

  describe('invite (RBAC, real guards)', () => {
    // Unlike every other test in this file, this one does not fake
    // JwtAuthGuard or RolesGuard, and does not call `controller.invite(...)`
    // directly — it boots a real app with the real `@UseGuards(JwtAuthGuard,
    // RolesGuard)` chain (real Reflector included) on the real compiled
    // route, only stubbing `JwtService.verifyAsync` to hand back role
    // claims. A dropped `@Roles(...)` decorator or a swapped guard order
    // would fail this test even though every other test above stays green.
    it('lets MANAGER/ADMINISTRATOR tokens reach the service and rejects EDITOR/READ_ONLY with 403', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [InviteController],
        providers: [
          { provide: InviteService, useValue: inviteService },
          JwtAuthGuard,
          RolesGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();
      const server = app.getHttpServer() as Server;

      for (const role of [UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR]) {
        verifyAsync.mockResolvedValueOnce({
          sub: 'caller-1',
          email: 'caller@example.com',
          role,
        });

        await request(server)
          .post('/auth/invite')
          .set('Authorization', 'Bearer a-valid-token')
          .send({ email: 'invitee@example.com', role: UsuarioRole.EDITOR })
          .expect(200);
      }

      for (const role of [UsuarioRole.EDITOR, UsuarioRole.READ_ONLY]) {
        verifyAsync.mockResolvedValueOnce({
          sub: 'caller-2',
          email: 'caller2@example.com',
          role,
        });

        await request(server)
          .post('/auth/invite')
          .set('Authorization', 'Bearer a-valid-token')
          .send({ email: 'invitee@example.com', role: UsuarioRole.EDITOR })
          .expect(403);
      }

      await app.close();
    });
  });

  describe('activate', () => {
    it('delegates to InviteService.activate and returns a success message', async () => {
      const result = await controller.activate({
        token: 'raw-token',
        password: 'a-new-password',
      });

      expect(inviteService.activate).toHaveBeenCalledWith(
        'raw-token',
        'a-new-password',
      );
      expect(result).toEqual({
        message: 'Your account has been activated. You can now log in.',
      });
    });

    it('rejects with the generic message when activate returns false, never leaking why', async () => {
      inviteService.activate.mockResolvedValue(false);

      await expect(
        controller.activate({
          token: 'unknown-token',
          password: 'a-new-password',
        }),
      ).rejects.toThrow(ACTIVATE_FAILED_MESSAGE);
    });

    it('rejects with the generic message when token is missing, never calling the service', async () => {
      await expect(
        controller.activate({
          password: 'a-new-password',
        } as never),
      ).rejects.toThrow(ACTIVATE_FAILED_MESSAGE);
      expect(inviteService.activate).not.toHaveBeenCalled();
    });

    it('rejects with the generic message when token is empty', async () => {
      await expect(
        controller.activate({ token: '', password: 'a-new-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(inviteService.activate).not.toHaveBeenCalled();
    });

    it('rejects with the generic message when token exceeds the length cap', async () => {
      await expect(
        controller.activate({
          token: 'a'.repeat(513),
          password: 'a-new-password',
        }),
      ).rejects.toThrow(ACTIVATE_FAILED_MESSAGE);
      expect(inviteService.activate).not.toHaveBeenCalled();
    });

    it('rejects with the generic message when password is missing, never calling the service', async () => {
      await expect(
        controller.activate({ token: 'raw-token' } as never),
      ).rejects.toThrow(ACTIVATE_FAILED_MESSAGE);
      expect(inviteService.activate).not.toHaveBeenCalled();
    });

    it('rejects with the generic message when password is empty', async () => {
      await expect(
        controller.activate({ token: 'raw-token', password: '' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(inviteService.activate).not.toHaveBeenCalled();
    });

    it('rejects with the generic message when password exceeds the length cap', async () => {
      await expect(
        controller.activate({
          token: 'raw-token',
          password: 'a'.repeat(1025),
        }),
      ).rejects.toThrow(ACTIVATE_FAILED_MESSAGE);
      expect(inviteService.activate).not.toHaveBeenCalled();
    });

    it('rejects with the generic message when the body itself is missing', async () => {
      await expect(controller.activate(undefined as never)).rejects.toThrow(
        ACTIVATE_FAILED_MESSAGE,
      );
      expect(inviteService.activate).not.toHaveBeenCalled();
    });
  });
});
