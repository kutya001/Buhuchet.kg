import { expect, test, type APIRequestContext, type Page, type Response } from '@playwright/test';
import { DEMO_PASSWORD, finger, hire, settledBox, signIn, uniqueLogin } from './helpers';

// Общий список записей (UnifiedDataGrid, задачи #14–#16) на списке сотрудников через настоящий
// сайт: страницы с сервера, настройки вида пользователя, группировка, фильтры у столбцов, поиск и
// действия над записью без правого клика. У каждого теста свой новый сотрудник с ролью «Главный
// бухгалтер» (видит модуль «Сотрудники») или своей ролью с правом «Сотрудники и роли»: его вид списка
// не пересекается с другими тестами.

const isStaffList = (r: Response) =>
  r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/staff';

interface StaffPage {
  items: { id: string; fullName: string }[];
  total: number;
  page: number;
  groups?: { key: string; label: string | null; count: number; sub?: { count: number }[] }[];
}

/** Ответ списка, у которого параметр `name` равен `value`. */
const listWith = (name: string, value: string) => (r: Response) =>
  isStaffList(r) && new URL(r.url()).searchParams.get(name) === value;

/**
 * Владелец создаёт двух бухгалтеров с общим редким словом в ФИО и блокирует второго: поиск по слову
 * находит обоих, фильтр «Статус: Активен» оставляет первого.
 */
