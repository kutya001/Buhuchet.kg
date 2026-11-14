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

export interface DbOptions {
  max?: number;
  applicationName?: string;
  /**
   * Через сколько секунд простоя соединение закрывается (по умолчанию не закрывается): для
   * соединений, которые нужны не всё время, — следующий запрос откроет его заново.
   */
  idleTimeoutSeconds?: number;
  /**
   * Корневой сертификат сервера (PEM): соединение проверяет сертификат и имя сервера, как
   * sslmode=verify-full, и это главнее sslmode в адресе. Без него — как в адресе (обычно require:
   * шифрование без проверки сертификата).
   */
  caCert?: string | undefined;
}

/**
 * Подключение к PostgreSQL. `prepare: false` — для пула Supabase (Supavisor) в режиме транзакций;
 * на обычном PostgreSQL это тоже работает.
 */
export function createDb(url: string, options: DbOptions = {}): DbHandle {
  const sql = postgres(url, {
    max: options.max ?? 5,
    prepare: false,
    ...(options.idleTimeoutSeconds ? { idle_timeout: options.idleTimeoutSeconds } : {}),
    ...(options.caCert ? { ssl: { ca: options.caCert, rejectUnauthorized: true } } : {}),
    onnotice: () => {},
    connection: { application_name: options.applicationName ?? 'buhuchet' },
  });
  return {
    db: drizzle(sql, { schema }),
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
