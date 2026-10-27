import { expect, test } from '@playwright/test';
import { ADMIN_PASSWORD, platformAdmin, search, uniqueInn } from './admin';
import { signIn, uniqueLogin } from './helpers';

// Админка → «Организации» (ТЗ «Админка» → «Модуль организаций»; просьба заказчика 27.10.2026 —
// стенд, где администратор платформы создаёт организации): плашки, список всех организаций,
// «Новая организация» с владельцем, блокировка и разблокировка. Администратор свой на каждый тест и
// проект (`platformAdmin`).

const OWNER_PASSWORD = 'Bh-E2E7-BLK9';

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
});
