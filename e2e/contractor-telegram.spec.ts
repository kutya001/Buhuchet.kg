import { expect, test, type APIRequestContext } from '@playwright/test';
import { search } from './admin';
import {
  botMessages,
  DEMO_PASSWORD,
  hire,
  linkTelegram,
  pressStart,
  signIn,
  tellBot,
  uniqueChat,
  uniqueLogin,
  WEBHOOK_SECRET,
} from './helpers';

// Telegram контрагента (доработки 13.11.2026, задача К3; прототип v92 modules/cp-telegram.js): клиент
// подключает свой Telegram на странице контрагента, подключение подтверждает организация, клиент
// отключается сам командой «Отключить». Бот — подделка Telegram (fake-telegram.ts).

/** Адрес демо-организации «Бухгалтер Плюс». */
const SLUG = 'buhgalter-plyus';

const freshInn = () =>
  `07${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`;

interface TelegramList {
  on: number;
  wait: number;
  items: { name: string; status: string; byClient: boolean; decidedBy: string | null }[];
}

/** Владелец создаёт контрагента с ответственным и включает его страницу. */
async function enabledPage(
  api: APIRequestContext,
  origin: string,
  name: string,
  responsible: string,
) {
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
      responsibleEmployeeId: responsible,
      tariff: { amount: 0, period: 'M' },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const on = await api.post(`/api/contractors/${id}/page/enable`, { headers: { origin } });
  expect(on.status(), await on.text()).toBe(200);
  const { code } = (await on.json()) as { code: string };
  return { id, inn, code, path: `/${SLUG}/inn/${inn}` };
}

