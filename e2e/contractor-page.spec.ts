import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { search } from './admin';
import {
  botMessages,
  DEMO_PASSWORD,
  defaultResponsible,
  hire,
  linkTelegram,
  pressStart,
  signIn,
  uniqueChat,
  uniqueLogin,
} from './helpers';
import { orgWithTypes } from './orgs';
import {
  clearCookiesButWelcome,
  closeDone,
  forgetWelcome,
  PAGE_HELP,
  pageHint,
  WELCOME_COOKIE,
} from './page-help';

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
    await expect(page.getByRole('button', { name: 'Открыть' })).toBeEnabled();
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
    // Подвал: у организации, которая принимает файлы от контрагентов, — «…и отправлять файлы
    // бухгалтеру» (доработки 14.11.2026, блок 2); общая часть — одна.
    await expect(page.getByText(/Вопросы — вашему бухгалтеру\.$/)).toBeVisible();
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
    await expect(page.getByRole('button', { name: 'Открыть' })).toBeEnabled();
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
    const passwordSet = await staff.post('/api/auth/password', {
      headers: { origin: staffOrigin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(passwordSet.status()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(staff, staffOrigin, chat);
    await staff.dispose();

    const name = `ОсОО «Закрытие ${Date.now().toString(36)}»`;
    const { origin, id, code, path, inn } = await enabledPage(request, baseURL, name, employee.id);
    // Браузер контрагента запомнил код.
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Открыть' })).toBeEnabled();
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

  test('(проверка прототипа v86) код доступа в блоке «Страница контрагента» копируется нажатием на него: «Код … скопирован», действие — в истории контрагента', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const name = `ОсОО «Код ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}»`;
    const { origin, id, code } = await enabledPage(request, baseURL, name);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/cps/all');
    const rows = page.locator('[data-grid] [data-id]');
    await expect(rows.first()).toBeVisible();
    await search(page, isMobile, name);
    await rows.filter({ hasText: name }).first().getByText(name, { exact: true }).click();
    const card = page.getByRole('dialog', { name });
    const shown = `${code.slice(0, 3)} ${code.slice(3)}`;
    const button = card.getByRole('button', { name: `Код доступа ${shown}: скопировать` });
    await expect(button).toHaveAttribute('title', 'Нажмите, чтобы скопировать код');
    await button.click();
    await expect(
      page.getByRole('status').filter({ hasText: `Код ${shown} скопирован` }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await expect
      .poll(async () => {
        const res = await request.get(`/api/contractors/${id}/history`);
        const { items } = (await res.json()) as { items: { entity: string; action: string }[] };
        return items.some((h) => h.entity === 'contractor_page' && h.action === 'page_code_copy');
      })
      .toBe(true);
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
  // «Открыть» доступна, когда React подхватил страницу: раньше поле заполнять нельзя (№ 41).
  const open = page.getByRole('button', { name: 'Открыть' });
  await expect(open).toBeEnabled();
  await page.getByLabel('Код доступа').fill(code);
  await open.click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

const section = (page: Page, key: string) => page.locator(`[data-sec="${key}"]`);

/** Страница по ссылке подхвачена React: после `goto` и `reload` нажатие раньше этого теряется (№ 41). */
const pageReady = (page: Page) =>
  expect(page.locator('[data-pub-page]')).toHaveAttribute('data-pub-ready', '');

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
      // Подпись кнопки — как в Telegram (прототип v116 `pgRqBtn`).
      await expect(card.getByRole('button', { name: 'Скопировать номер телефона' })).toBeVisible();
    }
    await pay
      .locator('[data-pay="tax"]')
      .getByRole('button', { name: 'Скопировать номер телефона' })
      .click();
    await expect(page.getByText('Номер телефона скопирован')).toBeVisible();
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
    await pageReady(page);
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
      // Примечание к файлу (прототип v95) видят только сотрудники: на странице его нет (v96).
      note: `Оригинал в сейфе ${tag}`,
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
    await expect(files.locator(`[data-pub-fo="${charter}"]`)).toContainText(`Устав ${tag}.pdf`);
    await expect(page.locator('body')).not.toContainText('Оригинал в сейфе');
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

// Доработки 14.11.2026, блок 6, этап 3, поток К (прототип v116 modules/cp-paid.js): «Я оплатил» с
// чеком, «По месяцам» и «Перечислить», код на 1 день, «Забыли код? Прислать в Telegram».

type Texts = Record<string, string>;

/** Тексты словаря интерфейса (`GET /api/l10n`): тест не копирует длинные строки. */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

/** Текст словаря с подстановками `{имя}`. */
function text(texts: Texts, key: string, values: Record<string, string | number> = {}) {
  const raw = texts[key];
  expect(raw, key).toBeTruthy();
  return Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), raw!);
}

/** Сумма на экране — с неразрывными пробелами: в сравнении любой пробел. */
const som = (value: string) =>
  new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s'));

/** Шаги «Я оплатил»: у каждого — номер в кружке и текст из подсказки `paidSteps`. */
const paidSteps = () =>
  pageHint('paidSteps')
    .split('|')
    .map((s) => new RegExp(`^\\d+${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));

/** Настоящий PDF по содержимому: сервер проверяет начало файла, а не расширение. */
const pdfBytes = () =>
  Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
    'latin1',
  );

/** Раздел страницы раскрыт: на телефоне он свёрнут, кроме «Главного» и «Как оплатить». */
async function unfold(page: Page, key: string, isMobile: boolean) {
  const sec = section(page, key);
  if (isMobile) {
    await expect(sec).toHaveAttribute('data-folded', '');
    // «Свёрнуто» видно уже в HTML сервера, а нажатие работает, когда React подхватил страницу и узнал
    // телефон: тогда `aria-expanded` — false (№ 41).
    const toggle = sec.locator('[data-pub-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(sec).not.toHaveAttribute('data-folded', '');
  }
  return sec;
}

test.describe('Доработки 14.11, блок 6: страница контрагента — оплата и код', () => {
  test.beforeEach(async ({ page }) => {
    const part = () => Math.floor(Math.random() * 256);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });
  });

  test('(приёмка блока 6) на странице контрагента «Я оплатил» без чека не отправляется; с чеком у месяца «Ожидает подтверждения»; «Принять» у чека открывает «Поступление от контрагента» с этим чеком в файлах, после записи чек — у поступления, у месяца — «Оплачено»', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    // Своя организация, отчёт с суммой, два открытия страницы, окна «Перечислить» и «Я оплатил», у
    // сотрудника — «Отправленные файлы», окно чека и «Поступление от контрагента» с прикреплением.
    test.slow();
    const texts = await dictionary(request);
    const o = await pageOrg(request, baseURL);
    const tag = Date.now().toString(36);
    const name = `ОсОО «Оплата ${tag}»`;
    const cp = await pageOf(request, o, name, 'org');
    // НДС за прошлый месяц со сроком в этом году: «Отчёты» показывают год срока сдачи.
    const prev = new Date(`${bishkek()}T00:00:00Z`);
    prev.setUTCDate(1);
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    const nds = await manualReport(request, o.origin, {
      contractorId: cp.id,
      reportTypeCode: 'nds',
      month: prev.toISOString().slice(0, 10),
      due: `${bishkek().slice(0, 4)}-12-21`,
    });
    const amount = await request.post(`/api/reports/${nds}/amount`, {
      headers: { origin: o.origin },
      data: { version: await versionOf(request, nds), amount: 467_050 },
    });
    expect(amount.status(), await amount.text()).toBe(200);

    await openByCode(page, cp.path, cp.code, name);
    // «Как оплатить»: подпись реквизита и «Я оплатил» у карточки «Налоги».
    const tax = section(page, 'pay').locator('[data-pay="tax"]');
    await expect(tax.locator('[data-pay-head]')).not.toBeEmpty();
    await expect(tax.locator('[data-pub-paid="tax"]')).toHaveText(text(texts, 'pub.paid.btn'));
    await expect(tax.locator('[data-pay-wait]')).toHaveCount(0);

    // «Отчёты» → «По месяцам»: к оплате, оплачено, осталось и «Не оплачено».
    const reports = await unfold(page, 'reports', isMobile);
    await reports.getByRole('button', { name: text(texts, 'pub.rep.by_month') }).click();
    const month = reports
      .locator('[data-pub-tile]')
      .filter({ has: page.locator('[data-pub-month-pay]') });
    await expect(month).toHaveCount(1);
    await expect(month.locator('[data-pub-month-pay]')).toHaveText(
      som('к оплате 4 670,50 · оплачено 0 · осталось 4 670,50'),
    );
    await expect(month.locator('[data-pub-mpay]')).toHaveAttribute('data-pub-mpay', 'unpaid');
    await expect(month.locator('[data-pub-mpay]')).toHaveText(text(texts, 'pub.mpay.unpaid'));

    // «Перечислить»: остаток месяца и «Я оплатил» — окно с суммой остатка.
    await month.locator('[data-pub-send]').click();
    const send = page.getByRole('dialog').filter({ has: page.locator('[data-pub-send-dlg]') });
    await expect(send.locator('[data-pub-send-left]')).toHaveText(som('4 670,50 сом'));
    await send.locator('[data-pub-send-paid]').click();
    const paid = page.getByRole('dialog', { name: text(texts, 'pub.paid.title') });
    await expect(paid.locator('[data-pub-paid-sum]')).toHaveValue(som('4 670,50'));
    await expect(paid.getByText(text(texts, 'pub.paid.info'))).toBeVisible();
    // Что сделать — по шагам (доработки 15.11.2026, пункт 3.4); выбора «что оплатили» здесь нет.
    await expect(paid.locator('[data-pub-paid-steps] li')).toHaveText(paidSteps());
    await expect(paid.locator('[data-chip-select]')).toHaveCount(0);
    // Без чека «Отправить» неактивна.
    const ok = paid.locator('[data-pub-paid-ok]');
    await expect(ok).toBeDisabled();
    const fileName = `чек-${tag}.pdf`;
    await paid
      .locator('[data-pub-paid-file]')
      .setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: pdfBytes() });
    await expect(ok).toBeEnabled();
    await ok.click();
    await expect(paid).toBeHidden();
    await closeDone(page, text(texts, 'cph.paid.done_t'), pageHint('paidDone'));

    // У месяца — «Ожидает подтверждения», у карточки «Налоги» — когда и сколько сообщили.
    await expect(month.locator('[data-pub-mpay]')).toHaveAttribute('data-pub-mpay', 'wait');
    await expect(month.locator('[data-pub-mpay]')).toHaveText(text(texts, 'pub.mpay.wait'));
    await expect(tax.locator('[data-pay-wait]')).toContainText(text(texts, 'pub.mpay.wait'));
    await expect(tax.locator('[data-pay-wait]')).toContainText(som('4 670,50 сом'));
    // Чек — в «Отправленных вами».
    const files = await unfold(page, 'files', isMobile);
    await expect(
      files.locator('[data-pub-sent-row]').filter({ hasText: fileName }),
    ).toHaveAttribute('data-pub-sent-row', 'new');
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(wide).toBe(false);

    // Бухгалтер (вход владельца — в том же браузере) в «Отправленных файлах» принимает чек: открывается
    // «Поступление от контрагента» с суммой месяца, и чек уже стоит в поле файлов (прототип v119
    // `rcptFileRow`) — при сохранении он прикрепляется к поступлению без повторной загрузки. У контрагента
    // «Файл к поступлению обязателен»: принятый чек его засчитывает, другого файла не нужно.
    const moneyCard = (await (
      await request.get(`/api/contractors/${cp.id}/money`, { maxRetries: 2 })
    ).json()) as { contractor: { version: number } };
    const needFile = await request.patch(`/api/contractors/${cp.id}/money-settings`, {
      headers: { origin: o.origin },
      data: { version: moneyCard.contractor.version, needReceiptFile: true },
    });
    expect(needFile.status(), await needFile.text()).toBe(200);
    // Со страницы по ссылке — уходим до входа сотрудника в том же браузере (№ 6).
    await page.goto('about:blank');
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto('/app/files/sent');
    const grid = page.locator('[data-files-sent] [data-grid]');
    await expect(grid).toBeVisible();
    // Ответ поиска — до нажатия в строке (docs/typical-mistakes.md № 27).
    const found = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname === '/api/files/sent' && url.searchParams.get('q') === tag;
    });
    await search(page, isMobile, tag);
    expect((await found).status()).toBe(200);
    const line = grid.locator('[data-id]').filter({ hasText: fileName });
    await expect(line).toContainText(text(texts, 'files.sent.st.new'));
    await line.getByText(fileName, { exact: true }).click();
    await page.getByRole('dialog', { name: fileName }).locator('[data-sent-window-accept]').click();
    const money = page.getByRole('dialog', { name: text(texts, 'money.in.title') });
    await expect(money.locator('[data-receipt-total]')).toHaveValue(som('4 670,50'));
    await expect(money.locator(`[data-receipt-row="${nds}"]`)).toHaveValue(som('4 670,50'));
    const chip = money.locator('[data-sent-receipt]');
    await expect(chip).toContainText(fileName);
    await expect(chip).toContainText(text(texts, 'cppage.rcpt.file_hint'));
    await expect(chip.locator('[data-sent-receipt-remove]')).toHaveText(
      text(texts, 'cppage.rcpt.file_remove'),
    );
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/contractors/${cp.id}/receipts`,
    );
    const attached = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /^\/api\/files\/sent\/[^/]+\/attach$/.test(new URL(r.url()).pathname),
    );
    await money.getByRole('button', { name: text(texts, 'money.in.ok') }).click();
    const savedRes = await saved;
    expect(savedRes.status()).toBe(201);
    const receiptId = ((await savedRes.json()) as { id: string }).id;
    expect((await attached).status()).toBe(201);
    await expect(money).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'money.in.done') }),
    ).toBeVisible();
    await expect(line).toContainText(text(texts, 'files.sent.st.accepted'));
    // Чек — среди файлов поступления (копия: в «Отправленных файлах» он тоже остался).
    const receiptRes = await request.get(`/api/files?kind=receipt&id=${receiptId}`, {
      maxRetries: 2,
    });
    expect(receiptRes.status(), await receiptRes.text()).toBe(200);
    const receiptFiles = (await receiptRes.json()) as { items: { name: string }[] };
    expect(receiptFiles.items.map((f) => f.name)).toEqual([fileName]);

    // Месяц на странице контрагента — оплачен.
    await page.goto(cp.path);
    await pageReady(page);
    const again = await unfold(page, 'reports', isMobile);
    await again.getByRole('button', { name: text(texts, 'pub.rep.by_month') }).click();
    const done = again
      .locator('[data-pub-tile]')
      .filter({ has: page.locator('[data-pub-month-pay]') });
    await expect(done.locator('[data-pub-month-pay]')).toHaveText(
      som('к оплате 4 670,50 · оплачено 4 670,50 · осталось 0'),
    );
    await expect(done.locator('[data-pub-mpay]')).toHaveAttribute('data-pub-mpay', 'paid');
    await expect(done.locator('[data-pub-mpay]')).toHaveText(text(texts, 'pub.mpay.paid'));
    await expect(done.locator('[data-pub-send]')).toHaveCount(0);
    await expect(section(page, 'pay').locator('[data-pay="tax"] [data-pay-wait]')).toHaveCount(0);

    // Сообщение об оплате — в истории контрагента от его имени.
    const history = (await (
      await request.get(`/api/contractors/${cp.id}/history`, { maxRetries: 2 })
    ).json()) as { items: { action: string; actor: string | null }[] };
    const claim = history.items.find((h) => h.action === 'page_paid');
    expect(claim).toBeTruthy();
    expect(claim!.actor).toBeNull();
  });

  test('(прототип v119) «Я оплатил» за обслуживание: «Принять» у чека открывает «Принять оплату за обслуживание» с этим чеком в поле файлов; после «Убрать» оплата записана без файла, чек остался принятым', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    // Своя организация, страница клиента и окно денег у сотрудника в одном тесте.
    test.slow();
    const texts = await dictionary(request);
    const o = await pageOrg(request, baseURL);
    const tag = Date.now().toString(36);
    const name = `ОсОО «Обслуживание ${tag}»`;
    const cp = await pageOf(request, o, name, 'org');

    // Клиент: «Как оплатить» → «Обслуживание» → «Я оплатил» с чеком (месяц и сумма — по умолчанию).
    await openByCode(page, cp.path, cp.code, name);
    const fee = section(page, 'pay').locator('[data-pay="fee"]');
    await fee.locator('[data-pub-paid="fee"]').click();
    const paid = page.getByRole('dialog', { name: text(texts, 'pub.paid.title') });
    const fileName = `чек-обслуживание-${tag}.pdf`;
    await paid
      .locator('[data-pub-paid-file]')
      .setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: pdfBytes() });
    await paid.locator('[data-pub-paid-ok]').click();
    await expect(paid).toBeHidden();
    await closeDone(page, text(texts, 'cph.paid.done_t'));

    // Сотрудник (вход владельца — в том же браузере): «Принять» у чека — окно оплаты с чеком.
    // Со страницы по ссылке — уходим до входа сотрудника в том же браузере (№ 6).
    await page.goto('about:blank');
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto('/app/files/sent');
    const grid = page.locator('[data-files-sent] [data-grid]');
    await expect(grid).toBeVisible();
    // Ответ поиска — до нажатия в строке (docs/typical-mistakes.md № 27).
    const found = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname === '/api/files/sent' && url.searchParams.get('q') === tag;
    });
    await search(page, isMobile, tag);
    expect((await found).status()).toBe(200);
    const line = grid.locator('[data-id]').filter({ hasText: fileName });
    await expect(line).toContainText(text(texts, 'files.sent.st.new'));
    await line.getByText(fileName, { exact: true }).click();
    await page.getByRole('dialog', { name: fileName }).locator('[data-sent-window-accept]').click();
    const money = page.getByRole('dialog', { name: text(texts, 'fee.pay.title') });
    const chip = money.locator('[data-sent-receipt]');
    await expect(chip).toContainText(fileName);
    await expect(chip).toContainText(text(texts, 'cppage.rcpt.file_hint'));

    // «Убрать»: строки чека нет, при сохранении чек к оплате не прикрепляется.
    await chip.locator('[data-sent-receipt-remove]').click();
    await expect(chip).toHaveCount(0);
    const attaches: string[] = [];
    page.on('request', (r) => {
      if (/^\/api\/files\/sent\/[^/]+\/attach$/.test(new URL(r.url()).pathname)) {
        attaches.push(r.url());
      }
    });
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/contractors/${cp.id}/fee-payments`,
    );
    await money.getByRole('button', { name: text(texts, 'fee.pay.ok') }).click();
    const savedRes = await saved;
    expect(savedRes.status()).toBe(201);
    const paymentId = ((await savedRes.json()) as { id: string }).id;
    await expect(money).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'fee.pay.saved') }),
    ).toBeVisible();
    await expect(line).toContainText(text(texts, 'files.sent.st.accepted'));
    expect(attaches).toEqual([]);
    const paymentRes = await request.get(`/api/files?kind=fee_payment&id=${paymentId}`, {
      maxRetries: 2,
    });
    expect(paymentRes.status(), await paymentRes.text()).toBe(200);
    const paymentFiles = (await paymentRes.json()) as { items: unknown[] };
    expect(paymentFiles.items).toEqual([]);
  });

  test('(приёмка блока 6) код страницы запоминается на сутки; «Забыли код? Прислать в Telegram» — код пришёл в подключённый Telegram, четвёртый раз за сутки не приходит', async ({
    page,
    request,
    baseURL,
  }) => {
    const texts = await dictionary(request);
    const name = `ОсОО «Код ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}»`;
    const { origin, id, code, path } = await enabledPage(request, baseURL, name);

    // Верный код: «В этом браузере код запомнится на 1 день», cookie этой ссылки — на сутки.
    await page.goto(path);
    await expect(page.getByText(text(texts, 'pub.code.remember'))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Открыть' })).toBeEnabled();
    await page.getByLabel('Код доступа').fill(code);
    await page.getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    const cookie = (await page.context().cookies()).find((c) => c.name.endsWith('bh_page'));
    expect(cookie).toBeTruthy();
    const left = cookie!.expires * 1000 - Date.now();
    expect(left).toBeGreaterThan(86_400_000 - 600_000);
    expect(left).toBeLessThanOrEqual(86_400_000 + 60_000);

    // Клиент подключает Telegram со своей страницы, бухгалтер подтверждает.
    const link = await page.request.post(`${path}/telegram`, { headers: { origin } });
    expect(link.status(), await link.text()).toBe(200);
    const clientChat = uniqueChat();
    expect(
      (
        await pressStart(request, ((await link.json()) as { url: string }).url, clientChat)
      ).status(),
    ).toBe(200);
    const list = (await (
      await request.get(`/api/contractors/${id}/page/telegram`, { maxRetries: 2 })
    ).json()) as {
      items: { id: string; name: string; version: number }[];
    };
    const waiting = list.items.find((i) => i.name === `@e2e_${clientChat}`)!;
    const approved = await request.post(`/api/contractors/${id}/page/telegram/${waiting.id}`, {
      headers: { origin },
      data: { action: 'approve', version: waiting.version },
    });
    expect(approved.status(), await approved.text()).toBe(200);

    // Сутки прошли — браузер код забыл: снова «Введите код доступа».
    await clearCookiesButWelcome(page.context());
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Введите код доступа' })).toBeVisible();

    // «Забыли код? Прислать в Telegram»: код — в подключённый Telegram, не больше 3 раз за сутки.
    const shown = `${code.slice(0, 3)} ${code.slice(3)}`;
    const codes = async () =>
      (await botMessages(request, clientChat)).filter((m) => m.includes(shown));
    const forgot = page.locator('[data-pub-forgot]');
    const answer = page.locator('[data-pub-forgot-answer]');
    await expect(forgot).toHaveText(text(texts, 'pub.forgot'));
    await expect(forgot).toBeEnabled();
    for (let n = 1; n <= 3; n++) {
      await forgot.click();
      await expect(answer).toHaveAttribute('data-pub-forgot-answer', 'sent');
      await expect(answer).toHaveText(text(texts, 'pub.forgot.sent'));
      await expect.poll(async () => (await codes()).length).toBe(n);
    }
    await forgot.click();
    await expect(answer).toHaveText(text(texts, 'pub.forgot.limit', { n: 3 }));
    await expect(answer).toHaveAttribute('data-pub-forgot-answer', '');
    expect(await codes()).toHaveLength(3);

    // Кодом из Telegram страница открывается; каждая отправка — в истории контрагента.
    await page.getByLabel('Код доступа').fill(code);
    await page.getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    const history = (await (
      await request.get(`/api/contractors/${id}/history`, { maxRetries: 2 })
    ).json()) as { items: { action: string }[] };
    expect(history.items.filter((h) => h.action === 'page_code_tg')).toHaveLength(3);
  });
});

// Доработки 15.11.2026 (прототип v120 modules/cp-help.js): подсказки на странице контрагента для людей
// без бухгалтерского образования — «Что это за страница?» до кода, «Добро пожаловать» один раз, обзор
// облачками по разделам с записью в историю, «Помощь» с частыми вопросами, «Словарик», шаги в «Я оплатил».
// Тексты подсказок — из наполнения (`kbUi.cpHelp` refDB.json), подписи интерфейса — из словаря.

/** Облачко обзора: номер шага и сколько всего (`cph.tour.of` — «{n} из {m}»). */
async function tourStep(page: Page): Promise<{ n: number; m: number }> {
  const label = (await page.locator('[data-tour-count]').innerText()).trim();
  const [n, m] = label.split(/\D+/).filter(Boolean).map(Number);
  return { n: n!, m: m! };
}

test.describe('Доработки 15.11: подсказки на странице контрагента', () => {
  test.beforeEach(async ({ page }) => {
    const part = () => Math.floor(Math.random() * 256);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });
  });

  test('(приёмка 15.11, пункт 2) до кода — «Что это за страница?»; после первого кода — «Добро пожаловать» и обзор облачками до «Готово!»; обзор, закрытый на шаге, — тоже в истории контрагента', async ({
    page,
    request,
    baseURL,
  }) => {
    // Своя организация, два прохода обзора по всем разделам страницы и история контрагента.
    test.slow();
    const texts = await dictionary(request);
    const o = await pageOrg(request, baseURL);
    const name = `ОсОО «Обзор ${Date.now().toString(36)}»`;
    const cp = await pageOf(request, o, name, 'org');
    const tours = async () =>
      (
        (await (
          await request.get(`/api/contractors/${cp.id}/history`, { maxRetries: 2 })
        ).json()) as { items: { action: string; changes: { field: string; to?: unknown }[] }[] }
      ).items.filter((h) => h.action === 'page_tour');

    // Этот браузер страницу ещё не видел.
    await forgetWelcome(page.context());
    await page.goto(cp.path);
    const what = page.locator('[data-pub-what]');
    await expect(what).toHaveText(pageHint('codeWhat'));
    await expect(page.locator('[data-pub-what-text]')).toBeHidden();
    await what.click();
    await expect(page.locator('[data-pub-what-text]')).toHaveText(pageHint('codeWhatX'));

    await openByCode(page, cp.path, cp.code, name);
    const welcome = page.getByRole('dialog', { name: PAGE_HELP.welcome.t! });
    await expect(welcome.locator('[data-pub-welcome]')).toContainText(PAGE_HELP.welcome.lead!);
    // Карточки — только разделов, которые видны: отчёты, оплата и файлы.
    await expect(welcome.locator('[data-pub-welcome-card]')).toHaveText([
      new RegExp(PAGE_HELP.welcome.repT!),
      new RegExp(PAGE_HELP.welcome.payT!),
      new RegExp(PAGE_HELP.welcome.filesT!),
    ]);
    await welcome.locator('[data-pub-welcome-go]').click();
    await expect(welcome).toBeHidden();
    // Отметка «уже видели» — под адресом этой страницы: второй раз приветствия здесь не будет.
    await expect
      .poll(async () =>
        (await page.context().cookies()).some(
          (c) => c.name === WELCOME_COOKIE && c.path === cp.path,
        ),
      )
      .toBe(true);

    // Обзор: облачко у каждого видимого раздела, у «Отчётов» — что значат цвета, последнее — «Готово!».
    // Название облачка — его подпись для чтения с экрана.
    const bubble = page.locator('[data-tour-bubble]');
    const next = bubble.locator('[data-tour-next]');
    const reportsStep = PAGE_HELP.tour.find((s) => s.sec === 'reports')!;
    const endStep = PAGE_HELP.tour.find((s) => s.sec === 'end')!;
    await expect(bubble).toHaveAttribute('aria-label', PAGE_HELP.tour[0]!.t);
    const { m } = await tourStep(page);
    const titles: string[] = [];
    for (let n = 1; n <= m; n++) {
      await expect(page.locator('[data-tour-count]')).toHaveText(
        text(texts, 'cph.tour.of', { n, m }),
      );
      const title = (await bubble.getAttribute('aria-label')) ?? '';
      titles.push(title);
      if (title === reportsStep.t) await expect(bubble.locator('[data-pub-legend]')).toBeVisible();
      await expect(next).toHaveText(text(texts, n === m ? 'cph.tour.done' : 'cph.tour.next'));
      await next.click();
    }
    await expect(bubble).toBeHidden();
    expect(titles).toContain(reportsStep.t);
    expect(titles.at(-1)).toBe(endStep.t);
    await expect.poll(async () => (await tours()).length).toBe(1);
    expect((await tours())[0]!.changes).toEqual([{ field: 'of', to: m }]);

    // «Помощь» → «Показать, как пользоваться страницей» — тот же обзор; «Закончить» на третьем шаге.
    await page.locator('[data-pub-help]').click();
    const help = page.locator('[data-pub-help-panel]');
    await help.locator('[data-pub-help-tour]').click();
    await expect(help).toBeHidden();
    await expect(page.locator('[data-tour-count]')).toHaveText(
      text(texts, 'cph.tour.of', { n: 1, m }),
    );
    await next.click();
    await expect(page.locator('[data-tour-count]')).toHaveText(
      text(texts, 'cph.tour.of', { n: 2, m }),
    );
    await next.click();
    await expect(page.locator('[data-tour-count]')).toHaveText(
      text(texts, 'cph.tour.of', { n: 3, m }),
    );
    // «Закончить» под текстом облачка (у крестика в углу — та же подпись, но без текста).
    await bubble.getByText(text(texts, 'cph.tour.end'), { exact: true }).click();
    await expect(bubble).toBeHidden();
    await expect.poll(async () => (await tours()).length).toBe(2);
    expect((await tours())[0]!.changes).toEqual([
      { field: 'step', to: 3 },
      { field: 'of', to: m },
    ]);
  });

  test('(приёмка 15.11, пункты 3–5) «Помощь»: вопросы о том, что есть на странице, ответ с кнопкой открывает нужное окно; «Словарик» — облачко у слова и список в «Помощи»; в «Я оплатил» — шаги и выбор «Налоги / Обслуживание»', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    // Своя организация, панель «Помощь» с двумя окнами и «Словарик».
    test.slow();
    const texts = await dictionary(request);
    const o = await pageOrg(request, baseURL);
    const name = `ОсОО «Помощь ${Date.now().toString(36)}»`;
    const cp = await pageOf(request, o, name, 'org');
    await openByCode(page, cp.path, cp.code, name);
    // Приветствие этот браузер уже видел (playwright.config.ts): страница сразу открыта.
    await expect(page.locator('[data-pub-welcome]')).toHaveCount(0);

    const openHelp = async () => {
      await page.locator('[data-pub-help]').click();
      const panel = page.getByRole('dialog', { name: pageHint('helpTitle') });
      await expect(panel.locator('[data-pub-help-panel]')).toBeVisible();
      return panel;
    };
    const question = (panel: ReturnType<Page['locator']>, q: string) =>
      panel.locator('[data-pub-faq]').filter({ has: page.getByRole('button', { name: q }) });
    const faq = (act: string) => PAGE_HELP.faq.find((q) => q.act === act && q.on)!;

    // Вопросы — о том, что на странице есть: оплата налогов и обслуживания, отправка файла.
    let panel = await openHelp();
    for (const q of [faq('goPay').q, faq('paid').q, faq('up').q]) {
      await expect(question(panel, q)).toHaveCount(1);
    }
    // Ответ раскрывается по нажатию; кнопка ответа открывает «Я оплатил» с выбором, что оплачено.
    const paidQ = question(panel, faq('paid').q);
    await paidQ.getByRole('button', { name: faq('paid').q }).click();
    await expect(paidQ.getByRole('button', { name: faq('paid').q })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await paidQ.locator('[data-pub-faq-act="paid"]').click();
    await expect(panel).toBeHidden();
    const paid = page.getByRole('dialog', { name: text(texts, 'pub.paid.title') });
    await expect(paid.locator('[data-pub-paid-steps] li')).toHaveText(paidSteps());
    const pick = paid.getByRole('group', { name: pageHint('paidPick') });
    const tax = pick.getByRole('button', { name: text(texts, 'pub.pay.tax') });
    const fee = pick.getByRole('button', { name: text(texts, 'pub.pay.fee') });
    await expect(tax).toHaveAttribute('aria-pressed', 'true');
    await fee.click();
    await expect(fee).toHaveAttribute('aria-pressed', 'true');
    await expect(tax).toHaveAttribute('aria-pressed', 'false');
    await expect(paid.getByText(pageHint('paidFile'), { exact: false })).toBeVisible();
    await paid.getByRole('button', { name: text(texts, 'btn.cancel') }).click();
    await expect(paid).toBeHidden();

    // «Как отправить документ бухгалтеру?» → «Отправить файл»: окно с тем, что можно прислать.
    panel = await openHelp();
    const upQ = question(panel, faq('up').q);
    await upQ.getByRole('button', { name: faq('up').q }).click();
    await upQ.locator('[data-pub-faq-act="up"]').click();
    await expect(panel).toBeHidden();
    const send = page.getByRole('dialog', { name: text(texts, 'pub.sent.send') });
    await expect(send.getByText(pageHint('upHint', { мб: 20, файлов: 10 }))).toBeVisible();
    await send.getByRole('button', { name: text(texts, 'btn.cancel') }).click();
    await expect(send).toBeHidden();

    // «Словарик» в «Помощи»: все слова с объяснением.
    panel = await openHelp();
    const glossQ = panel.locator('[data-pub-faq="__gloss"]');
    await glossQ.getByRole('button').first().click();
    await expect(glossQ.locator('[data-pub-help-gloss] dt')).toHaveCount(PAGE_HELP.gloss.length);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // Слово на странице подчёркнуто: по нажатию — облачко с его объяснением.
    if (isMobile) await unfold(page, 'reports', isMobile);
    const word = page.locator('[data-pub-gl]:visible').first();
    await expect(word).toBeVisible();
    await word.click();
    const pop = page.locator('[data-pub-gloss-pop]');
    await expect(pop).toBeVisible();
    const explained = (await pop.locator('p').innerText()).trim();
    expect(PAGE_HELP.gloss.map((g) => g.x)).toContain(explained);
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
  });
});
