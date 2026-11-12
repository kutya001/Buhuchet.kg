import { expect, test } from '@playwright/test';
import { ADMIN_PASSWORD, ownerPassword, platformAdmin, search, uniqueInn } from './admin';
import { signIn, uniqueLogin } from './helpers';

// Админка → «Организации» (ТЗ «Админка» → «Модуль организаций»; просьба заказчика 27.10.2026 —
// стенд, где администратор платформы создаёт организации): плашки, список всех организаций,
// «Новая организация» с владельцем, блокировка и разблокировка. Администратор свой на каждый тест и
// проект (`platformAdmin`).

const OWNER_PASSWORD = ownerPassword();

test.describe('Админка: организации', () => {
  test('администратор видит плашки и все организации; демо-организацию стенда заблокировать нельзя', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const orgs = (await (await page.request.get('/api/admin/organizations?size=all')).json()) as {
      items: { name: string; isDemo: boolean }[];
      total: number;
    };
    const demo = orgs.items.find((o) => o.isDemo)!;
    expect(demo).toBeTruthy();

    await page.goto('/app/orgs');
    const plates = page.locator('[data-plates]');
    // «Статистика» по умолчанию: на ПК показана, на телефоне скрыта (ТЗ «Статистика модуля»).
    if (isMobile) {
      await expect(plates).toHaveCount(0);
      await page.getByRole('button', { name: 'Статистика' }).click();
    }
    await expect(plates).toContainText('Организаций');
    await expect(plates).toContainText('активных');
    await expect(plates).toContainText('Контрагентов на платформе');
    await expect(plates).toContainText('Пользователей');
    await expect(plates).toContainText('Запросы на добавление');

    const rows = page.locator('[data-grid] [data-id]');
    await expect(rows.first()).toBeVisible();
    await search(page, isMobile, demo.name);
    const row = rows.filter({ hasText: demo.name });
    await expect(row.first()).toContainText('Активна');
    await row.first().locator('[data-row-menu]').click();
    const menu = page.getByRole('menu', { name: 'Действия' });
    await expect(menu.getByRole('menuitem', { name: 'Заблокировать' })).toBeDisabled();
    await expect(menu).toContainText('Демо-организация стенда');
    await page.keyboard.press('Escape');

    // Нажатие на плашку «Запросы на добавление» открывает «Справочники платформы» → «Запросы».
    await plates.getByRole('button', { name: /Запросы на добавление/ }).click();
    await expect(page).toHaveURL(/\/app\/pdicts\/requests$/);
  });

  test('«Новая организация»: ошибки под полями, занятые ИНН и логин; созданная — в списке, владелец входит временным паролем', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const demo = (
      (await (await page.request.get('/api/admin/organizations?size=all')).json()) as {
        items: { inn: string | null; isDemo: boolean }[];
      }
    ).items.find((o) => o.isDemo)!;
    await page.goto('/app/orgs');
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();

    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Новая организация' });
    await expect(form).toContainText('Создаётся вместе с учётной записью владельца');
    await expect(form).toContainText('копии шаблонов ролей «Главный бухгалтер» и «Бухгалтер»');
    await expect(form).toContainText(
      'показатели по умолчанию «Выручка», «Количество сотрудников» и «ФОТ»',
    );
    const password = form.getByLabel('Временный пароль');
    await expect(password).toHaveValue(/^Bh-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const temporaryPassword = await password.inputValue();

    const create = form.getByRole('button', { name: 'Создать' });
    await create.click();
    await expect(form).toContainText('Введите название');
    await expect(form).toContainText('ИНН — 14 цифр');
    await expect(form).toContainText('Введите ФИО');
    await expect(form).toContainText('Латиница, цифры, точка, дефис; от 3 символов');

    const name = `ОсОО «${uniqueLogin('Сквозная')}»`;
    await form.getByLabel('Название').fill(name);
    await form.getByLabel('ИНН').fill(demo.inn!);
    await form.getByLabel('ФИО владельца').fill('Сквозной Владелец Тестович');
    await form.getByLabel('Логин владельца').fill('erkin');
    await create.click();
    await expect(form).toContainText('Организация с таким ИНН уже есть');

    await form.getByLabel('ИНН').fill(uniqueInn());
    await create.click();
    await expect(form).toContainText('Такой логин уже занят на платформе');

    const owner = uniqueLogin('e2e-own');
    await form.getByLabel('Логин владельца').fill(owner.toUpperCase());
    await create.click();
    await expect(form).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Организация и владелец созданы' }),
    ).toBeVisible();

    await search(page, isMobile, name);
    const row = page.locator('[data-grid] [data-id]').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Активна');
    if (!isMobile) await expect(row).toContainText(owner);

    // Владелец входит временным паролем и обязан его сменить.
    const ownerApi = await playwright.request.newContext({ baseURL });
    const login = await signIn(ownerApi, origin, owner, temporaryPassword);
    expect(await login.json()).toMatchObject({
      user: { login: owner, mustChangePassword: true },
      employee: { roleName: 'Владелец организации' },
    });
    await ownerApi.dispose();
  });

  test('(прототип v74) администратор платформы создал организацию: на вкладке «Настройка показателей» модуля «Показатели» уже есть «Выручка», «Количество сотрудников» и «ФОТ»', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const owner = uniqueLogin('e2e-kpi');
    const created = await page.request.post('/api/admin/organizations', {
      headers: { origin },
      data: {
        name: `ОсОО «${uniqueLogin('Показатели')}»`,
        inn: uniqueInn(),
        ownerFullName: 'Показателева Сквозная',
        ownerLogin: owner,
        temporaryPassword: OWNER_PASSWORD,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    await page.request.post('/api/auth/logout', { headers: { origin } });

    // Владелец сменил временный пароль и включил «Показатели контрагентов».
    await signIn(page.request, origin, owner, OWNER_PASSWORD);
    const changed = await page.request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: OWNER_PASSWORD, newPassword: ownerPassword() },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const policy = (await (await page.request.get('/api/org/policy')).json()) as {
      version: number;
    };
    const on = await page.request.patch('/api/org/policy', {
      headers: { origin },
      data: { version: policy.version, features: { indicators: true } },
    });
    expect(on.status(), await on.text()).toBe(200);

    await page.goto('/app/kpi/setup');
    const items = page.locator('[data-kpi-indicator]');
    await expect(items).toHaveCount(3);
    expect(
      await items.evaluateAll((l) => l.map((e) => e.getAttribute('data-kpi-indicator'))),
    ).toEqual(['Выручка', 'Количество сотрудников', 'ФОТ']);
  });

  test('блокировка организации: владелец при входе видит сообщение о блокировке; разблокировка возвращает вход', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const admin = await platformAdmin(page.request, origin);
    const owner = uniqueLogin('e2e-blk');
    const name = `ОсОО «${uniqueLogin('Блокируемая')}»`;
    const created = await page.request.post('/api/admin/organizations', {
      headers: { origin },
      data: {
        name,
        inn: uniqueInn(),
        ownerFullName: 'Блокова Сквозная',
        ownerLogin: owner,
        temporaryPassword: OWNER_PASSWORD,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const menu = page.getByRole('menu', { name: 'Действия' });
    const toast = page.getByRole('status');
    const findRow = async () => {
      await page.goto('/app/orgs');
      await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
      await search(page, isMobile, name);
      const row = page.locator('[data-grid] [data-id]').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      return row;
    };

    const row = await findRow();
    await row.locator('[data-row-menu]').click();
    await menu.getByRole('menuitem', { name: 'Заблокировать' }).click();
    const ask = page.getByRole('dialog', { name: `Заблокировать ${name}?` });
    await expect(ask).toContainText('Никто из сотрудников организации не сможет войти.');
    await ask.getByRole('button', { name: 'Заблокировать' }).click();
    await expect(toast.filter({ hasText: 'Организация заблокирована' })).toBeVisible();
    await expect(row).toContainText('Заблокирована');

    // Владелец заблокированной организации на странице входа видит сообщение о блокировке.
    await page.request.post('/api/auth/logout', { headers: { origin } });
    await page.goto('/login');
    await page.getByLabel('Логин').fill(owner);
    await page.getByLabel('Пароль', { exact: true }).fill(OWNER_PASSWORD);
    await Promise.all([
      page.waitForResponse('**/api/auth/login'),
      page.getByRole('button', { name: 'Войти' }).click(),
    ]);
    await expect(
      page.getByText(/заблокирована\. Обратитесь к администратору платформы\./),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // Администратор разблокирует — владелец снова входит.
    await signIn(page.request, origin, admin, ADMIN_PASSWORD);
    const again = await findRow();
    await again.locator('[data-row-menu]').click();
    await menu.getByRole('menuitem', { name: 'Разблокировать' }).click();
    await expect(toast.filter({ hasText: 'Организация разблокирована' })).toBeVisible();
    await expect(again).toContainText('Активна');
    await page.request.post('/api/auth/logout', { headers: { origin } });
    await signIn(page.request, origin, owner, OWNER_PASSWORD);
  });

  test('(приёмка, прототип v83) карточка организации: девять вкладок только для просмотра, кнопки шапки, ссылки на карточку пользователя и #orgs/<адрес>', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const owner = uniqueLogin('e2e-oc');
    const name = `ОсОО «${uniqueLogin('Карточная')}»`;
    const inn = uniqueInn();
    const created = await page.request.post('/api/admin/organizations', {
      headers: { origin },
      data: {
        name,
        inn,
        ownerFullName: 'Карточкин Сквозной',
        ownerLogin: owner,
        temporaryPassword: OWNER_PASSWORD,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const orgs = (await (await page.request.get('/api/admin/organizations?size=all')).json()) as {
      items: { name: string; slug: string }[];
    };
    const slug = orgs.items.find((o) => o.name === name)!.slug;
    const toast = page.getByRole('status');

    // Нажатие на строку списка открывает карточку; в меню строки первым — «Открыть карточку».
    await page.goto('/app/orgs');
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
    await search(page, isMobile, name);
    const row = page.locator('[data-grid] [data-id]').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await row.locator('[data-row-menu]').click();
    await expect(
      page.getByRole('menu', { name: 'Действия' }).getByRole('menuitem').first(),
    ).toHaveText('Открыть карточку');
    await page.keyboard.press('Escape');
    await row.getByText(name).click();
    const card = page.getByRole('dialog', { name });
    const openTab = async (tab: string) => {
      if (isMobile) {
        await card.getByRole('tab', { selected: true }).click();
        await page.getByRole('menu').getByRole('menuitem', { name: tab }).click();
      } else {
        await card.getByRole('tab', { name: tab }).click();
      }
      await expect(card.getByRole('tab', { selected: true })).toContainText(tab);
    };

    // Шапка: ИНН, адрес страницы, состояние, кнопки — как в меню строки и «Сбросить пароль владельцу».
    await expect(card.locator('[data-org-states]')).toHaveText('Активна');
    await expect(card).toContainText(inn);
    await expect(card).toContainText(`buhuchet.kg/${slug}`);
    await expect(card).toContainText('подключена');
    await expect(card.locator('[data-org-action="block"]')).toBeVisible();
    await expect(card.locator('[data-org-action="reset-owner"]')).toBeVisible();
    await expect(card).toContainText(
      'Только просмотр: администратор не меняет контрагентов, отчёты и настройки организации',
    );

    // «Основное»: реквизиты, владелец, заявка, блокировки.
    await expect(card).toContainText('На платформе');
    await expect(card.locator('[data-org-owner]')).toHaveText(owner);
    await expect(card).toContainText('создана без заявки');
    await expect(card.locator('[data-org-blocks]')).toHaveText('Не блокировалась');

    // «Сводка»: плитки с числами; нажатие открывает вкладку.
    await openTab('Сводка');
    const summary = card.locator('[data-org-summary]');
    await expect(summary).toContainText('активных · заблокировано 0');
    await expect(summary).toContainText('Входы за 30 дней');
    await summary.getByRole('button', { name: /Сотрудники/ }).click();
    await expect(card.getByRole('tab', { selected: true })).toContainText('Сотрудники');

    // «Сотрудники»: строка открывает карточку пользователя, организация в ней — карточку организации.
    const staff = card.locator('[data-org-staff]');
    await expect(staff).toContainText(owner);
    await expect(staff).toContainText('Владелец организации');
    await expect(staff).toContainText('Не сменил временный пароль');
    await staff.getByText('Карточкин Сквозной').click();
    const account = page.getByRole('dialog', { name: 'Карточкин Сквозной' });
    await expect(account.locator('[data-account-states]')).toContainText(
      'Не сменил временный пароль',
    );
    // Карточка организации открывается заново — поверх карточки пользователя.
    await account.getByRole('button', { name, exact: true }).first().click();
    await expect(card.locator('[data-org-states]')).toHaveText('Активна');
    await expect(card.getByRole('tab', { selected: true })).toContainText('Основное');

    // Остальные вкладки — только просмотр.
    await openTab('Контрагенты');
    await expect(card.locator('[data-org-contractors]')).toContainText(
      'Только просмотр: изменить контрагентов организации из Админки нельзя.',
    );
    await openTab('Отчёты');
    await expect(card).toContainText('По месяцам и видам отчётов');
    await expect(card.locator('[data-org-overdue]')).toContainText('Просроченных отчётов нет');
    await openTab('Деньги');
    await expect(card.locator('[data-org-fee="year"]')).toContainText('Начислено');
    await expect(card).toContainText('Налоги контрагентов по месяцам');
    await openTab('Настройки');
    const settings = card.locator('[data-org-settings]');
    await expect(settings).toContainText('Учётная политика');
    await expect(settings).toContainText('Включённые модули и функции');
    await expect(settings).toContainText('Подключённые виды отчётов');
    await expect(settings).toContainText('Роли и права · 3');
    await expect(settings).toContainText('Telegram-напоминания');
    await expect(settings.locator('button, input, select, textarea')).toHaveCount(0);
    await openTab('Файлы');
    await expect(card.locator('[data-org-files]')).toContainText('Файлов пока нет');

    // Кнопки шапки: блокировка после вопроса, разблокировка сразу; причины — в «Основном».
    await card.locator('[data-org-action="block"]').click();
    const ask = page.getByRole('dialog', { name: `Заблокировать ${name}?` });
    await ask.getByRole('button', { name: 'Заблокировать' }).click();
    await expect(toast.filter({ hasText: 'Организация заблокирована' })).toBeVisible();
    await expect(card.locator('[data-org-states]')).toHaveText('Заблокирована администратором');
    await openTab('Основное');
    await expect(card.locator('[data-org-blocks]')).toContainText(
      'Организация заблокирована: Заблокирована администратором',
    );
    await card.locator('[data-org-action="unblock"]').click();
    await expect(toast.filter({ hasText: 'Организация разблокирована' })).toBeVisible();
    await expect(card.locator('[data-org-states]')).toHaveText('Активна');
    await expect(card.locator('[data-org-blocks]')).toContainText(
      'Организация разблокирована (была: Заблокирована администратором)',
    );

    // «Сбросить пароль владельцу» — то же окно, что у «Сбросить пароль» учётной записи.
    await card.locator('[data-org-action="reset-owner"]').click();
    const done = page.getByRole('dialog', { name: 'Пароль сброшен' });
    await expect(done).toContainText(owner);
    await done.getByRole('button', { name: 'Готово' }).click();
    await expect(done).toBeHidden();

    // «История»: создание, блокировки и два открытия карточки (из списка и из карточки пользователя);
    // перечитывание открытой карточки после действий новой записи не даёт.
    await openTab('История');
    await expect(card.getByText('Организация создана вместе с владельцем')).toHaveCount(1);
    await expect(card.getByText('Открыта карточка организации')).toHaveCount(2);
    await expect(card.locator('[data-timeline-item]').first()).toContainText(
      'Организация разблокирована',
    );
    await card.getByRole('button', { name: 'Готово' }).click();
    await expect(card).toBeHidden();
    await account.getByRole('button', { name: 'Готово' }).click();
    await expect(account).toBeHidden();

    // Ссылка #orgs/<адрес организации> открывает карточку; нет такого адреса — уведомление.
    await page.goto(`/app/orgs#orgs/${slug}`);
    await expect(card.locator('[data-org-states]')).toHaveText('Активна');
    await expect(page).toHaveURL(/\/app\/orgs(\/list)?$/);
    await page.goto('/app/orgs#orgs/net-takogo-adresa');
    await expect(toast.filter({ hasText: 'Организация с таким адресом не найдена' })).toBeVisible();
    await expect(page.locator('[data-org-card]')).toHaveCount(0);
  });
});
