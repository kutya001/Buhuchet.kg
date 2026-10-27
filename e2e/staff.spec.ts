import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

// Сотрудники и роли через настоящий сайт (Next.js → API): владелец демо-организации создаёт
// сотрудника, тот входит временным паролем и обязан его сменить; заблокированный не входит (методы
// API, задача #10). Экраны (задача #18): «Новый сотрудник», карточка сотрудника с «Действиями»,
// «Сменить роль», вкладка «Роли», карточка и форма роли; «Изменить» сотрудника и «Удалить» роль
// (docs/deviations.md, п. 16). Логины свои на каждый запуск и проект (ПК и телефон).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo';

const uniqueLogin = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

async function signIn(api: APIRequestContext, origin: string, login: string, password: string) {
  const res = await api.post('/api/auth/login', { headers: { origin }, data: { login, password } });
  expect(res.status(), await res.text()).toBe(200);
  return res;
}

/** Владелец демо-организации создаёт сотрудника с ролью «Бухгалтер». */
async function hire(
  owner: APIRequestContext,
  origin: string,
  login: string,
  fullName = 'Проверкин Сквозной Тестович',
) {
  const roles = await owner.get('/api/roles?size=all');
  expect(roles.status()).toBe(200);
  const { items } = (await roles.json()) as { items: { id: string; name: string }[] };
  const roleId = items.find((r) => r.name === 'Бухгалтер')!.id;
  const res = await owner.post('/api/staff', {
    headers: { origin },
    data: { fullName, login, roleId },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as {
    employee: { id: string; version: number; active: boolean };
    temporaryPassword: string;
  };
}

test.describe('Этап 1: сотрудники и роли (API)', () => {
  test('владелец создаёт сотрудника с логином и временным паролем; сотрудник входит и обязан сменить пароль', async ({
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    const employee = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
    const login = uniqueLogin('e2e-new');
    const { temporaryPassword } = await hire(owner, origin, login);

    const first = await signIn(employee, origin, login, temporaryPassword);
    expect(await first.json()).toMatchObject({
      user: { login, mustChangePassword: true },
      employee: { roleName: 'Бухгалтер' },
    });
    const locked = await employee.get('/api/staff');
    expect(locked.status()).toBe(403);
    expect(await locked.json()).toMatchObject({ error: { code: 'password_change_required' } });

    const changed = await employee.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(changed.status()).toBe(200);
    const me = await employee.get('/api/auth/me');
    expect(await me.json()).toMatchObject({ user: { login, mustChangePassword: false } });
    await owner.dispose();
    await employee.dispose();
  });

  test('заблокированный сотрудник не может войти, его сеансы закрыты', async ({
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    const employee = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
    const login = uniqueLogin('e2e-block');
    const created = await hire(owner, origin, login);
    await signIn(employee, origin, login, created.temporaryPassword);
    expect((await employee.get('/api/auth/me')).status()).toBe(200);

    const blocked = await owner.post(`/api/staff/${created.employee.id}/block`, {
      headers: { origin },
      data: { version: created.employee.version },
    });
    expect(blocked.status()).toBe(200);
    expect(await blocked.json()).toMatchObject({ active: false });

    expect((await employee.get('/api/auth/me')).status()).toBe(401);
    const again = await employee.post('/api/auth/login', {
      headers: { origin },
      data: { login, password: created.temporaryPassword },
    });
    expect(again.status()).toBe(403);
    expect(await again.json()).toMatchObject({ error: { code: 'employee_blocked' } });
    await owner.dispose();
    await employee.dispose();
  });
});

/** Подпись выбранного значения выпадающего списка. */
const selected = (select: Locator) =>
  expect.poll(() => select.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.text));

/** Выбрать способ в «+ Добавить» модуля. */
async function add(page: Page, name: string) {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menu', { name: 'Добавить' }).getByRole('menuitem', { name }).click();
}

/** Слово для ФИО, своё на каждый запуск: по нему запись находится общим поиском. */
const randomWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

test.describe('Этап 1: сотрудники и роли (экраны)', () => {
  test('«Новый сотрудник»: ошибки под полями, занятый логин; создан — карточка, «Действия» и «Сменить роль»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    // Своё слово в ФИО на каждый запуск: по нему сотрудник находится общим поиском (логин на
    // телефоне в видимых столбцах не показан, а поиск — по видимым).
    const word = randomWord('Нов');
    const fullName = `Новиков ${word} Тестович`;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/staff/list');
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();

    await add(page, 'Сотрудник');
    const form = page.getByRole('dialog', { name: 'Новый сотрудник' });
    await expect(form).toContainText('Вход по логину и паролю, без почты');
    await expect(form).toContainText('При первом входе сотруднику предложат привязать Telegram');
    // Временный пароль уже подставлен; роль — из учётной политики («Бухгалтер»).
    const password = form.getByLabel('Временный пароль');
    await expect(password).toHaveValue(/^Bh-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const temporaryPassword = await password.inputValue();
    await selected(form.getByLabel(/^Роль/)).toBe('Бухгалтер');
    await expect(form.getByLabel(/^Роль/).locator('option')).not.toContainText([
      'Владелец организации',
    ]);

    const create = form.getByRole('button', { name: 'Создать' });
    await create.click();
    await expect(form).toContainText('Введите фамилию и имя');
    await expect(form).toContainText('Латиница, цифры, точка, дефис; от 3 символов');

    await form.getByLabel('ФИО').fill(fullName);
    await form.getByLabel('Логин').fill('erkin');
    // Номер — по маске страны: пробелы ставятся сами, неполный номер — ошибка.
    const phone = form.getByLabel('Телефон');
    await phone.fill('55512');
    await expect(phone).toHaveValue('555 12');
    await create.click();
    await expect(form).toContainText('Номер — 9 цифр');
    await phone.fill('555100200999');
    await expect(phone).toHaveValue('555 100 200');
    await create.click();
    await expect(form).toContainText('Такой логин уже занят на платформе');
    await expect(form).not.toContainText('Номер — 9 цифр');

    const login = uniqueLogin('e2e-ui');
    await form.getByLabel('Логин').fill(login.toUpperCase());
    await create.click();
    await expect(form).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Сотрудник создан' })).toBeVisible();

    // Новый сотрудник в списке; строка открывает его карточку.
    await search(page, isMobile, word);
    const row = page.locator('[data-grid] [data-id]').filter({ hasText: fullName });
    await expect(row).toHaveCount(1);
    await row.getByText(fullName).click();
    const card = page.getByRole('dialog', { name: fullName });
    await expect(card).toContainText('Бухгалтер');
    await expect(card).toContainText(login);
    await expect(card).toContainText('не привязан');
    await expect(card).toContainText('ещё не входил');
    await expect(card).toContainText('Активен');
    if (isMobile) {
      // Пары «подпись — значение» на телефоне: два коротких значения подряд — в строку, длинное и
      // оставшееся без пары — во всю ширину.
      const item = (label: string) =>
        card.locator('dl > div', {
          has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }),
        });
      await expect(item('Логин')).toHaveAttribute('data-pack', 'full');
      await expect(item('Telegram')).toHaveAttribute('data-pack', 'half');
      await expect(item('Последний вход')).toHaveAttribute('data-pack', 'half');
      await expect(item('Статус')).toHaveAttribute('data-pack', 'full');
    }
    await expect(card.getByRole('link', { name: '+996 555 100 200' })).toHaveAttribute(
      'href',
      'tel:+996555100200',
    );
    await expect(card.getByRole('link', { name: 'Написать в WhatsApp' })).toHaveAttribute(
      'href',
      'https://wa.me/996555100200',
    );

    // «Действия» — пункты меню списка без «Открыть карточку».
    await card.getByRole('button', { name: 'Действия' }).click();
    const menu = page.getByRole('menu', { name: 'Действия' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Изменить',
      'Сменить роль',
      'Сбросить пароль',
      'Заблокировать',
    ]);
    await menu.getByRole('menuitem', { name: 'Сменить роль' }).click();
    const change = page.getByRole('dialog', { name: 'Роль сотрудника' });
    await expect(change).toContainText(fullName);
    await change.getByLabel('Роль', { exact: true }).selectOption({ label: 'Главный бухгалтер' });
    await change.getByRole('button', { name: 'Сохранить' }).click();
    await expect(change).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Роль изменена' })).toBeVisible();
    await expect(card).toContainText('Главный бухгалтер');

    // Вкладка «Контрагенты»: закреплённых пока нет. На телефоне вкладки — список под текущей.
    if (isMobile) {
      await card.getByRole('tab', { selected: true }).click();
      await page.getByRole('menu').getByRole('menuitem', { name: 'Контрагенты' }).click();
    } else {
      await card.getByRole('tab', { name: 'Контрагенты' }).click();
    }
    await expect(card.getByRole('tab', { selected: true })).toContainText('Контрагенты');
    await expect(card).toContainText('Закреплено контрагентов: 0');
    await expect(card).toContainText('Нет закреплённых контрагентов');

    // С подставленным паролем сотрудник входит, роль — новая.
    const res = await page.request.post('/api/auth/login', {
      headers: { origin },
      data: { login, password: temporaryPassword },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toMatchObject({
      user: { login, mustChangePassword: true },
      employee: { roleName: 'Главный бухгалтер' },
    });
  });

  test('«Изменить» сотрудника: ошибки под полями; новые ФИО и телефон видны в списке и в карточке', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const word = randomWord('Изм');
    const before = `Правкин ${word} Тестович`;
    const after = `Исправкин ${word} Тестович`;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const { employee } = await hire(page.request, origin, uniqueLogin('e2e-edit'), before);
    await page.goto('/app/staff/list');
    await search(page, isMobile, word);
    const row = page.locator(`[data-grid] [data-id="${employee.id}"]`);
    await expect(row).toContainText(before);

    await row.locator('[data-row-menu]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: 'Изменить' })
      .click();
    const form = page.getByRole('dialog', { name: 'Изменить сотрудника' });
    const save = form.getByRole('button', { name: 'Сохранить' });
    const fio = form.getByLabel('ФИО');
    await expect(fio).toHaveValue(before);
    await fio.fill('');
    await save.click();
    await expect(form).toContainText('Введите фамилию и имя');
    await fio.fill(after);
    const phone = form.getByLabel('Телефон');
    await phone.fill('70011');
    await save.click();
    await expect(form).toContainText('Номер — 9 цифр');
    await phone.fill('700111222');
    await expect(phone).toHaveValue('700 111 222');
    await save.click();
    await expect(form).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Данные сотрудника сохранены' }),
    ).toBeVisible();

    // Новые ФИО — в строке списка; карточка — с новыми ФИО и телефоном.
    await expect(row).toContainText(after);
    await row.getByText(after).click();
    const card = page.getByRole('dialog', { name: after });
    await expect(card.getByRole('link', { name: '+996 700 111 222' })).toHaveAttribute(
      'href',
      'tel:+996700111222',
    );
    const saved = (await (await page.request.get(`/api/staff/${employee.id}`)).json()) as {
      fullName: string;
      phone: string | null;
    };
    expect(saved).toMatchObject({ fullName: after, phone: '+996700111222' });
  });

  test('«Удалить» роль: роль без сотрудников удаляется после вопроса; у роли владельца и роли с сотрудниками пункт недоступен с причиной', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const name = `Роль ${uniqueLogin('e2e-del')}`;
    const created = await page.request.post('/api/roles', { headers: { origin }, data: { name } });
    expect(created.status(), await created.text()).toBe(201);
    await page.goto('/app/staff/roles');
    const rows = page.locator('[data-grid] [data-id]');
    const menu = page.getByRole('menu', { name: 'Действия' });
    await expect(rows.first()).toBeVisible();

    // Причины недоступного пункта видны в меню; меню закрывается Esc. Ролей в демо-организации много —
    // нужная находится общим поиском (на телефоне поле открывается кнопкой один раз).
    if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
    const find = (text: string) => page.getByRole('searchbox').first().fill(text);
    const refused = async (role: string, reason: string) => {
      await find(role);
      const row = rows.filter({ has: page.getByText(role, { exact: true }) });
      await expect(row).toHaveCount(1);
      await row.locator('[data-row-menu]').click();
      await expect(menu.getByRole('menuitem', { name: 'Удалить' })).toBeDisabled();
      await expect(menu).toContainText(reason);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    };
    await refused('Владелец организации', 'Роль владельца не удаляется');
    await refused('Бухгалтер', 'Роль назначена сотрудникам: сначала смените им роль');

    await find(name);
    const row = rows.filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await row.locator('[data-row-menu]').click();
    await menu.getByRole('menuitem', { name: 'Удалить' }).click();
    const ask = page.getByRole('dialog', { name: `Удалить роль «${name}»?` });
    await expect(ask).toContainText('Роль никому не назначена.');
    await ask.getByRole('button', { name: 'Удалить' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Роль удалена' })).toBeVisible();
    await expect(row).toHaveCount(0);
    const roles = (await (await page.request.get('/api/roles?size=all')).json()) as {
      items: { name: string }[];
    };
    expect(roles.items.map((r) => r.name)).not.toContain(name);
  });

  test('форма роли: группы модулей с описанием под каждым правом, «Выбрать все» в «Задачах» отмечает три права, на телефоне группы свёрнуты и показывают «Выбрано N из M»', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const catalog = (await (await page.request.get('/api/permissions')).json()) as {
      items: { id: string; group: string; name: string; description: string }[];
    };
    await page.goto('/app/staff/roles');
    await expect(
      page.getByText('Права выдаются через роли: сотрудник → роль → права.'),
    ).toBeVisible();
    // Счётчики вкладок, как в прототипе: активных сотрудников и ролей.
    const tabs = page.locator('[data-tabrow]');
    await expect(tabs.locator('a[href="/app/staff/list"]')).toHaveText(/^Сотрудники\s*[1-9]\d*$/);
    await expect(tabs.locator('a[href="/app/staff/roles"]')).toHaveText(/^Роли\s*[1-9]\d*$/);
    // Те же числа — у вкладок модуля в левой панели (на ПК).
    if (!isMobile) {
      await page.getByRole('button', { name: 'Раскрыть вкладки: Сотрудники' }).click();
      await expect(page.locator('aside a[href="/app/staff/roles"]')).toHaveText(
        /^Роли\s*[1-9]\d*$/,
      );
    }

    await test.step('роль владельца — «все права», «Изменить» недоступно, в карточке права не меняются', async () => {
      await search(page, isMobile, 'Владелец организации');
      const owner = page
        .locator('[data-grid] [data-id]')
        .filter({ hasText: 'Владелец организации' });
      await expect(owner).toHaveCount(1);
      await expect(owner).toContainText('все права');
      await expect(owner).toContainText('39 из 39');
      await owner.locator('[data-row-menu]').click();
      const menu = page.getByRole('menu', { name: 'Действия' });
      const edit = menu.getByRole('menuitem', { name: 'Изменить' });
      await expect(edit).toBeDisabled();
      await expect(menu).toContainText('Права владельца не меняются');
      await menu.getByRole('menuitem', { name: 'Открыть' }).click();
      const card = page.getByRole('dialog', { name: 'Владелец организации' });
      await expect(card).toContainText('У владельца организации все права, они не меняются.');
      await expect(card.getByRole('button', { name: 'Изменить' })).toHaveCount(0);
      await expect(card.locator('[data-permission]')).toHaveCount(isMobile ? 0 : 39);
      await card.getByRole('button', { name: 'Готово' }).click();
      await expect(card).toBeHidden();
    });

    // Новая роль — копия «Бухгалтера» (задач у него нет): после «Создать» сразу её форма прав.
    const name = `Роль ${uniqueLogin('e2e')}`;
    await add(page, 'Роль');
    const create = page.getByRole('dialog', { name: 'Новая роль' });
    await create.getByRole('button', { name: 'Создать' }).click();
    await expect(create).toContainText('Введите название');
    await create.getByLabel('Название').fill(name);
    await selected(create.getByLabel('Скопировать права из')).toBe('Бухгалтер');
    await create.getByRole('button', { name: 'Создать' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Роль создана: отметьте её права' }),
    ).toBeVisible();
    const form = page.getByRole('dialog', { name: 'Права роли' });
    await expect(form).toContainText(name);
    await expect(form.getByLabel('Название роли')).toHaveValue(name);
    await expect(page).toHaveURL(/\/app\/staff\/roles$/);

    // Группы — в порядке меню модулей, «Общие права» последней.
    const groups = form.locator('[data-permission-group]');
    await expect(groups).toHaveCount(12);
    expect(
      await groups.evaluateAll((els) => els.map((el) => el.getAttribute('data-permission-group'))),
    ).toEqual([
      'cps',
      'reports',
      'fin',
      'projects',
      'kpi',
      'tasks',
      'files',
      'staff',
      'dicts',
      'kb',
      'org',
      'common',
    ]);
    await expect(groups.last()).toContainText('Общие права');
    const tasks = form.locator('[data-permission-group="tasks"]');
    if (isMobile) {
      // На телефоне все группы свёрнуты, в заголовке — «Выбрано N из M».
      await expect(form.locator('[data-permission-group][data-open]')).toHaveCount(0);
      await expect(form.locator('[data-permission]')).toHaveCount(0);
      await expect(form.locator('[data-permission-group="cps"] [data-group-count]')).toHaveText(
        'Выбрано 2 из 9',
      );
      await expect(tasks.locator('[data-group-count]')).toHaveText('Выбрано 0 из 3');
      await tasks.getByRole('button', { name: 'Задачи' }).click();
      await expect(tasks).toHaveAttribute('data-open', '');
    } else {
      // На ПК все группы раскрыты; шире 1100 px — в две колонки.
      await expect(form.locator('[data-permission-group][data-open]')).toHaveCount(12);
      // Обе рамки — в одном кадре: окно появляется с масштабом (bu-pop), и две отдельные
      // boundingBox() на медленной машине попадают в разные кадры анимации.
      await expect
        .poll(() =>
          groups.evaluateAll((els) => {
            const [a, b] = els.slice(0, 2).map((el) => el.getBoundingClientRect());
            return { sameRow: Math.abs(a!.top - b!.top) <= 1, side: b!.left > a!.right };
          }),
        )
        .toEqual({ sameRow: true, side: true });
      await expect(form.locator('[data-permission]')).toHaveCount(39);
    }
    // Под каждым правом — что оно разрешает (справочник «Права ролей»).
    for (const p of catalog.items.filter((i) => i.group === 'tasks')) {
      const row = tasks.locator(`[data-permission="${p.id}"]`);
      await expect(row).toContainText(p.name);
      await expect(row).toContainText(p.description);
      await expect(row.getByRole('checkbox')).not.toBeChecked();
    }
    await tasks.getByRole('button', { name: 'Выбрать все' }).click();
    await expect(tasks.locator('[data-group-count]')).toHaveText('Выбрано 3 из 3');
    for (const id of ['tasksCreate', 'tasksAll', 'tasksConfirm']) {
      await expect(tasks.locator(`[data-permission="${id}"]`).getByRole('checkbox')).toBeChecked();
    }
    await expect(tasks.getByRole('button', { name: 'Снять все' })).toBeVisible();

    // Без «Просматривать проекты» остальные права группы закрыты: «Сначала дайте просмотр».
    const projects = form.locator('[data-permission-group="projects"]');
    if (isMobile) await projects.getByRole('button', { name: 'Проекты контрагентов' }).click();
    await projects.locator('[data-permission="projView"]').getByRole('checkbox').uncheck();
    const manage = projects.locator('[data-permission="projects"]');
    await expect(manage.getByRole('checkbox')).toBeDisabled();
    await expect(manage).toContainText('Сначала дайте просмотр');
    await expect(form.locator('[data-role-count]')).toHaveText('Выбрано прав: 16 из 39');

    // Область группы: «Все контрагенты» для отчётов.
    const reports = form.locator('[data-permission-group="reports"]');
    await reports.getByRole('button', { name: 'Все контрагенты' }).click();
    await expect(reports.getByRole('button', { name: 'Все контрагенты' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await form.getByRole('button', { name: 'Сохранить' }).click();
    await expect(form).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Права роли сохранены' }),
    ).toBeVisible();
    const roles = (await (await page.request.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string; permissionCount: number }[];
    };
    const saved = roles.items.find((r) => r.name === name)!;
    expect(saved.permissionCount).toBe(16);
    const role = (await (await page.request.get(`/api/roles/${saved.id}`)).json()) as {
      permissions: string[];
      scopes: Record<string, string>;
    };
    expect(role.permissions).toEqual(
      expect.arrayContaining(['tasksCreate', 'tasksAll', 'tasksConfirm']),
    );
    expect(role.permissions).not.toContain('projView');
    expect(role.scopes.reports).toBe('all');

    await test.step('сотрудник с этой ролью не видит «Проекты» в меню', async () => {
      const owner = await playwright.request.newContext({ baseURL });
      await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
      const login = uniqueLogin('e2e-role');
      const hired = await owner.post('/api/staff', {
        headers: { origin },
        data: { fullName: 'Ролев Сквозной Тестович', login, roleId: saved.id },
      });
      expect(hired.status(), await hired.text()).toBe(201);
      const { temporaryPassword } = (await hired.json()) as { temporaryPassword: string };
      await owner.dispose();
      await page.goto('about:blank');
      await page.context().clearCookies();
      await signIn(page.request, origin, login, temporaryPassword);
      const changed = await page.request.post('/api/auth/password', {
        headers: { origin },
        data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
      });
      expect(changed.status()).toBe(200);
      await page.goto('/app');
      await expect(page).toHaveURL(/\/app\/home\/today$/);
      await expect(page.locator('aside a[href^="/app/reports"]').first()).toBeAttached();
      await expect(page.locator('aside a[href^="/app/projects"]')).toHaveCount(0);
      await expect(page.locator('aside a[href^="/app/tasks"]').first()).toBeAttached();
    });
  });
});
