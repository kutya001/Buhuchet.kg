import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ownerPassword, platformAdmin, search, uniqueInn } from './admin';
import { botMessages, sendToBot, signIn, uniqueChat, uniqueLogin } from './helpers';
import { IP_CERT, leadDocsDraft, leadDocsFields } from './lead-docs';

// Telegram заявителя и пароль по ссылке (поток Т, доработки 14.11.2026, блок 1, пункты 2–3; прототип
// v113 modules/tg-lead.js) через настоящий сайт с ботом-подделкой (fake-telegram.ts): «Старт» по
// устаревшей ссылке заявителя, страница «Задать пароль» по ссылке, которой нет, и — вместе с частью
// потока И (форма лендинга с документами, «Одобрить»; общая сборка этапа 2) — путь «заявка → Старт →
// Одобрить» и отказ в Telegram. Сообщение «Организация создана» с кнопкой «Задать пароль» бот шлёт
// только у сайта по https (кнопка-ссылка), а сквозные тесты идут по http: саму страницу по ссылке, пароль
// и вход проверяют тесты API (packages/api/src/modules/telegram/lead-link.test.ts) и базы
// (packages/db/src/lead-telegram.test.ts).

type Texts = Record<string, string>;

/** Тексты словаря интерфейса (`GET /api/l10n`): тесты не копируют длинные строки. */
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

/** Ключ ссылки, которой нет в базе: 43 знака base64url, как у настоящей. */
const unknownKey = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.padEnd(43, 'q').slice(0, 43);

test('(доработки 14.11.2026, блок 1) «Старт» по устаревшей или чужой ссылке заявителя — бот отвечает «Ссылка устарела или уже использована» и просит отправить заявку ещё раз', async ({
  request,
}) => {
  const chat = uniqueChat();
  await sendToBot(request, chat, { text: `/start l_${unknownKey()}` });
  await expect
    .poll(() => botMessages(request, chat))
    .toEqual([expect.stringContaining('buhuchet.kg')]);
  const [reply] = await botMessages(request, chat);
  expect(reply).toContain('Ссылка устарела');
});

test('(доработки 14.11.2026, блок 1) Страница «Задать пароль» по ссылке, которой нет, — «Ссылка устарела», срок 7 дней и «Ко входу»; адрес не уходит в Referer и не индексируется', async ({
  page,
}) => {
  const texts = await dictionary(page.request);
  const title = page.getByRole('heading', { name: text(texts, 'setpass.invalid.title') });
  const res = await page.goto(`/setpass/${unknownKey()}`);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  expect(res?.headers()['x-robots-tag']).toBe('noindex, nofollow');
  await expect(title).toBeVisible();
  await expect(page.getByText(text(texts, 'setpass.invalid.text', { days: 7 }))).toBeVisible();
  await expect(page.getByLabel(texts['auth.new_password']!)).toHaveCount(0);

  // Ключ не того вида — то же, без запроса к API.
  await page.goto('/setpass/not-a-key');
  await expect(title).toBeVisible();
  await page.getByRole('link', { name: text(texts, 'setpass.to_login') }).click();
  await expect(page).toHaveURL(/\/login$/);
});

