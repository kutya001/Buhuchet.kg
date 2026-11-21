import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin } from './admin';
import { newOrgOwner } from './helpers';

// Этап 2, П8 общего плана 20.11 (поток К): страница контрагента по ссылке при закрытом по подписке
// доступе организации (доработки 20.11.2026, блок 4, пункт 4; прототип v152 `pubOrgClosed`,
// `pubClosedHtml`). Своя организация теста: администратор платформы ставит «Оплачено до» вчерашним днём —
// браузер, где клиент уже ввёл код, видит «Страница временно недоступна» без названия фирмы и данных;
// другой браузер без кода — обычный ввод кода; после оплаты тот же браузер снова видит страницу. Кнопки
// бота и ответы методов страницы — тесты пакетов (`packages/api/src/modules/contractor-page/org-closed.test.ts`).

const DAY = 86_400_000;

const bishkekDay = (days: number) =>
  new Date(Date.now() + 6 * 3600_000 + days * DAY).toISOString().slice(0, 10);

/** Свой ИНН контрагента на каждый запуск и проект: 14 цифр, первая — 0. */
const freshInn = () =>
  `06${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`;

/** Тексты словаря интерфейса: тест не копирует строки экрана. */
async function dictTexts(api: APIRequestContext): Promise<Record<string, string>> {
  const res = await api.get('/api/l10n', { maxRetries: 2 });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Record<string, string> }).texts;
}

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

/** Владелец своей организации включает «Страницу контрагента», создаёт контрагента и его страницу. */
async function closedOrgPage(api: APIRequestContext, origin: string, name: string) {
  const owner = await newOrgOwner(api, origin);
  const policy = (await (await api.get('/api/org/policy', { maxRetries: 2 })).json()) as {
    version: number;
  };
  const on = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: policy.version, features: { cppage: true } },
  });
  expect(on.status(), await on.text()).toBe(200);
  const staff = (await (await api.get('/api/staff?size=all', { maxRetries: 2 })).json()) as {
    items: { id: string }[];
  };
  const created = await api.post('/api/contractors', {
    headers: { origin },
    data: {
      name,
      inn: freshInn(),
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      startDate: '2026-10-01',
      responsibleEmployeeId: staff.items[0]!.id,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const page = await api.post(`/api/contractors/${id}/page/enable`, { headers: { origin } });
  expect(page.status(), await page.text()).toBe(200);
  const block = (await page.json()) as { link: string; code: string };
  return { owner, path: new URL(block.link).pathname, code: block.code };
}

/** Свой адрес клиента: с одного адреса после 3 неверных кодов за час ввод закрыт (п. Е-2). */
async function ownAddress(page: Page) {
  const part = () => Math.floor(Math.random() * 256);
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test('(доработки 20.11.2026, блок 4, пункт 4; этап 2, П8) страница контрагента при закрытом доступе: браузер с введённым кодом — «Страница временно недоступна» без названия фирмы и данных, без кода — ввод кода; после оплаты — снова страница', async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  // Длинный сценарий: организация и администратор платформы через `pnpm db:*`, два браузера.
  test.slow();
  const origin = new URL(baseURL!).origin;
  const name = `ОсОО «Закрытая ${Date.now().toString(36)}»`;
  const api = await playwright.request.newContext({ baseURL });
  let site: Awaited<ReturnType<typeof closedOrgPage>>;
  let texts: Record<string, string>;
  try {
    site = await closedOrgPage(api, origin, name);
    texts = await dictTexts(api);
  } finally {
    await api.dispose();
  }
  const orgName = `ОсОО «${site.owner}»`;
  const title = texts['pub.org_closed.title']!;
  const note = texts['pub.org_closed.text']!;
  expect(title).toBeTruthy();
  expect(note).toBeTruthy();

  // Клиент открыл ссылку и ввёл код, пока доступ открыт: код запомнен в этом браузере.
  await ownAddress(page);
  await page.goto(site.path);
  await expect(page.getByRole('button', { name: 'Открыть' })).toBeEnabled();
  await page.getByLabel('Код доступа').fill(site.code);
  await page.getByRole('button', { name: 'Открыть' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

  const admin = await playwright.request.newContext({ baseURL });
  try {
    await platformAdmin(admin, origin);
    await setPaidUntil(admin, origin, site.owner, bishkekDay(-1));

    await test.step('тот же браузер — «Страница временно недоступна», без названия фирмы, контрагента и данных', async () => {
      await page.reload();
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      await expect(page.getByText(note)).toBeVisible();
      await expect(page.getByText(name)).toHaveCount(0);
      await expect(page.getByText(orgName)).toHaveCount(0);
      await expect(page.locator('[data-sec]')).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(false);
    });

    await test.step('другой браузер без кода — обычный ввод кода: по ссылке не видно, что подписка не оплачена', async () => {
      const other = await browser.newContext({ baseURL });
      try {
        const fresh = await other.newPage();
        await ownAddress(fresh);
        await fresh.goto(site.path);
        await expect(fresh.getByLabel('Код доступа')).toBeVisible();
        await expect(fresh.getByText(title)).toHaveCount(0);
      } finally {
        await other.close();
      }
    });

    await test.step('оплатили — тот же браузер снова видит страницу без нового кода', async () => {
      await setPaidUntil(admin, origin, site.owner, bishkekDay(30));
      await page.reload();
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(page.getByText(title)).toHaveCount(0);
    });
  } finally {
    await admin.dispose();
  }
});
