import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  botAnswers,
  botFile,
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

// Действия сотрудника из чата бота (поток Т, задача Т2; пакет заказчика 13.11.2026, идеи 1, 3 и 7;
// прототип v97 modules/tg-staff.js) через настоящий сайт с ботом-подделкой (fake-telegram.ts): кнопки
// под отчётами в напоминании, «Сдан» с обязательным файлом — файл ответом боту, задача из чата, возврат
// «На исправление» с кнопкой «Сдан». Каждый тест — в своей организации; расписание запускается вызовом
// /api/cron/tick. Права, область «Свои», чужая организация, «Подтвердить» и «Вернуть» с причиной из чата —
// `packages/api/src/modules/telegram/staff-bot.test.ts` (там часы стоят: напоминание о ждущих
// подтверждения приходит не раньше чем через день).

const CRON_SECRET = process.env.CRON_SECRET ?? 'local-cron-secret-change-me';
const OWN_PASSWORD = 'Свой-пароль-e2e-1';
const DAY = 86_400_000;
const bishkekToday = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const unique = (text: string) =>
  `${text} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function tick(api: APIRequestContext) {
  const res = await api.post('/api/cron/tick', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Учётная политика своей организации: только переданные поля. */
async function policy(api: APIRequestContext, origin: string, patch: Record<string, unknown>) {
  const current = (await (await api.get('/api/org/policy')).json()) as { version: number };
  const res = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: current.version, ...patch },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Настройки вида отчёта в организации: дни напоминаний, «Файл обязателен». */
async function typeSetup(
  api: APIRequestContext,
  origin: string,
  code: string,
  patch: { remindDays?: number[]; needFile?: boolean },
) {
  const settings = (await (await api.get('/api/org-report-types/settings')).json()) as {
    items: { code: string; version: number }[];
  };
  const row = settings.items.find((x) => x.code === code)!;
  const res = await api.put(`/api/org-report-types/${code}`, {
    headers: { origin },
    data: { version: row.version, ...patch },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** «Разовый отчёт» 1-Т за прошлый месяц со сроком через 3 дня; дни напоминания — под срок после переноса. */
async function reportDueSoon(api: APIRequestContext, origin: string, contractorId: string) {
  const today = bishkekToday();
  const month = `${addDays(today.slice(0, 8) + '01', -1).slice(0, 8)}01`;
  const res = await api.post('/api/reports', {
    headers: { origin },
    data: {
      contractorId,
      reportTypeCode: 't1m',
      month,
      due: addDays(today, 3),
      reasonCode: 'ПРЧ-001',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const report = (await res.json()) as { id: string; dueDate: string };
  const days = daysBetween(today, report.dueDate);
  if (days !== 3) await typeSetup(api, origin, 't1m', { remindDays: [days] });
  return report.id;
}

interface ReportSeen {
  status: string;
  version: number;
  statusHistory: { to: string; via?: string | null }[];
}
const reportOf = async (api: APIRequestContext, id: string) =>
  (await (await api.get(`/api/reports/${id}`)).json()) as ReportSeen;

/** Кнопки действий сообщения (без ссылки «Открыть»: она есть только у сайта по https). */
const actions = (m: BotSent) =>
  (m.keyboard ?? []).flat().flatMap((b) => (b.callback_data ? [b.callback_data] : []));
const withAction = async (api: APIRequestContext, chat: number, data: string) =>
  (await botSent(api, chat)).find((m) => actions(m).includes(data));

/** Нажать кнопку и дождаться скрытого ответа бота. */
async function press(api: APIRequestContext, chat: number, message: BotSent, data: string) {
  const id = await pressBotButton(api, chat, message.messageId, data);
  await expect.poll(async () => (await botAnswers(api)).some((a) => a.id === id)).toBe(true);
  return (await botAnswers(api)).find((a) => a.id === id)!.text;
}

/** Расписание до тех пор, пока бот не пришлёт в чат сообщение с этой кнопкой. */
async function remindedWith(api: APIRequestContext, chat: number, data: string) {
  await expect
    .poll(
      async () => {
        await tick(api);
        return Boolean(await withAction(api, chat, data));
      },
      { timeout: 120_000, intervals: [2_000, 5_000, 10_000] },
    )
    .toBe(true);
  return (await withAction(api, chat, data))!;
}

const lastText = async (api: APIRequestContext, chat: number) =>
  (await botSent(api, chat)).at(-1)?.text ?? '';

test.describe('Доработки 13.11. Т2: действия сотрудника из чата бота', () => {
  test('(пакет заказчика 13.11.2026, идея 1) напоминание: под своим отчётом кнопки «В работе» и «Сдан»; «В работе» меняет статус, в истории на сайте — «через Telegram»; «Сдан» с обязательным файлом — бот просит файл, без файла отчёт не сдан, файл ответом прикрепляется и отчёт сдан', async ({
    request,
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(request, origin, false);
    await policy(request, origin, {
      features: { telegram: false, tasks: true, files: true },
      digestTime: '00:00',
    });
    const connected = await request.post('/api/org-report-types/connect', {
      headers: { origin },
      data: { connect: ['t1m'], disconnect: [], remindDays: [3] },
    });
    expect(connected.status(), await connected.text()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(request, origin, chat);
    const name = `ОсОО «${unique('Кнопки')}»`;
    const cp = await newContractor(request, origin, { tariff: false, name });
    const id = await reportDueSoon(request, origin, cp.id);
    await policy(request, origin, { features: { telegram: true } });

    // Следом за напоминанием — сообщение об отчёте с кнопками.
    const message = await remindedWith(request, chat, `repWork:${id}`);
    expect(message.text).toContain('1-Т за ');
    expect(message.text).toContain(name);
    expect(message.text).toContain('срок ');
    expect(
      (message.keyboard ?? []).flat().flatMap((b) => (b.callback_data ? [b.text] : [])),
    ).toEqual(['В работе', 'Сдан']);
    expect(actions(message)).toEqual([`repWork:${id}`, `repDone:${id}`]);

    // «В работе»: статус меняется, кнопка гаснет, второе нажатие — «Кнопка устарела».
    expect(await press(request, chat, message, `repWork:${id}`)).toContain('статус «В работе».');
    expect((await reportOf(request, id)).status).toBe('in_progress');
    await expect
      .poll(
        async () => (await withAction(request, chat, `repDone:${id}`))?.keyboard?.[0]?.[0]?.text,
      )
      .toBe('✓ В работе');
    expect(await press(request, chat, message, `repWork:${id}`)).toContain('Кнопка устарела');

    // «Файл обязателен» у вида отчёта: «Сдан» не ставится, бот просит файл отдельным сообщением.
    await typeSetup(request, origin, 't1m', { needFile: true });
    await pressBotButton(request, chat, message.messageId, `repDone:${id}`);
    await expect
      .poll(() => lastText(request, chat))
      .toContain('отправьте файл отчёта или квитанцию ответом на это сообщение');
    const ask = (await botSent(request, chat)).at(-1)!;
    expect(ask.keyboard).toEqual([[{ text: 'Отмена', callback_data: 'askCancel' }]]);
    expect((await reportOf(request, id)).status).toBe('in_progress');
    // Текст вместо файла — бот объясняет, отчёт по-прежнему не сдан.
    await sendToBot(request, chat, { text: 'готово' });
    await expect.poll(() => lastText(request, chat)).toContain('Нужен файл');
    // Программа не принимается — как на сайте.
    const exe = await botFile(request, { name: 'отчёт.exe', content: 'MZ' });
    await sendToBot(request, chat, { document: { fileId: exe, name: 'отчёт.exe' } });
    await expect
      .poll(() => lastText(request, chat))
      .toContain('Программы, сценарии и веб-страницы не принимаются');
    expect((await reportOf(request, id)).status).toBe('in_progress');

    // Файл ответом на просьбу: прикреплён к отчёту, отчёт сдан.
    const fileName = `${unique('Квитанция')}.pdf`;
    const pdf = await botFile(request, { name: fileName, content: '%PDF-1.4\n% e2e\n' });
    await sendToBot(request, chat, {
      document: { fileId: pdf, name: fileName },
      caption: 'Принято ГНС',
      replyTo: ask.messageId,
    });
    await expect.poll(() => lastText(request, chat)).toContain('отмечен «Сдан».');
    const seen = await reportOf(request, id);
    expect(seen.status).toBe('submitted');
    expect(seen.statusHistory.map((h) => [h.to, h.via ?? null])).toEqual([
      ['todo', null],
      ['in_progress', 'telegram'],
      ['submitted', 'telegram'],
    ]);
    const files = (await (await request.get(`/api/files?kind=report&id=${id}`)).json()) as {
      items: { name: string }[];
    };
    expect(files.items.map((f) => f.name)).toEqual([fileName]);
    // Просьба закрыта: ещё один файл к ней уже не относится.
    const before = (await botSent(request, chat)).length;
    await sendToBot(request, chat, { document: { fileId: pdf, name: fileName } });
    expect(
      (await (await request.get(`/api/files?kind=report&id=${id}`)).json()) as { items: unknown[] },
    ).toMatchObject({ items: [{ name: fileName }] });
    expect((await botSent(request, chat)).length).toBe(before);

    // На сайте: ссылка «Открыть» из сообщения открывает карточку отчёта, в истории — «через Telegram».
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto(`/app/reports/all?report=${id}`);
    const card = page.locator(`[data-report-card="${id}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(fileName);
    await expect(card.getByText('через Telegram').first()).toBeAttached();
    await expect(page).toHaveURL(/\/app\/reports\/all$/);
  });

  test('(пакет заказчика 13.11.2026, идея 3) задача: исполнитель получает сообщение с кнопками «Взять в работу» и «Выполнена», постановщику приходит сообщение о каждом шаге; с «Требуется файл» бот ждёт файл, «Отмена» ничего не меняет', async ({
    request,
    playwright,
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(request, origin, false);
    await policy(request, origin, { features: { telegram: true, tasks: true, files: true } });
    const authorChat = uniqueChat();
    await linkTelegram(request, origin, authorChat);
    const roles = (await (await request.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string }[];
    };
    const login = uniqueLogin('e2e-bot-exec');
    const hired = await request.post('/api/staff', {
      headers: { origin },
      data: {
        fullName: 'Исполнитель Сквозной Тестович',
        login,
        phone: null,
        roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
      },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    const { employee, temporaryPassword } = (await hired.json()) as {
      employee: { id: string };
      temporaryPassword: string;
    };
    const executor = await playwright.request.newContext({ baseURL });
    await signIn(executor, origin, login, temporaryPassword);
    const changed = await executor.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: OWN_PASSWORD },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(executor, origin, chat);

    const options = (await (await request.get('/api/tasks/form-options')).json()) as {
      categories: { code: string }[];
    };
    const newTask = async (title: string, needFile: boolean) => {
      const created = await request.post('/api/tasks', {
        headers: { origin },
        data: {
          title,
          description: '',
          categoryCode: options.categories[0]!.code,
          contractorId: null,
          executorEmployeeId: employee.id,
          term: 'day',
          dueDate: '2099-12-30',
          needFile,
          confirm: false,
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      return ((await created.json()) as { id: string }).id;
    };
    const statusOf = async (id: string) =>
      ((await (await request.get(`/api/tasks/${id}`)).json()) as { status: string }).status;

    // Новая задача — сообщение с названием и кнопками.
    const title = unique('Сверить акт');
    const id = await newTask(title, false);
    await expect.poll(() => withAction(executor, chat, `taskWork:${id}`)).toBeTruthy();
    const message = (await withAction(executor, chat, `taskWork:${id}`))!;
    expect(message.text).toContain(`${title}\nНовая задача от `);
    expect(actions(message)).toEqual([`taskWork:${id}`, `taskDone:${id}`]);
    expect(
      (message.keyboard ?? []).flat().flatMap((b) => (b.callback_data ? [b.text] : [])),
    ).toEqual(['Взять в работу', 'Выполнена']);
    // Чужая кнопка: постановщик не исполнитель — из своего чата задачу не закрыть.
    const foreign = await pressBotButton(request, authorChat, message.messageId, `taskDone:${id}`);
    await expect
      .poll(async () => (await botAnswers(request)).find((a) => a.id === foreign)?.text ?? '')
      .toContain('Кнопка устарела');
    expect(await statusOf(id)).toBe('todo');

    expect(await press(executor, chat, message, `taskWork:${id}`)).toBe('Задача в работе.');
    expect(await statusOf(id)).toBe('in_progress');
    await expect.poll(() => lastText(request, authorChat)).toContain(`Задача в работе: ${title}.`);
    expect(await press(executor, chat, message, `taskDone:${id}`)).toBe(
      'Задача отмечена выполненной.',
    );
    expect(await statusOf(id)).toBe('done');
    await expect.poll(() => lastText(request, authorChat)).toContain(`Задача выполнена: ${title}.`);
    const done = (await (await request.get(`/api/tasks/${id}`)).json()) as {
      statusHistory: { to: string; via?: string | null }[];
    };
    expect(done.statusHistory.map((h) => [h.to, h.via ?? null])).toEqual([
      ['todo', null],
      ['in_progress', 'telegram'],
      ['done', 'telegram'],
    ]);

    // «Требуется файл»: «Выполнена» просит файл; «Отмена» — задача не меняется; файл — задача закрыта.
    const hardTitle = unique('Скан договора');
    const hard = await newTask(hardTitle, true);
    await expect.poll(() => withAction(executor, chat, `taskDone:${hard}`)).toBeTruthy();
    const hm = (await withAction(executor, chat, `taskDone:${hard}`))!;
    const askFile = async () => {
      await pressBotButton(executor, chat, hm.messageId, `taskDone:${hard}`);
      await expect
        .poll(async () => {
          const last = (await botSent(executor, chat)).at(-1)!;
          return actions(last).includes('askCancel') ? last.text : '';
        })
        .toContain(`${hardTitle}: отправьте файл ответом на это сообщение`);
      return (await botSent(executor, chat)).at(-1)!;
    };
    const first = await askFile();
    expect(await press(executor, chat, first, 'askCancel')).toBe('Отменено. Запись не изменена.');
    expect(await statusOf(hard)).toBe('todo');
    const ask = await askFile();
    expect(ask.messageId).not.toBe(first.messageId);
    const fileName = `${unique('Договор')}.pdf`;
    const pdf = await botFile(executor, { name: fileName, content: '%PDF-1.4\n% e2e\n' });
    await sendToBot(executor, chat, { document: { fileId: pdf, name: fileName } });
    await expect.poll(() => lastText(executor, chat)).toBe('Задача отмечена выполненной.');
    expect(await statusOf(hard)).toBe('done');
    const files = (await (await request.get(`/api/files?kind=task&id=${hard}`)).json()) as {
      items: { name: string }[];
    };
    expect(files.items.map((f) => f.name)).toEqual([fileName]);

    // На сайте: ссылка «Открыть задачу» открывает карточку, в истории — «через Telegram».
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto(`/app/tasks/mine?task=${id}`);
    const card = page.locator(`[data-task-card="${id}"]`);
    await expect(card).toBeVisible();
    await expect(page.getByRole('dialog').filter({ has: card })).toContainText(title);
    await expect(card.getByText('через Telegram').first()).toBeAttached();
    await expect(page).toHaveURL(/\/app\/tasks\/mine$/);
    await executor.dispose();
  });

  test('(пакет заказчика 13.11.2026, идея 7) возврат «На исправление»: ответственный получает причину и кнопку «Сдан» — исправил и сразу отметил', async ({
    request,
    playwright,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(request, origin, false);
    await policy(request, origin, {
      features: { telegram: false, tasks: true, files: true },
      digestTime: '00:00',
      reportConfirm: true,
    });
    const connected = await request.post('/api/org-report-types/connect', {
      headers: { origin },
      data: { connect: ['t1m'], disconnect: [], remindDays: [3] },
    });
    expect(connected.status(), await connected.text()).toBe(200);
    const roles = (await (await request.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string }[];
    };
    const login = uniqueLogin('e2e-bot-acc');
    const hired = await request.post('/api/staff', {
      headers: { origin },
      data: {
        fullName: 'Ответственный Сквозной Тестович',
        login,
        phone: null,
        roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
      },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    const { employee, temporaryPassword } = (await hired.json()) as {
      employee: { id: string };
      temporaryPassword: string;
    };
    const accountant = await playwright.request.newContext({ baseURL });
    await signIn(accountant, origin, login, temporaryPassword);
    const changed = await accountant.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: OWN_PASSWORD },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(accountant, origin, chat);
    const name = `ОсОО «${unique('Возврат')}»`;
    const cp = await newContractor(request, origin, {
      tariff: false,
      name,
      responsible: employee.id,
    });
    const id = await reportDueSoon(request, origin, cp.id);
    await policy(request, origin, { features: { telegram: true } });

    // Ответственный отмечает «Сдан» из чата: при «Сдача отчётов требует подтверждения» отчёт ждёт старшего.
    const message = await remindedWith(accountant, chat, `repDone:${id}`);
    expect(await press(accountant, chat, message, `repDone:${id}`)).toContain(
      'отмечен «Сдан». Ждёт подтверждения',
    );
    const submitted = await reportOf(request, id);
    expect(submitted.status).toBe('submitted');

    // Владелец возвращает на сайте — ответственному причина и кнопка «Сдан».
    const fix = await request.post(`/api/reports/${id}/fix`, {
      headers: { origin },
      data: { version: submitted.version, reason: 'Нет квитанции о приёме' },
    });
    expect(fix.status(), await fix.text()).toBe(200);
    await expect
      .poll(async () =>
        (await botSent(accountant, chat)).some((m) =>
          m.text.includes('↩️ На исправление: 1-Т за '),
        ),
      )
      .toBe(true);
    const back = (await botSent(accountant, chat)).findLast((m) =>
      m.text.includes('↩️ На исправление: 1-Т за '),
    )!;
    expect(back.text).toContain(name);
    expect(back.text).toContain('Причина: Нет квитанции о приёме.');
    expect(actions(back)).toEqual([`repDone:${id}`]);
    expect((await reportOf(request, id)).status).toBe('needs_fix');
    expect(await press(accountant, chat, back, `repDone:${id}`)).toContain('отмечен «Сдан».');
    const again = await reportOf(request, id);
    expect(again.status).toBe('submitted');
    expect(again.statusHistory.at(-1)).toMatchObject({ to: 'submitted', via: 'telegram' });
    await accountant.dispose();
  });
});

// Таблицы в сообщениях бота (поток Т, задача Т3; пакет заказчика 13.11.2026, идеи 2, 8 и 10; прототип
// v100 modules/tg-tables.js). Сводка недели приходит только по понедельникам, поэтому тест проверяет то,
// что положено сегодня: в понедельник — сообщение с таблицей по сотрудникам, в другой день — что его нет.
// Кнопка «Напомнить», раздел долгов, права и область — `packages/api/src/modules/telegram/
// staff-tables.test.ts` (там часы стоят на понедельнике).
test.describe('Доработки 13.11. Т3: таблицы в сообщениях бота', () => {
  test('(пакет заказчика 13.11.2026, идеи 2 и 8) утреннее напоминание — таблицей с разделами, простой текст — прежние строки; сводка недели владельцу — по понедельникам таблицей по сотрудникам, в другие дни её нет', async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(request, origin, false);
    await policy(request, origin, {
      features: { telegram: false, tasks: true, files: true },
      digestTime: '00:00',
    });
    const connected = await request.post('/api/org-report-types/connect', {
      headers: { origin },
      data: { connect: ['t1m'], disconnect: [], remindDays: [3] },
    });
    expect(connected.status(), await connected.text()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(request, origin, chat);
    const name = `ОсОО «${unique('Таблицы')}»`;
    const cp = await newContractor(request, origin, { tariff: false, name });
    const today = bishkekToday();
    const id = await reportDueSoon(request, origin, cp.id);
    await policy(request, origin, { features: { telegram: true } });

    // Сообщение с кнопками отчёта идёт следом за сообщением дня: раз оно пришло, сообщение дня уже в чате.
    await remindedWith(request, chat, `repWork:${id}`);
    const all = await botSent(request, chat);
    const morning = all.find((m) => m.html?.includes('<b>Отчёты на '));
    expect(morning, 'сообщение дня с таблицами').toBeTruthy();
    expect(morning!.html).toContain('<i>Просрочено 0 · сегодня 0 · скоро 1 · оплата 0</i>');
    // Срочного нет — раскрыт первый раздел; в строке — контрагент, отчёт коротко и срок.
    expect(morning!.html).toMatch(/<details open><summary>⏰ Через \d+ дн\. · 1<\/summary>/);
    expect(morning!.html).toContain(`<td>${name}</td><td>1-Т, `);
    expect(morning!.html).toContain('<th>Контрагент</th><th>Отчёт</th><th align="right">Срок</th>');
    // Простой текст — прежняя строка напоминания.
    expect(morning!.text).toMatch(/⏰ Через \d+ дн\. срок сдачи: 1-Т за /);
    expect(morning!.text).toContain(name);
    expect(morning!.text).not.toContain('<');

    // Сводка недели владельцу: только в понедельник (день — по Бишкеку, на момент сбора напоминаний).
    const week = all.find((m) => m.text.startsWith('🗓 Неделя ') && m.html?.includes('<table'));
    const monday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
    if (monday && bishkekToday() === today) {
      expect(week, 'сводка недели в понедельник').toBeTruthy();
      expect(week!.html).toContain('<th>Сотрудник</th><th align="right">Сдать</th>');
      expect(week!.text).toMatch(/Сдать \d+ · оплатить \d+ · просрочено \d+/);
    } else if (!monday && bishkekToday() === today) {
      expect(week, 'сводки недели не в понедельник нет').toBeUndefined();
    }
  });
});
