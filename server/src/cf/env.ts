import type { TradeDO } from './trade-do';
import type { RoomDO } from './room-do';
import type { DirectoryDO } from './directory-do';
import type { TableDO } from './table-do';
import type { PresenceDO } from './presence-do';
import type { OutboxDO } from './outbox-do';
export interface Env {
  ENV_TAG: string; DATABASE_URL: string; AUTH_DATABASE_URL: string; ADMIN_DATABASE_URL?: string;
  BETTER_AUTH_SECRET: string; TICKET_SECRET: string; RESULT_SECRET: string; BETTER_AUTH_URL: string; APP_ORIGIN: string; APP_ORIGINS?: string; AUTH_BEARER?: string; TURNSTILE_MODE?: string; TURNSTILE_SECRET?: string; WS_MAX_LIFETIME_S?: string; EMAIL_MODE?: string; QA_OUTBOX_TOKEN?: string; GIT_SHA?: string;
  /** Phase C Hyperdrive bindings: override DATABASE_URL / AUTH_DATABASE_URL / ADMIN_DATABASE_URL when present. */
  HD_API?: Hyperdrive; HD_AUTH?: Hyperdrive; HD_ADMIN?: Hyperdrive;
  ROOM: DurableObjectNamespace<RoomDO>; DIRECTORY: DurableObjectNamespace<DirectoryDO>; TABLE: DurableObjectNamespace<TableDO>; TRADE: DurableObjectNamespace<TradeDO>; PRESENCE: DurableObjectNamespace<PresenceDO>; OUTBOX: DurableObjectNamespace<OutboxDO>;
}
