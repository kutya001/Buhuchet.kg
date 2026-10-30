import { expect, test, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// Страница контрагента по ссылке: включение, код доступа и защита (задача 2.42, #98). Блок карточки
// подключит карточка контрагента (2.11), разделы страницы — задача 2.43; поэтому страница включается
// через API сайта под владельцем демо-организации, а открывает её браузер без входа.

/** Адрес демо-организации «Бухгалтер Плюс». */
const SLUG = 'buhgalter-plyus';

/** Свой ИНН на каждый запуск и проект: 14 цифр, первая — 0. */
const freshInn = () =>
  `08${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`;

interface PageBlock {
  enabled: boolean;
  link: string | null;
  code: string | null;
  lastDevice: string | null;
}

/** Владелец создаёт контрагента и включает его страницу: ссылка и код — из блока карточки. */
async function enabledPage(api: APIRequestContext, baseURL: string | undefined, name: string) {
  const origin = new URL(baseURL!).origin;
  await signIn(api, origin, 'erkin', DEMO_PASSWORD);
  const staff = (await (await api.get('/api/staff?size=all')).json()) as {
    items: { id: string; active: boolean }[];
  };
  const inn = freshInn();
  const created = await api.post('/api/contractors', {
    headers: { origin },
    data: {
      name,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      startDate: '2026-10-01',
      responsibleEmployeeId: staff.items.find((e) => e.active)!.id,
      tariff: { amount: 0, period: 'M' },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const on = await api.post(`/api/contractors/${id}/page/enable`, { headers: { origin } });
  expect(on.status(), await on.text()).toBe(200);
  const block = (await on.json()) as PageBlock;
  expect(block.link).toBe(`${origin}/${SLUG}/inn/${inn}`);
  return { origin, id, inn, code: block.code!, path: `/${SLUG}/inn/${inn}` };
}

test.describe('Этап 2: страница контрагента по ссылке — код доступа и защита', () => {
  // Свой адрес на каждый тест: с одного адреса после 3 неверных кодов за час ввод закрыт на час
  // (docs/deviations.md п. Е-2), а тесты обоих проектов и повторы идут с одной машины. Адрес берётся
  // из первого X-Forwarded-For, как за Vercel и Caddy.
  test.beforeEach(async ({ page }) => {
    const part = () => Math.floor(Math.random() * 256);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });
  });

  test('(проверка задачи #98) ссылка без входа просит код: неверный — «Осталось попыток: 4», верный — шапка страницы; код запоминается в браузере', async ({
    page,
    request,
    baseURL,
  }) => {
    const name = `ОсОО «Страница ${Date.now().toString(36)}»`;
    const { id, code, path, inn } = await enabledPage(request, baseURL, name);

    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Введите код доступа' })).toBeVisible();
    // Без кода не видно ничего, даже названия контрагента.
    await expect(page.getByText(name)).toHaveCount(0);
    const input = page.getByLabel('Код доступа');
    await input.fill('12');
    await page.getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByText('Введите 6 цифр')).toBeVisible();
    await input.fill(code === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByText('Неверный код. Осталось попыток: 4')).toBeVisible();

    await input.fill(code);
    await page.getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText(inn)).toBeVisible();
    await expect(page.getByText('ваша бухгалтерская компания')).toBeVisible();
    await expect(page.getByText(/^Данные на \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/)).toBeVisible();
    await expect(
      page.getByText('Страница только для просмотра. Вопросы — вашему бухгалтеру.'),
    ).toBeVisible();
    // Ничего не прокручивается вбок (на телефоне — тоже).
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(wide).toBe(false);

    // Код запомнен в этом браузере: после перезагрузки страница открывается сразу.
    await page.reload();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    // Открытие записано с устройством — «Последнее открытие» в блоке карточки.
    const block = (await (await request.get(`/api/contractors/${id}/page`)).json()) as PageBlock;
    expect(block.lastDevice).toMatch(/^(ПК|Телефон) · Chrome$/);
  });

  test('(проверка задачи #98) «Сменить код» закрывает запомненный браузер; после «Выключить» и по неизвестному ИНН — «Страница недоступна»', async ({
    page,
    request,
    baseURL,
  }) => {
    const name = `ОсОО «Выключение ${Date.now().toString(36)}»`;
    const { origin, id, code, path } = await enabledPage(request, baseURL, name);
    await page.goto(path);
    await page.getByLabel('Код доступа').fill(code);
    await page.getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    const changed = await request.post(`/api/contractors/${id}/page/code`, { headers: { origin } });
    expect(changed.status()).toBe(200);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Введите код доступа' })).toBeVisible();

    const off = await request.post(`/api/contractors/${id}/page/disable`, { headers: { origin } });
    expect(off.status()).toBe(200);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Страница недоступна' })).toBeVisible();
    await expect(page.getByText('Обратитесь к вашему бухгалтеру.')).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);

    await page.goto(`/${SLUG}/inn/00000000000000`);
    await expect(page.getByRole('heading', { name: 'Страница недоступна' })).toBeVisible();
    await page.goto(`/no-such-org/inn/${path.split('/').pop()}`);
    await expect(page.getByRole('heading', { name: 'Страница недоступна' })).toBeVisible();
  });
});
