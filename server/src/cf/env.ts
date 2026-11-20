import type { TradeDO } from './trade-do';
import type { RoomDO } from './room-do';
import type { DirectoryDO } from './directory-do';
import type { TableDO } from './table-do';
export interface Env {
  ENV_TAG: string; DATABASE_URL: string; AUTH_DATABASE_URL: string; ADMIN_DATABASE_URL?: string;
  BETTER_AUTH_SECRET: string; TICKET_SECRET: string; RESULT_SECRET: string; BETTER_AUTH_URL: string; APP_ORIGIN: string;
  ROOM: DurableObjectNamespace<RoomDO>; DIRECTORY: DurableObjectNamespace<DirectoryDO>; TABLE: DurableObjectNamespace<TableDO>; TRADE: DurableObjectNamespace<TradeDO>;
}
