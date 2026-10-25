import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
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
 * Пароль роли в виде SCRAM-SHA-256 (как его хранит PostgreSQL): открытый пароль не попадает
 * ни в текст SQL, ни в журнал базы, ни в pg_stat_statements.
 */
export function scramSha256Verifier(password: string, salt = randomBytes(16)): string {
  const iterations = 4096;
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey}:${serverKey}`;
}

/**
 * Роли общие для всего сервера PostgreSQL: если две базы (например, параллельные тесты) меняют одну
 * роль одновременно, PostgreSQL отвечает «tuple concurrently updated» — тогда просто повторяем.
 */
async function retryConcurrent<T>(action: () => PromiseLike<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await action();
    } catch (error) {
      const concurrent = error instanceof Error && /concurrently updated/.test(error.message);
      if (!concurrent || i >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * i));
    }
  }
}

/**
 * Роль входа приложения (пользователь из DATABASE_URL): создаётся, если её нет, получает пароль из
 * строки подключения и членство в `buhuchet_app`. Она не владелец таблиц, не обходит RLS и не
 * получает прав владельца через членство в других ролях.
 */
export async function ensureAppLoginRole(adminUrl: string, appUrl: string): Promise<string> {
  const role = roleFromUrl(appUrl);
  const password = decodeURIComponent(new URL(appUrl).password);
  if (!/^buhuchet_[a-z0-9_]{1,54}$/.test(role)) {
    throw new Error(
      `Имя роли приложения «${role}» должно начинаться с buhuchet_ и состоять из a-z, 0-9 и _: ` +
        'так миграции не тронут чужие роли (на Supabase — anon, authenticated и т. п.)',
    );
  }
  if (role === roleFromUrl(adminUrl)) {
    throw new Error(
      'DATABASE_URL должен подключаться отдельной ролью, а не владельцем схемы: иначе RLS не работает',
    );
  }
  if (!password) throw new Error('В DATABASE_URL нет пароля роли приложения');

  const { sql, close } = createDb(adminUrl, { max: 1, applicationName: 'buhuchet-migrate' });
  try {
    const verifier = `'${scramSha256Verifier(password)}'`;
    const [existing] = await sql<{ rolsuper: boolean; rolbypassrls: boolean; owner: boolean }[]>`
      select rolsuper, rolbypassrls,
        exists (
          select 1 from pg_tables
          where schemaname in ('public', 'app') and pg_has_role(r.oid, tableowner, 'USAGE')
        ) or pg_has_role(r.oid, current_user, 'USAGE') as owner
      from pg_roles r where rolname = ${role}`;
    if (!existing) {
      await sql.unsafe(`create role "${role}" login password ${verifier}`);
    } else {
      if (existing.rolsuper || existing.rolbypassrls || existing.owner) {
        throw new Error(
          `Роль «${role}» — суперпользователь, обходит RLS или имеет права владельца таблиц; ` +
            'приложению такая роль запрещена',
        );
      }
      await retryConcurrent(() =>
        sql.unsafe(`alter role "${role}" with login password ${verifier}`),
      );
    }
    await retryConcurrent(() => sql.unsafe(`grant "${APP_GROUP_ROLE}" to "${role}"`));
    return role;
  } finally {
    await close();
  }
}