test.describe('Доработки 13.11, К3: Telegram контрагента', () => {
  test.beforeEach(async ({ page }) => {
    const part = () => Math.floor(Math.random() * 256);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });
  });

  test('(проверка К3) клиент подключает Telegram на своей странице, бухгалтер подтверждает в карточке, клиент отключается командой «Отключить»', async ({
    page,
    request,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    // Ответственный — новый сотрудник с Telegram (демо-сотрудникам Telegram не привязывается).
    const staff = await playwright.request.newContext({ baseURL });
    const login = uniqueLogin('e2e-cp-tg');
    const { employee, temporaryPassword } = await hire(staff, origin, login);
    await signIn(staff, origin, login, temporaryPassword);
    const passwordSet = await staff.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(passwordSet.status()).toBe(200);
    const staffChat = uniqueChat();
    await linkTelegram(staff, origin, staffChat);
    await staff.dispose();

    const name = `ОсОО «Телеграм ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}»`;
    const cp = await enabledPage(request, origin, name, employee.id);

    // Без запомненного кода ссылку на бота не получить — ответ как у несуществующей страницы.
    const stranger = await playwright.request.newContext({ baseURL });
    for (const address of [`/api/page/${SLUG}/${cp.inn}/telegram`, `${cp.path}/telegram`]) {
      const refused = await stranger.post(address, { headers: { origin } });
      expect(refused.status(), address).toBe(404);
    }
    // Запрос с другого сайта не принимается.
    const foreign = await stranger.post(`${cp.path}/telegram`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.status()).toBe(403);
    await stranger.dispose();

    // Клиент вводит код и открывает раздел «Telegram» своей страницы.
    await page.goto(cp.path);
    await page.getByLabel('Код доступа').fill(cp.code);
    await page.getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    const section = page.locator('[data-sec="tg"]');
    if (isMobile)
      await section
        .getByRole('button', { name: /Telegram/ })
        .first()
        .click();
    await expect(
      section.getByText('Получайте в Telegram суммы налогов к оплате и напоминания.'),
    ).toBeVisible();
    await expect(
      section.getByText(
        'Кнопка откроет бота Buhuchet.kg в Telegram — нажмите в нём «Старт». Подключение подтверждает ваш бухгалтер. Ссылка действует 24 часа и только один раз. Отключиться можно в любой момент командой «Отключить» в боте.',
      ),
    ).toBeVisible();

    // «Подключить Telegram» открывает бота по одноразовой ссылке в новой вкладке.
    await page
      .context()
      .route('https://t.me/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Telegram</title>' }),
      );
    const [linkResponse, botTab] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`${cp.path}/telegram`) && r.status() === 200),
      page.waitForEvent('popup'),
      section.getByRole('button', { name: 'Подключить Telegram' }).click(),
    ]);
    const { url } = (await linkResponse.json()) as { url: string };
    expect(url).toMatch(/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=cp_[A-Za-z0-9_-]{43}$/);
    await botTab.waitForURL(url);
    await botTab.close();

    // Клиент нажал «Старт» в боте: ему — «запрос отправлен», ответственному — запрос на подключение.
    const clientChat = uniqueChat();
    const telegramName = `@e2e_${clientChat}`;
    expect((await pressStart(request, url, clientChat)).status()).toBe(200);
    await expect
      .poll(async () => botMessages(request, clientChat))
      .toEqual([
        `Запрос отправлен вашему бухгалтеру: Telegram подключится к ${name} после подтверждения.`,
      ]);
    await expect
      .poll(async () => (await botMessages(request, staffChat)).at(-1) ?? '')
      .toContain(`${name}: запрос на подключение Telegram от «${telegramName}».`);
    // Ссылка одноразовая: из другого чата она уже не действует.
    const otherChat = uniqueChat();
    expect((await pressStart(request, url, otherChat)).status()).toBe(200);
    await expect
      .poll(async () => botMessages(request, otherChat))
      .toEqual([
        'Ссылка устарела или уже использована. Откройте страницу контрагента и нажмите «Подключить Telegram» ещё раз.',
      ]);
    // На странице клиента — «ждёт подтверждения бухгалтера».
    await page.reload();
    if (isMobile)
      await section
        .getByRole('button', { name: /Telegram/ })
        .first()
        .click();
    await expect(section.getByText('ждёт подтверждения бухгалтера: 1')).toBeVisible();

    // Бухгалтер открывает карточку контрагента: в блоке «Страница контрагента» — запрос.
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/cps/all');
    const rows = page.locator('[data-grid] [data-id]');
    await expect(rows.first()).toBeVisible();
    await search(page, isMobile, name);
    await rows.filter({ hasText: name }).first().getByText(name, { exact: true }).click();
    const card = page.getByRole('dialog', { name });
    const box = card.locator('[data-cp-tg]');
    await expect(box.getByText('Telegram контрагента', { exact: true })).toBeVisible();
    await expect(box.getByText('ждёт подтверждения: 1')).toBeVisible();
    await expect(box.getByText('подключено 0 из 5')).toBeVisible();
    await expect(box.getByText(telegramName)).toBeVisible();
    await expect(box.getByText('Ждёт подтверждения', { exact: true })).toBeVisible();
    await box.getByRole('button', { name: 'Подтвердить' }).click();
    const confirm = page.getByRole('dialog', { name: 'Подтвердить Telegram контрагента?' });
    await expect(
      confirm.getByText(
        `«${telegramName}» будет получать в Telegram суммы налогов к оплате и напоминания по контрагенту «${name}». Подтверждайте, только если знаете, что это Telegram вашего клиента.`,
      ),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `Telegram «${telegramName}» подключён` }),
    ).toBeVisible();
    await expect(box.getByText('Подключён', { exact: true })).toBeVisible();
    await expect(box.getByText('подключено 1 из 5')).toBeVisible();
    await expect(box.getByRole('button', { name: 'Отключить' })).toBeVisible();
    // Ничего не прокручивается вбок (на телефоне — тоже).
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(wide).toBe(false);
    // Клиенту бот пишет «Telegram подключён»; запрос и решение — в истории контрагента.
    await expect
      .poll(async () => (await botMessages(request, clientChat)).at(-1) ?? '')
      .toBe(
        `Telegram подключён: ${name}. Сюда будут приходить суммы налогов к оплате и напоминания. Чтобы отключиться, отправьте боту «Отключить».`,
      );
    const history = (await (await request.get(`/api/contractors/${cp.id}/history`)).json()) as {
      items: { entity: string; action: string; actor: string | null }[];
    };
    const actions = history.items.filter((h) => h.action.startsWith('page_tg_'));
    expect(actions.map((h) => h.action).sort()).toEqual(['page_tg_on', 'page_tg_request']);
    expect(actions.find((h) => h.action === 'page_tg_request')!.actor).toBeNull();

    // Клиент отключается сам: «Отключить» в чате с ботом.
    expect((await tellBot(request, clientChat, 'Отключить')).status()).toBe(200);
    await expect
      .poll(async () => (await botMessages(request, clientChat)).at(-1) ?? '')
      .toBe(
        `Telegram отключён от ${name}. Подключить снова можно на странице контрагента — кнопкой «Подключить Telegram».`,
      );
    const list = (await (
      await request.get(`/api/contractors/${cp.id}/page/telegram`)
    ).json()) as TelegramList;
    expect(list).toMatchObject({ on: 0, wait: 0 });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      name: telegramName,
      status: 'off',
      byClient: true,
      decidedBy: null,
    });
  });

  test('(проверка К3) бухгалтер отклоняет запрос и отключает подключённый Telegram в карточке контрагента', async ({
    page,
    request,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const staff = await playwright.request.newContext({ baseURL });
    const { employee } = await hire(staff, origin, uniqueLogin('e2e-cp-tg'));
    await staff.dispose();
    const name = `ОсОО «Телеграм ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}»`;
    const cp = await enabledPage(request, origin, name, employee.id);

    // Браузер клиента: код страницы введён, два чата просят подключение.
    const part = () => Math.floor(Math.random() * 256);
    const client = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-forwarded-for': `198.18.${part()}.${part()}` },
    });
    const opened = await client.post(`/api/page/${SLUG}/${cp.inn}/code`, {
      headers: { origin },
      data: { code: cp.code },
    });
    expect(opened.status(), await opened.text()).toBe(200);
    const ask = async () => {
      const link = await client.post(`${cp.path}/telegram`, { headers: { origin } });
      expect(link.status(), await link.text()).toBe(200);
      const chat = uniqueChat();
      const { url } = (await link.json()) as { url: string };
      expect((await pressStart(request, url, chat)).status()).toBe(200);
      return { chat, name: `@e2e_${chat}` };
    };
    const refusedClient = await ask();
    const linkedClient = await ask();
    await client.dispose();
    // Второй запрос подтверждён (владелец вошёл в `request` при создании контрагента).
    const listed = async () =>
      (await (
        await request.get(`/api/contractors/${cp.id}/page/telegram`)
      ).json()) as TelegramList & {
        items: { id: string; version: number }[];
      };
    const waiting = (await listed()).items.find((i) => i.name === linkedClient.name)!;
    const approved = await request.post(`/api/contractors/${cp.id}/page/telegram/${waiting.id}`, {
      headers: { origin },
      data: { action: 'approve', version: waiting.version },
    });
    expect(approved.status(), await approved.text()).toBe(200);

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/cps/all');
    const rows = page.locator('[data-grid] [data-id]');
    await expect(rows.first()).toBeVisible();
    await search(page, isMobile, name);
    await rows.filter({ hasText: name }).first().getByText(name, { exact: true }).click();
    const box = page.getByRole('dialog', { name }).locator('[data-cp-tg]');
    await expect(box.getByText('ждёт подтверждения: 1')).toBeVisible();
    await expect(box.getByText('подключено 1 из 5')).toBeVisible();

    // «Отклонить» — сразу, без вопроса: клиенту бот пишет, что бухгалтер не подтвердил.
    await box.getByRole('button', { name: 'Отклонить' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Запрос отклонён' })).toBeVisible();
    await expect(box.getByText('Отклонён', { exact: true })).toBeVisible();
    await expect(box.getByText('ждёт подтверждения: 1')).toHaveCount(0);
    await expect(box.getByRole('button', { name: 'Подтвердить' })).toHaveCount(0);
    await expect
      .poll(async () => (await botMessages(request, refusedClient.chat)).at(-1) ?? '')
      .toBe(
        `Бухгалтер не подтвердил подключение Telegram к ${name}. Свяжитесь с вашим бухгалтером.`,
      );

    // «Отключить» — с вопросом: клиенту бот пишет, что Telegram отключён.
    await box.getByRole('button', { name: 'Отключить' }).click();
    const confirm = page.getByRole('dialog', { name: 'Отключить Telegram контрагента?' });
    await expect(
      confirm.getByText(
        `«${linkedClient.name}» перестанет получать сообщения по контрагенту «${name}». Подключиться снова клиент сможет на своей странице — с новым подтверждением.`,
      ),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Отключить' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `Telegram «${linkedClient.name}» отключён` }),
    ).toBeVisible();
    await expect(box.getByText('Отключён', { exact: true })).toBeVisible();
    await expect(box.getByText('подключено 0 из 5')).toBeVisible();
    await expect(box.getByRole('button', { name: 'Отключить' })).toHaveCount(0);
    await expect
      .poll(async () => (await botMessages(request, linkedClient.chat)).at(-1) ?? '')
      .toBe(
        `Telegram отключён от ${name}. Подключить снова можно на странице контрагента — кнопкой «Подключить Telegram».`,
      );

    const after = await listed();
    expect(after).toMatchObject({ on: 0, wait: 0 });
    expect(after.items.map((i) => i.status).sort()).toEqual(['no', 'off']);
    expect(after.items.every((i) => !i.byClient && i.decidedBy !== null)).toBe(true);
    const history = (await (await request.get(`/api/contractors/${cp.id}/history`)).json()) as {
      items: { action: string }[];
    };
    expect(
      history.items
        .map((h) => h.action)
        .filter((a) => a.startsWith('page_tg_'))
        .sort(),
    ).toEqual(['page_tg_no', 'page_tg_off', 'page_tg_on', 'page_tg_request', 'page_tg_request']);
  });
});

