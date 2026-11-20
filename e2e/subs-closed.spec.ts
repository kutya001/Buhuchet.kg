import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin } from './admin';
import { newOrgOwner, signIn, uniqueLogin } from './helpers';

// Закрытый доступ по подписке (доработки 20.11.2026, блок 4, пункт 4; этап 1, П1; прототип v153
// `subClosed`, core/login.js): у своей организации теста администратор ставит «Оплачено до» вчерашним
// днём — открытая вкладка сотрудника уходит на вход, после верного пароля он видит «Доступ закрыт…», с
// неверным — то же «Неверный логин или пароль», что и все; владелец входит и видит только «Моя
// организация» → «Подписка» с заметкой «Подписка закончилась …». За 7 дней до конца срока владельцу —
// полоса «Подписка оплачена до …» с «Продлить» (экран и оболочка потока И, общая сборка этапа 1).

const CLOSED =
  'Доступ закрыт: подписка организации не оплачена. Обратитесь к владельцу организации.';
const DAY = 86_400_000;
/** Пароль владельца после `newOrgOwner` (свой пароль вместо временного). */
const OWNER_PASSWORD = 'Свой-пароль-e2e-1';

const bishkekDay = (days: number) =>
  new Date(Date.now() + 6 * 3600_000 + days * DAY).toISOString().slice(0, 10);
const ruDate = (iso: string) => iso.split('-').reverse().join('.');

/** Администратор платформы: «Изменить подписку» организации владельца `ownerLogin` — «Оплачено до» `paidUntil`. */
async function setPaidUntil(
  admin: APIRequestContext,
  origin: string,
  ownerLogin: string,
  paidUntil: string,
) {
  const orgs = (await (
    await admin.get('/api/admin/organizations?size=all', { maxRetries: 2 })
  ).json()) as { items: { id: string; name: string }[] };
  const org = orgs.items.find((o) => o.name === `ОсОО «${ownerLogin}»`);
  expect(org, ownerLogin).toBeTruthy();
  const card = (await (
    await admin.get(`/api/admin/subscriptions/${org!.id}`, { maxRetries: 2 })
  ).json()) as { sub: { planId: string; seats: number; version: number } };
  const res = await admin.put(`/api/admin/subscriptions/${org!.id}`, {
    headers: { origin },
    data: {
      planId: card.sub.planId,
      seats: card.sub.seats,
      extraGb: 0,
      paidUntil,
      free: false,
      reason: `e2e: оплачено до ${paidUntil} ${ownerLogin}`,
      version: card.sub.version,
    },
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function signInByForm(page: Page, login: string, password: string) {
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse('**/api/auth/login'),
    page.getByRole('button', { name: 'Войти' }).click(),
  ]);
}

test('(доработки 20.11.2026, блок 4, пункт 4; прототип v153) на следующий день после «Оплачено до» открытая вкладка сотрудника уходит на вход, после верного пароля — «Доступ закрыт…», с неверным — «Неверный логин или пароль»; владелец видит только «Подписку»', async ({
  page,
  browser,
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

  // Сотрудник вошёл, пока доступ открыт: вкладка программы открыта.
  const staffContext = await browser.newContext({ baseURL });
  const staffTab = await staffContext.newPage();
  const password = 'Свой-пароль-e2e-2';
  await signIn(staffTab.request, origin, login, temporaryPassword);
  const changed = await staffTab.request.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporaryPassword, newPassword: password },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  await staffTab.goto('/app');
  await expect(staffTab).toHaveURL(/\/app(\/|$)/);

  // Администратор платформы: «Изменить подписку» — «Оплачено до» вчера по Бишкеку.
  const admin = await playwright.request.newContext({ baseURL });
  await platformAdmin(admin, origin);
  const yesterday = bishkekDay(-1);
  await setPaidUntil(admin, origin, ownerLogin, yesterday);
  await admin.dispose();

  await test.step('открытая вкладка сотрудника при следующем переходе уходит на вход', async () => {
    await staffTab.reload();
    await expect(staffTab).toHaveURL(/\/login/);
    await staffContext.close();
  });

  await page.goto('/login');
  await test.step('неверный пароль — «Неверный логин или пароль», о подписке ни слова', async () => {
    await signInByForm(page, login, 'неверный');
    await expect(page.locator('main form').getByRole('alert')).toHaveText(
      'Неверный логин или пароль',
    );
  });
  await test.step('верный пароль — «Доступ закрыт…», вход не открылся', async () => {
    await signInByForm(page, login, password);
    await expect(page.locator('main form').getByRole('alert')).toHaveText(CLOSED);
    await expect(page).toHaveURL(/\/login$/);
  });
  await test.step('владелец входит: только «Моя организация» → «Подписка», «Подписка закончилась …»', async () => {
    await signInByForm(page, ownerLogin, OWNER_PASSWORD);
    await expect(page).toHaveURL(/\/app(\/|$)/);
    await page.goto('/app/org/sub');
    const screen = page.locator('[data-sub-screen="own"]');
    await expect(screen).toContainText(`Подписка закончилась ${ruDate(yesterday)}`);
    await expect(screen.locator('[data-sub-pay-open="renew"]')).toBeEnabled();
    await expect(page.getByRole('tab', { selected: true })).toContainText('Подписка');
    await expect(page.locator('[data-sub-closed]')).toHaveCount(0);
  });
});

test('(доработки 20.11.2026, блок 4, пункт 3; прототип v154) за 7 дней до «Оплачено до» владельцу — полоса «Подписка оплачена до …», «Продлить» открывает окно оплаты', async ({
  page,
  playwright,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const ownerLogin = await newOrgOwner(page.request, origin);
  const admin = await playwright.request.newContext({ baseURL });
  await platformAdmin(admin, origin);
  const soon = bishkekDay(3);
  await setPaidUntil(admin, origin, ownerLogin, soon);
  await admin.dispose();

  await page.goto('/app');
  const bar = page.locator('[data-sub-renew]');
  await expect(bar).toContainText(`Подписка оплачена до ${ruDate(soon)}`);
  await bar.getByRole('link').click();
  await expect(page).toHaveURL(/\/app\/org\/sub/);
  await expect(page.locator('[data-sub-pay="renew"]')).toBeVisible();
});
