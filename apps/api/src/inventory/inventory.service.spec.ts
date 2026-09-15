import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TipoAccion } from '@prisma/client';
import {
  InventoryService,
  NAME_ALREADY_EXISTS_MESSAGE,
  ITEM_NOT_FOUND_MESSAGE,
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
    itemConfiguracion: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tx: {
    itemConfiguracion: {
      create: jest.Mock<Promise<ItemRow>, [unknown]>;
      update: jest.Mock<Promise<ItemRow>, [unknown]>;
      delete: jest.Mock<Promise<ItemRow>, [unknown]>;
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
        update: jest
          .fn<Promise<ItemRow>, [unknown]>()
          .mockResolvedValue(CREATED_ITEM),
        delete: jest
          .fn<Promise<ItemRow>, [unknown]>()
          .mockResolvedValue(CREATED_ITEM),
      },
    };

    prisma = {
      itemConfiguracion: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(CREATED_ITEM),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
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

  // spec-3-3: `update(usuarioId, id, dto)` — partial update of an existing
  // item. `prisma.itemConfiguracion.findUnique` supplies the "before" state
  // (and the 404 check); the mutation + audit entry go through the same
  // `tx`-scoped transaction pattern as `create`.
  describe('update', () => {
    const EXISTING_ITEM: ItemRow = {
      id: 'item-1',
      nombre: 'core-db',
      descripcion: 'Core database',
      dominioPropietario: 'platform',
      direccionRed: '10.0.0.1',
      tipo: 'DATABASE',
      properties: { engine: 'postgres', version: '14' },
    };

    beforeEach(() => {
      prisma.itemConfiguracion.findUnique.mockResolvedValue(EXISTING_ITEM);
      tx.itemConfiguracion.update.mockResolvedValue(EXISTING_ITEM);
    });

    // I/O matrix row 1 + first Acceptance Criterion: only supplied fields
    // change, one audit entry with {before, after} for exactly those fields.
    it('updates only the supplied fields and records one audit entry with before/after for exactly those fields', async () => {
      const result = await service.update('user-1', 'item-1', {
        descripcion: 'Updated description',
      });

      expect(result).toEqual(EXISTING_ITEM);
      expect(tx.itemConfiguracion.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { descripcion: 'Updated description' },
      });
      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(tx, {
        usuarioId: 'user-1',
        tipoAccion: TipoAccion.UPDATE,
        entidad: 'ItemConfiguracion',
        entidadId: EXISTING_ITEM.id,
        cambios: {
          before: { descripcion: 'Core database' },
          after: { descripcion: 'Updated description' },
        },
      });
    });

    // I/O matrix row 2 + first Acceptance Criterion: properties is
    // shallow-merged, top-level keys not mentioned survive untouched.
    it('shallow-merges supplied properties with the existing properties, keeping untouched keys', async () => {
      const mergedItem = {
        ...EXISTING_ITEM,
        properties: { engine: 'postgres', version: '15' },
      };
      tx.itemConfiguracion.update.mockResolvedValue(mergedItem);

      const result = await service.update('user-1', 'item-1', {
        properties: { version: '15' },
      });

      expect(result).toEqual(mergedItem);
      expect(tx.itemConfiguracion.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { properties: { engine: 'postgres', version: '15' } },
      });
      expect(auditService.record).toHaveBeenCalledWith(tx, {
        usuarioId: 'user-1',
        tipoAccion: TipoAccion.UPDATE,
        entidad: 'ItemConfiguracion',
        entidadId: EXISTING_ITEM.id,
        cambios: {
          before: { properties: { engine: 'postgres', version: '14' } },
          after: { properties: { engine: 'postgres', version: '15' } },
        },
      });
    });

    // No deep/recursive merge of nested objects inside properties (spec
    // Boundaries/Never) — a nested object under a top-level key is replaced
    // wholesale by the supplied value for that key, not merged into.
    it('replaces a top-level properties key wholesale rather than deep-merging nested objects', async () => {
      prisma.itemConfiguracion.findUnique.mockResolvedValue({
        ...EXISTING_ITEM,
        properties: { config: { a: 1, b: 2 } },
      });

      await service.update('user-1', 'item-1', {
        properties: { config: { b: 3 } },
      });

      const { data } = tx.itemConfiguracion.update.mock.calls[0][0] as {
        data: { properties: unknown };
      };
      expect(data.properties).toEqual({ config: { b: 3 } });
    });

    // I/O matrix row 3: nombre supplied -> trimmed + case-insensitively
    // checked for uniqueness excluding the item's own row.
    it('trims a supplied nombre and checks uniqueness excluding the item itself', async () => {
      await service.update('user-1', 'item-1', { nombre: '  new-name  ' });

      expect(prisma.itemConfiguracion.findFirst).toHaveBeenCalledWith({
        where: {
          nombre: { equals: 'new-name', mode: 'insensitive' },
          NOT: { id: 'item-1' },
        },
      });
      const { data } = tx.itemConfiguracion.update.mock.calls[0][0] as {
        data: { nombre: string };
      };
      expect(data.nombre).toBe('new-name');
    });

    // Self-exclusion: re-supplying the item's own current nombre (unchanged)
    // must not trip the uniqueness check against itself — the `NOT: { id }`
    // clause is what makes this distinct from the "different item" collision
    // case below, so it needs its own assertion rather than relying on that
    // test alone.
    it('accepts a nombre update that matches the item its own current nombre, excluding itself from the collision check', async () => {
      const result = await service.update('user-1', 'item-1', {
        nombre: EXISTING_ITEM.nombre,
      });

      expect(prisma.itemConfiguracion.findFirst).toHaveBeenCalledWith({
        where: {
          nombre: { equals: EXISTING_ITEM.nombre, mode: 'insensitive' },
          NOT: { id: 'item-1' },
        },
      });
      expect(result).toEqual(EXISTING_ITEM);
      expect(tx.itemConfiguracion.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { nombre: EXISTING_ITEM.nombre },
      });
    });

    // I/O matrix row 4: nombre collides case-insensitively with a different
    // item -> 409, no state change.
    it('rejects a nombre that collides case-insensitively with a different item, before starting a transaction', async () => {
      prisma.itemConfiguracion.findFirst.mockResolvedValue({
        ...EXISTING_ITEM,
        id: 'other-item',
        nombre: 'Other-Name',
      });

      await expect(
        service.update('user-1', 'item-1', { nombre: 'other-name' }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.update('user-1', 'item-1', { nombre: 'other-name' }),
      ).rejects.toThrow(NAME_ALREADY_EXISTS_MESSAGE);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // Race-condition backstop, mirroring create's: the loser of two
    // concurrent renames hits the DB's real unique constraint (P2002),
    // surfaced as the same 409 rather than a raw 500.
    it('converts a concurrent unique-constraint violation into a 409 conflict, recording no audit entry', async () => {
      tx.itemConfiguracion.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update('user-1', 'item-1', { nombre: 'core-db' }),
      ).rejects.toThrow(ConflictException);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    // I/O matrix row 5: tipo not in the catalog -> 400, no DB access at all,
    // no transaction started.
    it('rejects a tipo outside the static catalog with a BadRequestException, never touching the DB', async () => {
      await expect(
        service.update('user-1', 'item-1', { tipo: 'NOT_A_TYPE' }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.itemConfiguracion.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // I/O matrix row 6: unknown item id -> 404, no transaction started.
    it('rejects an unknown item id with a NotFoundException, before starting a transaction', async () => {
      prisma.itemConfiguracion.findUnique.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'missing-item', { descripcion: 'x' }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.update('user-1', 'missing-item', { descripcion: 'x' }),
      ).rejects.toThrow(ITEM_NOT_FOUND_MESSAGE);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // A field simply absent from dto (undefined) must never appear in the
    // Prisma `data` payload nor in the audit before/after -- otherwise an
    // absent key would be indistinguishable from "set to undefined".
    it('leaves fields absent from dto entirely untouched in both the Prisma update and the audit payload', async () => {
      await service.update('user-1', 'item-1', { direccionRed: '10.0.0.2' });

      expect(tx.itemConfiguracion.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { direccionRed: '10.0.0.2' },
      });
      const [, auditCall] = auditService.record.mock.calls[0] as [
        unknown,
        { cambios: { before: object; after: object } },
      ];
      expect(Object.keys(auditCall.cambios.before)).toEqual(['direccionRed']);
      expect(Object.keys(auditCall.cambios.after)).toEqual(['direccionRed']);
    });

    // Same all-or-nothing guarantee as create: a failure from
    // AuditService.record propagates out of update() unchanged.
    it('propagates a failure from AuditService.record, never swallowing it as a partial success', async () => {
      auditService.record.mockRejectedValue(new Error('audit write failed'));

      await expect(
        service.update('user-1', 'item-1', { descripcion: 'x' }),
      ).rejects.toThrow('audit write failed');
    });

    // spec-3-4 I/O matrix's "Concurrent update-during-delete" row: the item
    // vanishes between update's own up-front findUnique and its
    // transactional tx.itemConfiguracion.update, which then hits Prisma's
    // P2025 ("record not found") — surfaced as the same 404 every other
    // unknown-id path returns, not a raw 500, and no audit entry recorded.
    it('converts a concurrent record-not-found (P2025) on the transactional update into a 404, recording no audit entry', async () => {
      tx.itemConfiguracion.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record to update not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update('user-1', 'item-1', { descripcion: 'x' }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.update('user-1', 'item-1', { descripcion: 'x' }),
      ).rejects.toThrow(ITEM_NOT_FOUND_MESSAGE);
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  // spec-3-4: `remove(usuarioId, id)` — permanent hard delete of an
  // `ItemConfiguracion`. `prisma.itemConfiguracion.findUnique` supplies both
  // the pre-deletion snapshot and the 404 check; the row delete and its
  // audit entry go through the same `tx`-scoped transaction pattern as
  // `create`/`update`.
  describe('remove', () => {
    const EXISTING_ITEM: ItemRow = {
      id: 'item-1',
      nombre: 'core-db',
      descripcion: 'Core database',
      dominioPropietario: 'platform',
      direccionRed: '10.0.0.1',
      tipo: 'DATABASE',
      properties: { engine: 'postgres', version: '14' },
    };

    beforeEach(() => {
      prisma.itemConfiguracion.findUnique.mockResolvedValue(EXISTING_ITEM);
      tx.itemConfiguracion.delete.mockResolvedValue(EXISTING_ITEM);
    });

    // I/O matrix row 1 + first Acceptance Criterion: item removed, exactly
    // one DELETE audit row with a full pre-deletion snapshot in cambios.
    it('deletes the item and records exactly one DELETE audit entry with a full pre-deletion snapshot, through the same tx', async () => {
      await service.remove('user-1', 'item-1');

      expect(tx.itemConfiguracion.delete).toHaveBeenCalledWith({
        where: { id: 'item-1' },
      });
      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(tx, {
        usuarioId: 'user-1',
        tipoAccion: TipoAccion.DELETE,
        entidad: 'ItemConfiguracion',
        entidadId: EXISTING_ITEM.id,
        cambios: {
          nombre: EXISTING_ITEM.nombre,
          descripcion: EXISTING_ITEM.descripcion,
          dominioPropietario: EXISTING_ITEM.dominioPropietario,
          direccionRed: EXISTING_ITEM.direccionRed,
          tipo: EXISTING_ITEM.tipo,
          properties: EXISTING_ITEM.properties,
        },
      });
    });

    // I/O matrix row 2 + third Acceptance Criterion: unknown item id -> 404,
    // no transaction started, no audit entry.
    it('rejects an unknown item id with a NotFoundException, before starting a transaction', async () => {
      prisma.itemConfiguracion.findUnique.mockResolvedValue(null);

      await expect(service.remove('user-1', 'missing-item')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove('user-1', 'missing-item')).rejects.toThrow(
        ITEM_NOT_FOUND_MESSAGE,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    // Regression: the audit cambios snapshot must come from
    // tx.itemConfiguracion.delete's own return value, not the earlier
    // up-front findUnique — otherwise a concurrent update that commits
    // between the two would make the audit entry record stale pre-delete
    // field values instead of what was actually deleted.
    it('builds the audit snapshot from the transactional delete result, not the earlier findUnique read', async () => {
      const staleReadItem = { ...EXISTING_ITEM, descripcion: 'stale' };
      const actuallyDeletedItem = {
        ...EXISTING_ITEM,
        descripcion: 'updated concurrently before delete committed',
      };
      prisma.itemConfiguracion.findUnique.mockResolvedValue(staleReadItem);
      tx.itemConfiguracion.delete.mockResolvedValue(actuallyDeletedItem);

      await service.remove('user-1', 'item-1');

      const [, params] = auditService.record.mock.calls[0] as [
        unknown,
        { cambios: { descripcion: string } },
      ];
      expect(params.cambios.descripcion).toBe(
        'updated concurrently before delete committed',
      );
    });

    // I/O matrix row 5 (Concurrent double-delete): the loser's
    // tx.itemConfiguracion.delete hits Prisma's P2025 once the winner has
    // already removed the row -- surfaced as the same 404, no audit entry.
    it('converts a concurrent record-not-found (P2025) into a 404, recording no audit entry', async () => {
      tx.itemConfiguracion.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Record to delete does not exist',
          { code: 'P2025', clientVersion: 'test' },
        ),
      );

      await expect(service.remove('user-1', 'item-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove('user-1', 'item-1')).rejects.toThrow(
        ITEM_NOT_FOUND_MESSAGE,
      );
      expect(auditService.record).not.toHaveBeenCalled();
    });

    // A non-P2025 error out of the transaction must not be misclassified as
    // a not-found.
    it('rethrows a non-P2025 error unchanged', async () => {
      tx.itemConfiguracion.delete.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(service.remove('user-1', 'item-1')).rejects.toThrow(
        'connection lost',
      );
    });

    // Same all-or-nothing guarantee as create/update: a failure from
    // AuditService.record propagates out of remove() unchanged.
    it('propagates a failure from AuditService.record, never swallowing it as a partial success', async () => {
      auditService.record.mockRejectedValue(new Error('audit write failed'));

      await expect(service.remove('user-1', 'item-1')).rejects.toThrow(
        'audit write failed',
      );
    });
  });

  // spec-3-2: `list(filters, page, pageSize)` — the sole additional read
  // path onto `ItemConfiguracion` (create's own uniqueness `findFirst` is
  // unrelated). Every test below asserts on the exact `where` object passed
  // to both `findMany` and `count` (they must always match, or `total`
  // would drift from the filtered page) plus ordering/pagination.
  describe('list', () => {
    const ROW: ItemRow = { ...CREATED_ITEM };

    beforeEach(() => {
      prisma.itemConfiguracion.findMany.mockResolvedValue([ROW]);
      prisma.itemConfiguracion.count.mockResolvedValue(1);
    });

    // I/O matrix row 1: unfiltered query, ordered nombre asc, paginated.
    it('returns entries ordered nombre asc, when no filters are supplied', async () => {
      const result = await service.list({}, 1, 20);

      expect(prisma.itemConfiguracion.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: { nombre: 'asc' },
      });
      expect(prisma.itemConfiguracion.count).toHaveBeenCalledWith({
        where: {},
      });
      expect(result).toEqual({ data: [ROW], total: 1, page: 1, pageSize: 20 });
    });

    it('computes skip from page/pageSize', async () => {
      await service.list({}, 3, 10);

      expect(prisma.itemConfiguracion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    // I/O matrix row 2: tipo filter -> exact match, not validated against
    // the catalog (unrecognized tipo is a legitimate empty-result query).
    it('filters by tipo alone (exact match)', async () => {
      await service.list({ tipo: 'DATABASE' }, 1, 20);

      expect(prisma.itemConfiguracion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tipo: 'DATABASE' } }),
      );
      expect(prisma.itemConfiguracion.count).toHaveBeenCalledWith({
        where: { tipo: 'DATABASE' },
      });
    });

    it('does not validate tipo against the catalog (an unrecognized tipo is just a filter)', async () => {
      prisma.itemConfiguracion.findMany.mockResolvedValue([]);
      prisma.itemConfiguracion.count.mockResolvedValue(0);

      const result = await service.list({ tipo: 'NOT_A_TYPE' }, 1, 20);

      expect(result.data).toEqual([]);
      expect(prisma.itemConfiguracion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tipo: 'NOT_A_TYPE' } }),
      );
    });

    // I/O matrix row 3: texto filter -> case-insensitive substring across
    // nombre OR descripcion.
    it('filters by texto alone (case-insensitive substring across nombre OR descripcion)', async () => {
      await service.list({ texto: 'core' }, 1, 20);

      expect(prisma.itemConfiguracion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { nombre: { contains: 'core', mode: 'insensitive' } },
              { descripcion: { contains: 'core', mode: 'insensitive' } },
            ],
          },
        }),
      );
      expect(prisma.itemConfiguracion.count).toHaveBeenCalledWith({
        where: {
          OR: [
            { nombre: { contains: 'core', mode: 'insensitive' } },
            { descripcion: { contains: 'core', mode: 'insensitive' } },
          ],
        },
      });
    });

    // I/O matrix row 4: tipo and texto AND-combined when both are supplied.
    it('AND-combines tipo and texto when both are supplied', async () => {
      await service.list({ tipo: 'DATABASE', texto: 'core' }, 1, 20);

      expect(prisma.itemConfiguracion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tipo: 'DATABASE',
            OR: [
              { nombre: { contains: 'core', mode: 'insensitive' } },
              { descripcion: { contains: 'core', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('orders by nombre asc with no other sort option', async () => {
      await service.list({}, 1, 20);

      expect(prisma.itemConfiguracion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { nombre: 'asc' } }),
      );
    });

    // Story 3.2's third AC: "the real total" must reflect the full filtered
    // count, not just how many rows landed on this one page — the two
    // numbers must be independent even when a filter narrows both queries.
    it('reports the full filtered total even when the current page has fewer rows', async () => {
      prisma.itemConfiguracion.findMany.mockResolvedValue([ROW]);
      prisma.itemConfiguracion.count.mockResolvedValue(47);

      const result = await service.list({ tipo: 'DATABASE' }, 2, 20);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(47);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(20);
      expect(prisma.itemConfiguracion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tipo: 'DATABASE' },
          skip: 20,
          take: 20,
        }),
      );
      expect(prisma.itemConfiguracion.count).toHaveBeenCalledWith({
        where: { tipo: 'DATABASE' },
      });
    });
  });
});
