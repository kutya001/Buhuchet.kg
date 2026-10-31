import { expect, test, type APIRequestContext } from '@playwright/test';
import { botMessages, linkTelegram, signIn, uniqueChat, uniqueLogin } from './helpers';
import { orgWithTypes } from './orgs';
import { newContractor } from './reports';

// Напоминания и сообщения в Telegram (задача 2.25) и регулярные задачи по отчётам (задача 2.24) через
// настоящий сайт с ботом-подделкой (fake-telegram.ts). Каждый тест — в своей организации: время сводки
// 00:00 (пора сразу), «Напоминания в Telegram» включаются последними, когда отчёты и привязка уже есть,
// — иначе расписание отметило бы день раньше. Расписание запускается вызовом /api/cron/tick, как это
// делает Vercel; день сводки и правила по дням недели — тесты `packages/domain/src/telegram/*.test.ts`
// и `packages/api/src/modules/telegram/reminders.test.ts` (там часы стоят на понедельнике).

const CRON_SECRET = process.env.CRON_SECRET ?? 'local-cron-secret-change-me';
const DAY = 86_400_000;
const bishkekToday = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const uniqueTitle = (text: string) =>
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

/** «Разовый отчёт» через API; ответ — срок после переноса на рабочий день. */
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
  return (await res.json()) as { id: string; dueDate: string };
}

