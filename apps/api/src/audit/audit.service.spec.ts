import { Test } from '@nestjs/testing';
import { Prisma, TipoAccion } from '@prisma/client';
import { AuditService, RecordAuditParams } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let tx: { registroAuditoria: { create: jest.Mock } };
  // For `record`, PrismaService is never used — spec-2-1 Boundaries require
  // every write to go through the passed `tx` instead. spec-2-2 adds `list`,
  // which does read through this directly (`findMany`/`count`), so the mock
  // now covers both.
  let prismaService: {
    registroAuditoria: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  const PARAMS: RecordAuditParams = {
    usuarioId: 'user-1',
    tipoAccion: TipoAccion.CREATE,
    entidad: 'ItemConfiguracion',
    entidadId: 'item-1',
    cambios: { before: null, after: { name: 'server-1' } },
  };

  beforeEach(async () => {
    tx = {
      registroAuditoria: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1', ...PARAMS }),
      },
    };
    prismaService = {
      registroAuditoria: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = moduleRef.get(AuditService);
  });

  // I/O matrix row 1: record(tx, params) writes exactly one row through the
  // passed tx, with all five canonical fields (fecha is a DB default, not
  // asserted here since the mock doesn't compute it).
  it('writes exactly one RegistroAuditoria row through the passed tx', async () => {
    await service.record(tx as unknown as Prisma.TransactionClient, PARAMS);

    expect(tx.registroAuditoria.create).toHaveBeenCalledTimes(1);
    expect(tx.registroAuditoria.create).toHaveBeenCalledWith({
      data: {
        usuarioId: PARAMS.usuarioId,
        tipoAccion: PARAMS.tipoAccion,
        entidad: PARAMS.entidad,
        entidadId: PARAMS.entidadId,
        cambios: PARAMS.cambios,
      },
    });
  });

  // I/O matrix row 3: the write goes through the passed tx, never through a
  // fresh top-level PrismaService client.
  it('never writes through PrismaService directly', async () => {
    await service.record(tx as unknown as Prisma.TransactionClient, PARAMS);

    expect(prismaService.registroAuditoria.create).not.toHaveBeenCalled();
  });

  // I/O matrix row 2: if the caller's transaction later rolls back, no row
  // persists. record() itself has no rollback logic of its own — it is a
  // thin pass-through to tx.registroAuditoria.create, so this is proven by
  // showing that a tx-level failure (rollback) propagates out of record()
  // rather than being swallowed, exactly like the domain write it
  // accompanies would.
  it('propagates a tx-level failure (e.g. the enclosing transaction rolling back) instead of swallowing it', async () => {
    const rollbackError = new Error('transaction rolled back');
    tx.registroAuditoria.create.mockRejectedValue(rollbackError);

    await expect(
      service.record(tx as unknown as Prisma.TransactionClient, PARAMS),
    ).rejects.toThrow(rollbackError);
  });

  it.each(['entidad', 'entidadId'] as const)(
    'rejects an empty %s without writing anything (table is append-only, no fix-up path)',
    async (field) => {
      await expect(
        service.record(tx as unknown as Prisma.TransactionClient, {
          ...PARAMS,
          [field]: '',
        }),
      ).rejects.toThrow(/must not be empty/);
      expect(tx.registroAuditoria.create).not.toHaveBeenCalled();
    },
  );

  it('accepts each TipoAccion value', async () => {
    for (const tipoAccion of [
      TipoAccion.CREATE,
      TipoAccion.UPDATE,
      TipoAccion.DELETE,
    ]) {
      await service.record(tx as unknown as Prisma.TransactionClient, {
        ...PARAMS,
        tipoAccion,
      });
    }

    expect(tx.registroAuditoria.create).toHaveBeenCalledTimes(3);
  });

  // spec-2-2: `list(filters, page, pageSize)` — the sole read path onto
  // RegistroAuditoria. Every test below asserts on the exact `where` object
  // passed to both `findMany` and `count` (they must always match, or total
  // would drift from the filtered page) plus ordering/pagination.
  describe('list', () => {
    const ROW = {
      id: 'audit-1',
      usuarioId: 'user-1',
      usuario: { id: 'user-1', email: 'user1@example.com' },
      tipoAccion: TipoAccion.UPDATE,
      entidad: 'ItemConfiguracion',
      entidadId: 'item-1',
      cambios: { before: null, after: { name: 'server-1' } },
      fecha: new Date('2026-09-01T00:00:00.000Z'),
    };

    beforeEach(() => {
      prismaService.registroAuditoria.findMany.mockResolvedValue([ROW]);
      prismaService.registroAuditoria.count.mockResolvedValue(1);
    });

    // I/O matrix row 1: unfiltered query, ordered fecha desc, paginated,
    // each entry carries the joined usuario.id/usuario.email.
    it('returns entries ordered fecha desc with the joined usuario, when no filters are supplied', async () => {
      const result = await service.list({}, 1, 20);

      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        include: { usuario: { select: { id: true, email: true } } },
      });
      expect(prismaService.registroAuditoria.count).toHaveBeenCalledWith({
        where: {},
      });
      expect(result).toEqual({
        data: [
          {
            id: ROW.id,
            usuarioId: ROW.usuarioId,
            usuario: ROW.usuario,
            tipoAccion: ROW.tipoAccion,
            entidad: ROW.entidad,
            entidadId: ROW.entidadId,
            cambios: ROW.cambios,
            fecha: ROW.fecha,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    });

    it('computes skip from page/pageSize', async () => {
      await service.list({}, 3, 10);

      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('filters by usuarioId alone', async () => {
      await service.list({ usuarioId: 'user-1' }, 1, 20);

      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { usuarioId: 'user-1' } }),
      );
      expect(prismaService.registroAuditoria.count).toHaveBeenCalledWith({
        where: { usuarioId: 'user-1' },
      });
    });

    it('filters by entidad alone', async () => {
      await service.list({ entidad: 'ItemConfiguracion' }, 1, 20);

      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entidad: 'ItemConfiguracion' },
        }),
      );
    });

    it('filters by entidadId alone', async () => {
      await service.list({ entidadId: 'item-1' }, 1, 20);

      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entidadId: 'item-1' },
        }),
      );
    });

    it('filters by tipoAccion alone', async () => {
      await service.list({ tipoAccion: TipoAccion.DELETE }, 1, 20);

      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tipoAccion: TipoAccion.DELETE },
        }),
      );
    });

    it('filters by desde alone (fecha >= desde)', async () => {
      const desde = new Date('2026-01-01T00:00:00.000Z');
      await service.list({ desde }, 1, 20);

      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fecha: { gte: desde } } }),
      );
    });

    it('filters by hasta alone (fecha <= hasta)', async () => {
      const hasta = new Date('2026-12-31T23:59:59.999Z');
      await service.list({ hasta }, 1, 20);

      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fecha: { lte: hasta } } }),
      );
    });

    it('combines desde and hasta into a single fecha range', async () => {
      const desde = new Date('2026-01-01T00:00:00.000Z');
      const hasta = new Date('2026-12-31T23:59:59.999Z');
      await service.list({ desde, hasta }, 1, 20);

      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fecha: { gte: desde, lte: hasta } },
        }),
      );
    });

    // AC: "filtered by any combination ... then only entries matching every
    // supplied filter are returned" — all five filters AND-combined at once.
    it('AND-combines every supplied filter together', async () => {
      const desde = new Date('2026-01-01T00:00:00.000Z');
      const hasta = new Date('2026-12-31T23:59:59.999Z');
      await service.list(
        {
          usuarioId: 'user-1',
          entidad: 'ItemConfiguracion',
          entidadId: 'item-1',
          tipoAccion: TipoAccion.UPDATE,
          desde,
          hasta,
        },
        1,
        20,
      );

      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            usuarioId: 'user-1',
            entidad: 'ItemConfiguracion',
            entidadId: 'item-1',
            tipoAccion: TipoAccion.UPDATE,
            fecha: { gte: desde, lte: hasta },
          },
        }),
      );
    });

    // spec Boundaries: "a swapped range just yields zero results, which is
    // self-correcting" — no error, just an empty page.
    it('returns an empty page (not an error) when desde is later than hasta', async () => {
      prismaService.registroAuditoria.findMany.mockResolvedValue([]);
      prismaService.registroAuditoria.count.mockResolvedValue(0);
      const desde = new Date('2026-12-31T00:00:00.000Z');
      const hasta = new Date('2026-01-01T00:00:00.000Z');

      const result = await service.list({ desde, hasta }, 1, 20);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fecha: { gte: desde, lte: hasta } },
        }),
      );
    });

    // spec-2-1's review added @@index([entidad, entidadId]) specifically for
    // ordering by fecha with a stable tie-breaker on identical timestamps.
    it('orders by fecha desc with id desc as a tie-breaker', async () => {
      await service.list({}, 1, 20);

      expect(prismaService.registroAuditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        }),
      );
    });
  });
});
