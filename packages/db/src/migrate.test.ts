import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureAppLoginRole, noticeLine, roleFromUrl, scramSha256Verifier } from './migrate';
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

describe.skipIf(!databaseAvailable())('ensureAppLoginRole: в базе', () => {
  let t: TestDatabase;
  const BAD_ROLE = `buhuchet_test_owner_${process.pid}`;
  const notices: string[] = [];

  beforeAll(async () => {
    t = await createTestDatabase({ onMigrationNotice: (line) => notices.push(line) });
  });

  afterAll(async () => {
    await t?.admin.sql.unsafe(`drop role if exists "${BAD_ROLE}"`);
    await t?.drop();
  });

  // Итог переноса данных (п. К-19, О-81) — в журнале «Migrate test» и выпуска: раньше подключение
  // миграций глушило NOTICE, и чисел «объединено N» не было видно.
  it('сообщения миграций доходят до вывода: итог объединения копий чеков', () => {
    expect(notices.some((line) => /^NOTICE: file_copies_merge \(\d{4}\): /.test(line))).toBe(true);
  });

  it('роль входит в базу с паролем из строки подключения', async () => {
    const [row] = await t.app.sql<{ me: string }[]>`select current_user as me`;
    expect(row?.me).toBe(roleFromUrl(t.appUrl));
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
