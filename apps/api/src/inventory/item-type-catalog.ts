/**
 * Static catalog of valid `ItemConfiguracion.tipo` values (spec-3-1, FR-13/
 * AD-8). `tipo` is a plain `String` column, not a Prisma enum, precisely so
 * that adding a new type is an edit to this array — never a schema
 * migration. `InventoryService.create` validates every incoming `tipo`
 * against this list; nothing else defines what a "valid type" is.
 *
 * Values are English `UPPER_SNAKE_CASE`, matching `TipoAccion`'s value
 * convention (see `schema.prisma`). Purely data: this file's whole reason to
 * exist is being trivially editable without a migration, so resist adding
 * logic here.
 */
export const ITEM_TYPE_CATALOG: readonly string[] = [
  'APPLICATION',
  'API',
  'SERVICE',
  'DATABASE',
  'VIRTUAL_SERVER',
  'PHYSICAL_SERVER',
  'CLUSTER',
  'INTEGRATION',
  'SCHEDULED_JOB',
  'JOB_SERVER',
  'LOAD_BALANCER',
  'LDAP_DIRECTORY',
  'CONTAINER_ORCHESTRATOR',
  'NETWORK_DEVICE',
  'FIREWALL',
  'STORAGE',
  'CERTIFICATE',
  'DOMAIN',
  'MESSAGE_QUEUE',
  'BACKUP',
  'SOFTWARE_LICENSE',
  'MONITORING_TOOL',
];
