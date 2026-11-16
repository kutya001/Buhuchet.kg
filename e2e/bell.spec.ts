import { randomBytes } from 'node:crypto';
import {
  devices,
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { DEMO_PASSWORD, hire, newOrgOwner, signIn, stillElement, uniqueLogin } from './helpers';
import { newContractor } from './reports';

// Колокольчик уведомлений (доработки 16.11.2026, блок 3; прототип v123 `ui/bell-panel.js`): число
// непросмотренных, панель «Уведомления», «просмотрено» и «прочитано» на всех устройствах человека,
// переход по строке. Что попадает в колокольчик и кому — тесты пакетов потока Т
// (`packages/api/src/modules/telegram/bell.test.ts`, `packages/db/src/telegram-bell.test.ts`).
//
// Оба теста проверяют ПК и телефон сразу: второе устройство — свой контекст браузера с размером
// другого проекта, поэтому на проекте телефона они не повторяются.

const CRON_SECRET = process.env.CRON_SECRET ?? 'local-cron-secret-change-me';
/** Адрес демо-организации «Бухгалтер Плюс». */
const SLUG = 'buhgalter-plyus';
const PASSWORD = 'Свой-пароль-e2e-1';

const PC = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } };
const PHONE = { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } };

type Texts = Record<string, string>;

/** Тексты словаря интерфейса (`GET /api/l10n`). */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

/** Текст словаря до первой подстановки: «Сроки на сегодня: {list}» → «Сроки на сегодня:». */
function lead(texts: Texts, key: string) {
  const raw = texts[key];
  expect(raw, key).toBeTruthy();
  return raw!.split('{')[0]!.trim();
}

/** Второе устройство того же человека: вход в своём контексте браузера (свой cookie). */
async function device(
  browser: Browser,
  baseURL: string,
  kind: 'pc' | 'phone',
  login: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    ...(kind === 'pc' ? PC : PHONE),
    baseURL,
    locale: 'ru-RU',
    timezoneId: 'Asia/Bishkek',
  });
  const page = await context.newPage();
  await signIn(page.request, new URL(baseURL).origin, login, PASSWORD);
  return { context, page };
}

/** ИНН контрагента: в КР начинается с 0, 1 или 2. */
const freshInn = () =>
  `07${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`;

/**
 * Открыть или обновить страницу: число непросмотренных — из ответа сервера (до ответа значок рисует
 * «0», поэтому сверять только атрибут нельзя) и значок, когда он его показал.
 */
async function bellPage(page: Page, reload = false) {
  const counted = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/bell/count' && r.status() === 200,
  );
  if (reload) await page.reload();
  else await page.goto('/app/home');
  const { unseen } = (await (await counted).json()) as { unseen: number };
  const bell = page.locator('[data-bell]');
  await expect(bell).toHaveAttribute('data-unseen', String(unseen));
  const badge = bell.locator('[data-bell-count]');
  if (unseen) await expect(badge).toHaveText(String(unseen));
  else await expect(badge).toHaveCount(0);
  return unseen;
}

/** Открыть панель «Уведомления»: первый ответ страницы — уже после «просмотрено». */
async function openPanel(page: Page) {
  const seen = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/bell/seen' && r.request().method() === 'POST',
  );
  await page.locator('[data-bell]').click();
  const panel = page.locator('[data-bell-panel]');
  await expect(panel).toBeVisible();
  expect((await seen).status()).toBe(200);
  return panel;
}

