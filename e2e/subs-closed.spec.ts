import { expect, test, type Page } from '@playwright/test';
import { platformAdmin } from './admin';
import { newOrgOwner, uniqueLogin } from './helpers';

// Закрытый доступ по подписке (доработки 20.11.2026, блок 4, пункт 4; этап 1, П1; прототип v153
// `subClosed`, core/login.js): у своей организации теста администратор ставит «Оплачено до» вчерашним
// днём — сотрудник после верного пароля видит «Доступ закрыт…», с неверным — то же «Неверный логин или
// пароль», что и все. Что видит владелец (только экран «Подписка» потока И) — с общей сборкой этапа 1.

const CLOSED =
  'Доступ закрыт: подписка организации не оплачена. Обратитесь к владельцу организации.';
const DAY = 86_400_000;
const bishkekYesterday = () => new Date(Date.now() + 6 * 3600_000 - DAY).toISOString().slice(0, 10);

async function signInByForm(page: Page, login: string, password: string) {
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse('**/api/auth/login'),
    page.getByRole('button', { name: 'Войти' }).click(),
  ]);
}

test('(доработки 20.11.2026, блок 4, пункт 4; прототип v153) на следующий день после «Оплачено до» сотрудник после верного пароля видит «Доступ закрыт…», с неверным — «Неверный логин или пароль»', async ({
  page,
  playwright,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const owner = await playwright.request.newContext({ baseURL });
  const ownerLogin = await newOrgOwner(owner, origin);
  const roles = (await (await owner.get('/api/roles?size=all', { maxRetries: 2 })).json()) as {
    items: { id: string; name: string }[];
  };
  const login = uniqueLogin('e2e-closed');
  const hired = await owner.post('/api/staff', {
    headers: { origin },
    data: {
      fullName: 'Закрытов Сквозной Тестович',
      login,
      roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
    },
  });
  expect(hired.status(), await hired.text()).toBe(201);
  const { temporaryPassword } = (await hired.json()) as { temporaryPassword: string };
  await owner.dispose();

  // Администратор платформы: «Изменить подписку» — «Оплачено до» вчера по Бишкеку.
  const admin = await playwright.request.newContext({ baseURL });
  await platformAdmin(admin, origin);
  const orgs = (await (
    await admin.get('/api/admin/organizations?size=all', { maxRetries: 2 })
  ).json()) as { items: { id: string; name: string }[] };
  const org = orgs.items.find((o) => o.name === `ОсОО «${ownerLogin}»`);
  expect(org, ownerLogin).toBeTruthy();
  const card = (await (
    await admin.get(`/api/admin/subscriptions/${org!.id}`, { maxRetries: 2 })
  ).json()) as { sub: { planId: string; seats: number; version: number } };
  const closed = await admin.put(`/api/admin/subscriptions/${org!.id}`, {
    headers: { origin },
    data: {
      planId: card.sub.planId,
      seats: card.sub.seats,
      extraGb: 0,
      paidUntil: bishkekYesterday(),
      free: false,
      reason: `e2e: срок прошёл ${login}`,
      version: card.sub.version,
    },
  });
  expect(closed.status(), await closed.text()).toBe(200);
  await admin.dispose();

  await page.goto('/login');
  await test.step('неверный пароль — «Неверный логин или пароль», о подписке ни слова', async () => {
    await signInByForm(page, login, 'неверный');
    await expect(page.locator('main form').getByRole('alert')).toHaveText(
      'Неверный логин или пароль',
    );
  });
  await test.step('верный пароль — «Доступ закрыт…», вход не открылся', async () => {
    await signInByForm(page, login, temporaryPassword);
    await expect(page.locator('main form').getByRole('alert')).toHaveText(CLOSED);
    await expect(page).toHaveURL(/\/login$/);
  });
});
