import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  botAnswers,
  botSent,
  linkTelegram,
  pressBotButton,
  sendToBot,
  signIn,
  uniqueChat,
  uniqueLogin,
  type BotSent,
} from './helpers';
import { orgWithTypes } from './orgs';
import { newContractor } from './reports';

// Меню команд бота (поток Т, задача Т5; пакет заказчика 13.11.2026, идея 4; прототип v102
// modules/tg-menu.js) через настоящий сайт с ботом-подделкой (fake-telegram.ts): кнопки команд под полем
// ввода после привязки, «Сегодня», «Неделя», «Просрочено», «Найти контрагента» с
// карточкой контрагента и ссылкой на сайт, область «Свои», чат без привязки. Каждый тест — в своей
// организации. Права по каждой команде, модуль «Оплата налогов», долг в карточке, общий чат двух
// логинов, чужая организация, предел частоты и команды в меню бота (сайт сообщает их Telegram только
// по https, у сквозного теста сайт по http) — `packages/api/src/modules/telegram/commands.test.ts`.

const OWN_PASSWORD = 'Свой-пароль-e2e-1';
const DAY = 86_400_000;
const MENU = [
  ['Сегодня', 'Неделя'],
  ['Просрочено', 'Найти контрагента'],
];
const bishkekToday = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const unique = (text: string) =>
  `${text} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Учётная политика своей организации: только переданные поля. */
async function policy(api: APIRequestContext, origin: string, patch: Record<string, unknown>) {
  const current = (await (await api.get('/api/org/policy')).json()) as { version: number };
  const res = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: current.version, ...patch },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Своя организация с ботом и одним видом отчёта (1-Т); сеанс владельца — в `api`. */
async function orgWithBot(api: APIRequestContext, origin: string) {
  await orgWithTypes(api, origin, false);
  await policy(api, origin, { features: { telegram: true } });
  const connected = await api.post('/api/org-report-types/connect', {
    headers: { origin },
    data: { connect: ['t1m'], disconnect: [] },
  });
  expect(connected.status(), await connected.text()).toBe(200);
}

/** «Разовый отчёт» 1-Т за прошлый месяц с этим сроком; срок после переноса на рабочий день. */
async function reportDue(
  api: APIRequestContext,
  origin: string,
  contractorId: string,
  due: string,
) {
  const today = bishkekToday();
  const month = `${addDays(today.slice(0, 8) + '01', -1).slice(0, 8)}01`;
  const res = await api.post('/api/reports', {
    headers: { origin },
    data: { contractorId, reportTypeCode: 't1m', month, due, reasonCode: 'ПРЧ-001' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; dueDate: string };
}

/** Человек написал боту; ответ — новое сообщение чата (текст вместе с таблицами). */
async function ask(
  api: APIRequestContext,
  chat: number,
  message: { text: string; replyTo?: number },
): Promise<BotSent> {
  const before = (await botSent(api, chat)).length;
  await sendToBot(api, chat, message);
  await expect.poll(async () => (await botSent(api, chat)).length).toBeGreaterThan(before);
  return (await botSent(api, chat)).at(-1)!;
}

/** Кнопки действий сообщения (без ссылки «Открыть»: она есть только у сайта по https). */
const actions = (m: BotSent) =>
  (m.keyboard ?? []).flat().flatMap((b) => (b.callback_data ? [b.callback_data] : []));

test.describe('Доработки 13.11. Т5: меню команд бота', () => {
  test('(пакет заказчика 13.11.2026, идея 4) после привязки под полем ввода — кнопки команд; «Сегодня», «Неделя» и «Просрочено» отвечают по отчётам организации; на другой текст бот подсказывает про меню', async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const origin = new URL(baseURL!).origin;
    await orgWithBot(request, origin);
    const chat = uniqueChat();
    await linkTelegram(request, origin, chat);

    // Сообщение о привязке приносит кнопки команд под поле ввода.
    await expect
      .poll(async () => (await botSent(request, chat)).find((m) => m.menu)?.menu)
      .toEqual(MENU);
    // Пока отчётов нет — ответы одной строкой; ответ на команду кнопки меню не убирает.
    const empty = await ask(request, chat, { text: '/today' });
    expect(empty.text).toContain('ничего нет');
    expect(empty.menu).toEqual(MENU);
    expect((await ask(request, chat, { text: 'Просрочено' })).text).toContain(
      'Просроченного нет: отчёты сданы и налоги оплачены в срок.',
    );

    const today = bishkekToday();
    const late = `ОсОО «${unique('Опоздавший')}»`;
    const current = `ОсОО «${unique('Сегодняшний')}»`;
    const lateCp = await newContractor(request, origin, { tariff: false, name: late });
    const currentCp = await newContractor(request, origin, { tariff: false, name: current });
    await reportDue(request, origin, lateCp.id, addDays(today, -20));
    // Срок «сегодня» в выходной переносится на рабочий день: тогда отчёта в «Сегодня» нет.
    const dueToday = (await reportDue(request, origin, currentCp.id, today)).dueDate === today;

    // «Просрочено»: команда и кнопка меню — одно и то же.
    for (const text of ['/overdue', 'Просрочено']) {
      const overdue = await ask(request, chat, { text });
      expect(overdue.text).toContain('Просрочено · 1');
      expect(overdue.text).toContain('Опоздавший');
      expect(overdue.text).toContain('1-Т');
      expect(overdue.text).not.toContain('Сегодняшний');
    }

    const todayAnswer = await ask(request, chat, { text: 'Сегодня' });
    if (dueToday) {
      expect(todayAnswer.text).toContain('Сегодня, ');
      expect(todayAnswer.text).toContain('Сдать 1 · оплатить 0');
      expect(todayAnswer.text).toContain('Сегодняшний');
      expect(todayAnswer.text).not.toContain('Опоздавший');
    } else {
      expect(todayAnswer.text).toContain('ничего нет');
    }

    // «Неделя»: дни без названий контрагентов; просроченное — числом в подзаголовке.
    const week = await ask(request, chat, { text: '/week' });
    expect(week.text).toContain('🗓 Неделя ');
    expect(week.text).toContain('просрочено 1');
    if (dueToday) expect(week.text).toContain('Сдать 1 · оплатить 0 · просрочено 1');

    // Другой текст в привязанном чате — подсказка про меню, а не просьба привязать Telegram.
    const hint = await ask(request, chat, { text: 'Привет' });
    expect(hint.text).toBe('Команды бота — в меню и на кнопках под полем ввода.');
    expect(hint.menu).toEqual(MENU);
  });

  test('(пакет заказчика 13.11.2026, идея 4) «Найти контрагента»: бот спрашивает название, по части названия предлагает выбрать, по кнопке присылает карточку контрагента; ссылка из карточки открывает её на сайте; бухгалтер с областью «Свои» чужого контрагента не находит; чат без привязки команд не выполняет', async ({
    request,
    page,
    baseURL,
    playwright,
  }) => {
    test.setTimeout(120_000);
    const origin = new URL(baseURL!).origin;
    await orgWithBot(request, origin);
    const chat = uniqueChat();
    await linkTelegram(request, origin, chat);

    const mark = unique('Поиск').replace(/\s/g, '');
    const first = `ОсОО «${mark} Альфа»`;
    const second = `ОсОО «${mark} Бета»`;
    const firstCp = await newContractor(request, origin, { tariff: false, name: first });
    const secondCp = await newContractor(request, origin, { tariff: false, name: second });
    await reportDue(request, origin, firstCp.id, addDays(bishkekToday(), -20));

    // Бот спрашивает название; под вопросом — «Отмена».
    const question = await ask(request, chat, { text: 'Найти контрагента' });
    expect(question.text).toBe('Напишите название или ИНН контрагента ответом на это сообщение.');
    expect((question.keyboard ?? []).flat().map((b) => b.text)).toEqual(['Отмена']);

    // Слишком короткий запрос — вопрос остаётся открытым.
    const short = await ask(request, chat, { text: 'О', replyTo: question.messageId });
    expect(short.text).toContain('Слишком коротко.');

    // Часть названия без учёта регистра: два контрагента — кнопки с названиями.
    const many = await ask(request, chat, {
      text: mark.toUpperCase(),
      replyTo: question.messageId,
    });
    expect(many.text).toBe('Найдено контрагентов: 2. Выберите нужного.');
    expect((many.keyboard ?? []).flat().map((b) => b.text)).toEqual([first, second]);
    expect(actions(many)).toEqual([`cpCard:${firstCp.id}`, `cpCard:${secondCp.id}`]);

    // Кнопка с названием — карточка контрагента отдельным сообщением: ответственный и его отчёты.
    const before = (await botSent(request, chat)).length;
    const pressId = await pressBotButton(request, chat, many.messageId, `cpCard:${firstCp.id}`);
    await expect
      .poll(async () => (await botAnswers(request)).some((a) => a.id === pressId))
      .toBe(true);
    await expect.poll(async () => (await botSent(request, chat)).length).toBeGreaterThan(before);
    const card = (await botSent(request, chat)).at(-1)!;
    expect(card.text).toContain(first);
    expect(card.text).toContain('Ответственный: ');
    expect(card.text).toContain('обслуживается с 01.01.2026');
    expect(card.text).toContain('1-Т');
    expect(card.text).not.toContain('Бета');
    // Кнопки списка остаются: можно открыть и второго контрагента.
    expect(
      actions((await botSent(request, chat)).find((m) => m.messageId === many.messageId)!),
    ).toEqual([`cpCard:${firstCp.id}`, `cpCard:${secondCp.id}`]);

    // Полное название — сразу карточка, без выбора.
    const again = await ask(request, chat, { text: '/find' });
    const exact = await ask(request, chat, { text: second, replyTo: again.messageId });
    expect(exact.text).toContain(second);
    expect(exact.text).toContain('Просроченных отчётов и отчётов со сроком в этом месяце нет.');

    // Ссылка «Открыть на сайте» из карточки: на сайте открывается карточка этого контрагента.
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto(`/app/cps/all?contractor=${firstCp.id}`);
    await expect(page.getByRole('dialog', { name: first })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/cps\/all$/);

    // Бухгалтер с областью «Свои»: контрагенты владельца ему не видны ни в поиске, ни в «Просрочено».
    const roles = (await (await request.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string }[];
    };
    const login = uniqueLogin('e2e-menu');
    const hired = await request.post('/api/staff', {
      headers: { origin },
      data: {
        fullName: 'Менюев Сквозной Тестович',
        login,
        phone: null,
        roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
      },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    const { temporaryPassword } = (await hired.json()) as { temporaryPassword: string };
    const staff = await playwright.request.newContext({ baseURL });
    await signIn(staff, origin, login, temporaryPassword);
    const changed = await staff.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: OWN_PASSWORD },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const staffChat = uniqueChat();
    await linkTelegram(staff, origin, staffChat);
    expect((await ask(staff, staffChat, { text: '/overdue' })).text).toContain('Просроченного нет');
    const staffQuestion = await ask(staff, staffChat, { text: '/find' });
    const none = await ask(staff, staffChat, { text: mark, replyTo: staffQuestion.messageId });
    expect(none.text).toContain('Такого контрагента среди ваших нет.');
    // Кнопка чужой карточки из чата владельца в чате бухгалтера не работает: сообщение не его.
    const foreign = await pressBotButton(staff, staffChat, many.messageId, `cpCard:${firstCp.id}`);
    await expect
      .poll(async () => (await botAnswers(staff)).find((a) => a.id === foreign)?.text ?? '')
      .toContain('Кнопка устарела');
    expect((await botSent(staff, staffChat)).at(-1)!.text).not.toContain(first);
    await staff.dispose();

    // Чат без привязки: команда не выполняется, бот просит привязать Telegram и убирает кнопки меню.
    const stranger = uniqueChat();
    const refused = await ask(request, stranger, { text: '/today' });
    expect(refused.text).toContain('Это бот Buhuchet.kg. Чтобы получать напоминания');
    expect(refused.menu).toEqual([]);
  });
});