async function hirePair(api: APIRequestContext, origin: string, word: string) {
  await signIn(api, origin, 'erkin', DEMO_PASSWORD);
  const roles = (await (await api.get('/api/roles')).json()) as {
    items: { id: string; name: string }[];
  };
  const roleId = roles.items.find((r) => r.name === 'Бухгалтер')!.id;
  const made: { id: string; version: number; login: string }[] = [];
  for (const n of ['Первый', 'Второй']) {
    const login = uniqueLogin('e2e-pair');
    const res = await api.post('/api/staff', {
      headers: { origin },
      data: { fullName: `Сочетаев ${word} ${n}`, login, roleId },
    });
    expect(res.status(), await res.text()).toBe(201);
    made.push({
      ...((await res.json()) as { employee: { id: string; version: number } }).employee,
      login,
    });
  }
  const blocked = await api.post(`/api/staff/${made[1]!.id}/block`, {
    headers: { origin },
    data: { version: made[1]!.version },
  });
  expect(blocked.status(), await blocked.text()).toBe(200);
  await api.post('/api/auth/logout', { headers: { origin } });
  return made;
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

/**
 * Владелец создаёт роль «как у главного бухгалтера и ещё «Сотрудники и роли»» и сотрудника с ней;
 * сотрудник входит в браузере и меняет временный пароль. Действия над сотрудниками не трогают
 * владельца демо-организации, которым входят другие тесты.
 */
async function signInAsStaffManager(page: Page, origin: string, setup: APIRequestContext) {
  await signIn(setup, origin, 'erkin', DEMO_PASSWORD);
  const roles = (await (await setup.get('/api/roles')).json()) as {
    items: { id: string; name: string }[];
  };
  const chief = roles.items.find((r) => r.name === 'Главный бухгалтер')!.id;
  const made = await setup.post('/api/roles', {
    headers: { origin },
    data: { name: `Сквозная роль ${uniqueLogin('staff')}`, copyFromRoleId: chief },
  });
  expect(made.status(), await made.text()).toBe(201);
  const role = (await made.json()) as { id: string; version: number; permissions: string[] };
  const saved = await setup.patch(`/api/roles/${role.id}`, {
    headers: { origin },
    data: { version: role.version, permissions: [...role.permissions, 'staff'] },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  const login = uniqueLogin('e2e-staff');
  const hired = await setup.post('/api/staff', {
    headers: { origin },
    data: { fullName: 'Кадров Сквозной Тестович', login, roleId: role.id },
  });
  expect(hired.status(), await hired.text()).toBe(201);
  const { temporaryPassword } = (await hired.json()) as { temporaryPassword: string };
  await setup.post('/api/auth/logout', { headers: { origin } });
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
    await expect.poll(() => headers(page)).toEqual(['fullName', 'role', 'phone', 'active']);

    // «Столбцы»: скрыть «Телефон», «Роль» — наверх.
    await page.getByRole('button', { name: /^Столбцы/ }).click();
    const panel = page.getByRole('dialog', { name: 'Столбцы' });
    await panel.getByRole('checkbox', { name: 'Телефон' }).uncheck();
    // «Роль» — третья в общем порядке столбцов (после ФИО и скрытого «Логина»).
    for (let i = 0; i < 2; i++) await panel.getByRole('button', { name: 'Выше: Роль' }).click();
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

  test('группировка по двум полям показывает вложенные группы с числом записей; фильтр-плашка и поиск сочетаются', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    // Слово из букв без цифр: поиск ищет его в ФИО, а не в логине.
    const word = `Сквозь${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;
    const setup = await playwright.request.newContext({ baseURL });
    await hirePair(setup, origin, word);
    await setup.dispose();
    await signInAsNewChief(page, origin);
    await page.goto('/app/staff/list');
    const grid = page.locator('[data-grid]');
    await expect(grid.locator('[data-id]').first()).toBeVisible();
    // Фильтры — у заголовков таблицы: на телефоне переключаемся с карточек на таблицу.
    if (isMobile) await page.getByRole('button', { name: 'Вид списка: Таблица' }).click();

    // «Группировка»: роль, внутри — статус.
    await grid.locator('[data-grid-group-button]').click();
    const panel = page.getByRole('dialog', { name: 'Группировка' });
    await panel.getByLabel('Уровень 1').selectOption({ label: 'Роль' });
    await panel.getByLabel('Уровень 2 (внутри первого)').selectOption({ label: 'Статус' });
    const grouped = page.waitForResponse(listWith('group', 'role,active'));
    await panel.getByRole('button', { name: 'Применить' }).click();
    const all = (await (await grouped).json()) as StaffPage;
    expect(all.groups!.length).toBeGreaterThan(0);
    expect(all.groups!.reduce((n, g) => n + g.count, 0)).toBe(all.total);
    const accountants = all.groups!.find((g) => g.label === 'Бухгалтер')!;
    expect(accountants.sub!.reduce((n, g) => n + g.count, 0)).toBe(accountants.count);

    await expect(grid.locator('[data-chip="group"]')).toContainText('Группировка: Роль → Статус');
    await expect(grid.locator('[data-group-level="0"]')).toHaveCount(all.groups!.length);
    const path = `›${accountants.key}`;
    const top = grid.locator(`[data-group="${path}"]`);
    await expect(top).toContainText('Бухгалтер');
    await expect(top).toContainText(String(accountants.count));
    await expect(grid.locator(`[data-group^="${path}›"]`)).toHaveCount(accountants.sub!.length);
    await expect(grid.locator('[data-grid-footer]').first()).toContainText(
      `Групп: ${all.groups!.length} · записей: ${all.total}`,
    );

    // Фильтр у столбца «Статус»: только «Активен».
    await grid.getByRole('button', { name: 'Фильтр: Статус' }).click();
    const filter = page.getByRole('dialog', { name: 'Статус' });
    await filter.getByRole('checkbox', { name: 'Заблокирован' }).uncheck();
    const filtered = page.waitForResponse(
      (r) =>
        isStaffList(r) && (new URL(r.url()).searchParams.get('filters') ?? '').includes('active'),
    );
    await filter.getByRole('button', { name: 'Применить' }).click();
    expect((await filtered).status()).toBe(200);
    await expect(grid.locator('[data-chip="active"]')).toContainText('Статус: Активен');

    // Поиск по редкому слову вместе с фильтром: остаётся один активный бухгалтер.
    if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
    const searched = page.waitForResponse(listWith('q', word));
    await page.getByRole('searchbox').fill(word);
    const found = (await (await searched).json()) as StaffPage;
    expect(found.total).toBe(1);
    expect(found.items[0]!.fullName).toBe(`Сочетаев ${word} Первый`);
    expect(found.groups).toEqual([
      expect.objectContaining({
        label: 'Бухгалтер',
        count: 1,
        sub: [expect.objectContaining({ label: 'Активен', count: 1 })],
      }),
    ]);
    await expect(grid.locator('[data-chip="search"]')).toContainText(`Поиск: «${word}»`);
    await expect(grid.locator('[data-id]')).toHaveCount(1);
    await expect(grid.locator('[data-id]')).toContainText(`Сочетаев ${word} Первый`);

    // Без фильтра тот же поиск находит обоих — фильтр и поиск действительно сочетаются.
    const both = page.waitForResponse(
      (r) => listWith('q', word)(r) && !new URL(r.url()).searchParams.has('filters'),
    );
    await grid
      .locator('[data-chip="active"]')
      .getByRole('button', { name: 'Убрать фильтр' })
      .click();
    expect(((await (await both).json()) as StaffPage).total).toBe(2);
    await expect(grid.locator('[data-id]')).toHaveCount(2);

    // «Сбросить всё» убирает поиск и фильтры, группировка остаётся.
    await grid.locator('[data-grid-reset]').click();
    await expect(grid.locator('[data-chip="search"]')).toHaveCount(0);
    await expect(grid.locator('[data-chip="group"]')).toBeVisible();
  });
  test('(проверка задачи #16) на телефоне доступны поиск, фильтры и действия над записью без правого клика: «⋯» и долгое нажатие', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const word = `Действ${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;
    const setup = await playwright.request.newContext({ baseURL });
    const [first, second] = await hirePair(setup, origin, word);
    await signInAsStaffManager(page, origin, setup);
    await page.goto('/app/staff/list');
    const grid = page.locator('[data-grid]');
    await expect(grid.locator('[data-id]').first()).toBeVisible();
    // На телефоне список — плитками, на ПК — таблицей (прототип: вид по умолчанию по ширине).
    await expect(grid).toHaveAttribute('data-view', isMobile ? 'cards' : 'table');

    // Поиск: на телефоне — кнопкой «Поиск» в верхней панели.
    if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
    const searched = page.waitForResponse(listWith('q', word));
    await page.getByRole('searchbox').fill(word);
    expect(((await (await searched).json()) as StaffPage).total).toBe(2);
    const card = (id: string) => grid.locator(`[data-id="${id}"]`);
    await expect(card(first!.id)).toContainText('Активен');
    await expect(card(second!.id)).toContainText('Заблокирован');

    // Фильтр у столбца «Статус» (на телефоне — в виде «Таблица», как в прототипе); плашка фильтра
    // видна и в плитках, там же фильтр снимается.
    if (isMobile) await page.getByRole('button', { name: 'Вид списка: Таблица' }).click();
    await grid.getByRole('button', { name: 'Фильтр: Статус' }).click();
    const filter = page.getByRole('dialog', { name: 'Статус' });
    await filter.getByRole('checkbox', { name: 'Активен' }).uncheck();
    await filter.getByRole('button', { name: 'Применить' }).click();
    await expect(grid.locator('[data-id]')).toHaveCount(1);
    await expect(card(second!.id)).toBeVisible();
    if (isMobile) await page.getByRole('button', { name: 'Вид списка: Карточки' }).click();
    const chip = grid.locator('[data-chip="active"]');
    await expect(chip).toContainText('Статус: Заблокирован');
    await chip.getByRole('button', { name: 'Убрать фильтр' }).click();
    await expect(grid.locator('[data-id]')).toHaveCount(2);

    const menu = page.getByRole('menu', { name: 'Действия' });
    const toast = page.getByRole('status');

    // «⋯» на плитке или в строке: «Заблокировать» — после подтверждения.
    const more = card(first!.id).locator('[data-row-menu]');
    if (isMobile) {
      // Касание «⋯» на телефоне — не меньше 44 px: нажатие рядом с кнопкой попадает в неё.
      const box = await settledBox(more);
      expect(box.width).toBeLessThan(44);
      const hit = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-row-menu]') !== null,
        [box.x + box.width / 2, box.y - 8] as const,
      );
      expect(hit).toBe(true);
    }
    await more.click();
    await expect(menu.getByRole('menuitem')).toHaveText(['Сбросить пароль', 'Заблокировать']);
    await menu.getByRole('menuitem', { name: 'Заблокировать' }).click();
    const ask = page.getByRole('dialog', { name: /^Заблокировать / });
    await expect(ask).toContainText('Сотрудник не сможет войти. Его история сохранится.');
    await ask.getByRole('button', { name: 'Заблокировать' }).click();
    await expect(toast).toHaveText('Сотрудник заблокирован');
    await expect(card(first!.id)).toContainText('Заблокирован');

    // Меню без «⋯»: на телефоне — долгим нажатием на плитку, на ПК — правым кликом.
    const target = card(second!.id);
    if (isMobile) {
      const box = await settledBox(target.locator('dl'));
      await (await finger(page)).hold({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    } else {
      await target.click({ button: 'right' });
    }
    await menu.getByRole('menuitem', { name: 'Разблокировать' }).click();
    await expect(toast.filter({ hasText: 'Сотрудник разблокирован' })).toBeVisible();
    await expect(target).toContainText('Активен');
    // После долгого нажатия карточка записи не открылась: окон нет.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // «Сбросить пароль»: временный пароль показывается один раз, с ним сотрудник входит.
    await target.locator('[data-row-menu]').click();
    await menu.getByRole('menuitem', { name: 'Сбросить пароль' }).click();
    const reset = page.getByRole('dialog', { name: 'Пароль сброшен' });
    await expect(reset).toContainText(`Сочетаев ${word} Второй`);
    await expect(reset).toContainText('Передайте его сотруднику лично.');
    const password = (await reset.locator('[data-temporary-password]').textContent())!;
    await reset.getByRole('button', { name: 'Готово' }).click();
    await expect(reset).toHaveCount(0);
    const login = await setup.post('/api/auth/login', {
      headers: { origin },
      data: { login: second!.login, password },
    });
    expect(login.status(), await login.text()).toBe(200);
    expect(((await login.json()) as { user: { mustChangePassword: boolean } }).user).toMatchObject({
      mustChangePassword: true,
    });
    await setup.dispose();
  });
});
