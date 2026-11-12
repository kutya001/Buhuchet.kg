import { expect, test } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { newOrgOwner } from './helpers';

// Админка → «Техническая документация» (ТЗ «Админка» → «Техническая документация», решение заказчика
// 09.11.2026; прототип v83 admin/techdocs.js): вкладки «Схема базы» (страница схемы в рамке) и «API»
// (методы продукта со связями «метод → таблицы → SQL»). Только просмотр; видит только администратор
// платформы. Данные собраны при сборке сайта по исходникам этого же репозитория.

const USERS = 'GET /admin/users';

test.describe('Админка: техническая документация', () => {
  test('(приёмка) GET /admin/users: карточка метода со схемой Zod, таблица users на «Схеме базы» с блоком «Где используется в API», «Показать на схеме»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    await page.goto('/app/tdocs/api');

    // Строка версии: по какой версии продукта собрано описание.
    const version = page.locator('[data-td-version]');
    await expect(version).toContainText('Описание API собрано по репозиторию продукта');
    await expect(version).toContainText('коммит');
    await expect(version).toContainText(/\d+ метод/);
    await expect(version).toContainText(/Схема базы — описание версии \d+/);

    // По умолчанию — группами разделов; поиск по адресу находит метод.
    await expect(page.locator('[data-grid]')).toContainText('Админка');
    await search(page, isMobile, '/admin/users');
    const row = page.locator(`[data-grid] [data-id="${USERS}"]`);
    await expect(row).toContainText('/admin/users');
    await expect(row).toContainText('Администратор платформы');
    await row.click();

    const card = page.getByRole('dialog', { name: USERS });
    const body = card.locator(`[data-td-method="${USERS}"]`);
    const openTab = async (tab: string) => {
      if (isMobile) {
        await card.getByRole('tab', { selected: true }).click();
        await page.getByRole('menu').getByRole('menuitem', { name: tab }).click();
      } else {
        await card.getByRole('tab', { name: tab }).click();
      }
      await expect(card.getByRole('tab', { selected: true })).toContainText(tab);
    };
    await expect(body).toContainText('Только администратор платформы');
    await expect(card).toContainText('Только просмотр: из Админки метод не вызывается');

    // «Запрос»: параметры строки запроса списка.
    await expect(body).toContainText('Параметры строки запроса');
    await expect(body.locator('[data-td-tab="req"]')).toContainText('page');

    // «Ответы»: коды с описанием, успешный раскрыт.
    await openTab('Ответы');
    const responses = body.locator('[data-td-tab="res"] details');
    await expect(responses.first()).toContainText('200');
    await expect(responses.first()).toHaveAttribute('open', '');
    await expect(body.locator('[data-td-tab="res"]')).toContainText('403');
    // Тип поля со схемой Zod открывает окно её полей.
    await responses.first().locator('[data-td-schema="AdminUser"]').first().click();
    const zod = page.getByRole('dialog', { name: 'AdminUser', exact: true });
    await expect(zod).toContainText('Схема Zod из пакета shared продукта');
    await expect(zod.locator('[data-td-zod="AdminUser"]')).toContainText('login');
    await zod.getByRole('button', { name: 'Готово' }).click();
    await expect(zod).toHaveCount(0);

    // «SQL»: контекст, текст запроса с подсветкой и «Копировать».
    await openTab('SQL');
    const sql = body.locator('[data-td-tab="sql"]');
    await expect(sql).toContainText('Контекст выполнения');
    await expect(sql).toContainText('requirePlatformAdmin');
    await expect(sql.locator('[data-td-query]').first()).toContainText('Копировать');
    await expect(sql.locator('[data-td-query="view"] pre i.k').first()).toBeVisible();

    // «Код»: файлы продукта ссылками на GitHub.
    await openTab('Код');
    const code = body.locator('[data-td-tab="code"]');
    await expect(code).toContainText('packages/api/src/modules/admin/users.ts');
    await expect(code.locator('a').first()).toHaveAttribute(
      'href',
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[0-9a-f]+\/packages\//,
    );

    // «Таблицы»: users — в «Читает»; нажатие открывает таблицу на «Схеме базы».
    await openTab('Таблицы');
    const tables = body.locator('[data-td-tab="tbl"]');
    await expect(tables).toContainText('Читает');
    await expect(tables).toContainText('Меняет (добавляет, изменяет, удаляет) · 0');
    await tables.locator('[data-td-table="users"]').click();
    await expect(page).toHaveURL(/\/app\/tdocs\/db$/);
    await expect(card).toHaveCount(0);

    // Страница схемы — в рамке, без доступа к сайту; открыта таблица users с блоком «Где используется в API».
    const frameEl = page.locator('iframe.td-frame');
    await expect(frameEl).toHaveAttribute('sandbox', 'allow-scripts');
    const schema = page.frameLocator('iframe.td-frame');
    await expect(schema.locator('body')).toContainText('Пользователи (учётные записи)');
    await expect(schema.locator('body')).toContainText('Где используется в API');
    const usage = schema.locator(`[data-api="${USERS}"]`).first();
    await expect(usage).toContainText('/admin/users');
    await expect(usage).toContainText('чтение');

    // Метод из блока открывает карточку поверх схемы; «Показать на схеме» — диаграмма таблиц метода.
    await usage.click();
    await expect(body).toContainText('Только администратор платформы');
    await openTab('Таблицы');
    await tables.locator('[data-td-show]').click();
    await expect(card).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/tdocs\/db$/);
    await expect
      .poll(
        () =>
          page
            .frames()
            .find((f) => f.url().includes('/schema-page'))
            ?.url() ?? '',
      )
      .toContain('#/d/');

    // «На весь экран»: схема закрывает окно программы, Esc возвращает обычный вид.
    const wrap = page.locator('[data-td-frame]');
    await page.locator('[data-td-full]').click();
    await expect(wrap).toHaveAttribute('data-td-frame', 'full');
    await page.keyboard.press('Escape');
    await expect(wrap).toHaveAttribute('data-td-frame', '');
  });

  test('«API»: фильтр «Таблица», «Скачать OpenAPI» с таблицами и доступом методов', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    await page.goto('/app/tdocs/api');
    const grid = page.locator('[data-grid]');
    await expect(grid.locator('[data-id]').first()).toBeVisible();
    const all = (await (await page.request.get('/api/admin/tech-docs/methods?size=25')).json()) as {
      total: number;
    };
    const filtered = (await (
      await page.request.get('/api/admin/tech-docs/methods?size=25&table=sessions')
    ).json()) as { total: number };
    expect(filtered.total).toBeGreaterThan(0);
    expect(filtered.total).toBeLessThan(all.total);

    // Фильтр «Таблица» оставляет методы, которые читают или меняют таблицу.
    await page.locator('[data-td-table-filter]').selectOption('sessions');
    await search(page, isMobile, 'sessions/end');
    const row = grid.locator('[data-id="POST /admin/users/{id}/sessions/end"]');
    await expect(row).toContainText('Да');
    await row.click();
    const card = page.getByRole('dialog', { name: 'POST /admin/users/{id}/sessions/end' });
    await expect(card).toContainText('Параметры адреса');

    await card.getByRole('button', { name: 'Готово' }).click();

    // «Скачать OpenAPI»: openapi.json 3.1 с x-tables, x-access и x-permissions.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-td-openapi]').click(),
    ]);
    expect(download.suggestedFilename()).toBe('openapi.json');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const doc = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      openapi: string;
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    expect(doc.openapi).toBe('3.1.0');
    const users = doc.paths['/admin/users']!.get!;
    expect(users['x-access']).toBe('Администратор платформы');
    expect((users['x-tables'] as { read: string[] }).read).toContain('users');
    const perm = Object.values(doc.paths)
      .flatMap((p) => Object.values(p))
      .find((op) => Array.isArray(op['x-permissions']));
    expect(perm).toBeTruthy();
  });

  test('сотруднику организации и гостю модуль недоступен: ни данных, ни страницы схемы', async ({
    page,
    baseURL,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const paths = [
      '/api/admin/tech-docs',
      '/api/admin/tech-docs/methods',
      '/api/admin/tech-docs/method?id=GET%20%2Fadmin%2Fusers',
      '/api/admin/tech-docs/schema-page',
      '/api/admin/tech-docs/openapi',
    ];
    const guest = await playwright.request.newContext({ baseURL: origin });
    for (const path of paths) expect((await guest.get(path)).status(), path).toBe(401);
    await guest.dispose();

    await newOrgOwner(page.request, origin);
    for (const path of paths) expect((await page.request.get(path)).status(), path).toBe(403);
    const me = (await (await page.request.get('/api/auth/me')).json()) as { modules: string[] };
    expect(me.modules).not.toContain('tdocs');

    // Страница схемы отдаётся администратору только для рамки своего сайта и без доступа к сети.
    const admin = await playwright.request.newContext({ baseURL: origin });
    await platformAdmin(admin, origin);
    const res = await admin.get('/api/admin/tech-docs/schema-page');
    expect(res.status()).toBe(200);
    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(await res.text()).toContain('window.TDX_IN=');
    const adminMe = (await (await admin.get('/api/auth/me')).json()) as { modules: string[] };
    expect(adminMe.modules).toContain('tdocs');
    await admin.dispose();
  });
});