/** Свой адрес на каждую заявку: с одного адреса — не больше 3 заявок в час (как в admin-leads.spec.ts). */
const address = () =>
  `198.19.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

/** Свой номер на каждый запуск: 9 цифр после кода страны. */
const uniquePhone = () =>
  `7${String(Date.now()).slice(-5)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;

/**
 * Заявка гостя с документами через методы лендинга (как форма «Оставить заявку»): ответ формы несёт
 * ссылку «Подключить Telegram» — возвращается то, что Telegram передаст боту в «/start».
 */
async function submitLead(api: APIRequestContext, origin: string, firm: string): Promise<string> {
  const from = address();
  const draft = await leadDocsDraft(api, origin, from);
  const res = await api.post('/api/leads', {
    headers: { origin, 'x-forwarded-for': from },
    data: {
      ...leadDocsFields(draft, uniqueInn()),
      name: 'Сквозная Заявка',
      firm,
      phone: `+996${uniquePhone()}`,
      size: '21–50',
      telegram: '',
      note: '',
      consent: true,
      website: '',
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  const { tg } = (await res.json()) as { tg: { url?: string } | null };
  expect(tg?.url).toMatch(/^https:\/\/t\.me\/[^?]+\?start=l_/);
  return new URL(tg!.url!).searchParams.get('start')!;
}

/** Окно заявки по тексту строки (имя или фирма) на вкладке «Заявки» Админки. */
async function openLead(page: Page, isMobile: boolean, text: string, firm: string) {
  await page.goto('/app/orgs/leads');
  await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
  // Строку — после ответа поиска (docs/typical-mistakes.md № 27).
  const found = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/admin/leads' &&
      new URL(r.url()).searchParams.get('q') === text,
  );
  await search(page, isMobile, text);
  await found;
  const row = page.locator('[data-grid] [data-id]').filter({ hasText: text });
  await expect(row).toHaveCount(1);
  await row.click();
  return { row, card: page.getByRole('dialog', { name: firm }) };
}

/** «Отклонить» с причиной в окне заявки (как администратор на сайте). */
async function refuseLead(page: Page, isMobile: boolean, firm: string, reason: string) {
  const { card } = await openLead(page, isMobile, firm, firm);
  await card.getByRole('button', { name: 'В работу' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Заявка: В работе' })).toBeVisible();
  await card.getByRole('button', { name: 'Ещё действия' }).click();
  await page
    .getByRole('menu', { name: 'Ещё действия' })
    .getByRole('menuitem', { name: 'Отклонить', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Отклонить заявку' });
  await dialog.getByLabel('Причина отказа').fill(reason);
  await dialog.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText(`Отказ (${reason})`);
}

test('(доработки 14.11.2026, блок 1, пункты 1–3) заявка с документами, «Подключить Telegram» и «Старт» — «Заявка получена», у заявки «подключён» и «Telegram подключён» в истории; «Одобрить» — организация и владелец, ссылка «Организация» и «Из заявки» открывают друг друга; у владельца «Пароль не задан: ссылка в Telegram» и «Отправить новую ссылку для пароля»; владелец видит данные из документов и меняет адрес', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  // Длинный путь (разбор PDF на лендинге, «Одобрить», вход владельца) — больше 30 с на машине CI.
  test.setTimeout(240_000);
  const origin = new URL(baseURL!).origin;
  await platformAdmin(page.request, origin);
  const name = `Айгуль ${uniqueLogin('Путь')}`;
  const firm = `ИП ${uniqueLogin('Путь')}`;
  const inn = uniqueInn();
  const legal = 'г. Бишкек, ул. Сквозная, 9';

  // Гость — в своём браузере: ИП со свидетельством ГНС; ИНН — свой на каждый запуск (второй
  // организации с тем же ИНН «Одобрить» не создаст).
  const guest = await browser.newContext();
  let start: string;
  try {
    const landing = await guest.newPage();
    await landing.setExtraHTTPHeaders({ 'x-forwarded-for': address() });
    await landing.goto('/#lead');
    const form = landing.locator('#lp-lead form');
    await form
      .getByRole('group', { name: 'Форма организации' })
      .getByRole('button', { name: 'ИП' })
      .click();
    await form.getByLabel('Свидетельство ГНС').setInputFiles(IP_CERT);
    await expect(
      form.getByText('Данные из документов подставлены в поля — проверьте и поправьте, если нужно'),
    ).toBeVisible({ timeout: 30_000 });
    await form.getByLabel(/^Название фирмы/).fill(firm);
    await form.getByLabel(/^ИНН/).fill(inn);
    await form.getByLabel(/^Юридический адрес/).fill(legal);
    await form.getByLabel('Имя и фамилия').fill(name);
    await form.getByLabel('Телефон').fill(uniquePhone());
    await form.getByLabel('Сколько клиентов ведёте').selectOption('21–50');
    await form.getByLabel(/Согласен на/).check();
    await form.getByRole('button', { name: 'Отправить заявку' }).click();
    const sent = landing.locator('#lp-lead').getByRole('status');
    await expect(sent).toContainText(
      'Заявка отправлена. Подключите Telegram, чтобы узнать решение',
    );
    await expect(sent).toContainText('Ссылка на бота действует до');
    const href = await sent.getByRole('link', { name: 'Подключить Telegram' }).getAttribute('href');
    expect(href).toMatch(/^https:\/\/t\.me\/[^?]+\?start=l_/);
    start = new URL(href!).searchParams.get('start')!;
  } finally {
    await guest.close();
  }

  // «Старт» по ссылке — бот отвечает «Заявка получена» с фирмой.
  const chat = uniqueChat();
  await sendToBot(page.request, chat, { text: `/start ${start}` });
  await expect
    .poll(() => botMessages(page.request, chat))
    .toEqual([`✅ Заявка получена, о решении сообщим здесь. Фирма: ${firm}.`]);

  // Админка: у заявки Telegram заявителя «подключён», в истории — «Telegram подключён: @…».
  const { row, card } = await openLead(page, isMobile, name, firm);
  await expect(row).not.toContainText('не подключён');
  const docs = card.locator('[data-lead-docs]');
  await expect(docs).toContainText(inn);
  // «Данные из документов» — с именем подключившего (прототип v114 `ldTgPill(o, true)`).
  await expect(docs).toContainText(`подключён · @e2e_${chat}`);
  await expect(docs).not.toContainText('не подключён');
  await expect(card).toContainText(`Telegram подключён: @e2e_${chat}`);

  // «В работу», затем «Одобрить» с логином владельца: организация и владелец созданы (сообщение
  // «Организация создана» со ссылкой для пароля у сайта по http не уходит — см. начало файла).
  await card.getByRole('button', { name: 'В работу' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Заявка: В работе' })).toBeVisible();
  await card.getByRole('button', { name: 'Одобрить' }).click();
  const approve = page.getByRole('dialog', { name: 'Одобрить заявку' });
  const login = uniqueLogin('lead-own');
  await approve.getByLabel('Логин владельца').fill(login);
  await approve.getByRole('button', { name: 'Одобрить' }).click();
  await expect(approve).toBeHidden();
  // Сайт тестов — по http: кнопка-ссылка «Задать пароль» не уходит (только https), об этом — уведомление,
  // а заявителю после «Заявка получена» ничего не пришло.
  await expect(
    page.getByRole('status').filter({ hasText: 'ссылка для пароля не ушла' }),
  ).toBeVisible();
  expect(await botMessages(page.request, chat)).toEqual([
    `✅ Заявка получена, о решении сообщим здесь. Фирма: ${firm}.`,
  ]);

  // «Организация» в окне заявки открывает её карточку в «Организациях», «Из заявки» — снова заявку.
  const orgLink = card.locator('[data-lead-org]');
  await expect(orgLink).toHaveText(firm);
  await orgLink.click();
  await expect(page).toHaveURL(/\/app\/orgs(\/list)?$/);
  // Открылась карточка именно этой организации: название — заголовок окна, ИНН — под ним.
  const orgCard = page.getByRole('dialog').filter({ has: page.locator('[data-org-card]') });
  await expect(orgCard).toContainText(firm);
  await expect(orgCard).toContainText(inn);
  // Пароля у владельца ещё нет, Telegram привязан — «Отправить новую ссылку для пароля» доступна.
  await expect(orgCard.locator('[data-org-action="owner-setup"]')).toBeEnabled();
  await orgCard.locator('[data-org-lead]').click();
  await expect(page.locator('[data-lead-card]').filter({ hasText: inn })).toBeVisible();

  // Карточка владельца: «Пароль не задан: ссылка в Telegram»; временный пароль — для входа ниже.
  await page.goto(`/app/accounts#accounts/${login}`);
  const states = page.locator('[data-account-states]');
  await expect(states).toContainText('Пароль не задан: ссылка в Telegram');
  await page.locator('[data-account-action="reset-password"]').click();
  const done = page.getByRole('dialog', { name: 'Пароль сброшен' });
  const temporary = (await done.locator('[data-temporary-password]').textContent())!.trim();
  await done.getByRole('button', { name: 'Готово' }).click();
  await expect(done).toBeHidden();

  // Владелец — в своём браузере: в «Моя организация» данные из документов (ИНН и форма — только для
  // чтения), адрес меняет сам.
  const ownerContext = await browser.newContext();
  try {
    await signIn(ownerContext.request, origin, login, temporary);
    const changed = await ownerContext.request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporary, newPassword: ownerPassword() },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const own = await ownerContext.newPage();
    await own.goto('/app/org/main');
    const main = own.locator('main');
    const ownInn = main.getByLabel('ИНН', { exact: true });
    await expect(ownInn).toHaveValue(inn);
    await expect(ownInn).toHaveAttribute('readonly', '');
    const ownForm = main.getByLabel('Форма', { exact: true });
    await expect(ownForm).toHaveValue('ip');
    await expect(ownForm).toBeDisabled();
    const ownAddress = main.getByLabel('Адрес', { exact: true });
    await expect(ownAddress).toHaveValue(legal);
    await ownAddress.fill('г. Бишкек, ул. Новая, 10');
    await main.getByRole('button', { name: 'Сохранить' }).click();
    await expect(own.getByRole('status').filter({ hasText: 'Сохранено' })).toBeVisible();
    const profile = (await (
      await ownerContext.request.get('/api/org', { maxRetries: 2 })
    ).json()) as { address: string | null; inn: string | null; legalForm: string | null };
    expect(profile).toMatchObject({
      address: 'г. Бишкек, ул. Новая, 10',
      inn,
      legalForm: 'ip',
    });
  } finally {
    await ownerContext.close();
  }
});

test('(доработки 14.11.2026, блок 1, пункт 2) «Отклонить» на сайте — заявителю с подключённым Telegram приходит «Отказ по заявке» с причиной; кто нажал «Старт» по ссылке уже после отказа, получает ту же причину', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  // Две заявки с документами и два «Отклонить» в окне заявки — больше 30 с на машине CI.
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  await platformAdmin(page.request, origin);
  const early = `ОсОО «${uniqueLogin('Отказ')}»`;
  const late = `ОсОО «${uniqueLogin('Поздно')}»`;
  const guest = await browser.newContext();
  let earlyStart: string;
  let lateStart: string;
  try {
    earlyStart = await submitLead(guest.request, origin, early);
    lateStart = await submitLead(guest.request, origin, late);
  } finally {
    await guest.close();
  }
  const earlyChat = uniqueChat();
  const lateChat = uniqueChat();
  await sendToBot(page.request, earlyChat, { text: `/start ${earlyStart}` });
  await expect
    .poll(() => botMessages(page.request, earlyChat))
    .toEqual([`✅ Заявка получена, о решении сообщим здесь. Фирма: ${early}.`]);

  await refuseLead(page, isMobile, early, 'Не наш регион');
  await expect
    .poll(async () => (await botMessages(page.request, earlyChat)).at(-1))
    .toBe(`Отказ по заявке. Фирма: ${early}. Причина: Не наш регион.`);
  await refuseLead(page, isMobile, late, 'Дубль заявки');
  // Заявитель второй заявки бота ещё не открывал: у заявки Telegram не подключён, причина ждёт «Старта».
  const lateRows = await page.request.get('/api/admin/leads', {
    params: { q: late },
    maxRetries: 2,
  });
  expect(lateRows.status()).toBe(200);
  const { items: lateList } = (await lateRows.json()) as {
    items: { firm: string; status: string; tgLinked: boolean }[];
  };
  expect(lateList).toEqual([
    expect.objectContaining({ firm: late, status: 'rejected', tgLinked: false }),
  ]);
  await sendToBot(page.request, lateChat, { text: `/start ${lateStart}` });
  await expect
    .poll(() => botMessages(page.request, lateChat))
    .toEqual([`Отказ по заявке. Фирма: ${late}. Причина: Дубль заявки.`]);
  // Первому заявителю причина ушла один раз.
  expect(
    (await botMessages(page.request, earlyChat)).filter((m) => m.startsWith('Отказ по заявке')),
  ).toHaveLength(1);
});
