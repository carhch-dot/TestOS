import { NotFoundException } from '@nestjs/common';
import {
  TopologyService,
  ROOT_ITEM_NOT_FOUND_MESSAGE,
} from './topology.service';
import { PrismaService } from '../prisma/prisma.service';

type ItemRow = { id: string; nombre: string; tipo: string };
type RelacionRow = {
  id: string;
  origenId: string;
  destinoId: string;
  tipo: string;
};
type InClause = { in: string[] };

function isInClause(value: unknown): value is InClause {
  return typeof value === 'object' && value !== null && 'in' in value;
}

function idsFromClause(clause: string | InClause): Set<string> {
  return new Set(isInClause(clause) ? clause.in : [clause]);
}

// A tiny in-memory fake standing in for `PrismaService` — real Prisma query
// shapes (`findUnique`/`findMany` with `OR`/`in` clauses) filtered against
// plain fixture arrays, so tests exercise `TopologyService`'s actual BFS
// logic against a real graph rather than asserting on canned call sequences.
function createFakePrisma(
  items: ItemRow[],
  relaciones: RelacionRow[],
): {
  prisma: PrismaService;
  relacionFindMany: jest.Mock;
  itemFindMany: jest.Mock;
} {
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const itemFindMany = jest.fn(({ where }: { where: { id: InClause } }) => {
    const ids = idsFromClause(where.id);
    return Promise.resolve(items.filter((item) => ids.has(item.id)));
  });

  const relacionFindMany = jest.fn(
    ({
      where,
    }: {
      where:
        | {
            OR: [
              { origenId: string | InClause },
              { destinoId: string | InClause },
            ];
          }
        | { origenId: InClause; destinoId: InClause };
    }) => {
      if ('OR' in where) {
        const [origenClause, destinoClause] = where.OR;
        const origenIds = idsFromClause(origenClause.origenId);
        const destinoIds = idsFromClause(destinoClause.destinoId);
        return Promise.resolve(
          relaciones.filter(
            (r) => origenIds.has(r.origenId) || destinoIds.has(r.destinoId),
          ),
        );
      }
      const origenIds = idsFromClause(where.origenId);
      const destinoIds = idsFromClause(where.destinoId);
      return Promise.resolve(
        relaciones.filter(
          (r) => origenIds.has(r.origenId) && destinoIds.has(r.destinoId),
        ),
      );
    },
  );

  const prisma = {
    itemConfiguracion: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(itemsById.get(where.id) ?? null),
      ),
      findMany: itemFindMany,
    },
    relacion: {
      findMany: relacionFindMany,
    },
  } as unknown as PrismaService;

  return { prisma, relacionFindMany, itemFindMany };
}

function byId(nodes: { id: string }[]): string[] {
  return nodes.map((n) => n.id).sort();
}

