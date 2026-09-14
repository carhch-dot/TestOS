import { Test } from '@nestjs/testing';
import { Prisma, TipoAccion } from '@prisma/client';
import { AuditService, RecordAuditParams } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let tx: { registroAuditoria: { create: jest.Mock } };
  // PrismaService itself is never injected/used by AuditService — the spec
  // Boundaries require every write to go through the passed `tx`. It is
  // still provided to the testing module so a real `PrismaService` instance
  // (which we deliberately never touch) is available if some future
  // refactor accidentally starts depending on it — the "never through
  // PrismaService" assertion below is what actually proves that never
  // happens.
  let prismaService: { registroAuditoria: { create: jest.Mock } };

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
    prismaService = { registroAuditoria: { create: jest.fn() } };

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
});
