import { randomBytes } from 'node:crypto';
import {
  hasDatabaseEnv,
  integrationTestsRequired,
  loadDatabaseConfig,
} from '@buhuchet/adapters/config';
import { createDb, type Db, type DbHandle } from './client';
import { ensureAppLoginRole, runMigrations } from './migrate';
import { countryPhoneCodes, platformReference } from './schema';
import { seedPermissions, seedRoleTemplates } from './seed/access';
import { seedGked, seedPlatformReference } from './seed/platform';
import { platformDictRows, seedPlatformDicts } from './seed/platform-dicts';
import { readSpecJson } from './spec-data';

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

/** Номер рекомендательной блокировки на время миграций тестовой базы. */
const MIGRATION_LOCK = 704_118;

/** Временная база с применёнными миграциями. Обязательно вызвать drop() в afterAll. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const config = loadDatabaseConfig();
  const serverAdminUrl = config.DATABASE_ADMIN_URL!;
  const name = `test_${randomBytes(6).toString('hex')}`;
  const maintenance = createDb(serverAdminUrl, { max: 1, applicationName: 'buhuchet-test' });
  await maintenance.sql.unsafe(`create database "${name}"`);

  const adminUrl = withDatabase(serverAdminUrl, name);
  const appUrl = withDatabase(config.DATABASE_URL, name);
  // Миграции создают роли, общие для всего сервера (buhuchet_app, роль входа): параллельные файлы
  // тестов делают это по очереди, иначе одновременный CREATE ROLE падает на уникальности имени.
  await maintenance.sql`select pg_advisory_lock(${MIGRATION_LOCK})`;
  try {
    await runMigrations(adminUrl);
    await ensureAppLoginRole(adminUrl, appUrl);
  } finally {
    await maintenance.sql`select pg_advisory_unlock(${MIGRATION_LOCK})`;
    await maintenance.close();
  }

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

/** Права и шаблоны ролей из spec/data/refDB.json: без них организацию не создать. */
export async function seedAccessReference(db: Db): Promise<void> {
  const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
  await seedPermissions(db, refDB.permissions, { update: false });
  await seedRoleTemplates(db, refDB.roleTemplates, { update: false });
}

/** Справочник «Коды стран телефонов» из refDB.json — для проверки телефона сотрудника. */
export async function seedPhoneCodes(db: Db): Promise<void> {
  const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
  await db
    .insert(countryPhoneCodes)
    .values(platformDictRows(refDB).phoneCodes)
    .onConflictDoNothing();
}

/** Справочник «Налоги и ставки» из refDB.json — для формы просмотра налога. */
export async function seedTaxes(db: Db): Promise<void> {
  const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
  await db
    .insert(platformReference)
    .values({ key: 'taxes', payload: refDB.taxes, checksum: 'test', source: 'test' })
    .onConflictDoNothing();
}

/** Справочники платформы для контрагентов и отчётов из refDB.json (виды отчётов, режимы, УГНС, календарь…). */
export async function seedPlatformDictionaries(db: Db): Promise<void> {
  const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
  await seedPlatformDicts(db, refDB, { update: false });
}

/**
 * Справочники платформы целиком, как после `pnpm db:seed`: свои таблицы, мелкие разделы refDB.json
 * (`platform_reference`: группы справочников, банки, категории задач, статусы, шаблоны, налоги…) и
 * ГКЭД — для «Справочников платформы» организации.
 */
export async function seedAllPlatformDictionaries(db: Db): Promise<void> {
  const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
  await seedPlatformDicts(db, refDB, { update: false });
  await seedPlatformReference(db, refDB, 'test', { update: false });
  await seedGked(db, await readSpecJson('data/gkedDB.json'), { update: false });
}

/**
 * Разделы «Базы знаний» из refDB.json (шаги, группы, уровни, статьи, описание экранов) и тексты
 * приветствия с опросником (`onboarding`).
 */
export async function seedKbReference(db: Db): Promise<void> {
  const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
  const keys = [
    'kbSteps',
    'kbGroups',
    'kbLevels',
    'kbArticles',
    'kbUi',
    'kbShows',
    'onboarding',
  ] as const;
  await db
    .insert(platformReference)
    .values(keys.map((key) => ({ key, payload: refDB[key], checksum: 'test', source: 'test' })))
    .onConflictDoNothing();
}
