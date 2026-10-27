import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search, uniqueInn } from './admin';
import { DEMO_PASSWORD, hire, signIn, uniqueLogin } from './helpers';

// Админка → «Учётные записи» (ТЗ «Админка» → «Модуль учётных записей»; прототип
// admin/accounts-orgs.js): список всех пользователей платформы, сброс пароля, блокировка и
// разблокировка; сотрудник, которого заблокировал владелец, — своим статусом (docs/deviations.md,
// п. 49, решение А). Администратор свой на каждый тест и проект (`platformAdmin`).

const OWNER_PASSWORD = 'Bh-E2E7-ACC9';

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

    // Администратор платформы — тоже в списке: организация «Платформа». Нажатие на строку открывает
    // меню записи, как в прототипе; на своей строке — только недоступное «Это вы».
    await search(page, isMobile, admin);
    const self = page.locator('[data-grid] [data-id]').filter({ hasText: admin });
    await expect(self).toHaveCount(1);
    await expect(self).toContainText('Администратор платформы');
    await expect(self).toContainText('Платформа');
    await self.click();
    const menu = page.getByRole('menu', { name: 'Действия' });
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
});
