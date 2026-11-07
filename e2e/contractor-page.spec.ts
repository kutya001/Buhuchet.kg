import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { search } from './admin';
import {
  botMessages,
  DEMO_PASSWORD,
  defaultResponsible,
  hire,
  linkTelegram,
  signIn,
  uniqueChat,
  uniqueLogin,
} from './helpers';
import { orgWithTypes } from './orgs';

// Страница контрагента по ссылке: включение, код доступа и защита (задача 2.42, #98) и разделы
// страницы (задача 2.43, #99). Страница включается через API сайта, открывает её браузер без входа.

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

/**
 * Владелец создаёт контрагента и включает его страницу: ссылка и код — из блока карточки. Ответственный
 * — `responsible` или по умолчанию.
 */
async function enabledPage(
  api: APIRequestContext,
  baseURL: string | undefined,
  name: string,
  responsible?: string,
) {
  const origin = new URL(baseURL!).origin;
  await signIn(api, origin, 'erkin', DEMO_PASSWORD);
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
      responsibleEmployeeId: responsible ?? (await defaultResponsible(api)),
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

  test('(проверка задачи #98) ссылка без входа просит код: неверный — «Осталось попыток: 2», верный — шапка страницы; код запоминается в браузере', async ({
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
    // Остаток — меньший из двух: по ссылке 4, с этого адреса 2 (docs/deviations.md п. О-1).
    await expect(page.getByText('Неверный код. Осталось попыток: 2')).toBeVisible();

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

  test('(решение заказчика 07.11.2026, Р-5 А) 5 неверных кодов за сутки с разных адресов — «Страница закрыта» и в запомненном браузере, ответственному — сообщение в Telegram; «Сменить код» открывает её снова', async ({
    page,
    request,
    playwright,
    baseURL,
    isMobile,
  }) => {
    // Ответственный — новый сотрудник с Telegram (демо-сотрудникам Telegram не привязывается).
    const staff = await playwright.request.newContext({ baseURL });
    const staffOrigin = new URL(baseURL!).origin;
    const login = uniqueLogin('e2e-cp-closed');
    const { employee, temporaryPassword } = await hire(staff, staffOrigin, login);
    await signIn(staff, staffOrigin, login, temporaryPassword);
    const changed = await staff.post('/api/auth/password', {
      headers: { origin: staffOrigin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(changed.status()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(staff, staffOrigin, chat);
    await staff.dispose();

    const name = `ОсОО «Закрытие ${Date.now().toString(36)}»`;
    const { origin, id, code, path, inn } = await enabledPage(request, baseURL, name, employee.id);
    // Браузер контрагента запомнил код.
    await page.goto(path);
    await page.getByLabel('Код доступа').fill(code);
    await page.getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    // Пять неверных кодов с разных адресов: с одного ввод закрылся бы на час после третьего.
    const wrong = code === '000000' ? '111111' : '000000';
    const part = () => Math.floor(Math.random() * 256);
    for (let i = 1; i <= 5; i++) {
      const res = await request.post(`/api/page/${SLUG}/${inn}/code`, {
        headers: { origin, 'x-forwarded-for': `198.19.${part()}.${part()}` },
        data: { code: wrong },
      });
      expect(res.status(), await res.text()).toBe(i < 5 ? 403 : 429);
    }
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Страница закрыта' })).toBeVisible();
    await expect(
      page.getByText('Было 5 неверных кодов за сутки. Попросите новый код у вашего бухгалтера.'),
    ).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
    const block = (await (await request.get(`/api/contractors/${id}/page`)).json()) as {
      closed: boolean;
    };
    expect(block.closed).toBe(true);
    // Ответственному — «🔒 Страница контрагента … закрыта» со ссылкой на «Контрагентов».
    await expect
      .poll(async () => (await botMessages(request, chat)).find((m) => m.startsWith('🔒')) ?? '')
      .toContain(
        `🔒 Страница контрагента ${name} закрыта: 5 неверных кодов за сутки. Откройте карточку контрагента, нажмите «Сменить код»`,
      );

    // У бухгалтера в карточке контрагента, в блоке «Страница контрагента», — пометка.
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/cps/all');
    const rows = page.locator('[data-grid] [data-id]');
    await expect(rows.first()).toBeVisible();
    await search(page, isMobile, name);
    await rows.filter({ hasText: name }).first().getByText(name, { exact: true }).click();
    const card = page.getByRole('dialog', { name });
    await expect(card.locator('[data-cp-page-closed]')).toHaveText(
      'Страница закрыта: за сутки было 5 неверных кодов. Нажмите «Сменить код» (нет права — попросите владельца или главного бухгалтера) и отправьте контрагенту новый код.',
    );

    const changed = await request.post(`/api/contractors/${id}/page/code`, { headers: { origin } });
    expect(changed.status()).toBe(200);
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Введите код доступа' })).toBeVisible();
  });
});

// Разделы открытой страницы (задача 2.43, #99) — в своей организации теста: в ней включены страница,
// учёт оплаты налогов, плата за обслуживание, показатели и файлы, есть счёт «Перевод по номеру
// телефона» и кошелёк владельца — он же ответственный бухгалтер; демо-организацию тест не меняет.

/** M-Bank и Бакай Банк — коды refDB.json. */
const MBANK = 'БНК-13';
const BAKAI = 'БНК-02';

/** Дата по Бишкеку со сдвигом в днях. */
const bishkek = (shift = 0) =>
  new Date(Date.now() + 6 * 3600_000 + shift * 86_400_000).toISOString().slice(0, 10);

/** Ближайший прошедший будний день: срок на выходном сервер сразу переносит на рабочий. */
function lastWorkday(): string {
  for (let i = 1; ; i++) {
    const day = new Date(`${bishkek(-i)}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) return bishkek(-i);
  }
}

/** Своя организация теста: функции страницы, счёт организации и кошелёк владельца. */
async function pageOrg(api: APIRequestContext, baseURL: string | undefined) {
  const origin = new URL(baseURL!).origin;
  await orgWithTypes(api, origin);
  const policy = (await (await api.get('/api/org/policy')).json()) as { version: number };
  const on = await api.patch('/api/org/policy', {
    headers: { origin },
    data: {
      version: policy.version,
      features: { cppage: true, taxpay: true, fee: true, indicators: true, files: true },
    },
  });
  expect(on.status(), await on.text()).toBe(200);
  // П. 67: «Перевод по номеру телефона» 0555 123 456 (M-Bank, Бакай Банк), «Налоги и обслуживание».
  const account = await api.post('/api/org/accounts', {
    headers: { origin },
    data: {
      kind: 'phone',
      bankCode: null,
      accountNo: null,
      bik: null,
      phone: '+996555123456',
      phoneBanks: [MBANK, BAKAI],
      holderName: 'Организация теста',
      purpose: 'both',
      mainTax: true,
      mainFee: true,
    },
  });
  expect(account.status(), await account.text()).toBe(200);
  const wallet = await api.post('/api/profile/wallets', {
    headers: { origin },
    data: {
      kind: 'phone',
      bankCode: null,
      accountNo: null,
      phone: '+996700333444',
      phoneBanks: [MBANK],
      holderName: 'Подборова С.',
      isMain: true,
    },
  });
  expect(wallet.status(), await wallet.text()).toBe(200);
  const staff = (await (await api.get('/api/staff?size=all')).json()) as {
    items: { id: string }[];
  };
  return { origin, owner: staff.items[0]!.id };
}

/** Контрагент своей организации со включённой страницей: адрес и код — из блока карточки. */
async function pageOf(
  api: APIRequestContext,
  o: { origin: string; owner: string },
  name: string,
  paysTo: 'org' | 'emp',
) {
  const inn = freshInn();
  const created = await api.post('/api/contractors', {
    headers: { origin: o.origin },
    data: {
      name,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      startDate: '2026-01-01',
      responsibleEmployeeId: o.owner,
      paysTo,
      tariff: { amount: 500_000, period: 'M' },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const on = await api.post(`/api/contractors/${id}/page/enable`, {
    headers: { origin: o.origin },
  });
  expect(on.status(), await on.text()).toBe(200);
  const block = (await on.json()) as PageBlock;
  return { id, inn, code: block.code!, path: new URL(block.link!).pathname };
}

/** «Разовый отчёт» через API: вид, месяц периода и срок; ответ — id отчёта. */
async function manualReport(
  api: APIRequestContext,
  origin: string,
  data: { contractorId: string; reportTypeCode: string; month: string; due: string },
) {
  const res = await api.post('/api/reports', {
    headers: { origin },
    data: { ...data, reasonCode: 'ПРЧ-001' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const versionOf = async (api: APIRequestContext, id: string) =>
  ((await (await api.get(`/api/reports/${id}`)).json()) as { version: number }).version;

/** Ввести код в браузере: открывается страница контрагента. */
async function openByCode(page: Page, path: string, code: string, name: string) {
  await page.goto(path);
  await page.getByLabel('Код доступа').fill(code);
  await page.getByRole('button', { name: 'Открыть' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

const section = (page: Page, key: string) => page.locator(`[data-sec="${key}"]`);

test.describe('Этап 2: страница контрагента по ссылке — разделы и компоновка', () => {
  test.beforeEach(async ({ page }) => {
    const part = () => Math.floor(Math.random() * 256);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });
  });

  test('(п. 60) с верным кодом видны «Ваш бухгалтер», «Контакты», «Отчёты», «Показатели», «Оплата за обслуживание», а задач, истории и бонусов нет; после «Выключить» — «Страница недоступна. Обратитесь к вашему бухгалтеру»', async ({
    page,
    request,
    baseURL,
  }) => {
    const o = await pageOrg(request, baseURL);
    const name = 'ОсОО «Укс»';
    const cp = await pageOf(request, o, name, 'org');
    await page.goto(cp.path);
    await expect(page.getByRole('heading', { name: 'Введите код доступа' })).toBeVisible();
    await openByCode(page, cp.path, cp.code, name);
    for (const key of ['acc', 'contacts', 'reports', 'kpi', 'fee']) {
      await expect(section(page, key)).toHaveCount(1);
    }
    await expect(section(page, 'acc')).toContainText('Подборова Сквозная');
    for (const absent of ['Задачи', 'История', 'Бонус']) {
      await expect(page.getByText(absent, { exact: false })).toHaveCount(0);
    }
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(wide).toBe(false);

    const off = await request.post(`/api/contractors/${cp.id}/page/disable`, {
      headers: { origin: o.origin },
    });
    expect(off.status()).toBe(200);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Страница недоступна' })).toBeVisible();
    await expect(page.getByText('Обратитесь к вашему бухгалтеру.')).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test('(п. 67) платящий на счёт организации видит 0555 123 456 со «Скопировать» на обеих карточках; платящий на кошелёк бухгалтера — основной реквизит бухгалтера на «Налогах»', async ({
    page,
    request,
    baseURL,
  }) => {
    const o = await pageOrg(request, baseURL);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: o.origin,
    });
    const org = await pageOf(request, o, 'ОсОО «На счёт»', 'org');
    await openByCode(page, org.path, org.code, 'ОсОО «На счёт»');
    const pay = section(page, 'pay');
    await expect(pay).toBeVisible();
    for (const k of ['tax', 'fee']) {
      const card = pay.locator(`[data-pay="${k}"]`);
      await expect(card.locator('[data-pay-number]')).toHaveText('0555 123 456');
      await expect(card).toContainText('Перевод по номеру телефона');
      await expect(card).toContainText('Бакай Банк');
      await expect(card).toContainText('M-Bank');
      await expect(card.getByRole('button', { name: 'Скопировать номер' })).toBeVisible();
    }
    await pay
      .locator('[data-pay="tax"]')
      .getByRole('button', { name: 'Скопировать номер' })
      .click();
    await expect(page.getByText('Номер скопирован')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0555123456');

    const emp = await pageOf(request, o, 'ИП На кошелёк', 'emp');
    await openByCode(page, emp.path, emp.code, 'ИП На кошелёк');
    await expect(section(page, 'pay').locator('[data-pay="tax"] [data-pay-number]')).toHaveText(
      '0700 333 444',
    );
    await expect(section(page, 'pay').locator('[data-pay="fee"] [data-pay-number]')).toHaveText(
      '0555 123 456',
    );
  });

  test('(п. 68) страница с 24 отчётами на телефоне: сразу видны шапка, строка состояния, «Главное», «Как оплатить»; «Отчёты» свёрнуты с «сдано 18 из 24», внутри — плитки по видам с пояснением и «сдано N из M», касание плитки открывает периоды', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    test.setTimeout(120_000);
    const o = await pageOrg(request, baseURL);
    const name = 'ОсОО «Двадцать четыре»';
    const cp = await pageOf(request, o, name, 'org');
    const year = bishkek().slice(0, 4);
    const ids: string[] = [];
    for (const type of ['t1m', 'p1m']) {
      for (let m = 1; m <= 12; m++) {
        ids.push(
          await manualReport(request, o.origin, {
            contractorId: cp.id,
            reportTypeCode: type,
            month: `${year}-${String(m).padStart(2, '0')}-01`,
            due: `${year}-12-${String(10 + m).padStart(2, '0')}`,
          }),
        );
      }
    }
    // Сданы январь — сентябрь каждого вида: 18 из 24.
    const done = [...ids.slice(0, 9), ...ids.slice(12, 21)];
    const items = [];
    for (const id of done) items.push({ id, version: await versionOf(request, id) });
    const batch = await request.post('/api/reports/submit', {
      headers: { origin: o.origin },
      data: { date: bishkek(), items },
    });
    expect(batch.status(), await batch.text()).toBe(200);
    expect(((await batch.json()) as { done: number }).done).toBe(18);

    await openByCode(page, cp.path, cp.code, name);
    await expect(page.locator('[data-pub-state]')).toBeVisible();
    await expect(section(page, 'main')).toBeVisible();
    await expect(section(page, 'main')).toContainText(`Отчёты ${year}: сдано`);
    await expect(section(page, 'pay')).toBeVisible();
    const reports = section(page, 'reports');
    const tiles = reports.locator('[data-pub-tile]');
    if (isMobile) {
      // На телефоне «Отчёты» свёрнуты: в заголовке — итог, плиток не видно.
      await expect(reports).toHaveAttribute('data-folded', '');
      await expect(reports.locator('[data-pub-toggle]')).toContainText('сдано 18 из 24');
      await expect(tiles.first()).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Разделы страницы' })).toBeVisible();
      await reports.locator('[data-pub-toggle]').click();
    }
    await expect(tiles).toHaveCount(2);
    const t1m = reports.locator('[data-pub-tile="t1m"]');
    await expect(t1m).toBeVisible();
    await expect(t1m).toContainText('сдано 9 из 12');
    await expect(t1m).toContainText('Статистический отчёт для Нацстаткома');
    await expect(t1m.locator('[data-pub-row]')).toHaveCount(0);
    await t1m.getByRole('button').first().click();
    await expect(t1m.locator('[data-pub-row]').first()).toBeVisible();
    await expect(t1m).toContainText(`январь ${year}`);
    if (isMobile) {
      // Периодов 12: на телефоне — первые 5 и «Показать ещё 7».
      await expect(t1m.getByRole('button', { name: 'Показать ещё 7' })).toBeVisible();
    } else {
      await expect(t1m.locator('[data-pub-row]')).toHaveCount(12);
    }
  });

  test('(п. 74) просроченных отчётов нет, но не хватает на налоги — строка состояния жёлтая; после просрочки отчёта — красная', async ({
    page,
    request,
    baseURL,
  }) => {
    const o = await pageOrg(request, baseURL);
    const name = 'ОсОО «Строка состояния»';
    const cp = await pageOf(request, o, name, 'org');
    const year = bishkek().slice(0, 4);
    // НДС за прошлый месяц: сдать — в декабре, уплатить — до 25-го этого месяца; денег нет.
    const prev = new Date(`${bishkek()}T00:00:00Z`);
    prev.setUTCDate(1);
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    const nds = await manualReport(request, o.origin, {
      contractorId: cp.id,
      reportTypeCode: 'nds',
      month: prev.toISOString().slice(0, 10),
      due: `${year}-12-21`,
    });
    const amount = await request.post(`/api/reports/${nds}/amount`, {
      headers: { origin: o.origin },
      data: { version: await versionOf(request, nds), amount: 1_000_000 },
    });
    expect(amount.status(), await amount.text()).toBe(200);
    await openByCode(page, cp.path, cp.code, name);
    const state = page.locator('[data-pub-state]');
    await expect(state).toHaveAttribute('data-pub-state', 'warn');
    await expect(state).toContainText('не хватает');

    // 1-Т: срок прошёл, не сдан.
    await manualReport(request, o.origin, {
      contractorId: cp.id,
      reportTypeCode: 't1m',
      month: prev.toISOString().slice(0, 10),
      due: lastWorkday(),
    });
    await page.reload();
    await expect(state).toHaveAttribute('data-pub-state', 'bad');
    await expect(state).toContainText('просрочен 1 отчёт');
    // Замечание ведёт в «Отчёты» с плашкой «Просрочено».
    await state.getByRole('button', { name: 'просрочен 1 отчёт' }).click();
    await expect(section(page, 'reports').locator('[data-pub-tile="t1m"]')).toBeVisible();
    await expect(section(page, 'reports').locator('[data-pub-tile]')).toHaveCount(1);
  });
});

/** Маленький PDF: браузер показывает его в окне просмотра. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

/** Загрузить файл через API, как это делает браузер: начать, положить в хранилище, закончить. */
async function apiUpload(
  api: APIRequestContext,
  origin: string,
  data: Record<string, unknown> & { name: string; source: { kind: string; id: string | null } },
) {
  const start = await api.post('/api/files/uploads', {
    headers: { origin },
    data: { size: PDF.length, ...data },
  });
  expect(start.status(), await start.text()).toBe(201);
  const ticket = (await start.json()) as {
    id: string;
    upload: { url: string; headers: Record<string, string> };
  };
  const put = await api.put(ticket.upload.url, { headers: ticket.upload.headers, data: PDF });
  expect(put.status(), await put.text()).toBe(200);
  const done = await api.post(`/api/files/${ticket.id}/complete`, { headers: { origin } });
  expect(done.status(), await done.text()).toBe(200);
  return ticket.id;
}

test.describe('Этап 3: страница контрагента — раздел «Файлы» (прототип v74)', () => {
  test.beforeEach(async ({ page }) => {
    const part = () => Math.floor(Math.random() * 256);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });
  });

  test('(прототип v74) контрагент открыл свою страницу по ссылке и коду: в разделе «Файлы» плашки «Все», «Отчёты», «Документы компании»; в «Отчётах» — квитанция НДС за 09.2026 с подписью «НДС · 09.2026», PDF открывается на странице; файл, скрытый бухгалтером через «Скрыть со страницы контрагента», и файлы задач не видны', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const o = await pageOrg(request, baseURL);
    const tag = Date.now().toString(36);
    const name = 'ОсОО «Файлы»';
    const cp = await pageOf(request, o, name, 'org');
    // Квитанция к НДС за сентябрь 2026, устав и черновик договора в карточке, файл задачи.
    const nds = await manualReport(request, o.origin, {
      contractorId: cp.id,
      reportTypeCode: 'nds',
      month: '2026-09-01',
      due: '2026-10-20',
    });
    const receipt = await apiUpload(request, o.origin, {
      source: { kind: 'report', id: nds },
      name: `Квитанция НДС ${tag}.pdf`,
    });
    const charter = await apiUpload(request, o.origin, {
      source: { kind: 'manual', id: null },
      contractorId: cp.id,
      name: `Устав ${tag}.pdf`,
    });
    const draft = await apiUpload(request, o.origin, {
      source: { kind: 'manual', id: null },
      contractorId: cp.id,
      name: `Черновик договора ${tag}.pdf`,
    });
    const options = (await (await request.get('/api/tasks/form-options')).json()) as {
      categories: { code: string }[];
    };
    const created = await request.post('/api/tasks', {
      headers: { origin: o.origin },
      data: {
        title: `Собрать первичку ${tag}`,
        description: '',
        categoryCode: options.categories[0]!.code,
        contractorId: cp.id,
        executorEmployeeId: o.owner,
        term: 'day',
        dueDate: '2099-12-30',
        needFile: false,
        confirm: false,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { id: taskId } = (await created.json()) as { id: string };
    await apiUpload(request, o.origin, {
      source: { kind: 'task', id: taskId },
      name: `Файл задачи ${tag}.pdf`,
    });

    // Бухгалтер скрывает черновик в Файловом менеджере: «…» → «Скрыть со страницы контрагента».
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto('/app/files');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await search(page, isMobile, `Черновик договора ${tag}`);
    const row = page.locator(`[data-grid] [data-id="${draft}"]`);
    await row.locator('[data-row-menu]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: 'Скрыть со страницы контрагента' })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Файл скрыт со страницы контрагента' }),
    ).toBeVisible();

    // Контрагент открывает страницу по коду.
    await openByCode(page, cp.path, cp.code, name);
    const files = section(page, 'files');
    if (isMobile) {
      // На телефоне раздел свёрнут, в заголовке — число файлов.
      await expect(files).toHaveAttribute('data-folded', '');
      await expect(files.locator('[data-pub-toggle]')).toContainText('2 файла');
      await files.locator('[data-pub-toggle]').click();
    }
    const plates = files.locator('[data-pub-ff]');
    await expect(plates).toHaveCount(3);
    expect(
      await plates.evaluateAll((els) => els.map((e) => e.getAttribute('data-pub-ff'))),
    ).toEqual(['', 'rep', 'doc']);
    await expect(plates.nth(0)).toContainText('Все');
    await expect(plates.nth(1)).toContainText('Отчёты');
    await expect(plates.nth(2)).toContainText('Документы компании');
    const rows = files.locator('[data-pub-fo]');
    await expect(rows).toHaveCount(2);
    await expect(files.locator(`[data-pub-fo="${charter}"]`)).toBeVisible();
    await expect(files).not.toContainText('Черновик договора');
    await expect(files).not.toContainText('Файл задачи');

    // «Отчёты»: квитанция НДС с подписью «НДС · 09.2026».
    await plates.nth(1).click();
    await expect(rows).toHaveCount(1);
    const receiptRow = files.locator(`[data-pub-fo="${receipt}"]`);
    await expect(receiptRow).toContainText(`Квитанция НДС ${tag}.pdf`);
    await expect(receiptRow).toContainText('НДС · 09.2026');

    // PDF открывается в окне просмотра на странице, рядом — «Скачать».
    await receiptRow.click();
    const viewer = page.getByRole('dialog', { name: `Квитанция НДС ${tag}.pdf` });
    const frame = viewer.locator('iframe');
    await expect(frame).toHaveAttribute('src', `${cp.path}/files/${receipt}`);
    await expect(viewer.getByRole('link', { name: 'Скачать' })).toHaveAttribute(
      'href',
      `${cp.path}/files/${receipt}?download=1`,
    );
    const pdf = await page.request.get(`${cp.path}/files/${receipt}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    // Скрытый файл и файл задачи по ссылке страницы тоже не открываются.
    // Сайт в таком случае возвращает на саму страницу, без ссылки на хранилище.
    const hidden = await page.request.get(`${cp.path}/files/${draft}`, { maxRedirects: 0 });
    expect(hidden.status()).toBe(303);
    expect(hidden.headers().location?.endsWith(cp.path)).toBe(true);
  });
});
