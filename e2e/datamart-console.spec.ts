import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { platformAdmin } from './admin';
import { DEMO_PASSWORD, signIn } from './helpers';

// Консоль запросов «Витрины данных», этап 0 (доработки 27.11.2026, блок 2, пункт 11): защита метода
// «Выполнить в консоли» через настоящий сайт, раньше экрана «Консоль» (его делает этап 1). Тест только
// API — один проект (ПК): место запуска консоли одно на весь сайт, и два проекта мешали бы друг другу.

const PATHS = [
  ['post', '/api/admin/dm/console/run'],
  ['post', '/api/admin/dm/console/explain'],
  ['post', '/api/admin/dm/console/stop'],
  ['post', '/api/admin/dm/console/export'],
  ['get', '/api/admin/dm/console/schema'],
] as const;

/** «Выполнить» с повтором, пока место консоли занято другим запросом сайта (429). */
async function run(api: APIRequestContext, origin: string, query: string) {
  let res: APIResponse | undefined;
  await expect(async () => {
    res = await api.post('/api/admin/dm/console/run', {
      headers: { origin },
      data: { query, params: {} },
    });
    expect(res.status(), query).not.toBe(429);
  }).toPass({ intervals: [300, 600, 1000], timeout: 15_000 });
  return res!;
}

test.describe('Витрина данных: консоль запросов, этап 0', () => {
  test('(консоль, блок 2, пункт 11) администратор читает все организации; секреты, запись, смена роли, ожидание, блокировка, query_to_xml, сигнал другому соединению и «Мои запросы» — отказ; сотруднику и гостю метод не отвечает', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    test.skip(isMobile, 'только API: одного проекта достаточно');
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const api = page.request;

    // Все организации: демо-организация видна без её контекста.
    const ok = await run(
      api,
      origin,
      "select count(*)::int as n from organizations where slug = 'buhgalter-plyus'",
    );
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await ok.json()).toMatchObject({ columns: ['n'], rows: [[1]], more: false, max: 1000 });

    // Предел строк на экране — 1 000, «ещё есть».
    const many = await run(api, origin, 'select g from generate_series(1, 1500) g');
    expect(many.status()).toBe(200);
    const manyBody = (await many.json()) as { rows: unknown[]; more: boolean };
    expect(manyBody.rows).toHaveLength(1000);
    expect(manyBody.more).toBe(true);

    // Секреты закрыты ролью базы.
    for (const query of [
      'select password_hash from users',
      'select * from sessions',
      'select * from dm_template_sql',
      'select * from dm_console_queries',
    ]) {
      const res = await run(api, origin, query);
      expect(res.status(), query).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code, query).toBe(
        'dm_console_error',
      );
    }
    // Запись, смена роли и настроек, ожидание, блокировка, запрос из строки, сигнал — отказ разборщика.
    // Код отказа у каждого: без разборщика в образе сайта база отказала бы сама с `dm_console_error`.
    const NOT_SELECT = 'dm_sql_not_select';
    const FORBIDDEN = 'dm_console_forbidden';
    for (const [query, code] of [
      ["insert into news (id) values ('x')", NOT_SELECT],
      ['update organizations set name = name', NOT_SELECT],
      ['delete from organizations', NOT_SELECT],
      ['with d as (delete from organizations returning id) select * from d', NOT_SELECT],
      ['set role buhuchet_app', NOT_SELECT],
      ["select set_config('role', 'buhuchet_app', true)", FORBIDDEN],
      ['select pg_sleep(1)', FORBIDDEN],
      ['select pg_advisory_lock(1)', FORBIDDEN],
      ['select id from organizations for update', 'dm_sql_lock'],
      ["select query_to_xml('select 1', true, true, '')", FORBIDDEN],
      [
        "select ts_rewrite('a'::tsquery, 'select ''a''::tsquery, ''b''::tsquery from pg_'||'sleep(2)')",
        FORBIDDEN,
      ],
      ['select pg_terminate_backend(1)', FORBIDDEN],
      ['select pg_cancel_backend(1)', FORBIDDEN],
      ['select 1; select 2', 'dm_sql_two_statements'],
    ] as const) {
      const res = await run(api, origin, query);
      expect(res.status(), query).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code, query).toBe(code);
    }

    // «План запроса» — без выполнения.
    const plan = await api.post('/api/admin/dm/console/explain', {
      headers: { origin },
      data: { query: 'select count(*) from organizations', params: {} },
    });
    expect(plan.status(), await plan.text()).toBe(200);
    // «Остановить», когда нечего останавливать, — 0.
    const stop = await api.post('/api/admin/dm/console/stop', { headers: { origin } });
    expect(await stop.json()).toEqual({ stopped: 0 });
    // Карта базы: закрытого ролям нет.
    const map = await api.get('/api/admin/dm/console/schema');
    expect(map.status()).toBe(200);
    const tables = (
      (await map.json()) as { tables: { name: string; fields: { name: string }[] }[] }
    ).tables;
    expect(tables.map((t) => t.name)).toContain('organizations');
    expect(tables.map((t) => t.name)).not.toContain('dm_console_queries');
    expect(tables.find((t) => t.name === 'users')?.fields.map((f) => f.name)).not.toContain(
      'password_hash',
    );

    // Сотрудник организации (владелец демо-организации) и гость — отказ на каждый метод консоли.
    const staff = await playwright.request.newContext({ baseURL });
    await signIn(staff, origin, 'erkin', DEMO_PASSWORD);
    const guest = await playwright.request.newContext({ baseURL });
    for (const [method, path] of PATHS) {
      const body = { headers: { origin }, data: { query: 'select 1', params: {} } };
      const asStaff = method === 'get' ? await staff.get(path) : await staff.post(path, body);
      expect(asStaff.status(), path).toBe(403);
      const asGuest = method === 'get' ? await guest.get(path) : await guest.post(path, body);
      expect(asGuest.status(), path).toBe(401);
    }
    await staff.dispose();
    await guest.dispose();
  });
});
