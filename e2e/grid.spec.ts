import { expect, test, type APIRequestContext, type Page, type Response } from '@playwright/test';
import { DEMO_PASSWORD, hire, signIn, uniqueLogin } from './helpers';

// Общий список записей (UnifiedDataGrid, задача #14) на списке сотрудников через настоящий сайт:
// страницы с сервера и настройки вида пользователя. У каждого теста свой новый сотрудник с ролью
// «Главный бухгалтер» (видит модуль «Сотрудники»): его вид списка не пересекается с другими тестами.

const isStaffList = (r: Response) =>
  r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/staff';

interface StaffPage {
  items: { id: string }[];
  total: number;
  page: number;
}

/** В демо-организации не меньше `min` сотрудников: недостающих владелец создаёт через API. */
async function ensureStaff(api: APIRequestContext, origin: string, min: number) {
  await signIn(api, origin, 'erkin', DEMO_PASSWORD);
  const { total } = (await (await api.get('/api/staff?size=25')).json()) as StaffPage;
  const roles = (await (await api.get('/api/roles')).json()) as {
    items: { id: string; name: string }[];
  };
  const roleId = roles.items.find((r) => r.name === 'Бухгалтер')!.id;
  const prefix = uniqueLogin('e2e-many');
  for (let made = 0; made < min - total; made += 10) {
    await Promise.all(
      Array.from({ length: Math.min(10, min - total - made) }, async (_, i) => {
        const res = await api.post('/api/staff', {
          headers: { origin },
          data: {
            fullName: `Списков Сквозной ${made + i + 1}`,
            login: `${prefix}-${made + i}`,
            roleId,
          },
        });
        expect(res.status(), await res.text()).toBe(201);
      }),
    );
  }
  await api.post('/api/auth/logout', { headers: { origin } });
}

/** Новый главный бухгалтер входит в браузере и меняет временный пароль. */
async function signInAsNewChief(page: Page, origin: string) {
  const login = uniqueLogin('e2e-grid');
  const { temporaryPassword } = await hire(page.request, origin, login, null, 'Главный бухгалтер');
  await signIn(page.request, origin, login, temporaryPassword);
  const changed = await page.request.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
  });
  expect(changed.status(), await changed.text()).toBe(200);
}

/** Заголовки таблицы по порядку (ключи столбцов). */
const headers = (page: Page) =>
  page
    .locator('[data-grid] th[data-column]')
    .evaluateAll((ths) => ths.map((th) => th.getAttribute('data-column')));

test.describe('Списки: UnifiedDataGrid', () => {
  test('список из 250 записей листается страницами, сервер отдаёт только текущую страницу', async ({
    page,
    playwright,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    const setup = await playwright.request.newContext({ baseURL });
    await ensureStaff(setup, origin, 250);
    await setup.dispose();
    await signInAsNewChief(page, origin);

    const firstLoad = page.waitForResponse(isStaffList);
    await page.goto('/app/staff/list');
    const first = (await (await firstLoad).json()) as StaffPage;
    expect(first.items).toHaveLength(25);
    expect(first.page).toBe(1);
    expect(first.total).toBeGreaterThanOrEqual(250);

    const grid = page.locator('[data-grid]');
    const footer = page.locator('[data-grid-footer]');
    await expect(grid.locator('[data-id]')).toHaveCount(25);
    await expect(footer).toContainText(`Показано 1 – 25 из ${first.total}`);
    await expect(page.locator('[data-grid-page]')).toHaveText(`1 / ${Math.ceil(first.total / 25)}`);

    const secondLoad = page.waitForResponse(
      (r) => isStaffList(r) && new URL(r.url()).searchParams.get('page') === '2',
    );
    await page.getByRole('button', { name: 'Вперёд' }).click();
    const second = (await (await secondLoad).json()) as StaffPage;
    expect(second.items).toHaveLength(25);
    expect(second.page).toBe(2);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    await expect(grid.locator('[data-id]').first()).toHaveAttribute('data-id', second.items[0]!.id);
    await expect(grid.locator('[data-id]')).toHaveCount(25);
    await expect(footer).toContainText(`Показано 26 – 50 из ${second.total}`);
    await expect(page.locator('[data-grid-page]')).toHaveText(
      `2 / ${Math.ceil(second.total / 25)}`,
    );
  });

  test('скрыл столбец, поменял порядок и сортировку — после перезагрузки страницы вид тот же', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signInAsNewChief(page, origin);
    await page.goto('/app/staff/list');
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
    // На телефоне по умолчанию — карточки: переключаемся на таблицу (выбор тоже запоминается).
    if (isMobile) await page.getByRole('button', { name: 'Вид списка: Таблица' }).click();
    await expect.poll(() => headers(page)).toEqual(['fullName', 'phone', 'role', 'active']);

    // «Столбцы»: скрыть «Телефон», «Роль» — наверх.
    await page.getByRole('button', { name: /^Столбцы/ }).click();
    const panel = page.getByRole('dialog', { name: 'Столбцы' });
    await panel.getByRole('checkbox', { name: 'Телефон' }).uncheck();
    for (let i = 0; i < 3; i++) await panel.getByRole('button', { name: 'Выше: Роль' }).click();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect.poll(() => headers(page)).toEqual(['role', 'fullName', 'active']);

    // Сортировка по «ФИО»: настройки уходят на сервер вместе со всеми правками.
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'PUT' &&
        new URL(r.url()).pathname === '/api/view-settings/staff.list' &&
        (JSON.parse(r.request().postData() ?? '{}') as { sort?: { key: string } }).sort?.key ===
          'fullName',
    );
    const sorted = page.waitForResponse(
      (r) => isStaffList(r) && new URL(r.url()).searchParams.get('sort') === 'fullName.asc',
    );
    await page.getByTitle('Сортировать: ФИО').click();
    expect((await saved).status()).toBe(200);
    expect((await sorted).status()).toBe(200);
    await expect(page.locator('th[data-column="fullName"]')).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    const reloaded = page.waitForResponse(
      (r) => isStaffList(r) && new URL(r.url()).searchParams.get('sort') === 'fullName.asc',
    );
    await page.reload();
    expect((await reloaded).status()).toBe(200);
    await expect.poll(() => headers(page)).toEqual(['role', 'fullName', 'active']);
    await expect(page.locator('th[data-column="fullName"]')).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await expect(page.locator('[data-grid]')).toHaveAttribute('data-view', 'table');
  });
});
