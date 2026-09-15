import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TipoAccion } from '@prisma/client';
import {
  RelationsService,
  INVALID_TIPO_MESSAGE,
  SELF_RELATION_MESSAGE,
  ORIGEN_NOT_FOUND_MESSAGE,
  DESTINO_NOT_FOUND_MESSAGE,
  RELATION_ALREADY_EXISTS_MESSAGE,
} from './relations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type RelacionRow = {
  id: string;
  origenId: string;
  destinoId: string;
  tipo: string;
  descripcion: string | null;
};

type ItemRow = { id: string };

const ORIGEN_ITEM: ItemRow = { id: 'item-origen' };
const DESTINO_ITEM: ItemRow = { id: 'item-destino' };

const CREATED_RELATION: RelacionRow = {
  id: 'relacion-1',
  origenId: 'item-origen',
  destinoId: 'item-destino',
  tipo: 'HOSTS',
  descripcion: 'The server hosts the service',
};

describe('RelationsService', () => {
  let prisma: {
    itemConfiguracion: { findUnique: jest.Mock };
    relacion: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    relacion: { create: jest.Mock<Promise<RelacionRow>, [unknown]> };
  };
  let auditService: { record: jest.Mock };
  let service: RelationsService;

  beforeEach(async () => {
    tx = {
      relacion: {
        create: jest
          .fn<Promise<RelacionRow>, [unknown]>()
          .mockResolvedValue(CREATED_RELATION),
      },
    };

    prisma = {
      itemConfiguracion: {
        findUnique: jest.fn((args: { where: { id: string } }) => {
          if (args.where.id === ORIGEN_ITEM.id) {
            return Promise.resolve(ORIGEN_ITEM);
          }
          if (args.where.id === DESTINO_ITEM.id) {
            return Promise.resolve(DESTINO_ITEM);
          }
          return Promise.resolve(null);
        }),
      },
      relacion: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // Mirrors the real `$transaction(callback)` shape, same as
      // InventoryService's spec: invoke the callback with a transaction
      // client (`tx`) and return/propagate whatever it returns/throws.
      $transaction: jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      ),
    };

    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RelationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = moduleRef.get(RelationsService);
  });

  describe('create', () => {
    // I/O matrix row 1: two existing items, valid catalog tipo -> created,
    // one CREATE audit row, both through the same tx.
    it('creates the relation and records exactly one CREATE audit entry through the same tx', async () => {
      const result = await service.create('user-1', {
        origenId: 'item-origen',
        destinoId: 'item-destino',
        tipo: 'HOSTS',
        descripcion: 'The server hosts the service',
      });

      expect(result).toEqual(CREATED_RELATION);
      expect(tx.relacion.create).toHaveBeenCalledWith({
        data: {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
          descripcion: 'The server hosts the service',
        },
      });
      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(tx, {
        usuarioId: 'user-1',
        tipoAccion: TipoAccion.CREATE,
        entidad: 'Relacion',
        entidadId: CREATED_RELATION.id,
        cambios: {
          origenId: CREATED_RELATION.origenId,
          destinoId: CREATED_RELATION.destinoId,
          tipo: CREATED_RELATION.tipo,
          descripcion: CREATED_RELATION.descripcion,
        },
      });
    });

    // Regression: the audit cambios snapshot must come from
    // tx.relacion.create's own return value, not an echo of the input dto —
    // otherwise this test could pass even if the implementation built
    // cambios straight from dto instead of the persisted row. Mocks a
    // return value that differs from the input in `descripcion` to prove
    // the distinction.
    it('builds the audit snapshot from the persisted row returned by the transactional create, not the input dto', async () => {
      const persistedRelation: RelacionRow = {
        ...CREATED_RELATION,
        descripcion: 'persisted value, different from the input',
      };
      tx.relacion.create.mockResolvedValue(persistedRelation);

      await service.create('user-1', {
        origenId: 'item-origen',
        destinoId: 'item-destino',
        tipo: 'HOSTS',
        descripcion: 'input value, should not appear in cambios',
      });

      const [, params] = auditService.record.mock.calls[0] as [
        unknown,
        { cambios: { descripcion: string } },
      ];
      expect(params.cambios.descripcion).toBe(
        'persisted value, different from the input',
      );
    });

    // origenId/destinoId/tipo are trimmed once, up front — same reasoning
    // as InventoryService.create's nombre: a whitespace-padded value must
    // not be rejected as "not found"/"not recognized" when the trimmed
    // value is perfectly valid.
    it('trims origenId, destinoId, and tipo before validating and persisting them', async () => {
      await service.create('user-1', {
        origenId: '  item-origen  ',
        destinoId: '  item-destino  ',
        tipo: '  HOSTS  ',
      });

      expect(prisma.itemConfiguracion.findUnique).toHaveBeenCalledWith({
        where: { id: 'item-origen' },
      });
      expect(prisma.itemConfiguracion.findUnique).toHaveBeenCalledWith({
        where: { id: 'item-destino' },
      });
      const { data } = tx.relacion.create.mock.calls[0][0] as {
        data: { origenId: string; destinoId: string; tipo: string };
      };
      expect(data.origenId).toBe('item-origen');
      expect(data.destinoId).toBe('item-destino');
      expect(data.tipo).toBe('HOSTS');
    });

    // I/O matrix row 3: tipo not in the catalog -> 400, no DB access at
    // all, no transaction started.
    it('rejects a tipo outside the static catalog with a BadRequestException, never touching the DB', async () => {
      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'NOT_A_TYPE',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'NOT_A_TYPE',
        }),
      ).rejects.toThrow(INVALID_TIPO_MESSAGE('NOT_A_TYPE'));

      expect(prisma.itemConfiguracion.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // I/O matrix row 4: origenId === destinoId -> 400 before any DB access.
    it('rejects a self-relation (origenId === destinoId) with a BadRequestException, before any DB access', async () => {
      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'item-origen',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'item-origen',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow(SELF_RELATION_MESSAGE);

      expect(prisma.itemConfiguracion.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // I/O matrix row 5: origenId matches no item -> 404, no transaction
    // started.
    it('rejects an unknown origenId with a NotFoundException, before starting a transaction', async () => {
      await expect(
        service.create('user-1', {
          origenId: 'missing-item',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.create('user-1', {
          origenId: 'missing-item',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow(ORIGEN_NOT_FOUND_MESSAGE);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // Same I/O matrix row, destinoId side.
    it('rejects an unknown destinoId with a NotFoundException, before starting a transaction', async () => {
      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'missing-item',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'missing-item',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow(DESTINO_NOT_FOUND_MESSAGE);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // I/O matrix row 2: same (origenId, destinoId, tipo) already exists ->
    // 409, caught up front by the case-sensitive findFirst, no transaction
    // started.
    it('rejects an exact duplicate (origenId, destinoId, tipo) triple, before starting a transaction', async () => {
      prisma.relacion.findFirst.mockResolvedValue({
        ...CREATED_RELATION,
        id: 'existing-relation',
      });

      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow(RELATION_ALREADY_EXISTS_MESSAGE);

      expect(prisma.relacion.findFirst).toHaveBeenCalledWith({
        where: {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    // Duplicate check is an exact, case-sensitive triple match (spec
    // Boundaries: "tipo is a fixed catalog value, not free text") — a
    // different tipo for the same origen/destino pair is not a duplicate.
    it('does not treat a different tipo for the same origen/destino pair as a duplicate', async () => {
      await service.create('user-1', {
        origenId: 'item-origen',
        destinoId: 'item-destino',
        tipo: 'DEPENDS_ON',
      });

      expect(prisma.relacion.findFirst).toHaveBeenCalledWith({
        where: {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'DEPENDS_ON',
        },
      });
      expect(tx.relacion.create).toHaveBeenCalled();
    });

    // Race-condition backstop: two concurrent creates both pass the
    // up-front findFirst check; the loser's tx.relacion.create hits the
    // DB's real unique constraint (P2002), surfaced as the same 409 rather
    // than a raw 500 -- mirrors InventoryService.create's P2002 handling.
    it('converts a concurrent unique-constraint violation into a 409 conflict, recording no audit entry', async () => {
      tx.relacion.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow(RELATION_ALREADY_EXISTS_MESSAGE);

      expect(auditService.record).not.toHaveBeenCalled();
    });

    // The race this story's Restrict FKs make reachable: an item that
    // passed the up-front existence check can still be deleted (by a
    // concurrent DELETE /items/:id, if it had no other relations yet)
    // before this transactional create runs — Prisma reports P2003, which
    // must surface as a clean 404, not a raw 500, mirroring
    // InventoryService.remove's own P2003 catch for the reverse race.
    it('converts a concurrent foreign-key violation (P2003, item deleted mid-request) into a 404, recording no audit entry', async () => {
      tx.relacion.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint failed',
          { code: 'P2003', clientVersion: 'test' },
        ),
      );

      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(auditService.record).not.toHaveBeenCalled();
    });

    // A non-P2002/P2003 error out of the transaction must not be
    // misclassified as either a duplicate conflict or a vanished item.
    it('rethrows a non-P2002/P2003 error unchanged', async () => {
      tx.relacion.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow('connection lost');
    });

    // Same all-or-nothing guarantee as InventoryService.create: a failure
    // from AuditService.record propagates out of create() unchanged.
    it('propagates a failure from AuditService.record, never swallowing it as a partial success', async () => {
      auditService.record.mockRejectedValue(new Error('audit write failed'));

      await expect(
        service.create('user-1', {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
        }),
      ).rejects.toThrow('audit write failed');
    });

    it('defaults descripcion to undefined when omitted', async () => {
      await service.create('user-1', {
        origenId: 'item-origen',
        destinoId: 'item-destino',
        tipo: 'HOSTS',
      });

      expect(tx.relacion.create).toHaveBeenCalledWith({
        data: {
          origenId: 'item-origen',
          destinoId: 'item-destino',
          tipo: 'HOSTS',
          descripcion: undefined,
        },
      });
    });
  });

  describe('suggest', () => {
    // I/O matrix row: known pair -> a HOSTS-shaped suggestion.
    it('returns a mapped suggestion for a known type pair', () => {
      const result = service.suggest('VIRTUAL_SERVER', 'SERVICE');

      expect(result.tipo).toBe('HOSTS');
      expect(typeof result.descripcion).toBe('string');
      expect(result.descripcion.length).toBeGreaterThan(0);
    });

    // I/O matrix row: unmapped pair -> the generic CONNECTS_TO fallback,
    // never an error.
    it('returns the generic CONNECTS_TO fallback for an unmapped type pair', () => {
      const result = service.suggest('NOT_A_TYPE', 'ALSO_NOT_A_TYPE');

      expect(result.tipo).toBe('CONNECTS_TO');
      expect(typeof result.descripcion).toBe('string');
      expect(result.descripcion.length).toBeGreaterThan(0);
    });

    // Exercises suggestRelation's `*` wildcard-on-destination branch
    // (relation-type-catalog.ts's `'*|CLUSTER'` entry, named explicitly in
    // the spec's own Code Map) — previously untested, so a regression that
    // broke or removed the wildcard lookup would have passed every
    // existing test.
    it('returns the wildcard BELONGS_TO_CLUSTER suggestion for any origin type paired with CLUSTER', () => {
      const result = service.suggest('SOME_UNMAPPED_TYPE', 'CLUSTER');

      expect(result.tipo).toBe('BELONGS_TO_CLUSTER');
      expect(typeof result.descripcion).toBe('string');
      expect(result.descripcion.length).toBeGreaterThan(0);
    });

    // suggest is a pure static lookup: no Prisma dependency at all (spec
    // Design Notes).
    it('never touches the DB (pure static lookup)', () => {
      service.suggest('VIRTUAL_SERVER', 'SERVICE');

      expect(prisma.itemConfiguracion.findUnique).not.toHaveBeenCalled();
      expect(prisma.relacion.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
