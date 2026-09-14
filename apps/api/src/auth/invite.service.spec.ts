import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import {
  InviteService,
  EMAIL_ALREADY_REGISTERED_MESSAGE,
} from './invite.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

type Usuario = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  status: string;
};

type InvitationTokenRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
};

type PrismaMock = {
  usuario: {
    findUnique: jest.Mock<Promise<Usuario | null>, [unknown]>;
    create: jest.Mock<Promise<Usuario>, [unknown]>;
    update: jest.Mock<Promise<Usuario>, [unknown]>;
  };
  invitationToken: {
    create: jest.Mock<Promise<unknown>, [unknown]>;
    findUnique: jest.Mock<Promise<InvitationTokenRow | null>, [unknown]>;
    updateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
};

function hashOf(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

describe('InviteService', () => {
  let prisma: PrismaMock;
  let mailService: { send: jest.Mock<Promise<void>, [string, string, string]> };
  let service: InviteService;

  const PASSWORD = 'a-new-password';

  // A real, well-formed argon2 hash (not the literal string
  // 'placeholder-hash') — enforcePasswordPolicy's reuse check now runs
  // argon2.verify against every Usuario returned by the mock, and argon2
  // throws on a malformed hash rather than returning false.
  let PLACEHOLDER_HASH: string;

  beforeAll(async () => {
    PLACEHOLDER_HASH = await argon2.hash('unguessable-placeholder-value');
  });

  function makeUsuario(overrides: Partial<Usuario> = {}): Usuario {
    return {
      id: 'user-1',
      email: 'invitee@example.com',
      passwordHash: PLACEHOLDER_HASH,
      role: 'EDITOR',
      status: 'PENDING_VERIFICATION',
      ...overrides,
    };
  }

  function makeInvitationToken(
    overrides: Partial<InvitationTokenRow> = {},
  ): InvitationTokenRow {
    return {
      id: 'invitation-token-1',
      userId: 'user-1',
      tokenHash: hashOf('raw-token'),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      used: false,
      createdAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      usuario: {
        findUnique: jest.fn<Promise<Usuario | null>, [unknown]>(),
        create: jest.fn<Promise<Usuario>, [unknown]>(),
        update: jest.fn<Promise<Usuario>, [unknown]>(),
      },
      invitationToken: {
        create: jest.fn<Promise<unknown>, [unknown]>(),
        findUnique: jest.fn<Promise<InvitationTokenRow | null>, [unknown]>(),
        updateMany: jest
          .fn<Promise<{ count: number }>, [unknown]>()
          .mockResolvedValue({ count: 1 }),
      },
    };
    mailService = {
      send: jest
        .fn<Promise<void>, [string, string, string]>()
        .mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InviteService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = moduleRef.get(InviteService);
  });

  describe('invite', () => {
    // Scenario 1: brand-new email.
    it('creates a PENDING_VERIFICATION Usuario, one InvitationToken row, and sends an email', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      const created = makeUsuario();
      prisma.usuario.create.mockResolvedValue(created);

      await service.invite('invitee@example.com', 'EDITOR');

      expect(prisma.usuario.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.usuario.create.mock.calls[0][0] as {
        data: {
          email: string;
          passwordHash: string;
          role: string;
          status: string;
        };
      };
      expect(data.email).toBe('invitee@example.com');
      expect(data.role).toBe('EDITOR');
      expect(data.status).toBe('PENDING_VERIFICATION');
      // The placeholder hash must be a real, well-formed argon2 hash (so a
      // later login attempt's argon2.verify never throws) that never
      // matches any real password.
      expect(await argon2.verify(data.passwordHash, 'anything')).toBe(false);

      expect(prisma.invitationToken.create).toHaveBeenCalledTimes(1);
      const tokenCall = prisma.invitationToken.create.mock.calls[0][0] as {
        data: { userId: string; tokenHash: string; expiresAt: Date };
      };
      expect(tokenCall.data.userId).toBe(created.id);
      expect(tokenCall.data.tokenHash).toHaveLength(64);
      expect(tokenCall.data.expiresAt.getTime()).toBeGreaterThan(Date.now());

      expect(mailService.send).toHaveBeenCalledTimes(1);
      expect(mailService.send).toHaveBeenCalledWith(
        created.email,
        expect.any(String),
        expect.any(String),
      );

      // No sibling-invalidation call for a brand-new user — nothing to
      // invalidate.
      expect(prisma.invitationToken.updateMany).not.toHaveBeenCalled();
    });

    it('normalizes the email before lookup/creation', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      prisma.usuario.create.mockResolvedValue(makeUsuario());

      await service.invite('Invitee@Example.COM', 'EDITOR');

      expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { email: 'invitee@example.com' },
      });
    });

    it('does not wait on a slow MailService.send before resolving', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      prisma.usuario.create.mockResolvedValue(makeUsuario());
      mailService.send.mockReturnValue(new Promise(() => {}));

      await expect(
        service.invite('invitee@example.com', 'EDITOR'),
      ).resolves.toBeUndefined();
    });

    // Scenario 2: resend for an already-PENDING_VERIFICATION email.
    it('resends: no duplicate Usuario, invalidates prior unused tokens, issues one fresh token', async () => {
      const existing = makeUsuario({ status: 'PENDING_VERIFICATION' });
      prisma.usuario.findUnique.mockResolvedValue(existing);
      prisma.usuario.update.mockResolvedValue(existing);

      await service.invite('invitee@example.com', 'EDITOR');

      expect(prisma.usuario.create).not.toHaveBeenCalled();
      expect(prisma.invitationToken.updateMany).toHaveBeenCalledWith({
        where: { userId: existing.id, used: false },
        data: { used: true },
      });
      expect(prisma.invitationToken.create).toHaveBeenCalledTimes(1);
      const tokenCall = prisma.invitationToken.create.mock.calls[0][0] as {
        data: { userId: string };
      };
      expect(tokenCall.data.userId).toBe(existing.id);
      expect(mailService.send).toHaveBeenCalledTimes(1);
    });

    it('resends: applies a corrected role to the existing Usuario', async () => {
      const existing = makeUsuario({
        status: 'PENDING_VERIFICATION',
        role: 'EDITOR',
      });
      prisma.usuario.findUnique.mockResolvedValue(existing);
      prisma.usuario.update.mockResolvedValue({
        ...existing,
        role: 'MANAGER',
      });

      await service.invite('invitee@example.com', 'MANAGER');

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: existing.id },
        data: { role: 'MANAGER' },
      });
    });

    // Scenario 7: two concurrent invite() calls for the same brand-new email
    // both pass the findUnique->null check; the loser's usuario.create hits
    // the DB's unique constraint on `email` and must surface as the same 409
    // conflict as the ACTIVE/DEACTIVATED path, not an unhandled 500.
    it('converts a concurrent unique-constraint violation on create into a conflict', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      prisma.usuario.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.invite('invitee@example.com', 'EDITOR'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.invite('invitee@example.com', 'EDITOR'),
      ).rejects.toThrow(EMAIL_ALREADY_REGISTERED_MESSAGE);

      expect(prisma.invitationToken.create).not.toHaveBeenCalled();
      expect(mailService.send).not.toHaveBeenCalled();
    });

    // Scenario 3: email already ACTIVE or DEACTIVATED.
    it.each(['ACTIVE', 'DEACTIVATED'])(
      'rejects with a conflict when the email already belongs to a %s Usuario, mutating nothing',
      async (status) => {
        prisma.usuario.findUnique.mockResolvedValue(makeUsuario({ status }));

        await expect(
          service.invite('invitee@example.com', 'EDITOR'),
        ).rejects.toThrow(ConflictException);
        await expect(
          service.invite('invitee@example.com', 'EDITOR'),
        ).rejects.toThrow(EMAIL_ALREADY_REGISTERED_MESSAGE);

        expect(prisma.usuario.create).not.toHaveBeenCalled();
        expect(prisma.invitationToken.create).not.toHaveBeenCalled();
        expect(prisma.invitationToken.updateMany).not.toHaveBeenCalled();
        expect(mailService.send).not.toHaveBeenCalled();
      },
    );
  });

  describe('activate', () => {
    // Scenario 4: valid, unused, unexpired token + non-empty password.
    it('activates the Usuario, sets the password hash, and marks the token used', async () => {
      const invitationToken = makeInvitationToken();
      prisma.invitationToken.findUnique.mockResolvedValue(invitationToken);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ status: 'PENDING_VERIFICATION' }),
      );
      prisma.usuario.update.mockResolvedValue(
        makeUsuario({ status: 'ACTIVE' }),
      );

      const result = await service.activate('raw-token', PASSWORD);

      expect(result).toBe(true);
      expect(prisma.invitationToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hashOf('raw-token') },
      });
      expect(prisma.invitationToken.updateMany).toHaveBeenCalledWith({
        where: { id: invitationToken.id, used: false },
        data: { used: true },
      });

      expect(prisma.usuario.update).toHaveBeenCalledTimes(1);
      const { where, data } = prisma.usuario.update.mock.calls[0][0] as {
        where: { id: string };
        data: { passwordHash: string; status: string };
      };
      expect(where).toEqual({ id: invitationToken.userId });
      expect(typeof data.passwordHash).toBe('string');
      expect(data.passwordHash).not.toBe(PASSWORD);
      expect(data.status).toBe('ACTIVE');
    });

    // Scenario 5a: unknown token.
    it('rejects an unknown token without touching any row', async () => {
      prisma.invitationToken.findUnique.mockResolvedValue(null);

      const result = await service.activate('unknown-token', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.invitationToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    // Scenario 5b: already-used token.
    it('rejects an already-used token and does not re-activate the account', async () => {
      prisma.invitationToken.findUnique.mockResolvedValue(
        makeInvitationToken({ used: true }),
      );

      const result = await service.activate('raw-token', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.invitationToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    // Scenario 5c: expired token.
    it('rejects an expired token without touching any row', async () => {
      prisma.invitationToken.findUnique.mockResolvedValue(
        makeInvitationToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      const result = await service.activate('raw-token', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.invitationToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('rejects an empty password without looking up the token', async () => {
      const result = await service.activate('raw-token', '');

      expect(result).toBe(false);
      expect(prisma.invitationToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a non-string token without looking up anything', async () => {
      const result = await service.activate(
        12345 as unknown as string,
        PASSWORD,
      );

      expect(result).toBe(false);
      expect(prisma.invitationToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an empty token without looking up the token', async () => {
      const result = await service.activate('', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.invitationToken.findUnique).not.toHaveBeenCalled();
    });

    // Scenario 6: two concurrent requests presenting the same valid token —
    // exactly one succeeds. Both pass the (non-atomic) status re-check and
    // policy check; only the atomic consume actually decides the winner.
    it('rejects the loser of a concurrent race on the same token (lost the atomic consume)', async () => {
      const invitationToken = makeInvitationToken();
      prisma.invitationToken.findUnique.mockResolvedValue(invitationToken);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ status: 'PENDING_VERIFICATION' }),
      );
      prisma.invitationToken.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.activate('raw-token', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    // Scenario 8: a stale-but-still-valid InvitationToken presented against a
    // Usuario that is no longer PENDING_VERIFICATION (e.g. already ACTIVE)
    // must be rejected the same generic way, never resetting that user's
    // password with no re-authentication. The status re-check now runs
    // before the atomic consume, so the token is never marked used either.
    it('rejects a valid token whose target Usuario is no longer PENDING_VERIFICATION, without consuming the token', async () => {
      const invitationToken = makeInvitationToken();
      prisma.invitationToken.findUnique.mockResolvedValue(invitationToken);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ status: 'ACTIVE' }),
      );

      const result = await service.activate('raw-token', PASSWORD);

      expect(result).toBe(false);
      expect(prisma.invitationToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    // spec-1-11 I/O matrix row 1: password shorter than PASSWORD_MIN_LENGTH.
    // The token must remain unused so the same link can be retried.
    it('rejects a too-short password with a BadRequestException, without consuming the token', async () => {
      const invitationToken = makeInvitationToken();
      prisma.invitationToken.findUnique.mockResolvedValue(invitationToken);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ status: 'PENDING_VERIFICATION' }),
      );

      await expect(service.activate('raw-token', 'short1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.activate('raw-token', 'short1')).rejects.toThrow(
        /at least 8 characters/,
      );

      expect(prisma.invitationToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    // spec-1-11 AC 3: a policy-rejected attempt against a still-valid token
    // never consumes it — the same token can then succeed with a compliant
    // password.
    it('lets the same token succeed on retry after an earlier policy-rejected attempt', async () => {
      const invitationToken = makeInvitationToken();
      prisma.invitationToken.findUnique.mockResolvedValue(invitationToken);
      prisma.usuario.findUnique.mockResolvedValue(
        makeUsuario({ status: 'PENDING_VERIFICATION' }),
      );

      await expect(service.activate('raw-token', 'short1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.invitationToken.updateMany).not.toHaveBeenCalled();

      prisma.usuario.update.mockResolvedValue(
        makeUsuario({ status: 'ACTIVE' }),
      );

      const result = await service.activate('raw-token', PASSWORD);

      expect(result).toBe(true);
      expect(prisma.invitationToken.updateMany).toHaveBeenCalledWith({
        where: { id: invitationToken.id, used: false },
        data: { used: true },
      });
    });

    // Reuse check runs too (against the unguessable placeholder hash) — in
    // practice never matches a real password, but the policy call is
    // unconditional per spec-1-11 Code Map.
    it('does not reject a normal password merely because a reuse check also runs against the placeholder hash', async () => {
      const invitationToken = makeInvitationToken();
      prisma.invitationToken.findUnique.mockResolvedValue(invitationToken);
      const usuario = makeUsuario({ status: 'PENDING_VERIFICATION' });
      prisma.usuario.findUnique.mockResolvedValue(usuario);
      prisma.usuario.update.mockResolvedValue(
        makeUsuario({ status: 'ACTIVE' }),
      );

      const result = await service.activate('raw-token', PASSWORD);

      expect(result).toBe(true);
    });
  });
});
