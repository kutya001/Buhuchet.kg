import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { search } from './admin';
import {
  botMessages,
  DEMO_PASSWORD,
  defaultResponsible,
  hire,
  linkTelegram,
  openCardFold,
  pressStart,
  signIn,
  stillElement,
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

/** Заголовок окна кода (прототип v135: «Введите код», что вводить — строкой ниже). */
const codeHeading = (page: Page) => page.getByRole('heading', { name: 'Введите код', exact: true });

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
    await expect(codeHeading(page)).toBeVisible();
    // Без кода не видно ничего: ни названия контрагента, ни бухгалтерской компании (ТЗ строже
    // прототипа v135, docs/deviations.md п. К-21) — что было на экране кода, сверяется после входа.
    await expect(page.getByText(name)).toHaveCount(0);
    await expect(page.locator('[data-pub-brand]')).toHaveCount(0);
    const gateText = await page.locator('main').innerText();
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
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    // Шапка — та же бухгалтерская компания; ИНН — в «Связи» → «Ваши данные у нас» (на телефоне раздел
    // свёрнут: текст в нём есть, но не на экране); под страницей — «Обновлено …» (прототип v135).
    const brand = page.locator('#pub-top [data-pub-brand] b');
    await expect(brand).not.toBeEmpty();
    const orgName = (await brand.innerText()).trim();
    expect(orgName).not.toBe('');
    expect(gateText).not.toContain(orgName);
    await expect(page.locator('[data-sec="acc"]')).toContainText(inn);
    await expect(page.locator('[data-pub-updated]')).toHaveText(
      /^Обновлено \d{1,2} \S+, \d{2}:\d{2}$/,
    );
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
    await expect(codeHeading(page)).toBeVisible();

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
    // «Страница клиента» в карточке свёрнута до строки (прототип v137).
    const pageBox = await openCardFold(card, 'page');
    await expect(pageBox.locator('[data-cp-page-closed]')).toHaveText(
      'Страница закрыта: за сутки было 5 неверных кодов. Нажмите «Сменить код» (нет права — попросите владельца или главного бухгалтера) и отправьте контрагенту новый код.',
    );

    const changed = await request.post(`/api/contractors/${id}/page/code`, { headers: { origin } });
    expect(changed.status()).toBe(200);
    await page.goto(path);
    await expect(codeHeading(page)).toBeVisible();
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
    // «Страница клиента» в карточке свёрнута до строки (прототип v137).
    const pageBox = await openCardFold(card, 'page');
    const button = pageBox.getByRole('button', { name: `Код доступа ${shown}: скопировать` });
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

/**
 * Строка «Оплаты» (прототип v135 `poRow`): «Налоги» (`tax`) или «Услуги бухгалтера» (`fee`). Строка с
 * долгом раскрыта сама и реквизит в ней виден сразу; без долга — раскрывается по нажатию, а реквизит —
 * под «Куда переводить».
 */
async function payRow(page: Page, k: 'tax' | 'fee'): Promise<Locator> {
  const row = section(page, 'pay').locator(`[data-po="${k}"]`);
  await expect(row).toBeVisible();
  if ((await row.getAttribute('data-open')) === null) await row.locator('> button').click();
  await expect(row).toHaveAttribute('data-open', '');
  const where = row.locator(`[data-pub-det="acc-${k}"]`);
  if ((await where.count()) > 0 && (await where.getAttribute('data-open')) === null) {
    await where.locator('> button').click();
  }
  await expect(row.locator(`[data-pay="${k}"]`)).toBeVisible();
  return row;
}

/** Вид «Отчётов» из меню (прототип v135 `pubViewMenu`): сразу — «По месяцам». */
async function reportsMode(page: Page, reports: Locator, mode: 'month' | 'type' | 'due') {
  const label = { month: 'По месяцам', type: 'По видам', due: 'По срокам' }[mode];
  const button = reports.locator('[data-pub-mode]');
  if ((await button.getAttribute('data-pub-mode')) === mode) return;
  await button.click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await expect(button).toHaveAttribute('data-pub-mode', mode);
}

/** Плитка месяца или вида отчёта раскрыта (прототип `.pub-grp`, `.pub-rt`). */
async function openTile(tile: Locator) {
  await expect(tile).toBeVisible();
  if ((await tile.getAttribute('data-open')) === null) await tile.locator('> button').click();
  await expect(tile).toHaveAttribute('data-open', '');
}

/** Страница по ссылке подхвачена React: после `goto` и `reload` нажатие раньше этого теряется (№ 41). */
const pageReady = (page: Page) =>
  expect(page.locator('[data-pub-page]')).toHaveAttribute('data-pub-ready', '');

test.describe('Этап 2: страница контрагента по ссылке — разделы и компоновка', () => {
  test.beforeEach(async ({ page }) => {
    const part = () => Math.floor(Math.random() * 256);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });
  });

  test('(п. 60) с верным кодом видны «Оплата» с налогами и услугами бухгалтера, «Отчёты», «Связь» и «Цифры компании», а задач, истории и бонусов нет; после «Выключить» — «Страница недоступна. Обратитесь к вашему бухгалтеру»', async ({
    page,
    request,
    baseURL,
  }) => {
    const o = await pageOrg(request, baseURL);
    const name = 'ОсОО «Укс»';
    const cp = await pageOf(request, o, name, 'org');
    await page.goto(cp.path);
    await expect(codeHeading(page)).toBeVisible();
    await openByCode(page, cp.path, cp.code, name);
    // Разделы страницы простыми словами (прототип v135): «Оплата» (строки «Налоги» и «Услуги
    // бухгалтера»), «Отчёты», «Файлы», «Связь» (бухгалтер и «Ваши данные у нас»), «Цифры компании».
    for (const key of ['pay', 'reports', 'files', 'acc', 'kpi']) {
      await expect(section(page, key)).toHaveCount(1);
    }
    for (const k of ['tax', 'fee']) {
      await expect(section(page, 'pay').locator(`[data-po="${k}"]`)).toBeVisible();
    }
    await expect(section(page, 'acc')).toContainText('Подборова Сквозная');
    for (const absent of ['Задачи', 'Бонус']) {
      await expect(page.getByText(absent, { exact: false })).toHaveCount(0);
    }
    // «История оплат» услуг бухгалтера — не история контрагента: раздела «История» нет.
    await expect(page.getByText('История', { exact: true })).toHaveCount(0);
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

  test('(п. 67) платящий на счёт организации видит 0555 123 456 со «Скопировать номер» у «Налогов» и «Услуг бухгалтера»; платящий на кошелёк бухгалтера — основной реквизит бухгалтера у «Налогов»', async ({
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
    await expect(section(page, 'pay')).toBeVisible();
    for (const k of ['tax', 'fee'] as const) {
      // Куда переводить — в строке «Оплаты» (прототип v135 `pubPay`).
      const card = (await payRow(page, k)).locator(`[data-pay="${k}"]`);
      await expect(card.locator('[data-pay-number]')).toHaveText('0555 123 456');
      await expect(card).toContainText('По номеру телефона');
      await expect(card).toContainText('Бакай Банк');
      await expect(card).toContainText('M-Bank');
      await expect(card.getByRole('button', { name: 'Скопировать номер' })).toBeVisible();
    }
    await section(page, 'pay')
      .locator('[data-pay="tax"]')
      .getByRole('button', { name: 'Скопировать номер' })
      .click();
    await expect(page.getByText('Номер телефона скопирован')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0555123456');

    const emp = await pageOf(request, o, 'ИП На кошелёк', 'emp');
    await openByCode(page, emp.path, emp.code, 'ИП На кошелёк');
    const empTax = (await payRow(page, 'tax')).locator('[data-pay="tax"]');
    await expect(empTax.locator('[data-pay-number]')).toHaveText('0700 333 444');
    // Реквизит сотрудника — с пометкой «ваш бухгалтер» у получателя.
    await expect(empTax).toContainText('ваш бухгалтер');
    const empFee = (await payRow(page, 'fee')).locator('[data-pay="fee"]');
    await expect(empFee.locator('[data-pay-number]')).toHaveText('0555 123 456');
  });

  test('(п. 68) страница с 24 отчётами на телефоне: сразу видны шапка, «Что нужно сделать» и «Оплата»; «Отчёты» свёрнуты с «сдано 18 из 24», внутри — месяцы, а в виде «По видам» — плитки с «сдано N из M», касание плитки открывает пояснение и периоды', async ({
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
    // Сверху — блок состояния («Что нужно сделать» или «Всё в порядке») и «Оплата».
    await expect(page.locator('[data-pub-state]')).toBeVisible();
    await expect(section(page, 'pay')).toBeVisible();
    const reports = section(page, 'reports');
    const tiles = reports.locator('[data-pub-tile]');
    // Итог раздела — в его заголовке: «сдано 18 из 24 · следующий до …».
    await expect(reports.locator('[data-pub-sum]')).toContainText('сдано 18 из 24');
    if (isMobile) {
      // На телефоне «Отчёты» свёрнуты: в заголовке — итог, месяцев не видно.
      await expect(reports).toHaveAttribute('data-folded', '');
      await expect(tiles.first()).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Разделы страницы' })).toBeVisible();
      await unfold(page, 'reports', isMobile);
    }
    // Сразу — «По месяцам» (там деньги и «Оплатить»); плитки по видам — из меню вида.
    await expect(reports.locator('[data-pub-mode]')).toHaveAttribute('data-pub-mode', 'month');
    await expect(tiles.first()).toBeVisible();
    await reportsMode(page, reports, 'type');
    await expect(tiles).toHaveCount(2);
    const t1m = reports.locator('[data-pub-tile="t1m"]');
    await expect(t1m).toBeVisible();
    await expect(t1m).toContainText('сдано 9 из 12');
    await expect(t1m.locator('[data-pub-row]')).toHaveCount(0);
    await openTile(t1m);
    // Пояснение вида — внутри раскрытой плитки, куда сдаётся — простыми словами.
    await expect(t1m.locator('[data-pub-type-note]')).toContainText(
      'Статистический отчёт для Нацстаткома',
    );
    await expect(t1m.locator('[data-pub-row]').first()).toBeVisible();
    await expect(t1m).toContainText(`январь ${year}`);
    if (isMobile) {
      // Периодов 12: на телефоне — первые 5 и «Показать ещё 7».
      await expect(t1m.getByRole('button', { name: 'Показать ещё 7' })).toBeVisible();
    } else {
      await expect(t1m.locator('[data-pub-row]')).toHaveCount(12);
    }
  });

  test('(п. 74) не хватает на налоги — в «Что нужно сделать» сумма и «Оплатить» с окном «Оплатить налоги»; отчёт, не сданный в срок, — отдельной строкой «Их сдаёт бухгалтер», нажатие ведёт в «Отчёты» с плашкой «Не сданы в срок»', async ({
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
    // Вместо цветной строки состояния — «Что нужно сделать» с суммой и кнопкой (прототип v135).
    const state = page.locator('[data-pub-state]');
    await expect(state).toHaveAttribute('data-pub-state', 'todo');
    const tax = state.locator('[data-do="tax"]');
    await expect(tax).toContainText('Перевести на налоги');
    await expect(tax).toContainText(som('10 000 сом'));
    await expect(state.locator('[data-do="late"]')).toHaveCount(0);
    await expect(section(page, 'pay').locator('[data-po="tax"] [data-pay-st="short"]')).toHaveText(
      som('не хватает 10 000 сом'),
    );
    // «Оплатить» — окно с суммой и тем, куда переводить.
    await expect(tax.locator('[data-pub-pay="tax"]')).toHaveText('Оплатить');
    await tax.locator('[data-pub-pay="tax"]').click();
    const payWindow = page.getByRole('dialog', { name: 'Оплатить налоги' });
    await expect(payWindow.locator('[data-pub-sendsum]')).toContainText(som('10 000 сом'));
    await expect(payWindow.locator('[data-pay="tax"] [data-pay-number]')).toHaveText(
      '0555 123 456',
    );
    await page.keyboard.press('Escape');
    await expect(payWindow).toBeHidden();

    // 1-Т: срок прошёл, не сдан.
    await manualReport(request, o.origin, {
      contractorId: cp.id,
      reportTypeCode: 't1m',
      month: prev.toISOString().slice(0, 10),
      due: lastWorkday(),
    });
    await page.reload();
    await pageReady(page);
    // Несданный в срок отчёт — спокойно, без красного: его сдаёт бухгалтер.
    const late = state.locator('[data-do="late"]');
    await expect(late).toContainText('1 отчёт не сдан в срок');
    await expect(late).toContainText('Их сдаёт бухгалтер');
    // Строка ведёт в «Отчёты» с плашкой «Не сданы в срок»: остался месяц с этим отчётом.
    await late.getByRole('button', { name: '1 отчёт не сдан в срок' }).click();
    const reports = section(page, 'reports');
    await expect(reports).not.toHaveAttribute('data-folded', '');
    await expect(reports.locator('[data-pub-chip="late"]')).toHaveAttribute('aria-pressed', 'true');
    const month = reports.locator('[data-pub-tile]');
    await expect(month).toHaveCount(1);
    await expect(month.locator('[data-pub-late]')).toHaveText('1 отчёт не сдан в срок');
    await openTile(month);
    await expect(month.locator('[data-pub-row]')).toHaveCount(1);
    await expect(month.locator('[data-pub-row][data-late] [data-pub-due]')).toContainText(
      'срок был',
    );
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
    // Долгий путь: «Файловый менеджер», страница по коду, окна просмотра по трём спискам.
    test.slow();
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

    // Файл открывается в окне просмотра на странице (доработки 16.11.2026, блок 5), рядом — «Скачать».
    await receiptRow.click();
    const viewer = page.getByRole('dialog', { name: `Квитанция НДС ${tag}.pdf` });
    await expect(viewer.locator(`[data-file-viewer="${receipt}"]`)).toBeVisible();
    // Окно прочитало байты файла по ссылке страницы (`view=1`) и узнало в них PDF, а не открыло пустую рамку.
    await expect(viewer.locator('[data-fv="pdf"] iframe')).toHaveAttribute('src', /^blob:/);
    await expect(viewer.locator('[data-fv-download]')).toHaveAttribute(
      'href',
      `${cp.path}/files/${receipt}?download=1`,
    );
    // В списке «Отчёты» один файл — листать некуда (у окна потока И «‹ ›» тогда нет вовсе).
    await expect(viewer.locator('[data-fv-prev]:enabled, [data-fv-next]:enabled')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    // «Все»: «‹ ›» листают по файлам того же списка, в порядке строк.
    await plates.nth(0).click();
    await expect(rows).toHaveCount(2);
    const order = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-pub-fo')));
    const names = new Map([
      [charter, `Устав ${tag}.pdf`],
      [receipt, `Квитанция НДС ${tag}.pdf`],
    ]);
    await rows.first().click();
    const first = page.getByRole('dialog', { name: names.get(order[0]!) });
    await expect(first.locator('[data-fv-prev]')).toBeDisabled();
    await first.locator('[data-fv-next]').click();
    const second = page.getByRole('dialog', { name: names.get(order[1]!) });
    await expect(second.locator(`[data-file-viewer="${order[1]}"]`)).toBeVisible();
    await expect(second.locator('[data-fv-next]')).toBeDisabled();
    await expect(second.locator('[data-fv-download]')).toHaveAttribute(
      'href',
      `${cp.path}/files/${order[1]}?download=1`,
    );
    await page.keyboard.press('Escape');
    await expect(second).toBeHidden();
    // «Отчёты»: файл отчёта в плитке НДС открывается в том же окне, «‹ ›» — по файлам этого отчёта.
    const reports = await unfold(page, 'reports', isMobile);
    await reportsMode(page, reports, 'type');
    const ndsTile = reports.locator('[data-pub-tile="nds"]');
    await openTile(ndsTile);
    await expect(ndsTile.locator('[data-pub-row]').first()).toBeVisible();
    // На телефоне у плитки первые 5 периодов: остальные — «Показать ещё».
    const moreRows = ndsTile.getByRole('button', { name: /^Показать ещё/ });
    if (await moreRows.isVisible()) await moreRows.click();
    await ndsTile.locator(`[data-pub-file="${receipt}"]`).click();
    const reportFile = page.getByRole('dialog', { name: `Квитанция НДС ${tag}.pdf` });
    await expect(reportFile.locator(`[data-file-viewer="${receipt}"]`)).toBeVisible();
    await expect(reportFile.locator('[data-fv="pdf"] iframe')).toHaveAttribute('src', /^blob:/);
    await expect(reportFile.locator('[data-fv-prev]:enabled, [data-fv-next]:enabled')).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
    await expect(reportFile).toBeHidden();
    const pdf = await page.request.get(`${cp.path}/files/${receipt}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    // Окно читает файл с `view=1`: переход на подписанную ссылку-вложение.
    const viewed = await page.request.get(`${cp.path}/files/${receipt}?view=1`, {
      maxRedirects: 0,
    });
    expect(viewed.status()).toBe(302);
    expect(viewed.headers()['cache-control']).toContain('no-store');
    // Скрытый файл и файл задачи по ссылке страницы тоже не открываются.
    // Сайт в таком случае возвращает на саму страницу, без ссылки на хранилище, а окну — 404.
    const hidden = await page.request.get(`${cp.path}/files/${draft}`, { maxRedirects: 0 });
    expect(hidden.status()).toBe(303);
    expect(hidden.headers().location?.endsWith(cp.path)).toBe(true);
    const hiddenView = await page.request.get(`${cp.path}/files/${draft}?view=1`, {
      maxRedirects: 0,
    });
    expect(hiddenView.status()).toBe(404);
    expect(hiddenView.headers().location).toBeUndefined();
    // Без запомненного кода (запрос сотрудника, cookie страницы нет) и у неизвестной страницы — тот же
    // 404 без перехода и без ссылки на хранилище.
    for (const refused of [
      await request.get(`${cp.path}/files/${receipt}?view=1`, { maxRedirects: 0 }),
      await page.request.get(`/${SLUG}/inn/00000000000000/files/${receipt}?view=1`, {
        maxRedirects: 0,
      }),
    ]) {
      expect(refused.status()).toBe(404);
      expect(refused.headers().location).toBeUndefined();
      expect(refused.headers()['cache-control']).toContain('no-store');
    }
  });
});

// Доработки 14.11.2026, блок 6, этап 3, поток К (прототип v116 modules/cp-paid.js; простыми словами —
// v135): «Я оплатил» с чеком, «По месяцам» и «Оплатить», код на 1 день, «Забыли код?».

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

/** Настоящий PDF по содержимому: сервер проверяет начало файла, а не расширение. */
const pdfBytes = () =>
  Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
    'latin1',
  );

/** Раздел страницы раскрыт: на телефоне он свёрнут, кроме «Оплаты». */
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

  test('(приёмка блока 6; доработки 16.11, блок 1) на странице контрагента «Я оплатил» без чека не отправляется; с чеком у месяца «бухгалтер проверяет чек»; «Принять» у чека открывает «Поступление от контрагента» с этим чеком в файлах, «Отменить» оставляет чек «Новый»; после записи чек принят и — у поступления, у месяца — «оплачено»', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    // Своя организация, отчёт с суммой, три открытия страницы, окна «Оплатить» и «Я оплатил», у
    // сотрудника — «Отправленные файлы», окно чека, «Поступление от контрагента» с «Отменить», снова
    // «Принять» и «Сохранить» с прикреплением.
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
    // «Что нужно сделать»: сколько перевести на налоги.
    const todo = page.locator('[data-pub-state] [data-do="tax"]');
    await expect(todo).toContainText(som('4 670,50 сом'));
    // «Оплата» → «Налоги»: строка с долгом раскрыта — «не хватает», куда переводить и «Я оплатил».
    const tax = await payRow(page, 'tax');
    await expect(tax.locator('[data-pay-st="short"]')).toHaveText(
      som(text(texts, 'pub.pay.st.short', { sum: '4 670,50 сом' })),
    );
    await expect(tax.locator('[data-pay-number]')).not.toBeEmpty();
    await expect(tax.locator('[data-pub-paid="tax"]')).toHaveText(text(texts, 'pub.paid.btn'));
    await expect(tax.locator('[data-pay-wait]')).toHaveCount(0);

    // «Отчёты» — сразу «По месяцам»: в шапке месяца — «осталось», внутри — к оплате, оплачено, осталось.
    const reports = await unfold(page, 'reports', isMobile);
    await expect(reports.locator('[data-pub-mode]')).toHaveAttribute('data-pub-mode', 'month');
    const month = reports.locator('[data-pub-tile]');
    await expect(month).toHaveCount(1);
    await expect(month.locator('[data-pub-month-left]')).toHaveText(
      som(text(texts, 'pub.rep.g.left', { sum: '4 670,50 сом' })),
    );
    await openTile(month);
    await expect(month.locator('[data-pub-month-pay]')).toHaveText(
      som('к оплате 4 670,50 · оплачено 0 · осталось 4 670,50'),
    );

    // «Оплатить» у месяца: сумма остатка со «Скопировать», куда переводить и «Я оплатил» — окно с этой
    // суммой.
    await month.locator('[data-pub-send]').click();
    const send = page.getByRole('dialog').filter({ has: page.locator('[data-pub-pay-dlg="tax"]') });
    await expect(send.locator('[data-pub-sendsum]')).toContainText(som('4 670,50 сом'));
    await expect(send.locator('[data-pay="tax"] [data-pay-number]')).toHaveText('0555 123 456');
    await send.locator('[data-pub-pay-paid]').click();
    const paid = page.getByRole('dialog', { name: text(texts, 'pub.paid.title'), exact: true });
    await expect(paid.locator('[data-pub-paid-sum]')).toHaveValue(som('4 670,50'));
    // Сверху — «это не оплата» (прототип v135); выбора «что оплатили» здесь нет.
    await expect(paid.locator('[data-pub-paid-note-top]')).toHaveText(pageHint('paidNote'));
    await expect(paid.locator('[data-chip-select]')).toHaveCount(0);
    // Без чека «Отправить чек» неактивна.
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

    // У месяца — «бухгалтер проверяет чек»; у строки «Налоги» — «Бухгалтер проверяет», когда и сколько
    // отправили, и «Отправить ещё чек»; в «Что нужно сделать» — то же одной строкой.
    await expect(month.locator('[data-pub-month-wait]')).toHaveText(text(texts, 'pub.rep.g.wait'));
    await expect(tax.locator('[data-pay-wait]')).toContainText(text(texts, 'pub.wait.pill'));
    await expect(tax.locator('[data-pay-wait]')).toContainText(som('4 670,50 сом'));
    await expect(tax.locator('[data-pub-paid="tax"]')).toHaveText(text(texts, 'pub.paid.again'));
    await expect(todo).toContainText(som('4 670,50 сом · бухгалтер проверяет'));
    // Чек — в «Файлах», на вкладке «От вас» (она открыта сама: от бухгалтера файлов нет).
    const files = await unfold(page, 'files', isMobile);
    await expect(files.locator('[data-pub-ft="you"]')).toHaveAttribute('aria-selected', 'true');
    await expect(
      files.locator('[data-pub-sent-row]').filter({ hasText: fileName }),
    ).toHaveAttribute('data-pub-sent-row', 'new');
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(wide).toBe(false);

    // Бухгалтер (вход владельца — в том же браузере) в «Отправленных файлах» принимает чек: открывается
    // «Поступление от контрагента» с суммой месяца, и чек уже стоит в поле файлов (прототип v119
    // `rcptFileRow`) — при сохранении он принимается и прикрепляется к поступлению без повторной загрузки;
    // «Отменить» ничего не меняет — чек «Новый» (прототип v121). У контрагента «Файл к поступлению
    // обязателен»: чек его засчитывает, другого файла не нужно.
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
    // У чека с оплатой рядом с «Принять» — «Принять только файл» (доработки 16.11, блок 1, пункт 5).
    const sentWin = page.getByRole('dialog', { name: fileName });
    await expect(sentWin.locator('[data-sent-window-accept-file]')).toHaveText(
      text(texts, 'files.sent.accept_only'),
    );
    await sentWin.locator('[data-sent-window-accept]').click();
    const money = page.getByRole('dialog', { name: text(texts, 'money.in.title') });
    await expect(money.locator('[data-receipt-total]')).toHaveValue(som('4 670,50'));
    await expect(money.locator(`[data-receipt-row="${nds}"]`)).toHaveValue(som('4 670,50'));
    const chip = money.locator('[data-sent-receipt]');
    await expect(chip).toContainText(fileName);
    await expect(chip).toContainText(text(texts, 'cppage.rcpt.file_hint'));
    await expect(chip.locator('[data-sent-receipt-remove]')).toHaveText(
      text(texts, 'cppage.rcpt.file_remove'),
    );
    // «Отменить»: окно закрыто, чек «Новый», запроса «Принять» не было.
    const accepts: string[] = [];
    const onAccept = (r: { method(): string; url(): string }) => {
      if (
        r.method() === 'POST' &&
        /^\/api\/files\/sent\/[^/]+\/accept$/.test(new URL(r.url()).pathname)
      )
        accepts.push(r.url());
    };
    page.on('request', onAccept);
    await money.getByRole('button', { name: text(texts, 'btn.cancel') }).click();
    await expect(money).toBeHidden();
    await expect(line).toContainText(text(texts, 'files.sent.st.new'));
    expect(accepts).toEqual([]);
    page.off('request', onAccept);
    // В истории контрагента о чеке ничего: он не принят.
    const kept = (await (
      await request.get(`/api/contractors/${cp.id}/history`, { maxRetries: 2 })
    ).json()) as { items: { action: string }[] };
    expect(kept.items.map((h) => h.action)).not.toContain('sent_file_accept');
    // У месяца на странице контрагента — по-прежнему «бухгалтер проверяет чек».
    await page.goto(cp.path);
    await pageReady(page);
    const still = await unfold(page, 'reports', isMobile);
    await expect(still.locator('[data-pub-tile] [data-pub-month-wait]')).toHaveText(
      text(texts, 'pub.rep.g.wait'),
    );
    await page.goto('/app/files/sent');
    await expect(grid).toBeVisible();
    const refound = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname === '/api/files/sent' && url.searchParams.get('q') === tag;
    });
    await search(page, isMobile, tag);
    expect((await refound).status()).toBe(200);
    // Снова «Принять» — то же окно с чеком.
    await line.getByText(fileName, { exact: true }).click();
    await page.getByRole('dialog', { name: fileName }).locator('[data-sent-window-accept]').click();
    await expect(money.locator('[data-sent-receipt]')).toContainText(fileName);
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/contractors/${cp.id}/receipts`,
    );
    const accepted = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /^\/api\/files\/sent\/[^/]+\/accept$/.test(new URL(r.url()).pathname),
    );
    await money.getByRole('button', { name: text(texts, 'money.in.ok') }).click();
    const savedRes = await saved;
    expect(savedRes.status()).toBe(201);
    const receiptId = ((await savedRes.json()) as { id: string }).id;
    const acceptedRes = await accepted;
    expect(acceptedRes.status()).toBe(200);
    expect(acceptedRes.request().postDataJSON()).toMatchObject({
      attach: { kind: 'receipt', id: receiptId },
    });
    await expect(money).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'money.in.done') }),
    ).toBeVisible();
    await expect(line).toContainText(text(texts, 'files.sent.st.accepted'));
    // Чек — у поступления тем же файлом, что у контрагента, без копии (доработки 16.11, блок 2,
    // пункт 1): ссылка.
    const acceptedFile = ((await acceptedRes.json()) as { fileId: string }).fileId;
    const receiptRes = await request.get(`/api/files?kind=receipt&id=${receiptId}`, {
      maxRetries: 2,
    });
    expect(receiptRes.status(), await receiptRes.text()).toBe(200);
    const receiptFiles = (await receiptRes.json()) as {
      items: { id: string; name: string; linked: boolean }[];
    };
    expect(receiptFiles.items.map((f) => [f.id, f.name, f.linked])).toEqual([
      [acceptedFile, fileName, true],
    ]);
    // В «Файловом менеджере» — одна строка с обеими ссылками: «От контрагента» и поступление.
    const managed = await request.get(
      `/api/files/manager?size=all&filters=${encodeURIComponent(
        JSON.stringify({ cp: { type: 'enum', vals: [cp.id] } }),
      )}`,
      { maxRetries: 2 },
    );
    expect(managed.status(), await managed.text()).toBe(200);
    const rows = (
      (await managed.json()) as {
        items: { id: string; name: string; kind: string; links: { kind: string; id: string }[] }[];
      }
    ).items.filter((f) => f.name === fileName);
    // Вид строки — «Контрагент» (принятый файл, `FILE_LIST_KIND_OF`), ссылка — на поступление.
    expect(rows.map((f) => [f.id, f.kind, f.links.map((l) => [l.kind, l.id])])).toEqual([
      [acceptedFile, 'contractor', [['receipt', receiptId]]],
    ]);

    // Месяц на странице контрагента — оплачен.
    await page.goto(cp.path);
    await pageReady(page);
    const again = await unfold(page, 'reports', isMobile);
    const done = again.locator('[data-pub-tile]');
    await expect(done).toHaveCount(1);
    await expect(done.locator('[data-pub-month-paid]')).toHaveText(text(texts, 'pub.rep.g.paid'));
    await expect(done.locator('[data-pub-month-wait]')).toHaveCount(0);
    await openTile(done);
    await expect(done.locator('[data-pub-month-pay]')).toHaveText(
      som('к оплате 4 670,50 · оплачено 4 670,50 · осталось 0'),
    );
    await expect(done.locator('[data-pub-send]')).toHaveCount(0);
    // Денег хватает: в «Что нужно сделать» налогов нет, у строки «Налоги» чек больше не ждёт.
    await expect(page.locator('[data-pub-state] [data-do="tax"]')).toHaveCount(0);
    const paidRow = section(page, 'pay').locator('[data-po="tax"]');
    await expect(paidRow.locator('[data-pay-st="enough"]')).toHaveText(
      text(texts, 'pub.pay.st.enough'),
    );
    await expect(paidRow.locator('[data-pay-wait]')).toHaveCount(0);

    // Сообщение об оплате — в истории контрагента от его имени; чек — «прикреплён к поступлению от …».
    const history = (await (
      await request.get(`/api/contractors/${cp.id}/history`, { maxRetries: 2 })
    ).json()) as {
      items: { action: string; actor: string | null; changes: { field: string; to?: unknown }[] }[];
    };
    const claim = history.items.find((h) => h.action === 'page_paid');
    expect(claim).toBeTruthy();
    expect(claim!.actor).toBeNull();
    // Чек принят один раз — при сохранении поступления.
    const taken = history.items.filter((h) => h.action === 'sent_file_accept');
    expect(taken).toHaveLength(1);
    expect(taken[0]!.changes.map((c) => c.field)).toContain('receipt');
  });

  test('(прототип v119, v121) «Я оплатил» за обслуживание: «Принять только файл» принимает чек без окна денег; «Принять» у чека открывает «Принять оплату за обслуживание» с этим чеком в поле файлов; «Убрать» и «Вернуть»; после «Убрать» оплата записана без файла, а чек принят только в файлы контрагента', async ({
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

    // Клиент: «Оплата» → «Услуги бухгалтера» → «Я оплатил» с чеком. Долга ещё нет (месяц не оплачен, но
    // его срок не прошёл) — сумму клиент вводит сам (прототип v135 `pubPaidDlg`: сумма — долг).
    await openByCode(page, cp.path, cp.code, name);
    const fee = await payRow(page, 'fee');
    await fee.locator('[data-pub-paid="fee"]').click();
    const paid = page.getByRole('dialog', { name: text(texts, 'pub.paid.title'), exact: true });
    const fileName = `чек-обслуживание-${tag}.pdf`;
    await expect(paid.locator('[data-pub-paid-sum]')).toHaveValue('');
    await paid.locator('[data-pub-paid-sum]').fill('5000');
    await paid
      .locator('[data-pub-paid-file]')
      .setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: pdfBytes() });
    await paid.locator('[data-pub-paid-ok]').click();
    await expect(paid).toBeHidden();
    await closeDone(page, text(texts, 'cph.paid.done_t'));
    // Второй чек — для «Принять только файл»: кнопка теперь «Отправить ещё чек».
    const onlyName = `чек-только-файл-${tag}.pdf`;
    await expect(fee.locator('[data-pub-paid="fee"]')).toHaveText(text(texts, 'pub.paid.again'));
    await fee.locator('[data-pub-paid="fee"]').click();
    await paid.locator('[data-pub-paid-sum]').fill('5000');
    await paid
      .locator('[data-pub-paid-file]')
      .setInputFiles({ name: onlyName, mimeType: 'application/pdf', buffer: pdfBytes() });
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
    const money = page.getByRole('dialog', { name: text(texts, 'fee.pay.title') });
    const acceptCall = () =>
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          /^\/api\/files\/sent\/[^/]+\/accept$/.test(new URL(r.url()).pathname),
      );

    // «Принять только файл» у второго чека (доработки 16.11, блок 1, пункт 5): окно денег не
    // открывается, чек принят только в файлы контрагента.
    const onlyLine = grid.locator('[data-id]').filter({ hasText: onlyName });
    await expect(onlyLine).toContainText(text(texts, 'files.sent.st.new'));
    await onlyLine.getByText(onlyName, { exact: true }).click();
    const onlyTaken = acceptCall();
    await page
      .getByRole('dialog', { name: onlyName })
      .locator('[data-sent-window-accept-file]')
      .click();
    const onlyRes = await onlyTaken;
    expect(onlyRes.status()).toBe(200);
    expect(onlyRes.request().postDataJSON()).not.toHaveProperty('attach');
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'files.sent.accepted_only') }),
    ).toBeVisible();
    await expect(onlyLine).toContainText(text(texts, 'files.sent.st.accepted'));
    await expect(money).toHaveCount(0);

    const line = grid.locator('[data-id]').filter({ hasText: fileName });
    await expect(line).toContainText(text(texts, 'files.sent.st.new'));
    await line.getByText(fileName, { exact: true }).click();
    await page.getByRole('dialog', { name: fileName }).locator('[data-sent-window-accept]').click();
    const chip = money.locator('[data-sent-receipt]');
    await expect(chip).toContainText(fileName);
    await expect(chip).toContainText(text(texts, 'cppage.rcpt.file_hint'));

    // «Убрать»: строка «не прикрепится: будет принят только в файлы контрагента» и «Вернуть»
    // (прототип v121); «Вернуть» ставит чек обратно.
    const off = money.locator('[data-sent-receipt-off]');
    await chip.locator('[data-sent-receipt-remove]').click();
    await expect(chip).toHaveCount(0);
    await expect(off).toContainText(text(texts, 'cppage.rcpt.file_off', { name: fileName }));
    await off.locator('[data-sent-receipt-back]').click();
    await expect(chip).toContainText(fileName);
    await expect(off).toHaveCount(0);
    await chip.locator('[data-sent-receipt-remove]').click();
    await expect(off).toBeVisible();
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/contractors/${cp.id}/fee-payments`,
    );
    const accepted = acceptCall();
    await money.getByRole('button', { name: text(texts, 'fee.pay.ok') }).click();
    const savedRes = await saved;
    expect(savedRes.status()).toBe(201);
    const paymentId = ((await savedRes.json()) as { id: string }).id;
    // Чек принят без прикрепления к оплате.
    const acceptedRes = await accepted;
    expect(acceptedRes.status()).toBe(200);
    expect(acceptedRes.request().postDataJSON()).not.toHaveProperty('attach');
    await expect(money).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'fee.pay.saved') }),
    ).toBeVisible();
    await expect(line).toContainText(text(texts, 'files.sent.st.accepted'));
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

    // Верный код: cookie этой ссылки — на сутки (о сроке — в «Что это за страница?», прототип v135).
    await page.goto(path);
    await expect(page.getByText(text(texts, 'pub.code.text'))).toBeVisible();
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
    await expect(codeHeading(page)).toBeVisible();

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

// Доработки 15.11.2026 (прототип v120 modules/cp-help.js; простыми словами — v135): подсказки на странице
// контрагента для людей без бухгалтерского образования — «Что это за страница?» до кода, приглашение
// «Показать за минуту?» один раз, обзор облачками по разделам с записью в историю, «Помощь» с частыми
// вопросами, «Словарик», «это не оплата» в «Я оплатил».
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

  test('(приёмка 15.11, пункт 2) до кода — «Что это за страница?»; после первого кода — приглашение «Показать за минуту?» и обзор облачками до последнего шага; обзор, закрытый на шаге, — тоже в истории контрагента', async ({
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
    await expect(page.locator('[data-pub-what-text]')).toBeVisible();
    await expect(page.locator('[data-pub-what-text]')).toHaveText(pageHint('codeWhatX'));

    await openByCode(page, cp.path, cp.code, name);
    // Приглашение — полосой внизу экрана, а не окном (прототип v135 `cphWelcomeBar`): страница видна
    // сразу, окон на ней нет.
    const welcome = page.locator('[data-pub-welcome]');
    await expect(welcome).toContainText(PAGE_HELP.welcome.lead!);
    await expect(page.getByRole('dialog')).toHaveCount(0);
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

    // Обзор: облачко у «Что нужно сделать» и у каждого видимого раздела, у «Отчётов» — что значат цвета,
    // последнее — «Помощь» (облачко «Готово!» с v135 выключено). Название облачка — его подпись для
    // чтения с экрана.
    const bubble = page.locator('[data-tour-bubble]');
    const next = bubble.locator('[data-tour-next]');
    // Облачко стоит на месте: нажатие по переезжающей кнопке теряется молча (№ 34).
    const settled = async () => {
      await expect(next).toBeEnabled();
      await stillElement(bubble);
    };
    const reportsStep = PAGE_HELP.tour.find((s) => s.sec === 'reports')!;
    const lastStep = PAGE_HELP.tour.filter((s) => s.on).at(-1)!;
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
      await settled();
      await next.click();
    }
    await expect(bubble).toBeHidden();
    expect(titles).toContain(reportsStep.t);
    expect(titles.at(-1)).toBe(lastStep.t);
    await expect.poll(async () => (await tours()).length).toBe(1);
    expect((await tours())[0]!.changes).toEqual([{ field: 'of', to: m }]);

    // «Помощь» → «Как пользоваться» — тот же обзор; «Закончить» на третьем шаге.
    await page.locator('[data-pub-help]').click();
    const help = page.locator('[data-pub-help-panel]');
    await help.locator('[data-pub-help-tour]').click();
    await expect(help).toBeHidden();
    await expect(page.locator('[data-tour-count]')).toHaveText(
      text(texts, 'cph.tour.of', { n: 1, m }),
    );
    await settled();
    await next.click();
    await expect(page.locator('[data-tour-count]')).toHaveText(
      text(texts, 'cph.tour.of', { n: 2, m }),
    );
    await settled();
    await next.click();
    await expect(page.locator('[data-tour-count]')).toHaveText(
      text(texts, 'cph.tour.of', { n: 3, m }),
    );
    await settled();
    // «Закончить» под текстом облачка (у крестика в углу — та же подпись, но без текста).
    await bubble.getByText(text(texts, 'cph.tour.end'), { exact: true }).click();
    await expect(bubble).toBeHidden();
    await expect.poll(async () => (await tours()).length).toBe(2);
    expect((await tours())[0]!.changes).toEqual([
      { field: 'step', to: 3 },
      { field: 'of', to: m },
    ]);
  });

  test('(приёмка 15.11, пункты 3–5) «Помощь»: вопросы о том, что есть на странице, ответ с кнопкой ведёт к нужному месту или открывает окно; «Словарик» — облачко у слова и список в «Помощи»; в «Я оплатил» — «это не оплата» и что приложить', async ({
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
    // «Не сейчас» — приглашение закрывается и под адресом этой страницы больше не появляется.
    await forgetWelcome(page.context());
    await openByCode(page, cp.path, cp.code, name);
    const welcome = page.locator('[data-pub-welcome]');
    await welcome.locator('[data-pub-welcome-skip]').click();
    await expect(welcome).toBeHidden();
    await expect
      .poll(async () =>
        (await page.context().cookies()).some(
          (c) => c.name === WELCOME_COOKIE && c.path === cp.path,
        ),
      )
      .toBe(true);
    await page.reload();
    await pageReady(page);

    const openHelp = async () => {
      await page.locator('[data-pub-help]').click();
      const panel = page.getByRole('dialog', { name: pageHint('helpTitle') });
      await expect(panel.locator('[data-pub-help-panel]')).toBeVisible();
      return panel;
    };
    const question = (panel: ReturnType<Page['locator']>, q: string) =>
      panel.locator('[data-pub-faq]').filter({ has: page.getByRole('button', { name: q }) });
    const faq = (act: string) => PAGE_HELP.faq.find((q) => q.act === act && q.on)!;

    // Вопросы — о том, что на странице есть: оплата, «Не хватает» у налогов, файлы и их отправка.
    let panel = await openHelp();
    // После перезагрузки открыта только «Помощь»: приглашения нет.
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.locator('[data-pub-welcome]')).toHaveCount(0);
    for (const q of [faq('goPay').q, faq('goMoney').q, faq('goFiles').q, faq('up').q]) {
      await expect(question(panel, q)).toHaveCount(1);
    }
    // «Открыть файлы»: панель закрывается, раздел «Файлы» — на экране, на телефоне раскрыт.
    const files = section(page, 'files');
    if (isMobile) await expect(files).toHaveAttribute('data-folded', '');
    const goQ = question(panel, faq('goFiles').q);
    await goQ.getByRole('button', { name: faq('goFiles').q }).click();
    await goQ.locator('[data-pub-faq-act="goFiles"]').click();
    await expect(panel).toBeHidden();
    await expect(files).toBeInViewport();
    await expect(files).not.toHaveAttribute('data-folded', '');
    panel = await openHelp();
    // Ответ раскрывается по нажатию; «Открыть налоги» раскрывает строку «Налоги» в «Оплате» (без долга
    // она свёрнута).
    const taxRow = section(page, 'pay').locator('[data-po="tax"]');
    await expect(taxRow).not.toHaveAttribute('data-open', '');
    const moneyQ = question(panel, faq('goMoney').q);
    await moneyQ.getByRole('button', { name: faq('goMoney').q }).click();
    await expect(moneyQ.getByRole('button', { name: faq('goMoney').q })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await moneyQ.locator('[data-pub-faq-act="goMoney"]').click();
    await expect(panel).toBeHidden();
    await expect(taxRow).toHaveAttribute('data-open', '');
    await expect(taxRow).toBeInViewport();

    // «Я оплатил» у «Услуг бухгалтера»: сверху — «это не оплата», под чеком — что приложить, комментарий —
    // по ссылке; выбора «что оплатили» нет (он — только из «Помощи», когда такой вопрос включён).
    const feeRow = await payRow(page, 'fee');
    await feeRow.locator('[data-pub-paid="fee"]').click();
    const paid = page.getByRole('dialog', { name: text(texts, 'pub.paid.title'), exact: true });
    await expect(paid.locator('[data-pub-paid-note-top]')).toHaveText(pageHint('paidNote'));
    await expect(paid.getByText(pageHint('paidFile'), { exact: false })).toBeVisible();
    await expect(paid.locator('[data-chip-select]')).toHaveCount(0);
    await expect(paid.locator('[data-pub-paid-note]')).toHaveCount(0);
    await paid.locator('[data-pub-paid-add-note]').click();
    await expect(paid.locator('[data-pub-paid-note]')).toBeVisible();
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
    // На телефоне разделы свёрнуты, а в строках-кнопках слова не подчёркиваются: раскрываем «Связь» —
    // там подписи обычным текстом.
    if (isMobile) await unfold(page, 'acc', isMobile);
    const word = page.locator('[data-pub-gl]:visible').first();
    await expect(word).toBeVisible();
    await word.click();
    const pop = page.locator('[data-pub-gloss-pop]');
    await expect(pop).toBeVisible();
    const explained = (await pop.locator('p').innerText()).trim();
    expect(PAGE_HELP.gloss.map((g) => g.x)).toContain(explained);
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();

    // Пустой раздел «Файлы» (раскрыт переходом из «Помощи») так и говорит: файлов пока нет (пункт 5.5).
    await expect(files).toContainText(pageHint('emptyFiles'));
  });
});