/** Дни напоминаний вида отчёта в организации («Настройки организации» → вид). */
async function remindDays(api: APIRequestContext, origin: string, code: string, days: number[]) {
  const settings = (await (await api.get('/api/org-report-types/settings')).json()) as {
    items: { code: string; version: number }[];
  };
  const row = settings.items.find((x) => x.code === code)!;
  const res = await api.put(`/api/org-report-types/${code}`, {
    headers: { origin },
    data: { version: row.version, remindDays: days },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('Этап 2: напоминания в Telegram и регулярные задачи', () => {
  test('(п. 8) ответственный получает одно сообщение в Telegram со всеми своими отчётами за 3 дня до срока; повторный запуск расписания второго не присылает; регулярные задачи по отчётам — со статусом отчёта и без дублей', async ({
    request,
    page,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(request, origin, false);
    await policy(request, origin, {
      features: { telegram: false, tasks: true },
      digestTime: '00:00',
    });
    const connected = await request.post('/api/org-report-types/connect', {
      headers: { origin },
      data: { connect: ['t1m', 'nds'], disconnect: [], remindDays: [3] },
    });
    expect(connected.status(), await connected.text()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(request, origin, chat);
    const name = `ОсОО «Напоминание ${Date.now().toString(36)}»`;
    const cp = await newContractor(request, origin, { tariff: false, name });
    const today = bishkekToday();
    const month = `${addDays(today.slice(0, 8) + '01', -1).slice(0, 8)}01`;
    const sub = await manualReport(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 't1m',
      month,
      due: addDays(today, 3),
    });
    const both = await manualReport(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'nds',
      month,
      due: addDays(today, 3),
    });
    // Несданный просроченный отчёт другого контрагента: его регулярная задача видна в любой день месяца
    // (у отчётов со сроком в следующем месяце задачи ещё нет, как в прототипе `allTasks`).
    const lateName = `ОсОО «Просрочка ${Date.now().toString(36)}»`;
    const lateCp = await newContractor(request, origin, { tariff: false, name: lateName });
    const late = await manualReport(request, origin, {
      contractorId: lateCp.id,
      reportTypeCode: 't1m',
      month,
      due: addDays(today, -10),
    });
    expect(late.dueDate < today).toBe(true);
    // Срок на выходном или празднике переносится на рабочий день — напоминание за столько же дней до него.
    const days = daysBetween(today, sub.dueDate);
    expect(both.dueDate).toBe(sub.dueDate);
    if (days !== 3) {
      await remindDays(request, origin, 't1m', [days]);
      await remindDays(request, origin, 'nds', [days]);
    }
    await policy(request, origin, { features: { telegram: true } });

    const reminders = async () => {
      await tick(request);
      return (await botMessages(request, chat)).filter((m) => m.includes('срок сдачи'));
    };
    await expect
      .poll(reminders, { timeout: 120_000, intervals: [2_000, 5_000, 10_000] })
      .toHaveLength(1);
    const [text] = await reminders();
    expect(text).toContain(`⏰ Через ${days} дн. срок сдачи: `);
    expect(text).toContain(`1-Т за `);
    expect(text).toContain(`НДС за `);
    expect(text!.split(name)).toHaveLength(3);
    expect(text).toMatch(/Открыть в Buhuchet\.kg: \S+\/app\/reports\/week$/);
    // Ещё запуски в тот же день — второго сообщения нет.
    await tick(request);
    await tick(request);
    expect(await reminders()).toHaveLength(1);

    // Регулярные задачи: по одной на отчёт со сроком в этом месяце или просроченный, статус — из отчёта;
    // повторные запуски дублей не создают.
    const expected = [late, sub, both]
      .filter((r) => r.dueDate < today || r.dueDate.slice(0, 7) === today.slice(0, 7))
      .map((r) => r.id)
      .sort();
    const regular = async () => {
      const res = await request.get('/api/tasks?tab=all&size=all');
      expect(res.status(), await res.text()).toBe(200);
      const { items } = (await res.json()) as {
        items: { kind: string; id: string; title: string; report?: { status: string } }[];
      };
      return items.filter((r) => r.kind === 'regular');
    };
    const rows = await regular();
    expect(rows.map((r) => r.id).sort()).toEqual(expected);
    const lateTask = rows.find((r) => r.id === late.id)!;
    expect(lateTask.report).toMatchObject({ status: 'todo' });
    expect(lateTask.title.startsWith('Сдать 1-Т за ')).toBe(true);
    expect(lateTask.title.endsWith(` — ${lateName}`)).toBe(true);
    if (expected.includes(both.id)) {
      expect(rows.find((r) => r.id === both.id)?.title).toMatch(/^Сдать и оплатить НДС за /);
    }
    expect((await regular()).map((r) => r.id).sort()).toEqual(expected);

    // На экране «Задачи» → «Все»: метка «регулярная», шкала отчёта с меткой «отчёт», «Поставил» — «Система».
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto('/app/tasks/all');
    const row = page.locator(`[data-grid] [data-id="${late.id}"]`);
    await expect(row).toContainText(lateTask.title);
    await expect(row).toContainText('регулярная');
    await expect(row).toContainText('отчёт');
    await expect(row).toContainText('Система');
  });

  test('(п. 41, Telegram) возвращённую на доработку задачу исполнитель получает в Telegram с причиной; о новой задаче — тоже сообщение', async ({
    request,
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(request, origin, false);
    await policy(request, origin, { features: { telegram: true, tasks: true } });
    const me = (await (await request.get('/api/auth/me')).json()) as {
      employee: { shortName: string };
    };
    const roles = (await (await request.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string }[];
    };
    const login = uniqueLogin('e2e-exec');
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
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(executor, origin, chat);

    const title = uniqueTitle('Акт сверки');
    const options = (await (await request.get('/api/tasks/form-options')).json()) as {
      categories: { code: string }[];
    };
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
        needFile: false,
        confirm: true,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    await expect
      .poll(async () => (await botMessages(request, chat)).some((m) => m.includes(title)))
      .toBe(true);
    expect((await botMessages(request, chat)).find((m) => m.includes(title))).toContain(
      `Новая задача от ${me.employee.shortName}: ${title}, срок 30.12.2099.`,
    );

    const done = await executor.post(`/api/tasks/${id}/done`, { headers: { origin }, data: {} });
    expect(done.status(), await done.text()).toBe(200);
    const back = await request.post(`/api/tasks/${id}/rework`, {
      headers: { origin },
      data: { reason: 'Нет подписи руководителя' },
    });
    expect(back.status(), await back.text()).toBe(200);
    const rework = `↩️ Задача возвращена на доработку: ${title}. Причина: Нет подписи руководителя. Вернул: ${me.employee.shortName}`;
    await expect
      .poll(async () => (await botMessages(request, chat)).some((m) => m.includes(rework)))
      .toBe(true);
    await executor.dispose();
  });
});
