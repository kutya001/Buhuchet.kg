import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ownerPassword, platformAdmin, search, uniqueInn } from './admin';
import {
  botMessages,
  DEMO_PASSWORD,
  hire,
  linkTelegram,
  newOrgOwner,
  signIn,
  uniqueChat,
  uniqueLogin,
} from './helpers';

// Админка → «Учётные записи» (ТЗ «Админка» → «Модуль учётных записей»; прототип
// admin/accounts-orgs.js): список всех пользователей платформы, сброс пароля, блокировка и
// разблокировка; сотрудник, которого заблокировал владелец, — своим статусом (docs/deviations.md,
// п. 49, решение А). Администратор свой на каждый тест и проект (`platformAdmin`).

const OWNER_PASSWORD = ownerPassword();

/** Новая организация с владельцем (временный пароль `OWNER_PASSWORD`); вход — в `api` администратора. */
async function newOrg(api: APIRequestContext, origin: string) {
  const owner = uniqueLogin('e2e-acc');
  const name = `ОсОО «${uniqueLogin('Учётная')}»`;
  const created = await api.post('/api/admin/organizations', {
    headers: { origin },
    data: {
      name,
      inn: uniqueInn(),
      ownerFullName: 'Учётов Сквозной Тестович',
      ownerLogin: owner,
      temporaryPassword: OWNER_PASSWORD,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return { owner, name };
}

/** Строка учётной записи в списке: поиск по логину, ровно одна строка. */
async function accountRow(page: Page, isMobile: boolean, login: string) {
  await page.goto('/app/accounts');
  await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
  await search(page, isMobile, login);
  const row = page.locator('[data-grid] [data-id]').filter({ hasText: login });
  await expect(row).toHaveCount(1);
  return row;
}

test.describe('Админка: учётные записи', () => {
  test('список всех пользователей платформы: организация, ФИО, роль, статус; своя строка — «Это вы»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const admin = await platformAdmin(page.request, origin);
    const { owner, name } = await newOrg(page.request, origin);

    const row = await accountRow(page, isMobile, owner);
    await expect(row).toContainText('Учётов Сквозной Тестович');
    await expect(row).toContainText(name);
    await expect(row).toContainText('Владелец организации');
    await expect(row).toContainText('Активен');
    await expect(page.locator('[data-grid]')).toContainText('Последний вход');

    // Администратор платформы — тоже в списке: организация «Платформа». В меню записи на своей
    // строке — «Открыть карточку» и недоступное «Это вы» (прототип v83).
    await search(page, isMobile, admin);
    const self = page.locator('[data-grid] [data-id]').filter({ hasText: admin });
    await expect(self).toHaveCount(1);
    await expect(self).toContainText('Администратор платформы');
    await expect(self).toContainText('Платформа');
    await self.locator('[data-row-menu]').click();
    const menu = page.getByRole('menu', { name: 'Действия' });
    await expect(menu.getByRole('menuitem', { name: 'Открыть карточку' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Это вы' })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: 'Заблокировать' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('(проверка задачи #91) блокировка: заблокированный пользователь не входит, его сеанс закрыт; разблокировка возвращает вход', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const { owner } = await newOrg(page.request, origin);
    const user = await playwright.request.newContext({ baseURL });
    await signIn(user, origin, owner, OWNER_PASSWORD);
    expect((await user.get('/api/auth/me')).status()).toBe(200);
    const menu = page.getByRole('menu', { name: 'Действия' });
    const toast = page.getByRole('status');

    const row = await accountRow(page, isMobile, owner);
    await row.locator('[data-row-menu]').click();
    await expect(menu.getByRole('menuitem', { name: 'Сбросить пароль' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Заблокировать' }).click();
    const ask = page.getByRole('dialog', { name: `Заблокировать ${owner}?` });
    await expect(ask).toContainText('Пользователь не сможет войти, его сеансы завершатся.');
    await ask.getByRole('button', { name: 'Заблокировать' }).click();
    await expect(toast.filter({ hasText: 'Учётная запись заблокирована' })).toBeVisible();
    await expect(row).toContainText('Заблокирован');

    // Открытый сеанс закрыт, новый вход — отказ с сообщением о блокировке.
    expect((await user.get('/api/auth/me')).status()).toBe(401);
    const denied = await user.post('/api/auth/login', {
      headers: { origin },
      data: { login: owner, password: OWNER_PASSWORD },
    });
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: { code: 'user_blocked', message: expect.stringContaining('заблокирована') },
    });

    await row.locator('[data-row-menu]').click();
    await menu.getByRole('menuitem', { name: 'Разблокировать' }).click();
    await expect(toast.filter({ hasText: 'Учётная запись разблокирована' })).toBeVisible();
    await expect(row).toContainText('Активен');
    await signIn(user, origin, owner, OWNER_PASSWORD);
    await user.dispose();
  });

  test('(проверка задачи #91) сброс пароля: окно с временным паролем; прежний пароль не подходит, при входе — сменить пароль', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const { owner } = await newOrg(page.request, origin);

    const row = await accountRow(page, isMobile, owner);
    await row.locator('[data-row-menu]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: 'Сбросить пароль' })
      .click();
    const done = page.getByRole('dialog', { name: 'Пароль сброшен' });
    await expect(done).toContainText(`Учётов Сквозной Тестович · ${owner}`);
    await expect(done).toContainText('Временный пароль:');
    await expect(done).toContainText('Все сеансы пользователя завершены');
    const temporary = (await done.locator('[data-temporary-password]').textContent())!.trim();
    expect(temporary).toMatch(/^Bh-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await done.getByRole('button', { name: 'Готово' }).click();
    await expect(done).toBeHidden();

    const user = await playwright.request.newContext({ baseURL });
    const old = await user.post('/api/auth/login', {
      headers: { origin },
      data: { login: owner, password: OWNER_PASSWORD },
    });
    expect(old.status()).toBe(401);
    const signed = await signIn(user, origin, owner, temporary);
    expect(await signed.json()).toMatchObject({ user: { login: owner, mustChangePassword: true } });
    await user.dispose();
  });

  test('сотрудник, заблокированный владельцем: статус «Заблокирован владельцем», «Разблокировать» администратора нет', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    const login = uniqueLogin('e2e-oblk');
    const hired = (await hire(owner, origin, login)) as unknown as {
      employee: { id: string; version: number };
    };
    await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
    const blocked = await owner.post(`/api/staff/${hired.employee.id}/block`, {
      headers: { origin },
      data: { version: hired.employee.version },
    });
    expect(blocked.status(), await blocked.text()).toBe(200);
    await owner.dispose();

    await platformAdmin(page.request, origin);
    const row = await accountRow(page, isMobile, login);
    await expect(row).toContainText('Заблокирован владельцем');
    await expect(row.locator('[title^="Сотрудника заблокировал владелец"]')).toHaveCount(1);
    await row.locator('[data-row-menu]').click();
    const menu = page.getByRole('menu', { name: 'Действия' });
    await expect(menu.getByRole('menuitem', { name: 'Заблокировать' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Разблокировать' })).toHaveCount(0);
  });

  test('(прототип v76) администратор сбросил пароль бухгалтеру: владельцу организации пришло «🔑 Администратор платформы сбросил пароль сотрудника …», в окне — кому и какое сообщение', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    // Своя организация: владелец с привязанным Telegram и его бухгалтер.
    const owner = await playwright.request.newContext({ baseURL });
    await newOrgOwner(owner, origin);
    const chat = uniqueChat();
    await linkTelegram(owner, origin, chat);
    const roles = (await (await owner.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string }[];
    };
    const accountant = uniqueLogin('e2e-acc-reset');
    const hired = await owner.post('/api/staff', {
      headers: { origin },
      data: {
        fullName: 'Сбросов Сквозной Тестович',
        login: accountant,
        phone: null,
        roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
      },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    await owner.dispose();
    // Владелец другой организации с Telegram: ему о чужом сотруднике ничего не приходит.
    const stranger = await playwright.request.newContext({ baseURL });
    await newOrgOwner(stranger, origin);
    const strangerChat = uniqueChat();
    await linkTelegram(stranger, origin, strangerChat);
    await stranger.dispose();
    const strangerBefore = (await botMessages(page.request, strangerChat)).length;

    await platformAdmin(page.request, origin);
    const row = await accountRow(page, isMobile, accountant);
    await row.locator('[data-row-menu]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: 'Сбросить пароль' })
      .click();
    const done = page.getByRole('dialog', { name: 'Пароль сброшен' });
    const text = `🔑 Администратор платформы сбросил пароль сотрудника ${accountant}: выдан временный пароль, при входе его нужно сменить. Если вы об этом не просили, напишите администратору платформы.`;
    // Окно показывает сообщение владельцам, как прототип accResetPass.
    const notice = done.locator('[data-owners-notice]');
    await expect(notice).toContainText('Бот платформы');
    await expect(notice).toContainText(`→ владельцам организации: @e2e_${chat}`);
    await expect(notice).toContainText(text);
    await expect(notice).toContainText(
      'Шаблон «Telegram: пароль сотрудника сброшен администратором» — Справочники платформы → Шаблоны. Отправка записана в журнал «Телеграм» с типом «Пароль сброшен».',
    );
    expect(await botMessages(page.request, chat)).toContain(text);
    expect(await botMessages(page.request, strangerChat)).toHaveLength(strangerBefore);
    await done.getByRole('button', { name: 'Готово' }).click();
    await expect(done).toBeHidden();
  });

  test('(приёмка, прототип v83) карточка пользователя: шесть вкладок, «Завершить все сеансы» — пользователь вышел, в «Истории» — завершение сеансов и открытие карточки; ссылка #accounts/<логин>', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const admin = await platformAdmin(page.request, origin);
    // Бухгалтер демо-организации со своим сеансом: браузер — Chrome на Windows.
    const login = uniqueLogin('e2e-card');
    const hr = await playwright.request.newContext({ baseURL });
    const { temporaryPassword } = await hire(hr, origin, login);
    await hr.dispose();
    const user = await playwright.request.newContext({
      baseURL,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    });
    await signIn(user, origin, login, temporaryPassword);
    expect((await user.get('/api/auth/me')).status()).toBe(200);

    // Нажатие на строку списка открывает карточку.
    const row = await accountRow(page, isMobile, login);
    await row.getByText('Входов Сквозной Тестович').click();
    const card = page.getByRole('dialog', { name: 'Входов Сквозной Тестович' });
    await expect(card.locator('[data-account-states]')).toContainText('Не сменил временный пароль');
    await expect(card).toContainText(login);
    await expect(card).toContainText('Бухгалтер');
    await expect(card).toContainText(
      'Только просмотр: войти в программу под этим пользователем из Админки нельзя',
    );
    const openTab = async (name: string) => {
      if (isMobile) {
        await card.getByRole('tab', { selected: true }).click();
        await page.getByRole('menu').getByRole('menuitem', { name }).click();
      } else {
        await card.getByRole('tab', { name }).click();
      }
      await expect(card.getByRole('tab', { selected: true })).toContainText(name);
    };
    // Кнопки шапки — как в меню строки.
    await expect(card.locator('[data-account-action="reset-password"]')).toBeVisible();
    await expect(card.locator('[data-account-action="block"]')).toBeVisible();

    // «Основное»: сведения и права роли с областью.
    await expect(card).toContainText('Неверных паролей подряд сейчас');
    await expect(card).toContainText('0 из 10');
    await expect(card).toContainText('не привязан');
    await expect(card.locator('[data-account-perms]')).toContainText('только свои');

    // «Работа»: плашки-числа; нажатие открывает список только для просмотра.
    await openTab('Работа');
    const work = card.locator('[data-account-work]');
    await expect(work).toContainText('Закреплено контрагентов');
    await expect(work).toContainText('Просрочено');
    await expect(card).toContainText('Нет закреплённых контрагентов');
    await work.getByText('Открытых задач').click();
    const list = page.getByRole('dialog', { name: 'Открытые задачи' });
    await expect(list).toContainText('Входов Сквозной Тестович · только просмотр');
    await expect(list).toContainText('Записей нет');
    await list.getByRole('button', { name: 'Готово' }).click();
    await expect(list).toBeHidden();

    // «Обучение и видео», «Telegram».
    await openTab('Обучение и видео');
    await expect(card).toContainText('Уровень знаний');
    await expect(card).toContainText('Статей пока не читал');
    await expect(card).toContainText('Просмотры видео');
    await openTab('Telegram');
    await expect(card).toContainText(
      'Telegram не привязан: сообщения бота пользователю не уходят.',
    );

    // «Сеансы»: открытый сеанс с устройством, без адреса IP; «Завершить все сеансы» с вопросом.
    await openTab('Сеансы');
    await expect(card.locator('[data-account-sessions="1"]')).toBeVisible();
    await expect(card).toContainText('Chrome 130 · Windows 10 или 11');
    await expect(card).toContainText('Открыт');
    await expect(card).toContainText('адрес IP в карточке не показывается');
    await card.locator('[data-account-sessions-end]').click();
    const ask = page.getByRole('dialog', { name: `Завершить все сеансы ${login}?` });
    await expect(ask).toContainText(
      'Пользователь выйдет на всех устройствах: открытых сеансов — 1. Войти снова он сможет со своим паролем.',
    );
    await ask.getByRole('button', { name: 'Завершить' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Сеансы завершены: пользователь вышел на всех устройствах' }),
    ).toBeVisible();
    await expect(card.locator('[data-account-sessions="0"]')).toBeVisible();
    await expect(card).toContainText('Завершён администратором платформы');
    await expect(card.locator('[data-account-sessions-end]')).toBeDisabled();
    // Пользователь вышел на всех устройствах и может войти снова со своим паролем.
    expect((await user.get('/api/auth/me')).status()).toBe(401);
    await signIn(user, origin, login, temporaryPassword);
    await user.dispose();

    // «История»: завершение сеансов и одно открытие карточки администратором (перечитывание
    // открытой карточки после действия новой записи не даёт), создание учётной записи.
    await openTab('История');
    await expect(card).toContainText('Завершены все сеансы администратором платформы: 1');
    await expect(card.getByText('Открыта карточка пользователя')).toHaveCount(1);
    await expect(card).toContainText('Администратор платформы');
    await expect(card).toContainText('Учётная запись создана');
    await card.getByRole('button', { name: 'Готово' }).click();
    await expect(card).toBeHidden();

    // Ссылка #accounts/<логин> открывает карточку; у администратора платформы — три вкладки.
    await page.goto(`/app/accounts#accounts/${admin}`);
    const own = page.locator('[data-account-card]');
    await expect(own).toBeVisible();
    await expect(page).toHaveURL(/\/app\/accounts$/);
    const adminCard = page.getByRole('dialog').filter({ has: own });
    await expect(adminCard.locator('[data-account-states]')).toContainText(
      'Учётные записи администраторов платформы из Админки не меняются',
    );
    // На телефоне вкладки — списком под текущей: «1 из 3».
    const tabNames = isMobile
      ? page.getByRole('menu').getByRole('menuitem')
      : adminCard.getByRole('tab');
    if (isMobile) await adminCard.getByRole('tab', { selected: true }).click();
    await expect(tabNames).toHaveText([/Основное/, /Сеансы/, /История/]);

    // Нет такой учётной записи — уведомление, карточки нет.
    await page.goto('/app/accounts#accounts/net-takogo-logina');
    await expect(
      page.getByRole('status').filter({ hasText: 'Такой учётной записи нет' }),
    ).toBeVisible();
  });
});