describe('TopologyService', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.TOPOLOGY_MAX_DEPTH;
    delete process.env.TOPOLOGY_MAX_NODES;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('unknown root item', () => {
    it('tree() throws NotFoundException when itemId matches no item', async () => {
      const { prisma } = createFakePrisma([], []);
      const service = new TopologyService(prisma);

      await expect(service.tree('missing-item')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.tree('missing-item')).rejects.toThrow(
        ROOT_ITEM_NOT_FOUND_MESSAGE,
      );
    });

    it('neighbors() throws NotFoundException when itemId matches no item', async () => {
      const { prisma } = createFakePrisma([], []);
      const service = new TopologyService(prisma);

      await expect(service.neighbors('missing-item')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('isolated item', () => {
    it('tree() returns a single-node graph with no edges', async () => {
      const item: ItemRow = { id: 'A', nombre: 'Item A', tipo: 'SERVER' };
      const { prisma } = createFakePrisma([item], []);
      const service = new TopologyService(prisma);

      const result = await service.tree('A');

      expect(result).toEqual({
        rootId: 'A',
        nodes: [{ id: 'A', nombre: 'Item A', tipo: 'SERVER' }],
        edges: [],
        truncated: false,
      });
    });

    it('neighbors() returns a single-node graph with no edges', async () => {
      const item: ItemRow = { id: 'A', nombre: 'Item A', tipo: 'SERVER' };
      const { prisma } = createFakePrisma([item], []);
      const service = new TopologyService(prisma);

      const result = await service.neighbors('A');

      expect(result).toEqual({
        rootId: 'A',
        nodes: [{ id: 'A', nombre: 'Item A', tipo: 'SERVER' }],
        edges: [],
        truncated: false,
      });
    });
  });

  describe('happy path / cyclic graph', () => {
    // A HOSTS B, B DEPENDS_ON C, C INTEGRATES_WITH A — a 3-node cycle
    // (spec's own manual-smoke-test fixture). Every node is directly
    // connected to every other node in this particular fixture.
    const A: ItemRow = { id: 'A', nombre: 'Item A', tipo: 'SERVER' };
    const B: ItemRow = { id: 'B', nombre: 'Item B', tipo: 'SERVICE' };
    const C: ItemRow = { id: 'C', nombre: 'Item C', tipo: 'DATABASE' };
    const rAB: RelacionRow = {
      id: 'r-ab',
      origenId: 'A',
      destinoId: 'B',
      tipo: 'HOSTS',
    };
    const rBC: RelacionRow = {
      id: 'r-bc',
      origenId: 'B',
      destinoId: 'C',
      tipo: 'DEPENDS_ON',
    };
    const rCA: RelacionRow = {
      id: 'r-ca',
      origenId: 'C',
      destinoId: 'A',
      tipo: 'INTEGRATES_WITH',
    };

    it('tree() returns every node exactly once and every edge, and terminates despite the cycle', async () => {
      const { prisma, relacionFindMany } = createFakePrisma(
        [A, B, C],
        [rAB, rBC, rCA],
      );
      const service = new TopologyService(prisma);

      const result = await service.tree('A');

      expect(byId(result.nodes)).toEqual(['A', 'B', 'C']);
      expect(result.nodes).toHaveLength(3);
      expect(result.edges.map((e) => e.id).sort()).toEqual([
        'r-ab',
        'r-bc',
        'r-ca',
      ]);
      expect(result.truncated).toBe(false);
      expect(result.rootId).toBe('A');

      // Terminates: the BFS loop does not spin forever chasing the cycle
      // back to already-visited nodes.
      expect(relacionFindMany.mock.calls.length).toBeLessThan(10);
    });

    // Regression: the assertion above ("<10 calls") can't actually tell
    // cycle-safety apart from merely hitting the default TOPOLOGY_MAX_DEPTH
    // (5) — a broken `!visited.has(...)` dedup guard would still terminate
    // within 5 rounds purely from the depth cap, keeping that assertion
    // green. Setting TOPOLOGY_MAX_DEPTH far higher than this 3-node cycle
    // could ever need (20) and asserting an EXACT, small call count proves
    // termination came from the visited-set dedup itself, not the depth
    // limit: with dedup working, ring 1 discovers B/C and ring 2 finds
    // nothing new (every edge among {A,B,C} already touched), so the BFS
    // loop naturally empties after exactly 2 ring queries — plus the final
    // induceEdges query makes 3 relacion.findMany calls total. A broken
    // dedup guard would instead keep re-discovering "new" candidates every
    // round and have to run all the way to the artificially high depth cap
    // (20 ring queries) before stopping.
    it('terminates via cycle-dedup itself, not the depth cap (isolated with an artificially high TOPOLOGY_MAX_DEPTH)', async () => {
      process.env.TOPOLOGY_MAX_DEPTH = '20';
      const { prisma, relacionFindMany } = createFakePrisma(
        [A, B, C],
        [rAB, rBC, rCA],
      );
      const service = new TopologyService(prisma);

      const result = await service.tree('A');

      expect(byId(result.nodes)).toEqual(['A', 'B', 'C']);
      // 2 BFS ring queries + 1 final induceEdges query = 3.
      expect(relacionFindMany).toHaveBeenCalledTimes(3);
    });

    it('tree() includes real origenId/destinoId/tipo per edge (bidirectional traversal, spec Boundaries)', async () => {
      const { prisma } = createFakePrisma([A, B, C], [rAB, rBC, rCA]);
      const service = new TopologyService(prisma);

      const result = await service.tree('A');

      expect(result.edges).toEqual(
        expect.arrayContaining([
          { id: 'r-ab', origenId: 'A', destinoId: 'B', tipo: 'HOSTS' },
          { id: 'r-bc', origenId: 'B', destinoId: 'C', tipo: 'DEPENDS_ON' },
          {
            id: 'r-ca',
            origenId: 'C',
            destinoId: 'A',
            tipo: 'INTEGRATES_WITH',
          },
        ]),
      );
    });

    it('lean node projection: no descripcion/properties/dominioPropietario/direccionRed leak through', async () => {
      const { prisma } = createFakePrisma([A, B, C], [rAB, rBC, rCA]);
      const service = new TopologyService(prisma);

      const result = await service.tree('A');

      for (const node of result.nodes) {
        expect(Object.keys(node).sort()).toEqual(['id', 'nombre', 'tipo']);
      }
    });
  });

  describe("induced-subgraph edges beyond the BFS loop's own per-ring queries", () => {
    // ROOT -> N1 (ring 1) -> N2A and N1 -> N2B (both admitted together in
    // ring 2), plus a direct N2A<->N2B edge. With TOPOLOGY_MAX_DEPTH=2, the
    // BFS loop's own queries only ever touch {ROOT} (ring 1) and {N1}
    // (ring 2) — it exits once depth reaches 2, WITHOUT ever querying
    // {N2A, N2B}'s own relations, so the N2A<->N2B edge is never seen by
    // any ring query. Proving it still appears in the response is what
    // isolates induceEdges's actual contribution (spec Boundaries/Design
    // Notes) from what the BFS loop would have found on its own.
    const ROOT: ItemRow = { id: 'ROOT', nombre: 'Root', tipo: 'SERVER' };
    const N1: ItemRow = { id: 'N1', nombre: 'Neighbor 1', tipo: 'CLUSTER' };
    const N2A: ItemRow = { id: 'N2A', nombre: 'Sibling A', tipo: 'SERVICE' };
    const N2B: ItemRow = { id: 'N2B', nombre: 'Sibling B', tipo: 'DATABASE' };
    const rRootN1: RelacionRow = {
      id: 'r-root-n1',
      origenId: 'ROOT',
      destinoId: 'N1',
      tipo: 'HOSTS',
    };
    const rN1N2a: RelacionRow = {
      id: 'r-n1-n2a',
      origenId: 'N1',
      destinoId: 'N2A',
      tipo: 'BELONGS_TO_CLUSTER',
    };
    const rN1N2b: RelacionRow = {
      id: 'r-n1-n2b',
      origenId: 'N1',
      destinoId: 'N2B',
      tipo: 'BELONGS_TO_CLUSTER',
    };
    const rN2aN2b: RelacionRow = {
      id: 'r-n2a-n2b',
      origenId: 'N2A',
      destinoId: 'N2B',
      tipo: 'DEPENDS_ON',
    };

    it('includes an edge between two siblings jointly admitted in the final ring, never touched by any BFS ring query', async () => {
      process.env.TOPOLOGY_MAX_DEPTH = '2';
      const { prisma, relacionFindMany } = createFakePrisma(
        [ROOT, N1, N2A, N2B],
        [rRootN1, rN1N2a, rN1N2b, rN2aN2b],
      );
      const service = new TopologyService(prisma);

      const result = await service.tree('ROOT');

      expect(byId(result.nodes)).toEqual(['N1', 'N2A', 'N2B', 'ROOT']);
      expect(result.edges.map((e) => e.id).sort()).toEqual([
        'r-n1-n2a',
        'r-n1-n2b',
        'r-n2a-n2b',
        'r-root-n1',
      ]);
      // Exactly 2 ring queries (ring 1: touching ROOT; ring 2: touching
      // N1) plus 1 final induceEdges query = 3 relacion.findMany calls —
      // the N2A<->N2B edge is only ever discoverable via that 3rd call.
      expect(relacionFindMany).toHaveBeenCalledTimes(3);
    });
  });

  describe('indirect relations, within limits', () => {
    // Root -> N1 (depth 1) -> N2 (depth 2), no edge directly between Root
    // and N2 — a genuine "indirect" relation reachable only via N1.
    const ROOT: ItemRow = { id: 'ROOT', nombre: 'Root', tipo: 'SERVER' };
    const N1: ItemRow = { id: 'N1', nombre: 'Neighbor 1', tipo: 'SERVICE' };
    const N2: ItemRow = { id: 'N2', nombre: 'Neighbor 2', tipo: 'DATABASE' };
    const rRootN1: RelacionRow = {
      id: 'r-root-n1',
      origenId: 'ROOT',
      destinoId: 'N1',
      tipo: 'HOSTS',
    };
    const rN1N2: RelacionRow = {
      id: 'r-n1-n2',
      origenId: 'N1',
      destinoId: 'N2',
      tipo: 'DEPENDS_ON',
    };

    it('tree() reaches the indirect node up to TOPOLOGY_MAX_DEPTH', async () => {
      const { prisma } = createFakePrisma([ROOT, N1, N2], [rRootN1, rN1N2]);
      const service = new TopologyService(prisma);

      const result = await service.tree('ROOT');

      expect(byId(result.nodes)).toEqual(['N1', 'N2', 'ROOT']);
      expect(result.edges.map((e) => e.id).sort()).toEqual([
        'r-n1-n2',
        'r-root-n1',
      ]);
      expect(result.truncated).toBe(false);
    });

    it('neighbors() returns only the depth-1 node/edge, never the depth-2 one, regardless of TOPOLOGY_MAX_DEPTH', async () => {
      process.env.TOPOLOGY_MAX_DEPTH = '5';
      const { prisma, relacionFindMany } = createFakePrisma(
        [ROOT, N1, N2],
        [rRootN1, rN1N2],
      );
      const service = new TopologyService(prisma);

      const result = await service.neighbors('ROOT');

      expect(byId(result.nodes)).toEqual(['N1', 'ROOT']);
      expect(result.edges.map((e) => e.id)).toEqual(['r-root-n1']);
      expect(result.truncated).toBe(false);
      // A single findMany query, no BFS loop (spec Boundaries/FR24).
      expect(relacionFindMany).toHaveBeenCalledTimes(1);
    });

    // Regression: every other neighbors() fixture in this file has the
    // root strictly as origenId. The bidirectional query
    // (`OR: [{origenId: root.id}, {destinoId: root.id}]`) has a
    // `destinoId` clause too, but nothing exercised it specifically for
    // neighbors() — a regression that silently dropped that clause would
    // not have been caught.
    it('neighbors() finds a direct relation where the root is the destino (incoming), not just origen (outgoing)', async () => {
      const incoming: RelacionRow = {
        id: 'r-n1-root',
        origenId: 'N1',
        destinoId: 'ROOT',
        tipo: 'DEPENDS_ON',
      };
      const { prisma } = createFakePrisma([ROOT, N1], [incoming]);
      const service = new TopologyService(prisma);

      const result = await service.neighbors('ROOT');

      expect(byId(result.nodes)).toEqual(['N1', 'ROOT']);
      expect(result.edges).toEqual([
        {
          id: 'r-n1-root',
          origenId: 'N1',
          destinoId: 'ROOT',
          tipo: 'DEPENDS_ON',
        },
      ]);
    });

    it('tree() respects a custom TOPOLOGY_MAX_DEPTH of 1, marking truncated: true since N2 exists beyond it', async () => {
      process.env.TOPOLOGY_MAX_DEPTH = '1';
      const { prisma } = createFakePrisma([ROOT, N1, N2], [rRootN1, rN1N2]);
      const service = new TopologyService(prisma);

      const result = await service.tree('ROOT');

      expect(byId(result.nodes)).toEqual(['N1', 'ROOT']);
      // Regression: hitting TOPOLOGY_MAX_DEPTH while N2 remains genuinely
      // reachable (via N1) but unexplored must be reported as truncated,
      // not silently indistinguishable from "this is the complete graph".
      expect(result.truncated).toBe(true);
    });

    // Deliberately conservative edge case: the depth cap lands exactly at
    // N2, which happens to have no further connections of its own (the
    // graph's true boundary coincides with maxDepth). Because reaching that
    // conclusion would require querying past the depth limit — exactly what
    // TOPOLOGY_MAX_DEPTH exists to prevent — the last-admitted ring's own
    // reachability is never actually checked, so `truncated` stays `true`
    // here even though, in this specific fixture, nothing was really lost.
    // This is the intentional trade-off documented in the spec's Design
    // Notes: honest "might be more" over a silently wrong "definitely
    // complete".
    it("tree() with TOPOLOGY_MAX_DEPTH landing exactly on the graph's true boundary still reports truncated: true (conservative by design)", async () => {
      process.env.TOPOLOGY_MAX_DEPTH = '2';
      const { prisma } = createFakePrisma([ROOT, N1, N2], [rRootN1, rN1N2]);
      const service = new TopologyService(prisma);

      const result = await service.tree('ROOT');

      expect(byId(result.nodes)).toEqual(['N1', 'N2', 'ROOT']);
      expect(result.truncated).toBe(true);
    });
  });

  describe('node-count limit', () => {
    // Root directly connected to three neighbors; TOPOLOGY_MAX_NODES caps
    // total nodes at 2 (root + exactly one neighbor), well before
    // TOPOLOGY_MAX_DEPTH would ever be reached.
    const ROOT: ItemRow = { id: 'ROOT', nombre: 'Root', tipo: 'SERVER' };
    const N1: ItemRow = { id: 'N1', nombre: 'Neighbor 1', tipo: 'SERVICE' };
    const N2: ItemRow = { id: 'N2', nombre: 'Neighbor 2', tipo: 'SERVICE' };
    const N3: ItemRow = { id: 'N3', nombre: 'Neighbor 3', tipo: 'SERVICE' };
    const relations: RelacionRow[] = [
      { id: 'r1', origenId: 'ROOT', destinoId: 'N1', tipo: 'HOSTS' },
      { id: 'r2', origenId: 'ROOT', destinoId: 'N2', tipo: 'HOSTS' },
      { id: 'r3', origenId: 'ROOT', destinoId: 'N3', tipo: 'HOSTS' },
    ];

    it('tree() stops admitting immediately once TOPOLOGY_MAX_NODES is hit, mid-level, and sets truncated: true', async () => {
      process.env.TOPOLOGY_MAX_NODES = '2';
      const { prisma } = createFakePrisma([ROOT, N1, N2, N3], relations);
      const service = new TopologyService(prisma);

      const result = await service.tree('ROOT');

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].id).toBe('ROOT');
      expect(result.truncated).toBe(true);
      // No dangling edge: the one node actually admitted must have its
      // edge to root included; edges to the two rejected candidates must
      // not appear (they'd reference nodes absent from `nodes`).
      expect(result.edges).toHaveLength(1);
      const admittedNeighborId = result.nodes[1].id;
      expect(result.edges[0].destinoId).toBe(admittedNeighborId);
    });

    it('neighbors() also respects TOPOLOGY_MAX_NODES and sets truncated: true', async () => {
      process.env.TOPOLOGY_MAX_NODES = '2';
      const { prisma } = createFakePrisma([ROOT, N1, N2, N3], relations);
      const service = new TopologyService(prisma);

      const result = await service.neighbors('ROOT');

      expect(result.nodes).toHaveLength(2);
      expect(result.truncated).toBe(true);
      expect(result.edges).toHaveLength(1);
    });

    it('does not mark truncated when the reachable graph exactly fits TOPOLOGY_MAX_NODES', async () => {
      process.env.TOPOLOGY_MAX_NODES = '4'; // ROOT + N1 + N2 + N3, exactly
      const { prisma } = createFakePrisma([ROOT, N1, N2, N3], relations);
      const service = new TopologyService(prisma);

      const result = await service.tree('ROOT');

      expect(result.nodes).toHaveLength(4);
      expect(result.truncated).toBe(false);
    });
  });

  describe('env-configured limits (mirrors LOGIN_LOCKOUT_MAX_ATTEMPTS pattern)', () => {
    const ROOT: ItemRow = { id: 'ROOT', nombre: 'Root', tipo: 'SERVER' };
    const N1: ItemRow = { id: 'N1', nombre: 'Neighbor 1', tipo: 'SERVICE' };
    const relations: RelacionRow[] = [
      { id: 'r1', origenId: 'ROOT', destinoId: 'N1', tipo: 'HOSTS' },
    ];

    it.each(['not-a-number', '0', '-1', '1.5', ''])(
      'falls back to the default max depth when TOPOLOGY_MAX_DEPTH=%p',
      async (raw) => {
        process.env.TOPOLOGY_MAX_DEPTH = raw;
        const { prisma } = createFakePrisma([ROOT, N1], relations);
        const service = new TopologyService(prisma);

        const result = await service.tree('ROOT');

        // Default depth (5) comfortably reaches N1 even though the
        // supplied env value was invalid and should have been ignored.
        expect(byId(result.nodes)).toEqual(['N1', 'ROOT']);
      },
    );

    it.each(['not-a-number', '0', '-1', '1.5', ''])(
      'falls back to the default max nodes when TOPOLOGY_MAX_NODES=%p',
      async (raw) => {
        process.env.TOPOLOGY_MAX_NODES = raw;
        const { prisma } = createFakePrisma([ROOT, N1], relations);
        const service = new TopologyService(prisma);

        const result = await service.tree('ROOT');

        expect(result.truncated).toBe(false);
        expect(byId(result.nodes)).toEqual(['N1', 'ROOT']);
      },
    );

    // The "unset" case (env var absent entirely, as opposed to present
    // with an invalid value) is only ever exercised incidentally by
    // unrelated tests elsewhere in this file — asserted explicitly here,
    // alongside the invalid-value cases above, so it's documented as its
    // own covered case rather than left implicit.
    it('falls back to the default max depth and max nodes when both env vars are entirely unset', async () => {
      delete process.env.TOPOLOGY_MAX_DEPTH;
      delete process.env.TOPOLOGY_MAX_NODES;
      const { prisma } = createFakePrisma([ROOT, N1], relations);
      const service = new TopologyService(prisma);

      const result = await service.tree('ROOT');

      expect(byId(result.nodes)).toEqual(['N1', 'ROOT']);
      expect(result.truncated).toBe(false);
    });
  });
});
