/**
 * Static catalog of valid `Relacion.tipo` values (spec-4-1, FR-22/AD-8).
 * `tipo` is a plain `String` column, not a Prisma enum, precisely so that
 * adding a new type is an edit to this array — never a schema migration
 * (same rationale as `ITEM_TYPE_CATALOG`). `RelationsService.create`
 * validates every incoming `tipo` against this list; nothing else defines
 * what a "valid relation type" is.
 *
 * Values are English `UPPER_SNAKE_CASE`, matching `ITEM_TYPE_CATALOG`'s
 * value convention. Purely data: this file's whole reason to exist is being
 * trivially editable without a migration, so resist adding logic here.
 */
export const RELATION_TYPE_CATALOG: readonly string[] = [
  'HOSTS',
  'DEPENDS_ON',
  'HOSTED_IN',
  'BELONGS_TO_CLUSTER',
  'INTEGRATES_WITH',
  'CONNECTS_TO',
];

/**
 * Generic, always-safe fallback for any `(origenTipo, destinoTipo)` pair not
 * covered by `SUGGESTION_MAP` below (spec-4-1 Design Notes: "the suggestion
 * catalog is small and falls back to a generic default" — FR-20 only
 * requires "a reasonable suggestion," never an exhaustive one).
 */
const FALLBACK_SUGGESTION: { tipo: string; descripcion: string } = {
  tipo: 'CONNECTS_TO',
  descripcion: 'These items are connected.',
};

/**
 * A small, hand-picked lookup table over common `ItemConfiguracion.tipo`
 * pairs (spec-4-1's Code Map examples), keyed as `${origenTipo}|${destinoTipo}`.
 * `*` on either side of a pair matches any origin/destination type — checked
 * only after an exact-pair match misses (see `suggestRelation` below).
 * Advisory only (spec Boundaries): never validated or enforced, purely a
 * starting point the caller may accept or override before submitting the
 * actual create.
 */
const SUGGESTION_MAP: Readonly<
  Record<string, { tipo: string; descripcion: string }>
> = {
  'VIRTUAL_SERVER|SERVICE': {
    tipo: 'HOSTS',
    descripcion: 'The virtual server hosts this service.',
  },
  'PHYSICAL_SERVER|SERVICE': {
    tipo: 'HOSTS',
    descripcion: 'The physical server hosts this service.',
  },
  'VIRTUAL_SERVER|APPLICATION': {
    tipo: 'HOSTS',
    descripcion: 'The virtual server hosts this application.',
  },
  'PHYSICAL_SERVER|APPLICATION': {
    tipo: 'HOSTS',
    descripcion: 'The physical server hosts this application.',
  },
  'SERVICE|DATABASE': {
    tipo: 'DEPENDS_ON',
    descripcion: 'The service depends on this database.',
  },
  'APPLICATION|DATABASE': {
    tipo: 'DEPENDS_ON',
    descripcion: 'The application depends on this database.',
  },
  'SERVICE|API': {
    tipo: 'DEPENDS_ON',
    descripcion: 'The service depends on this API.',
  },
  'APPLICATION|SERVICE': {
    tipo: 'DEPENDS_ON',
    descripcion: 'The application depends on this service.',
  },
  '*|CLUSTER': {
    tipo: 'BELONGS_TO_CLUSTER',
    descripcion: 'This item belongs to the cluster.',
  },
  'CONTAINER_ORCHESTRATOR|CLUSTER': {
    tipo: 'BELONGS_TO_CLUSTER',
    descripcion: 'The container orchestrator belongs to the cluster.',
  },
};

/**
 * Pure, static lookup (no DB access) from an `(origenTipo, destinoTipo)`
 * pair to a `{tipo, descripcion}` suggestion (spec-4-1, FR-20). Tries the
 * exact pair first, then a `*` wildcard on the destination side, falling
 * back to `FALLBACK_SUGGESTION` when nothing matches — this function never
 * throws and never returns anything other than a valid suggestion.
 */
export function suggestRelation(
  origenTipo: string,
  destinoTipo: string,
): { tipo: string; descripcion: string } {
  const exact = SUGGESTION_MAP[`${origenTipo}|${destinoTipo}`];
  if (exact) {
    return exact;
  }

  const wildcardDestino = SUGGESTION_MAP[`*|${destinoTipo}`];
  if (wildcardDestino) {
    return wildcardDestino;
  }

  return FALLBACK_SUGGESTION;
}
