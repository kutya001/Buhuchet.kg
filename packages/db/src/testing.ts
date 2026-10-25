import { randomBytes } from 'node:crypto';
import {
  hasDatabaseEnv,
  integrationTestsRequired,
  loadDatabaseConfig,
} from '@buhuchet/adapters/config';
import { createDb, type DbHandle } from './client';
import { ensureAppLoginRole, runMigrations } from './migrate';

/**
 * Есть ли PostgreSQL для тестов. В CI (REQUIRE_INTEGRATION_TESTS=1) отсутствие базы — ошибка,
 * локально — тесты базы пропускаются с понятной причиной.
 */
export function databaseAvailable(): boolean {
  const ok = hasDatabaseEnv();
  if (!ok && integrationTestsRequired()) {
    throw new Error(
      'REQUIRE_INTEGRATION_TESTS=1, но DATABASE_URL или DATABASE_ADMIN_URL не заданы',
    );
  }
  return ok;
}

export interface TestDatabase {
  name: string;
  adminUrl: string;
  appUrl: string;
  /** Подключение владельцем схемы: обходит RLS, для подготовки данных. */
  admin: DbHandle;
  /** Подключение ролью приложения: RLS действует. */
  app: DbHandle;
  drop(): Promise<void>;
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Временная база с применёнными миграциями. Обязательно вызвать drop() в afterAll. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const config = loadDatabaseConfig();
  const serverAdminUrl = config.DATABASE_ADMIN_URL!;
  const name = `test_${randomBytes(6).toString('hex')}`;
  const maintenance = createDb(serverAdminUrl, { max: 1, applicationName: 'buhuchet-test' });
  await maintenance.sql.unsafe(`create database "${name}"`);
  await maintenance.close();

  const adminUrl = withDatabase(serverAdminUrl, name);
  const appUrl = withDatabase(config.DATABASE_URL, name);
  await runMigrations(adminUrl);
  await ensureAppLoginRole(adminUrl, appUrl);

  const admin = createDb(adminUrl, { max: 2, applicationName: 'buhuchet-test-admin' });
  const app = createDb(appUrl, { max: 2, applicationName: 'buhuchet-test-app' });
  return {
    name,
    adminUrl,
    appUrl,
    admin,
    app,
    async drop() {
      await Promise.all([admin.close(), app.close()]);
      const m = createDb(serverAdminUrl, { max: 1, applicationName: 'buhuchet-test' });
      await m.sql.unsafe(`drop database if exists "${name}" with (force)`);
      await m.close();
    },
  };
}
