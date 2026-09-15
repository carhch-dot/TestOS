import { Injectable, NotFoundException } from '@nestjs/common';
import { ItemConfiguracion, Relacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const ROOT_ITEM_NOT_FOUND_MESSAGE = 'Item not found.';

// Mirrors `LOGIN_LOCKOUT_MAX_ATTEMPTS`'s exact fallback-constant pattern
// (spec Boundaries) — FR23/FR26's own reference assumptions.
const DEFAULT_TOPOLOGY_MAX_DEPTH = 5;
const DEFAULT_TOPOLOGY_MAX_NODES = 5000;

// Lean node projection (spec Boundaries): no `descripcion`/`properties`/
// `dominioPropietario`/`direccionRed` — this feeds a graph visualization
// (XyFlow), not an item detail view.
export type TopologyNode = {
  id: string;
  nombre: string;
  tipo: string;
};

export type TopologyEdge = {
  id: string;
  origenId: string;
  destinoId: string;
  tipo: string;
};

export type TopologyGraph = {
  rootId: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  truncated: boolean;
};

// Narrower than the full `ItemConfiguracion` row (spec Boundaries: lean
// node projection) — every query that hydrates a `TopologyNode` selects
// only these three columns, never `descripcion`/`properties`/
// `dominioPropietario`/`direccionRed`, which this module discards anyway.
type LeanItem = Pick<ItemConfiguracion, 'id' | 'nombre' | 'tipo'>;

const LEAN_ITEM_SELECT = { id: true, nombre: true, tipo: true } as const;

function toNode(item: LeanItem): TopologyNode {
  return { id: item.id, nombre: item.nombre, tipo: item.tipo };
}

function toEdge(relacion: Relacion): TopologyEdge {
  return {
    id: relacion.id,
    origenId: relacion.origenId,
    destinoId: relacion.destinoId,
    tipo: relacion.tipo,
  };
}

/**
 * `TopologyModule`'s sole service (spec-4-3, FR23/FR24) — read-only BFS
 * traversal of the `Relacion` graph. Reads `ItemConfiguracion`/`Relacion`
 * directly via `PrismaService`; owns neither entity (a read-only
 * cross-module lookup is not a write, AD-1 — same reasoning
 * `RelationsService` already established for its own `ItemConfiguracion`
 * existence checks). No writes anywhere here, no `RegistroAuditoria`
 * entries (no `GET` endpoint in this codebase ever produces an audit row).
 *
 * Traversal follows a `Relacion` edge from EITHER side (spec Boundaries) —
 * a node's outgoing AND incoming relations both count as "connected",
 * because `tipo` (HOSTS, DEPENDS_ON, ...) encodes the kind of link, not
 * which direction is "the" dependency direction. `tree`/`neighbors` return
 * every edge's real `origenId`/`destinoId`/`tipo` so the caller loses no
 * information and can filter by direction itself.
 */
@Injectable()
export class TopologyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `GET /topology/:itemId/tree` — breadth-first, level by level, from
   * `itemId`, with a `visited` node-id set from the start so a cycle (e.g.
   * A HOSTS B, B DEPENDS_ON A) never re-adds or re-expands a node. Bounded
   * by `TOPOLOGY_MAX_DEPTH` (levels) and `TOPOLOGY_MAX_NODES` (total nodes)
   * — once the node cap is reached, no further nodes are admitted, even
   * mid-ring (spec Boundaries/FR26: "acota la vista... en vez de intentar
   * renderizar todo"). `truncated` is `true` whenever either limit actually
   * left reachable nodes unexplored — the node-cap case, and also the case
   * where `TOPOLOGY_MAX_DEPTH` was reached while a further ring was still
   * waiting to be queried (review finding: this second case was originally
   * missed, silently indistinguishable from "this is the complete graph").
   */
  async tree(itemId: string): Promise<TopologyGraph> {
    const root = await this.findRootOrThrow(itemId);
    const maxDepth = this.getMaxDepth();
    const maxNodes = this.getMaxNodes();

    const visited = new Map<string, TopologyNode>([[root.id, toNode(root)]]);
    let currentRing = [root.id];
    let depth = 0;
    let truncated = false;

    while (currentRing.length > 0 && depth < maxDepth) {
      const relations = await this.prisma.relacion.findMany({
        where: {
          OR: [
            { origenId: { in: currentRing } },
            { destinoId: { in: currentRing } },
          ],
        },
      });

      const { nextRing, truncated: ringTruncated } = await this.admitCandidates(
        visited,
        relations,
        maxNodes,
      );
      if (ringTruncated) {
        truncated = true;
      }
      currentRing = nextRing;
      depth += 1;
    }

    // `currentRing` still non-empty here means the loop exited because
    // `depth` reached `maxDepth`, not because there was nothing left to
    // explore (the loop always runs one more ring after a node-cap-limited
    // ring — see `admitCandidates` — so by this point a purely node-count
    // stop has already naturally drained `currentRing` to empty). There are
    // real, reachable nodes beyond `maxDepth` that were never queried, so
    // `truncated` must reflect that too, not just the node-count case
    // `ringTruncated` above already covers (review finding: hitting
    // `TOPOLOGY_MAX_DEPTH` with more graph beyond it previously left
    // `truncated: false`, indistinguishable from "this is the complete
    // graph").
    if (currentRing.length > 0) {
      truncated = true;
    }

    // The full induced subgraph on the final visited node set (spec
    // Boundaries), not just the edges incidentally discovered while
    // expanding each ring — an edge between two already-visited nodes,
    // only ever found once both happen to sit together in a later ring's
    // query, must still be included. Queried fresh here rather than
    // accumulated level-by-level so that requirement holds regardless of
    // exactly which ring each endpoint was first admitted in (including the
    // last ring run, whose own outgoing relations the BFS loop above never
    // queries once `depth` reaches `maxDepth`).
    const edges = await this.induceEdges(visited);

    return { rootId: root.id, nodes: [...visited.values()], edges, truncated };
  }

  /**
   * `GET /topology/:itemId/neighbors` — the same traversal with depth fixed
   * at 1, ignoring `TOPOLOGY_MAX_DEPTH` (spec Boundaries/FR24). A single
   * `relacion.findMany` anchored at the root — no BFS loop — which is what
   * makes this lighter than `tree`. Every returned relation touches the
   * root by construction, so unlike `tree` no separate "induce the full
   * subgraph" query is needed: the root-anchored query already is that
   * subgraph, restricted (as "direct neighbors" implies) to edges touching
   * the root itself.
   */
  async neighbors(itemId: string): Promise<TopologyGraph> {
    const root = await this.findRootOrThrow(itemId);
    const maxNodes = this.getMaxNodes();

    const visited = new Map<string, TopologyNode>([[root.id, toNode(root)]]);
    const relations = await this.prisma.relacion.findMany({
      where: { OR: [{ origenId: root.id }, { destinoId: root.id }] },
    });

    const { truncated } = await this.admitCandidates(
      visited,
      relations,
      maxNodes,
    );

    // Drop any edge into a candidate the node cap ultimately rejected — that
    // node is never in `nodes`, so keeping the edge would dangle.
    const edges = relations
      .filter(
        (relacion) =>
          visited.has(relacion.origenId) && visited.has(relacion.destinoId),
      )
      .map(toEdge);

    return { rootId: root.id, nodes: [...visited.values()], edges, truncated };
  }

  private async findRootOrThrow(itemId: string): Promise<LeanItem> {
    const root = await this.prisma.itemConfiguracion.findUnique({
      where: { id: itemId },
      select: LEAN_ITEM_SELECT,
    });
    if (!root) {
      throw new NotFoundException(ROOT_ITEM_NOT_FOUND_MESSAGE);
    }
    return root;
  }

  /**
   * Shared node-shaping helper for one ring's raw `Relacion` rows (Code
   * Map: "sharing the same node/edge-shaping helper as `tree`"). Finds the
   * not-yet-visited endpoint ids among `relations`, admits as many as fit
   * under `maxNodes` (in encounter order, stopping immediately rather than
   * finishing the ring — spec Boundaries), hydrates and adds them to
   * `visited` in place, and reports which ids were actually admitted plus
   * whether this ring's admission was capped.
   */
  private async admitCandidates(
    visited: Map<string, TopologyNode>,
    relations: Relacion[],
    maxNodes: number,
  ): Promise<{ nextRing: string[]; truncated: boolean }> {
    const candidateIds: string[] = [];
    const seen = new Set<string>();
    for (const relacion of relations) {
      for (const candidateId of [relacion.origenId, relacion.destinoId]) {
        if (!visited.has(candidateId) && !seen.has(candidateId)) {
          seen.add(candidateId);
          candidateIds.push(candidateId);
        }
      }
    }

    if (candidateIds.length === 0) {
      return { nextRing: [], truncated: false };
    }

    const remainingCapacity = maxNodes - visited.size;
    let idsToAdmit = candidateIds;
    let truncated = false;
    if (candidateIds.length > remainingCapacity) {
      idsToAdmit = candidateIds.slice(0, Math.max(remainingCapacity, 0));
      truncated = true;
    }

    if (idsToAdmit.length > 0) {
      const items = await this.prisma.itemConfiguracion.findMany({
        where: { id: { in: idsToAdmit } },
        select: LEAN_ITEM_SELECT,
      });
      for (const item of items) {
        visited.set(item.id, toNode(item));
      }
    }

    return { nextRing: idsToAdmit, truncated };
  }

  private async induceEdges(
    visited: Map<string, TopologyNode>,
  ): Promise<TopologyEdge[]> {
    const ids = [...visited.keys()];
    const relations = await this.prisma.relacion.findMany({
      where: { origenId: { in: ids }, destinoId: { in: ids } },
    });
    return relations.map(toEdge);
  }

  private getMaxDepth(): number {
    const raw = Number(process.env.TOPOLOGY_MAX_DEPTH);
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TOPOLOGY_MAX_DEPTH;
  }

  private getMaxNodes(): number {
    const raw = Number(process.env.TOPOLOGY_MAX_NODES);
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TOPOLOGY_MAX_NODES;
  }
}
