import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Групповая роль приложения: создаётся первой миграцией, получает права на таблицы. */
export const APP_GROUP_ROLE = 'buhuchet_app';

/** Текст сообщения сервера для журнала: «NOTICE: …». */
export const noticeLine = (notice: { severity?: string; message?: string }): string =>
  `${notice.severity ?? 'NOTICE'}: ${notice.message ?? ''}`;

/**
 * Применить все новые миграции. Только от имени владельца схемы (DATABASE_ADMIN_URL). `onNotice` —
 * сообщения миграций (`RAISE NOTICE` с итогом переноса данных, например 0159 `file_copies_merge`):
 * команда `db:migrate` печатает их в журнал стенда и выпуска, тесты — нет. `folder` — другая папка
 * миграций (тест «база до выпуска»: только миграции до нужной, `createTestDatabaseAt`).
 */
export async function runMigrations(
  adminUrl: string,
  caCert?: string,
  onNotice?: (line: string) => void,
  folder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  const { db, close } = createDb(adminUrl, {
    max: 1,
    applicationName: 'buhuchet-migrate',
    caCert,
    onNotice: onNotice ? (notice) => onNotice(noticeLine(notice)) : undefined,
  });
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await close();
  }
}

/** Имя роли из строки подключения; у пула Supabase оно вида `роль.проект`. */
export function roleFromUrl(url: string): string {
  return decodeURIComponent(parseDbUrl(url).username).split('.')[0] ?? '';
}

/** Разбор строки подключения без самой строки в ошибке: `TypeError` Node кладёт её целиком в `input`,
 *  и необработанное исключение напечатало бы пароль в журнал выпуска. */
function parseDbUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error(
      'Строка подключения к базе (DATABASE_URL или DATABASE_ADMIN_URL) — не адрес postgres://…',
    );
  }
}

/**
 * Роль и пароль приложения из DATABASE_URL с проверками до любого подключения: имя `buhuchet_…`
 * (миграции не тронут чужие роли), не владелец схемы (иначе RLS не работает), пароль есть.
 */
function appLogin(adminUrl: string, appUrl: string): { role: string; password: string } {
  const role = roleFromUrl(appUrl);
  const password = decodeURIComponent(parseDbUrl(appUrl).password);
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
  return { role, password };
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
 * Пароль роли приложения против базы (docs/decisions.md п. О-71): `new` — роли ещё нет, `same` — роль
 * входит с паролем из строки подключения, `differs` — база отвечает «неверный пароль». Рабочий сайт
 * (Vercel) входит своим `DATABASE_URL`, миграции выпуска — секретом GitHub: если они разошлись, смена
 * пароля в базе отрезает сайт от базы, а его неудачные входы приводят к блокировке адреса пула
 * Supabase (выпуск 28.11.2026). Роль есть, но вход ей запрещён (NOLOGIN) — тоже `new`: сайт ею всё
 * равно не входит, миграции дают ей вход и пароль. Другая ошибка входа (сеть, пул) — исключение:
 * выпуск не идёт вслепую. Имя роли и «не владелец» проверяются до первого подключения.
 */
export type AppPasswordState = 'new' | 'same' | 'differs';

/** Что делать с паролем роли: `stop` — миграции не запускать, `keep` — не трогать, `set` — поставить
 *  из строки подключения. `change` — смену просили явно (`--change-app-password`): вход не проверяем,
 *  чтобы ответ пула на неверный пароль (не всегда `28P01`) не мешал намеренной смене. */
export function appPasswordPlan(state: AppPasswordState | 'change'): 'stop' | 'keep' | 'set' {
  if (state === 'differs') return 'stop';
  if (state === 'same') return 'keep';
  return 'set';
}

/** Код PostgreSQL «неверный пароль» (`invalid_password`). */
const INVALID_PASSWORD = '28P01';

export async function appPasswordState(
  adminUrl: string,
  appUrl: string,
  caCert?: string,
): Promise<AppPasswordState> {
  const { role } = appLogin(adminUrl, appUrl);
  const admin = createDb(adminUrl, { max: 1, applicationName: 'buhuchet-migrate', caCert });
  try {
    const [found] = await admin.sql<{ login: boolean }[]>`
      select rolcanlogin as login from pg_roles where rolname = ${role}`;
    if (!found?.login) return 'new';
  } finally {
    await admin.close();
  }
  const app = createDb(appUrl, { max: 1, applicationName: 'buhuchet-migrate', caCert });
  try {
    await app.sql`select 1`;
    return 'same';
  } catch (error) {
    if ((error as { code?: string }).code === INVALID_PASSWORD) return 'differs';
    throw error;
  } finally {
    await app.close();
  }
}

/** Что сказать, когда пароль роли приложения в строке подключения не подходит к базе. */
export function appPasswordDiffersMessage(role: string): string {
  return (
    `Пароль роли «${role}» в DATABASE_URL не подходит к базе, а миграции поставили бы базе этот пароль: ` +
    'сайт, который входит со своим паролем, потерял бы базу. Миграции не запускались. ' +
    'Если пароль менять не нужно — поставьте в строку подключения (на выпуске — секрет ' +
    'PRODUCTION_DATABASE_URL, на стенде — TEST_DATABASE_URL) тот же пароль, что в DATABASE_URL сайта ' +
    'в Vercel, и только потом запустите снова: каждый запуск с неверным паролем — ещё одна неудачная ' +
    'попытка входа, после нескольких Supabase блокирует адрес общего пула для всех. Если пароль меняете намеренно — запуск с отметкой «Сменить пароль ' +
    'роли сайта» (локально `pnpm db:migrate --change-app-password`) и сразу тот же адрес в DATABASE_URL ' +
    'в Vercel с повторной выкладкой (docs/deploy.md, «Пароль роли сайта»).'
  );
}

/**
 * Роль входа приложения (пользователь из DATABASE_URL): создаётся, если её нет, получает пароль из
 * строки подключения и членство в `buhuchet_app`. Она не владелец таблиц, не обходит RLS и не
 * получает прав владельца через членство в других ролях. `keepPassword` — пароль уже подходит
 * (`appPasswordState` = `same`): его не перезаписываем, чтобы не менять соль SCRAM под работающим сайтом.
 */
export async function ensureAppLoginRole(
  adminUrl: string,
  appUrl: string,
  caCert?: string,
  options: { keepPassword?: boolean } = {},
): Promise<string> {
  const { role, password } = appLogin(adminUrl, appUrl);
  const { sql, close } = createDb(adminUrl, {
    max: 1,
    applicationName: 'buhuchet-migrate',
    caCert,
  });
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
      if (!options.keepPassword) {
        await retryConcurrent(() =>
          sql.unsafe(`alter role "${role}" with login password ${verifier}`),
        );
      }
    }
    await retryConcurrent(() => sql.unsafe(`grant "${APP_GROUP_ROLE}" to "${role}"`));
    return role;
  } finally {
    await close();
  }
}