async function tick(api: APIRequestContext) {
  const res = await api.post('/api/cron/tick', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(res.status(), await res.text()).toBe(200);
}

const SLOT = 5 * 60_000;

/**
 * Ближайший запуск строк дня (`telegram.bell-day` — раз в 5 минут, организация — в запуск своего «Часа
 * напоминаний»): момент и «ЧЧ:ММ» по Бишкеку; время в будущем, поэтому этот запуск ещё никто не занял.
 */
function nextSlot(now = Date.now()) {
  let slot = Math.ceil(now / SLOT) * SLOT;
  if (slot - now < 30_000) slot += SLOT;
  return { at: slot, hm: new Date(slot + 6 * 3600_000).toISOString().slice(11, 16) };
}

test.describe('Доработки 16.11, блок 3: колокольчик уведомлений', () => {
  test('(приёмка блока 3) контрагент прислал файл: у ответственного на колокольчике «1»; открыл панель на телефоне — на ПК счётчик погас после обновления; нажатие на строку открыло «Отправленные файлы»', async ({
    page,
    request,
    playwright,
    browser,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, 'ПК и телефон — в одном тесте: телефон — свой контекст браузера');
    // Длинный сценарий: новый сотрудник, страница контрагента, два устройства.
    test.slow();
    const origin = new URL(baseURL!).origin;
    const texts = await dictionary(request);

    // Ответственный — новый бухгалтер со своим паролем, без Telegram.
    const login = uniqueLogin('e2e-bell');
    const staffApi = await playwright.request.newContext({ baseURL });
    const { employee, temporaryPassword } = await hire(staffApi, origin, login);
    await signIn(staffApi, origin, login, temporaryPassword);
    const changed = await staffApi.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: PASSWORD },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    await staffApi.dispose();

    // Владелец создаёт контрагента с этим ответственным и включает его страницу.
    const tag = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const name = `ОсОО «Колокольчик ${tag}»`;
    await signIn(request, origin, 'erkin', DEMO_PASSWORD);
    const inn = freshInn();
    const created = await request.post('/api/contractors', {
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
        responsibleEmployeeId: employee.id,
        tariff: { amount: 0, period: 'M' },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const enabled = await request.post(`/api/contractors/${id}/page/enable`, {
      headers: { origin },
    });
    expect(enabled.status(), await enabled.text()).toBe(200);
    const { code } = (await enabled.json()) as { code: string };

    // На ПК у ответственного числа на колокольчике нет.
    await signIn(page.request, origin, login, PASSWORD);
    expect(await bellPage(page)).toBe(0);

    // Клиент отправляет файл со своей страницы (начать → PUT в хранилище → закончить).
    const part = () => Math.floor(Math.random() * 256);
    const client = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-forwarded-for': `198.18.${part()}.${part()}` },
    });
    const opened = await client.post(`/api/page/${SLUG}/${inn}/code`, {
      headers: { origin },
      data: { code },
    });
    expect(opened.status(), await opened.text()).toBe(200);
    const fileName = `выписка-${tag}.pdf`;
    const body = Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
      'latin1',
    );
    const path = `/${SLUG}/inn/${inn}`;
    const begun = await client.post(`${path}/sent`, {
      headers: { origin },
      data: { files: [{ name: fileName, size: body.length }] },
    });
    expect(begun.status(), await begun.text()).toBe(201);
    const ticket = (await begun.json()) as {
      items: { id: string; upload: { url: string; headers: Record<string, string> } }[];
    };
    const put = await client.put(ticket.items[0]!.upload.url, {
      headers: ticket.items[0]!.upload.headers,
      data: body,
    });
    expect(put.status(), await put.text()).toBe(200);
    const done = await client.post(`${path}/sent/complete`, {
      headers: { origin },
      data: { ids: ticket.items.map((i) => i.id) },
    });
    expect(done.status(), await done.text()).toBe(200);
    await client.dispose();

    // ПК: число «1» — после обновления страницы (или раз в минуту сам).
    expect(await bellPage(page, true)).toBe(1);

    // Телефон: «1» на колокольчике, панель во весь экран — строка «Новый файл от контрагента».
    const phone = await device(browser, baseURL!, 'phone', login);
    expect(await bellPage(phone.page)).toBe(1);
    const panel = await openPanel(phone.page);
    const box = await panel.boundingBox();
    expect(box?.width).toBe(390);
    const row = panel.locator('[data-bell-row]').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-bell-text]')).toHaveText(texts['bell.line.cp_file.one']!);
    await expect(row).toHaveAttribute('data-read', 'false');
    // Открыл панель — просмотрено: числа нет и на телефоне.
    await expect(phone.page.locator('[data-bell]')).toHaveAttribute('data-unseen', '0');

    // ПК после обновления: сервер отвечает «0», числа на значке нет.
    expect(await bellPage(page, true)).toBe(0);

    // Панель: кнопка-фильтр без строк — «Новых уведомлений нет» и «Показать все» (снова «Все»);
    // «Прочитать все» — строка без синей точки, уведомление.
    await panel.locator('[data-bell-tab="tasks"]').click();
    await expect(panel.locator('[data-bell-tab="tasks"]')).toHaveAttribute('aria-pressed', 'true');
    const empty = panel.locator('[data-bell-empty]');
    await expect(empty).toContainText(texts['bell.empty']!);
    await empty.getByRole('button', { name: texts['bell.show_all']! }).click();
    await expect(panel.locator('[data-bell-tab="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(row).toBeVisible();
    await panel.locator('[data-bell-read-all]').click();
    await expect(phone.page.getByText(texts['bell.read_all_done']!)).toBeVisible();
    await expect(row).toHaveAttribute('data-read', 'true');
    await expect(panel.locator('[data-bell-read-all]')).toBeDisabled();

    // Телефон: нажатие на строку — карточка контрагента, «Файлы» → «Отправленные файлы» с этим файлом.
    const read = phone.page.waitForResponse((r) =>
      /\/api\/bell\/[^/]+\/read$/.test(new URL(r.url()).pathname),
    );
    await stillElement(row);
    await row.click();
    await expect(panel).toBeHidden();
    const card = phone.page.getByRole('dialog', { name });
    const sent = card.locator('[data-cp-sent]');
    await expect(sent).toBeVisible();
    await expect(sent.locator('[data-mini-row]').filter({ hasText: fileName })).toBeVisible();
    await expect(sent).toBeInViewport();
    expect((await read).status()).toBe(200);
    await phone.context.close();

    // ПК: в панели строка уже прочитана (без синей точки) — «Прочитать все» на телефоне.
    const pcPanel = await openPanel(page);
    const pcRow = pcPanel.locator('[data-bell-row]').filter({ hasText: name });
    await expect(pcRow).toHaveAttribute('data-read', 'true');
    // Нажатие на строку на ПК — та же карточка поверх экрана.
    await pcRow.click();
    await expect(page.getByRole('dialog', { name }).locator('[data-cp-sent]')).toBeVisible();
  });

  test('(приёмка блока 3) сотрудник без Telegram утром видит в колокольчике строку «Сроки на сегодня: …»; нажатие открывает «На неделе» в «Отчетах для сдачи»', async ({
    page,
    request,
    browser,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, 'ПК и телефон — в одном тесте: телефон — свой контекст браузера');
    // Строки дня кладёт задача расписания в ближайший запуск «Часа напоминаний» — до 5 минут ожидания.
    test.setTimeout(11 * 60_000);
    const origin = new URL(baseURL!).origin;
    const texts = await dictionary(request);

    // Своя организация: владелец без Telegram, «Напоминания в Telegram» выключены.
    const login = await newOrgOwner(request, origin);
    const connected = await request.post('/api/org-report-types/connect', {
      headers: { origin },
      data: { connect: ['t1m'], disconnect: [] },
    });
    expect(connected.status(), await connected.text()).toBe(200);
    const cp = await newContractor(request, origin, { tariff: false });
    // Просроченный несданный отчёт — строка дня в любой день недели (повтор о просрочке включён).
    const today = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
    const day = (n: number) =>
      new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const late = await request.post('/api/reports', {
      headers: { origin },
      data: {
        contractorId: cp.id,
        reportTypeCode: 't1m',
        month: `${day(-40).slice(0, 8)}01`,
        due: day(-10),
        reasonCode: 'ПРЧ-001',
      },
    });
    expect(late.status(), await late.text()).toBe(201);
    expect(((await late.json()) as { dueDate: string }).dueDate < today).toBe(true);

    const me = (await (await request.get('/api/auth/me')).json()) as { telegram: unknown };
    expect(me.telegram).toBeNull();
    const current = (await (await request.get('/api/org/policy')).json()) as { version: number };
    const slot = nextSlot();
    const saved = await request.patch('/api/org/policy', {
      headers: { origin },
      data: { version: current.version, features: { telegram: false }, digestTime: slot.hm },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    // Запуск расписания (как вызывает Vercel) — пока не появится именно строка дня («Отчёты»):
    // до слота и ещё 3 минуты на запуск и его повтор.
    await expect
      .poll(
        async () => {
          await tick(request);
          const res = await request.get('/api/bell?tab=reports', { maxRetries: 2 });
          expect(res.status()).toBe(200);
          const { items } = (await res.json()) as { items: { event: string }[] };
          return items.filter((x) => x.event === 'day_dues').length;
        },
        { timeout: slot.at - Date.now() + 3 * 60_000, intervals: [10_000, 15_000] },
      )
      .toBe(1);

    // ПК: строка «Сроки на сегодня: … просрочено 1» с датой «Сегодня».
    const prefix = lead(texts, 'bell.line.day');
    await signIn(page.request, origin, login, PASSWORD);
    expect(await bellPage(page)).toBeGreaterThan(0);
    const panel = await openPanel(page);
    const row = panel.locator('[data-bell-row]').filter({ hasText: prefix });
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-bell-text]')).toContainText(
      texts['bell.line.day.over']!.replace('{n}', '1').trim(),
    );
    await expect(panel.getByText(texts['bell.group.today']!, { exact: true })).toBeVisible();

    // Телефон: та же строка; нажатие — «Отчеты для сдачи» → «На неделе».
    const phone = await device(browser, baseURL!, 'phone', login);
    await bellPage(phone.page);
    const phonePanel = await openPanel(phone.page);
    const phoneRow = phonePanel.locator('[data-bell-row]').filter({ hasText: prefix });
    await expect(phoneRow).toHaveCount(1);
    await stillElement(phoneRow);
    await phoneRow.click();
    await expect(phone.page).toHaveURL(/\/app\/reports\/week(\?|$)/);
    await expect(phone.page.locator('[data-grid]')).toBeVisible();
    await phone.context.close();

    // ПК: нажатие на строку — тот же список.
    await row.click();
    await expect(page).toHaveURL(/\/app\/reports\/week(\?|$)/);
    await expect(page.locator('[data-grid]')).toBeVisible();
  });
});
