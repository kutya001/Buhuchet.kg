import { readFileSync } from 'node:fs';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  DM_QUERY_MAX,
  UI_TEXTS,
  dmMethodSql,
  dmMethodToSelect,
  formatText,
} from '@buhuchet/domain';
import {
  DmConsoleCheck,
  DmConsoleHistory,
  DmConsoleQuery,
  DmConsoleQueryList,
  DmSchemaMap,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';
import { dmConsoleProblems } from './console-queries';

/*
 * Консоль запросов «Витрины данных», этап 1 (доработки 27.11.2026: консоль запросов, блоки 1, 3–5; П4–П6;
 * docs/decisions.md п. О-69): «Мои запросы» — только свои, организации и гостю отказ; устаревшая версия —
 * 409; «История» — свои запуски; проверка по ходу набора — место ошибки в тексте; перестройка запросов
 * методов API на всём снимке выполняется консолью или прямо пишет, что заменить.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const tr = (key: string, values?: Record<string, string | number>) =>
  formatText((UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key, values ?? {});

describe('проверка по ходу набора: место ошибки (блок 3, пункт 4)', () => {
  it('синтаксис — у слова, где споткнулся разборщик, с учётом параметров и кириллицы', async () => {
    const sql = "select 'контрагент' as name, :month as m\nfrom contractors wher x = 1";
    const [p] = await dmConsoleProblems(sql, tr);
    expect(p!.code).toBe('dm_sql_syntax');
    expect(sql.slice(p!.from, p!.to)).toBe('x');
  });
  it('запрещённая функция — подчёркнуто её имя', async () => {
    const sql = "select 1;\nselect 'ё', pg_sleep(1)";
    const [p] = await dmConsoleProblems(sql, tr);
    expect(p!.code).toBe('dm_console_forbidden');
    expect(sql.slice(p!.from, p!.to)).toBe('pg_sleep');
  });
  it('незакрытая кавычка и скобка — без разборщика; запись — начало оператора', async () => {
    expect((await dmConsoleProblems("select 'a", tr))[0]!.code).toBe('dm_sql_unclosed');
    expect((await dmConsoleProblems('select (1', tr))[0]!.code).toBe('dm_sql_parens');
    const del = await dmConsoleProblems('select 1; delete from users', tr);
    expect(del).toHaveLength(1);
    expect(del[0]!.code).toBe('dm_sql_not_select');
    expect('select 1; delete from users'.slice(del[0]!.from, del[0]!.to)).toBe('delete');
  });
  it('правильный текст — без ошибок; 12 параметров не сдвигают место', async () => {
    expect(await dmConsoleProblems('select :a, :b from contractors', tr)).toEqual([]);
    const sql = `select ${Array.from({ length: 12 }, (_, i) => `:${'p'.repeat(1)}${i}`).join(', ')}, :x fromm t`;
    const [p] = await dmConsoleProblems(sql, tr);
    expect(sql.slice(p!.from, p!.to)).toBe('t');
  });
});

describe.skipIf(!databaseAvailable())('Витрина данных: «Мои запросы» и «История» консоли', () => {
  let f: Fixture;
  const cookies: Record<string, string> = {};
  const call = (
    login: string | null,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ) =>
    apiRequest(
      f.app,
      method,
      `/api/admin/dm/console${path}`,
      login ? cookies[login] : undefined,
      body,
    );
  const ok = async <T>(res: Response, parse: { parse: (v: unknown) => T }, status = 200) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return parse.parse(await res.json());
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    const [admin] = await f.t.admin.db
      .select({ hash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.login, 'platform-admin'));
    await f.t.admin.db
      .insert(schema.users)
      .values({ login: 'platform-admin-2', passwordHash: admin!.hash, isPlatformAdmin: true });
    for (const login of ['owner-a', 'platform-admin', 'platform-admin-2']) {
      cookies[login] = await signIn(f.app, login, TEST_PASSWORD);
    }
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it.each([
    ['GET', '/queries'],
    ['POST', '/queries'],
    ['PUT', '/queries/00000000-0000-4000-8000-000000000001'],
    ['DELETE', '/queries/00000000-0000-4000-8000-000000000001?version=1'],
    ['GET', '/history'],
    ['POST', '/check'],
  ] as const)('сотрудник организации — 403, гость — 401: %s %s', async (method, path) => {
    const body =
      method === 'POST' || method === 'PUT'
        ? path === '/check'
          ? { query: 'select 1' }
          : { name: 'x', query: 'select 1', params: {}, version: 1 }
        : undefined;
    expect((await call('owner-a', method, path, body)).status).toBe(403);
    expect((await call(null, method, path, body)).status).toBe(401);
  });

  it('создать, изменить с версией, удалить; чужой не виден и не меняется', async () => {
    const made = await ok(
      await call('platform-admin', 'POST', '/queries', {
        name: '  Отчёты за месяц ',
        query: 'select count(*) from reports where period = :month',
        params: { month: '2026-11' },
      }),
      DmConsoleQuery,
      201,
    );
    expect(made).toMatchObject({
      name: 'Отчёты за месяц',
      params: { month: '2026-11' },
      version: 1,
    });
    // Другой администратор чужого не видит, не меняет и не удаляет (404, как нет записи).
    expect(
      (await ok(await call('platform-admin-2', 'GET', '/queries'), DmConsoleQueryList)).items,
    ).toEqual([]);
    const foreign = { name: 'чужое', query: 'select 1', params: {}, version: 1 };
    expect((await call('platform-admin-2', 'PUT', `/queries/${made.id}`, foreign)).status).toBe(
      404,
    );
    expect((await call('platform-admin-2', 'DELETE', `/queries/${made.id}?version=1`)).status).toBe(
      404,
    );
    // Своё — меняется, устаревшая версия — 409 и правка не затирает.
    const changed = await ok(
      await call('platform-admin', 'PUT', `/queries/${made.id}`, {
        ...foreign,
        name: 'Новое',
        version: 1,
      }),
      DmConsoleQuery,
    );
    expect(changed.version).toBe(2);
    const stale = await call('platform-admin', 'PUT', `/queries/${made.id}`, {
      ...foreign,
      name: 'Старое',
      version: 1,
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('record_changed');
    const mine = await ok(await call('platform-admin', 'GET', '/queries'), DmConsoleQueryList);
    expect(mine.items.map((q) => q.name)).toEqual(['Новое']);
    expect((await call('platform-admin', 'DELETE', `/queries/${made.id}?version=1`)).status).toBe(
      409,
    );
    expect((await call('platform-admin', 'DELETE', `/queries/${made.id}?version=2`)).status).toBe(
      204,
    );
    expect(
      (await ok(await call('platform-admin', 'GET', '/queries'), DmConsoleQueryList)).items,
    ).toEqual([]);
  });

  it('неверные данные — 400: пусто, длиннее предела, параметров больше 20', async () => {
    for (const body of [
      { name: ' ', query: 'select 1' },
      { name: 'x'.repeat(201), query: 'select 1' },
      { name: 'x', query: '' },
      { name: 'x', query: 's'.repeat(20_001) },
      {
        name: 'x',
        query: 'select 1',
        params: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, '1'])),
      },
    ]) {
      expect(
        (await call('platform-admin', 'POST', '/queries', body)).status,
        JSON.stringify(body).slice(0, 60),
      ).toBe(400);
    }
  });

  it('«История» — только свои запуски, новые сверху', async () => {
    await call('platform-admin', 'POST', '/run', { query: 'select 1 as one', params: {} });
    await call('platform-admin', 'POST', '/run', { query: 'select pg_sleep(1)', params: {} });
    await call('platform-admin-2', 'POST', '/run', { query: 'select 2 as two', params: {} });
    const mine = await ok(await call('platform-admin', 'GET', '/history'), DmConsoleHistory);
    expect(mine.items.map((r) => [r.query, r.outcome])).toEqual([
      ['select pg_sleep(1)', 'refused'],
      ['select 1 as one', 'ok'],
    ]);
    expect(mine.items[1]).toMatchObject({ rows: 1, action: 'dm_console_run', params: {} });
    const other = await ok(await call('platform-admin-2', 'GET', '/history'), DmConsoleHistory);
    expect(other.items.map((r) => r.query)).toEqual(['select 2 as two']);
  });

  it('проверка по ходу набора ничего не выполняет и в журнал не пишет', async () => {
    const before = (await ok(await call('platform-admin', 'GET', '/history'), DmConsoleHistory))
      .items.length;
    const res = await ok(
      await call('platform-admin', 'POST', '/check', { query: 'select * from contractors wher 1' }),
      DmConsoleCheck,
    );
    expect(res.problems[0]!.code).toBe('dm_sql_syntax');
    expect(
      (await ok(await call('platform-admin', 'GET', '/history'), DmConsoleHistory)).items,
    ).toHaveLength(before);
    // Текст длиннее предела запроса — 400, разборщик его не получает.
    const long = await call('platform-admin', 'POST', '/check', {
      query: 'x'.repeat(DM_QUERY_MAX + 1),
    });
    expect(long.status).toBe(400);
  });

  it('метод API → SELECT на всём снимке: выполняется консолью или прямо пишет, что заменить (блок 5, пункт 6)', async () => {
    const docs = JSON.parse(
      readFileSync(new URL('../../../../../spec/data/apiDocs.json', import.meta.url), 'utf8'),
    ) as { methods: { m: string; p: string; q?: number[] }[]; sql: { k: string; t: string }[] };
    const map = await ok(await call('platform-admin', 'GET', '/schema'), DmSchemaMap);
    const known = new Map(
      map.tables.map((t) => [t.name, new Map(t.fields.map((x) => [x.name, x.type]))]),
    );
    const texts = new Set(
      docs.methods.map((m) => dmMethodSql(m, docs.sql)).filter((x): x is string => !!x),
    );
    expect(texts.size).toBeGreaterThan(20);
    const outcome: string[] = [];
    const failed: string[] = [];
    for (const text of texts) {
      const r = dmMethodToSelect(text, known);
      expect(r.sql).not.toBeNull();
      if (r.replace.length) {
        outcome.push('replace');
        continue;
      }
      const params = Object.fromEntries(r.params.map((k) => [k, null]));
      const res = await call('platform-admin', 'POST', '/run', { query: r.sql, params });
      if (res.status !== 200) failed.push(`${r.sql!.slice(0, 80)}\n→ ${await res.text()}`);
      else outcome.push('ok');
    }
    expect(failed, failed.join('\n\n')).toEqual([]);
    // Хоть один запрос метода готов без замен, и каждый «не готов» назван.
    expect(outcome).toContain('ok');
  });
});