// Задача К5 (прототип v94 modules/cp-telegram.js: pgTgStaffMsg, tgAct('cptg-ok'), pgDebtRow): кнопки
// «Подтвердить» и «Отклонить» под запросом в чате сотрудника и «Напоминать о долге в Telegram» в карточке.
const FAKE_TELEGRAM = `http://127.0.0.1:${process.env.FAKE_TELEGRAM_PORT ?? 8091}`;

interface BotSent {
  messageId: number;
  text: string;
  keyboard?: { text: string; callback_data?: string }[][];
}

/** Сообщения бота в чате вместе с кнопками и номером сообщения. */
async function chatMessages(api: APIRequestContext, chat: number): Promise<BotSent[]> {
  const res = await api.get(`${FAKE_TELEGRAM}/messages?chat=${chat}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as BotSent[];
}

/** Нажата кнопка под сообщением бота: Telegram присылает вебхуком `callback_query`. */
function pressButton(api: APIRequestContext, chat: number, messageId: number, data: string) {
  return api.post('/api/telegram/webhook', {
    headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
    data: {
      update_id: Date.now(),
      callback_query: {
        id: `e2e-${chat}-${Date.now()}`,
        from: { id: chat, is_bot: false, first_name: 'Сквозной' },
        chat_instance: 'e2e',
        data,
        message: { message_id: messageId, date: 0, chat: { id: chat, type: 'private' } },
      },
    },
  });
}

test.describe('Доработки 13.11, К5: запрос на подключение в чате сотрудника и напоминание о долге', () => {
  test.beforeEach(async ({ page }) => {
    const part = () => Math.floor(Math.random() * 256);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });
  });

  test('(доработки 13.11.2026, К5) сотрудник подтверждает запрос кнопкой «Подтвердить» под сообщением бота; в карточке контрагента «Напоминать о долге в Telegram» выключается и включается сразу', async ({
    page,
    request,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    // Ответственный — новый главный бухгалтер с Telegram: у роли есть «Управлять страницей контрагента».
    const staff = await playwright.request.newContext({ baseURL });
    const login = uniqueLogin('e2e-cp-debt');
    const { employee, temporaryPassword } = await hire(
      staff,
      origin,
      login,
      null,
      'Главный бухгалтер',
    );
    await signIn(staff, origin, login, temporaryPassword);
    const passwordSet = await staff.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(passwordSet.status()).toBe(200);
    const staffChat = uniqueChat();
    await linkTelegram(staff, origin, staffChat);
    await staff.dispose();

    const name = `ОсОО «Долг ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}»`;
    const cp = await enabledPage(request, origin, name, employee.id);

    // Клиент с кодом страницы просит подключение.
    const part = () => Math.floor(Math.random() * 256);
    const client = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-forwarded-for': `198.18.${part()}.${part()}` },
    });
    const opened = await client.post(`/api/page/${SLUG}/${cp.inn}/code`, {
      headers: { origin },
      data: { code: cp.code },
    });
    expect(opened.status(), await opened.text()).toBe(200);
    const link = await client.post(`${cp.path}/telegram`, { headers: { origin } });
    expect(link.status(), await link.text()).toBe(200);
    const { url } = (await link.json()) as { url: string };
    await client.dispose();
    const clientChat = uniqueChat();
    const telegramName = `@e2e_${clientChat}`;
    expect((await pressStart(request, url, clientChat)).status()).toBe(200);

    // Сотруднику — сообщение «Telegram контрагента» с кнопками «Подтвердить» и «Отклонить».
    await expect
      .poll(async () => (await chatMessages(request, staffChat)).at(-1)?.text ?? '')
      .toContain(`${name}: запрос на подключение Telegram от «${telegramName}».`);
    const asked = (await chatMessages(request, staffChat)).at(-1)!;
    expect(asked.text.startsWith('Telegram контрагента\n')).toBe(true);
    expect(asked.keyboard?.map((row) => row.map((b) => b.text))).toEqual([
      ['Подтвердить', 'Отклонить'],
    ]);
    const ok = asked.keyboard![0]![0]!.callback_data!;
    expect(ok.startsWith('cptgOk:')).toBe(true);

    // Чужой чат с теми же данными кнопки ничего не подтверждает.
    expect((await pressButton(request, clientChat, asked.messageId, ok)).status()).toBe(200);
    const listed = async () =>
      (await (
        await request.get(`/api/contractors/${cp.id}/page/telegram`)
      ).json()) as TelegramList & { debt: { on: boolean; orgOn: boolean } | null };
    expect(await listed()).toMatchObject({ on: 0, wait: 1 });

    // «Подтвердить»: Telegram подключён, клиенту — сообщение, кнопки под запросом погасли.
    expect((await pressButton(request, staffChat, asked.messageId, ok)).status()).toBe(200);
    await expect
      .poll(async () => (await botMessages(request, clientChat)).at(-1) ?? '')
      .toBe(
        `Telegram подключён: ${name}. Сюда будут приходить суммы налогов к оплате и напоминания. Чтобы отключиться, отправьте боту «Отключить».`,
      );
    await expect
      .poll(async () =>
        (await chatMessages(request, staffChat))
          .find((m) => m.messageId === asked.messageId)
          ?.keyboard?.map((row) => row.map((b) => b.text)),
      )
      .toEqual([['✓ Подтверждён', 'Отклонить']]);
    const linked = await listed();
    expect(linked).toMatchObject({ on: 1, wait: 0 });
    expect(linked.items[0]).toMatchObject({ name: telegramName, status: 'on', byClient: false });
    expect(linked.items[0]!.decidedBy).not.toBeNull();
    // Повторное нажатие ничего не меняет.
    expect((await pressButton(request, staffChat, asked.messageId, ok)).status()).toBe(200);
    expect(await listed()).toMatchObject({ on: 1, wait: 0 });

    // Карточка контрагента: «Напоминать о долге в Telegram» (в демо-организации напоминания включены).
    expect(linked.debt).toMatchObject({ on: true, orgOn: true });
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const openCard = async () => {
      await page.goto('/app/cps/all');
      const rows = page.locator('[data-grid] [data-id]');
      await expect(rows.first()).toBeVisible();
      await search(page, isMobile, name);
      await rows.filter({ hasText: name }).first().getByText(name, { exact: true }).click();
    };
    await openCard();
    const box = page.getByRole('dialog', { name }).locator('[data-cp-tg]');
    await expect(box.getByText('подключено 1 из 5')).toBeVisible();
    const debt = box.locator('[data-cp-tg-debt]');
    const toggle = debt.getByRole('switch', { name: /Напоминать о долге в Telegram/ });
    await expect(toggle).toBeChecked();
    await expect(
      debt.getByText(
        'Раз в неделю, в понедельник в 10:00: недостача на налоги этого месяца и долг за обслуживание — сейчас долга нет.',
      ),
    ).toBeVisible();

    await toggle.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Напоминание о долге: выключено' }),
    ).toBeVisible();
    await expect(toggle).not.toBeChecked();
    expect((await listed()).debt).toMatchObject({ on: false, orgOn: true });
    // Переключатель и галочки «Разделы страницы» хранятся в одной записи, но друг другу не мешают:
    // в открытой карточке их можно менять подряд в любом порядке (прототип pgTgBoxClick).
    const section = page
      .getByRole('dialog', { name })
      .locator('[data-cp-page-section]:not([data-cp-page-section="tg"])')
      .first();
    await expect(section).toBeChecked();
    await section.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Раздел скрыт на странице' }),
    ).toBeVisible();
    await expect(section).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    expect((await listed()).debt).toMatchObject({ on: true });
    await section.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Раздел показывается на странице' }),
    ).toBeVisible();
    await expect(section).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect((await listed()).debt).toMatchObject({ on: false });
    await expect(page.getByText('Запись изменена другим пользователем')).toHaveCount(0);
    // Карточка открыта заново — переключатель в том же положении.
    await openCard();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Напоминание о долге: включено' }),
    ).toBeVisible();
    await expect(toggle).toBeChecked();
    expect((await listed()).debt).toMatchObject({ on: true, orgOn: true });
    // Ничего не прокручивается вбок (на телефоне — тоже).
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(wide).toBe(false);

    const history = (await (await request.get(`/api/contractors/${cp.id}/history`)).json()) as {
      items: { action: string }[];
    };
    expect(
      history.items
        .map((h) => h.action)
        .filter((a) => a.startsWith('page_tg_'))
        .sort(),
    ).toEqual(['page_tg_on', 'page_tg_request']);
  });
});
