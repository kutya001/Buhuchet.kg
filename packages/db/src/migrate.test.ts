import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appPasswordDiffersMessage,
  appPasswordPlan,
  appPasswordState,
  ensureAppLoginRole,
  noticeLine,
  roleFromUrl,
  scramSha256Verifier,
} from './migrate';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

/**
 * Журнал миграций (общая сборка этапа 2, перенумерация): мигратор Drizzle на стенде и рабочей базе
 * применяет миграцию, только если её `when` больше, чем у последней применённой, — иначе молча
 * пропускает; прогон на пустой базе этого не заметит. Поэтому номера идут подряд, файл есть у каждой
 * записи, а `when` строго растёт.
 */
describe('журнал миграций', () => {
  const dir = new URL('../migrations/', import.meta.url);
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', dir), 'utf8')) as {
    entries: { idx: number; tag: string; when: number }[];
  };

  it('номера подряд, у каждой записи свой файл, лишних файлов нет', () => {
    const { entries } = journal;
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
    for (const e of entries)
      expect(e.tag.startsWith(String(e.idx).padStart(4, '0') + '_')).toBe(true);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(files).toEqual(entries.map((e) => `${e.tag}.sql`));
  });

  it('`when` строго растёт — новую миграцию мигратор не пропустит', () => {
    const { entries } = journal;
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i]!.when, entries[i]!.tag).toBeGreaterThan(entries[i - 1]!.when);
    }
  });
});

describe('noticeLine', () => {
  it('строка журнала: важность и текст сообщения', () => {
    expect(noticeLine({ severity: 'NOTICE', message: 'итог: 2' })).toBe('NOTICE: итог: 2');
    expect(noticeLine({})).toBe('NOTICE: ');
  });
});

describe('roleFromUrl', () => {
  it('берёт имя роли из строки подключения', () => {
    expect(roleFromUrl('postgres://buhuchet_web:pw@localhost:5432/buhuchet')).toBe('buhuchet_web');
  });

  it('у пула Supabase отбрасывает суффикс проекта', () => {
    expect(
      roleFromUrl(
        'postgres://buhuchet_web.abcdefgh:pw@aws-0-eu-central-1.pooler.example:6543/postgres',
      ),
    ).toBe('buhuchet_web');
  });
});

describe('scramSha256Verifier', () => {
  it('формат PostgreSQL, пароль в нём не виден', () => {
    const v = scramSha256Verifier('secret-pass');
    expect(v).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(v).not.toContain('secret-pass');
  });

  it('та же соль — тот же результат, другая соль — другой', () => {
    const salt = Buffer.alloc(16, 1);
    expect(scramSha256Verifier('pw', salt)).toBe(scramSha256Verifier('pw', salt));
    expect(scramSha256Verifier('pw')).not.toBe(scramSha256Verifier('pw'));
  });
});

describe('ensureAppLoginRole: проверки до подключения', () => {
  const admin = 'postgres://postgres:pw@localhost:5432/buhuchet';

  it('роль только с префиксом buhuchet_', async () => {
    await expect(
      ensureAppLoginRole(admin, 'postgres://authenticator:pw@localhost:5432/buhuchet'),
    ).rejects.toThrow(/buhuchet_/);
  });

  it('не владелец схемы и с паролем', async () => {
    await expect(
      ensureAppLoginRole(admin, 'postgres://postgres:pw@localhost:5432/buhuchet'),
    ).rejects.toThrow();
    await expect(
      ensureAppLoginRole(admin, 'postgres://buhuchet_web@localhost:5432/buhuchet'),
    ).rejects.toThrow(/пароля/);
  });
});

describe('appPasswordPlan: что делать с паролем роли до миграций', () => {
  it.each([
    ['differs', 'stop'],
    ['same', 'keep'],
    ['new', 'set'],
    ['change', 'set'],
  ] as const)('%s → %s', (state, plan) => {
    expect(appPasswordPlan(state)).toBe(plan);
  });
});

describe('строка подключения не попадает в ошибку', () => {
  it('неверный адрес — своя ошибка без строки', () => {
    const bad = 'not a url with secret-pw-123';
    let message = '';
    try {
      roleFromUrl(bad);
    } catch (error) {
      message = String(error) + JSON.stringify(error);
    }
    expect(message).toContain('не адрес postgres');
    expect(message).not.toContain('secret-pw-123');
  });

  it('appPasswordState проверяет имя роли и «не владелец» до подключения', async () => {
    const admin = 'postgres://postgres:pw@127.0.0.1:1/x';
    await expect(appPasswordState(admin, 'postgres://postgres:pw@127.0.0.1:1/x')).rejects.toThrow(
      /buhuchet_/,
    );
    const same = 'postgres://buhuchet_x:pw@127.0.0.1:1/x';
    await expect(appPasswordState(same, same)).rejects.toThrow(/отдельной ролью/);
  });
});

describe('appPasswordDiffersMessage', () => {
  it('называет роль, секреты и как сменить пароль намеренно', () => {
    const text = appPasswordDiffersMessage('buhuchet_web');
    expect(text).toContain('«buhuchet_web»');
    expect(text).toContain('Миграции не запускались');
    expect(text).toContain('PRODUCTION_DATABASE_URL');
    expect(text).toContain('--change-app-password');
    expect(text).toContain('только потом запустите снова');
  });
});

