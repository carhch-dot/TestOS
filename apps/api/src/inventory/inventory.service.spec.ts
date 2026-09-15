import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, TipoAccion } from '@prisma/client';
import {
  InventoryService,
  NAME_ALREADY_EXISTS_MESSAGE,
} from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type ItemRow = {
  id: string;
  nombre: string;
  descripcion: string | null;
  dominioPropietario: string | null;
  direccionRed: string | null;
  tipo: string;
  properties: Prisma.JsonValue;
};

const CREATED_ITEM: ItemRow = {
  id: 'item-1',
  nombre: 'core-db',
  descripcion: 'Core database',
  dominioPropietario: 'platform',
  direccionRed: '10.0.0.1',
  tipo: 'DATABASE',
  properties: { engine: 'postgres' },
};

describe('InventoryService', () => {
  let prisma: {
    itemConfiguracion: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    itemConfiguracion: {
      create: jest.Mock<Promise<ItemRow>, [unknown]>;
    };
  };
  let auditService: { record: jest.Mock };
  let service: InventoryService;

  beforeEach(async () => {
    tx = {
      itemConfiguracion: {
        create: jest
          .fn<Promise<ItemRow>, [unknown]>()
          .mockResolvedValue(CREATED_ITEM),
      },
    };

    prisma = {
      itemConfiguracion: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // Mirrors the real `$transaction(callback)` shape: invoke the
      // callback with a transaction client (`tx`) and return/propagate
      // whatever it returns/throws — the same all-or-nothing semantics a
      // real Postgres transaction gives (a rejection here means nothing
      // committed).
      $transaction: jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      ),
    };

    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = moduleRef.get(InventoryService);
  });

  // I/O matrix row 1: valid tipo + unique nombre -> 201-equivalent create,
  // one RegistroAuditoria entry, both through the same tx.
  it('creates the item and records exactly one audit entry through the same tx', async () => {
    const result = await service.create('user-1', {
      nombre: 'core-db',
      tipo: 'DATABASE',
      descripcion: 'Core database',
      dominioPropietario: 'platform',
      direccionRed: '10.0.0.1',
      properties: { engine: 'postgres' },
    });

    expect(result).toEqual(CREATED_ITEM);
    expect(tx.itemConfiguracion.create).toHaveBeenCalledWith({
      data: {
        nombre: 'core-db',
        descripcion: 'Core database',
        dominioPropietario: 'platform',
        direccionRed: '10.0.0.1',
        tipo: 'DATABASE',
        properties: { engine: 'postgres' },
      },
    });
    expect(auditService.record).toHaveBeenCalledTimes(1);
    expect(auditService.record).toHaveBeenCalledWith(tx, {
      usuarioId: 'user-1',
      tipoAccion: TipoAccion.CREATE,
      entidad: 'ItemConfiguracion',
      entidadId: CREATED_ITEM.id,
      cambios: {
        nombre: CREATED_ITEM.nombre,
        descripcion: CREATED_ITEM.descripcion,
        dominioPropietario: CREATED_ITEM.dominioPropietario,
        direccionRed: CREATED_ITEM.direccionRed,
        tipo: CREATED_ITEM.tipo,
        properties: CREATED_ITEM.properties,
      },
    });
  });

  // spec Boundaries: "normalizados... antes de comparar o persistir" — a
  // whitespace-variant name must be trimmed before both the uniqueness check
  // and the persisted value, not just compared case-insensitively.
  it('trims nombre before both the uniqueness check and persisting it', async () => {
    await service.create('user-1', {
      nombre: '  core-db  ',
      tipo: 'DATABASE',
    });

    expect(prisma.itemConfiguracion.findFirst).toHaveBeenCalledWith({
      where: { nombre: { equals: 'core-db', mode: 'insensitive' } },
    });
    const { data } = tx.itemConfiguracion.create.mock.calls[0][0] as {
      data: { nombre: string };
    };
    expect(data.nombre).toBe('core-db');
  });

  // properties defaults to {} when the caller omits it entirely.
  it('defaults properties to {} when omitted', async () => {
    await service.create('user-1', { nombre: 'core-db', tipo: 'DATABASE' });

    const { data } = tx.itemConfiguracion.create.mock.calls[0][0] as {
      data: { properties: unknown };
    };
    expect(data.properties).toEqual({});
  });

  // I/O matrix row 2: tipo not in the catalog -> 400, no DB access at all
  // (not even the uniqueness check), no transaction started.
  it('rejects a tipo outside the static catalog with a BadRequestException, never touching the DB', async () => {
    await expect(
      service.create('user-1', { nombre: 'core-db', tipo: 'NOT_A_TYPE' }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.itemConfiguracion.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // I/O matrix row 3: nombre case-variant of an existing item -> 409,
  // caught up front by the case-insensitive findFirst, no transaction
  // started (so no item/audit row created).
  it('rejects a name that differs only in case from an existing item, before starting a transaction', async () => {
    prisma.itemConfiguracion.findFirst.mockResolvedValue({
      ...CREATED_ITEM,
      id: 'existing-1',
    });

    await expect(
      service.create('user-1', { nombre: 'Core-DB', tipo: 'DATABASE' }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.create('user-1', { nombre: 'Core-DB', tipo: 'DATABASE' }),
    ).rejects.toThrow(NAME_ALREADY_EXISTS_MESSAGE);

    expect(prisma.itemConfiguracion.findFirst).toHaveBeenCalledWith({
      where: { nombre: { equals: 'Core-DB', mode: 'insensitive' } },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Race-condition backstop: two concurrent creates both pass the up-front
  // findFirst check; the loser's tx.itemConfiguracion.create hits the DB's
  // real unique constraint on nombre (P2002), surfaced as the same 409
  // rather than a raw 500 -- mirrors InviteService.invite's P2002 handling.
  it('converts a concurrent unique-constraint violation into a 409 conflict, recording no audit entry', async () => {
    tx.itemConfiguracion.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.create('user-1', { nombre: 'core-db', tipo: 'DATABASE' }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.create('user-1', { nombre: 'core-db', tipo: 'DATABASE' }),
    ).rejects.toThrow(NAME_ALREADY_EXISTS_MESSAGE);

    expect(auditService.record).not.toHaveBeenCalled();
  });

  // I/O matrix row 5: a failure inside the transaction after the item
  // insert (here, AuditService.record rejecting) propagates out of
  // create() unchanged -- the same all-or-nothing guarantee a real
  // Postgres transaction gives (spec-2-1's AuditService.record was built
  // for exactly this).
  it('propagates a failure from AuditService.record, never swallowing it as a partial success', async () => {
    auditService.record.mockRejectedValue(new Error('audit write failed'));

    await expect(
      service.create('user-1', { nombre: 'core-db', tipo: 'DATABASE' }),
    ).rejects.toThrow('audit write failed');
  });

  // A non-P2002 error out of the transaction (e.g. some other DB failure)
  // must not be misclassified as a name conflict.
  it('rethrows a non-P2002 error unchanged', async () => {
    tx.itemConfiguracion.create.mockRejectedValue(new Error('connection lost'));

    await expect(
      service.create('user-1', { nombre: 'core-db', tipo: 'DATABASE' }),
    ).rejects.toThrow('connection lost');
  });

  // The P2002-to-409 conversion is scoped to only the itemConfiguracion
  // create call, not the whole transaction — a P2002 from the audit insert
  // (currently unreachable, since RegistroAuditoria has no @unique
  // constraint besides its PK, but a real code-smell if that ever changes)
  // must never be misreported as a name conflict.
  it('does not convert a P2002 raised by AuditService.record into a name conflict', async () => {
    auditService.record.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.create('user-1', { nombre: 'core-db', tipo: 'DATABASE' }),
    ).rejects.not.toThrow(NAME_ALREADY_EXISTS_MESSAGE);
  });
});
