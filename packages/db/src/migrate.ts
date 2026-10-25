import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Групповая роль приложения: создаётся первой миграцией, получает права на таблицы. */
export const APP_GROUP_ROLE = 'buhuchet_app';

/** Применить все новые миграции. Только от имени владельца схемы (DATABASE_ADMIN_URL). */
export async function runMigrations(adminUrl: string): Promise<void> {
  const { db, close } = createDb(adminUrl, { max: 1, applicationName: 'buhuchet-migrate' });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await close();
  }
}

/** Имя роли из строки подключения; у пула Supabase оно вида `роль.проект`. */
export function roleFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).username).split('.')[0] ?? '';
}

/**
 * Роль входа приложения (пользователь из DATABASE_URL): создаётся, если её нет, получает пароль из
 * строки подключения и членство в `buhuchet_app`. Она не владелец таблиц и не обходит RLS.
 */
export async function ensureAppLoginRole(adminUrl: string, appUrl: string): Promise<string> {
  const role = roleFromUrl(appUrl);
  const password = decodeURIComponent(new URL(appUrl).password);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error(`Имя роли приложения «${role}» должно состоять из a-z, 0-9 и _`);
  }
  if (role === roleFromUrl(adminUrl)) {
    throw new Error(
      'DATABASE_URL должен подключаться отдельной ролью, а не владельцем схемы: иначе RLS не работает',
    );
  }
  if (!password) throw new Error('В DATABASE_URL нет пароля роли приложения');

  const { sql, close } = createDb(adminUrl, { max: 1, applicationName: 'buhuchet-migrate' });
  try {
    const literal = `'${password.replace(/'/g, "''")}'`;
    const [existing] = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolsuper, rolbypassrls from pg_roles where rolname = ${role}`;
    if (!existing) {
      await sql.unsafe(`create role "${role}" login password ${literal}`);
    } else {
      if (existing.rolsuper || existing.rolbypassrls) {
        throw new Error(
          `Роль «${role}» — суперпользователь или обходит RLS; приложению такая роль запрещена`,
        );
      }
      await sql.unsafe(`alter role "${role}" with login password ${literal}`);
    }
    await sql.unsafe(`grant "${APP_GROUP_ROLE}" to "${role}"`);
    return role;
  } finally {
    await close();
  }
}