describe.skipIf(!databaseAvailable())('ensureAppLoginRole: в базе', () => {
  let t: TestDatabase;
  const BAD_ROLE = `buhuchet_test_owner_${process.pid}`;
  const KEEP_ROLE = `buhuchet_test_keep_${process.pid}`;
  const NOLOGIN_ROLE = `buhuchet_test_nologin_${process.pid}`;
  const notices: string[] = [];

  beforeAll(async () => {
    t = await createTestDatabase({ onMigrationNotice: (line) => notices.push(line) });
    // Роли остались от оборванного прогона — убрать, иначе «роли нет — new» не выполнится.
    for (const role of [KEEP_ROLE, NOLOGIN_ROLE]) {
      await t.admin.sql.unsafe(`drop role if exists "${role}"`);
    }
  });

  afterAll(async () => {
    for (const role of [BAD_ROLE, KEEP_ROLE, NOLOGIN_ROLE]) {
      await t?.admin.sql.unsafe(`drop role if exists "${role}"`);
    }
    await t?.drop();
  });

  // Итог переноса данных (п. К-19, О-81) — в журнале «Migrate test» и выпуска: раньше подключение
  // миграций глушило NOTICE, и чисел «объединено N» не было видно.
  it('сообщения миграций доходят до вывода: итог объединения копий чеков', () => {
    expect(notices.some((line) => /^NOTICE: file_copies_merge \(\d{4}\): /.test(line))).toBe(true);
    // Второй перенос (0160) и его вызов с границей выпуска 17.11.2026 (0164) — каждый своей строкой.
    for (const n of ['0160', '0164']) {
      expect(
        notices.some((line) => line.startsWith(`NOTICE: file_copies_merge_late (${n}): `)),
        n,
      ).toBe(true);
    }
  });

  it('роль входит в базу с паролем из строки подключения', async () => {
    const [row] = await t.app.sql<{ me: string }[]>`select current_user as me`;
    expect(row?.me).toBe(roleFromUrl(t.appUrl));
  });

  // Пароль роли приложения против базы до миграций (п. О-71, выпуск 28.11.2026).
  it('пароль роли: подходит — same, неверный — differs, роли нет — new', async () => {
    expect(await appPasswordState(t.adminUrl, t.appUrl)).toBe('same');
    const wrong = new URL(t.appUrl);
    wrong.password = 'not-the-password-0';
    expect(await appPasswordState(t.adminUrl, wrong.toString())).toBe('differs');
    const absent = new URL(t.appUrl);
    absent.username = `buhuchet_absent_${process.pid}`;
    expect(await appPasswordState(t.adminUrl, absent.toString())).toBe('new');
  });

  // Своя роль: соль SCRAM общей роли buhuchet_web меняют параллельные createTestDatabase других файлов.
  it('пароль подходит — keepPassword не трогает его в базе, без него — ставит заново', async () => {
    const url = new URL(t.appUrl);
    url.username = KEEP_ROLE;
    url.password = 'keep-password-0';
    const keepUrl = url.toString();
    const verifier = async () => {
      const [row] = await t.admin.sql<{ v: string }[]>`
        select rolpassword as v from pg_authid where rolname = ${KEEP_ROLE}`;
      return row?.v;
    };
    expect(await appPasswordState(t.adminUrl, keepUrl)).toBe('new');
    await ensureAppLoginRole(t.adminUrl, keepUrl);
    expect(await appPasswordState(t.adminUrl, keepUrl)).toBe('same');
    const before = await verifier();
    await ensureAppLoginRole(t.adminUrl, keepUrl, undefined, { keepPassword: true });
    expect(await verifier()).toBe(before);
    await ensureAppLoginRole(t.adminUrl, keepUrl);
    expect(await verifier()).not.toBe(before);
    expect(await appPasswordState(t.adminUrl, keepUrl)).toBe('same');
  });

  it('роль без права входа — new: миграции дают ей вход и пароль', async () => {
    const url = new URL(t.appUrl);
    url.username = NOLOGIN_ROLE;
    url.password = 'nologin-password-0';
    await t.admin.sql.unsafe(`create role "${NOLOGIN_ROLE}" nologin`);
    expect(await appPasswordState(t.adminUrl, url.toString())).toBe('new');
    await ensureAppLoginRole(t.adminUrl, url.toString());
    expect(await appPasswordState(t.adminUrl, url.toString())).toBe('same');
  });

  it('другая ошибка входа (нет связи) — исключение, а не «пароль подходит»', async () => {
    const url = new URL(t.appUrl);
    url.hostname = '127.0.0.1';
    url.port = '1';
    await expect(appPasswordState(t.adminUrl, url.toString())).rejects.toThrow();
  });

  it('роль с правами владельца таблиц отклоняется', async () => {
    const [owner] = await t.admin.sql<{ owner: string }[]>`
      select tableowner as owner from pg_tables where tablename = 'organizations'`;
    await t.admin.sql.unsafe(`create role "${BAD_ROLE}" login`);
    await t.admin.sql.unsafe(`grant "${owner!.owner}" to "${BAD_ROLE}"`);
    const url = new URL(t.appUrl);
    url.username = BAD_ROLE;
    url.password = 'pw-123456';
    await expect(ensureAppLoginRole(t.adminUrl, url.toString())).rejects.toThrow(/владельца/);
  });
});
