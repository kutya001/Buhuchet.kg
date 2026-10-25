import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  /** Сырой клиент postgres.js — только для служебных запросов (миграции, тесты). */
  sql: postgres.Sql;
  close(): Promise<void>;
}

/**
 * Подключение к PostgreSQL. `prepare: false` — для пула Supabase (Supavisor) в режиме транзакций;
 * на обычном PostgreSQL это тоже работает.
 */
export function createDb(
  url: string,
  options: { max?: number; applicationName?: string } = {},
): DbHandle {
  const sql = postgres(url, {
    max: options.max ?? 5,
    prepare: false,
    onnotice: () => {},
    connection: { application_name: options.applicationName ?? 'buhuchet' },
  });
  return {
    db: drizzle(sql, { schema }),
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
