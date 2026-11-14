import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  botSent,
  FAKE_TELEGRAM,
  linkTelegram,
  sendToBot,
  uniqueChat,
  WEBHOOK_SECRET,
} from './helpers';
import { orgWithTypes } from './orgs';
import { newContractor } from './reports';

// Виджет «Мои отчёты на неделю» (поток Т, задача Т9; пакет заказчика 13.11.2026, идея 5; прототип v106
// modules/tg-widget.js) через настоящий сайт с ботом-подделкой (fake-telegram.ts): команда «Мои на
// неделю» присылает виджет со своими отчётами, галочка в виджете сдаёт отчёт, данные виджета обновляются
// без нового сообщения. Права, «Действия из Telegram», чужая организация, файл к отчёту, «Обновить» и
// утреннее обновление — `packages/api/src/modules/telegram/widget.test.ts`.

const DAY = 86_400_000;
const bishkekToday = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const unique = (text: string) =>
  `${text} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface WidgetData {
  v: number;
  t: [string, number][];
  r: [number, string, string, 0 | 1][];
}

/** Сообщения чата у подделки — с данными виджета. */
const messages = async (api: APIRequestContext, chat: number) =>
  (await botSent(api, chat)) as (Awaited<ReturnType<typeof botSent>>[number] & {
    widget?: string;
  })[];

test.describe('Доработки 13.11. Т9: виджет «Мои отчёты на неделю»', () => {
  test('(пакет заказчика 13.11.2026, идея 5) «Мои на неделю» присылает виджет со своими отчётами недели и просроченными; галочка в виджете отмечает отчёт «Сдан», виджет обновляется без нового сообщения', async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(request, origin, false);
    const current = (await (await request.get('/api/org/policy')).json()) as { version: number };
    const policy = await request.patch('/api/org/policy', {
      headers: { origin },
      data: { version: current.version, features: { telegram: true } },
    });
    expect(policy.status(), await policy.text()).toBe(200);
    const connected = await request.post('/api/org-report-types/connect', {
      headers: { origin },
      data: { connect: ['t1m'], disconnect: [] },
    });
    expect(connected.status(), await connected.text()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(request, origin, chat);

    // Просроченный отчёт владельца — он ответственный.
    const name = `ОсОО «${unique('Виджет')}»`;
    const cp = await newContractor(request, origin, { tariff: false, name });
    const today = bishkekToday();
    const month = `${addDays(today.slice(0, 8) + '01', -1).slice(0, 8)}01`;
    const created = await request.post('/api/reports', {
      headers: { origin },
      data: {
        contractorId: cp.id,
        reportTypeCode: 't1m',
        month,
        due: addDays(today, -20),
        reasonCode: 'ПРЧ-001',
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const report = (await created.json()) as { id: string };

    // Команда меню — виджет; подпись видна и в старом Telegram.
    const before = (await messages(request, chat)).length;
    await sendToBot(request, chat, { text: 'Мои на неделю' });
    await expect.poll(async () => (await messages(request, chat)).length).toBeGreaterThan(before);
    const widget = (await messages(request, chat)).at(-1)!;
    expect(widget.widget).toBeTruthy();
    expect(widget.text).toContain('Мои отчёты на неделю');
    expect(widget.text).toContain('просрочено 1');
    const data = JSON.parse(widget.widget!) as WidgetData;
    expect(data.t[0]).toEqual(['Просрочено', 1]);
    const row = data.r.findIndex((r) => r[1].startsWith('ОсОО «Виджет'));
    expect(row).toBeGreaterThanOrEqual(0);
    expect(data.r[row]![2]).toContain('1-Т');

    // Галочка в виджете — запрос виджета к боту; ответ видит только сотрудник.
    const queryId = `e2e-wq-${chat}`;
    const res = await request.post('/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      data: {
        update_id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
        widget_query: {
          id: queryId,
          from: { id: chat, is_bot: false, first_name: 'Сквозной' },
          chat: { id: chat, type: 'private' },
          message_id: widget.messageId,
          data: `d:${row}:${data.v}`,
        },
      },
    });
    expect(res.status()).toBe(200);
    await expect
      .poll(async () => {
        const answers = (await (await request.get(`${FAKE_TELEGRAM}/widget-answers`)).json()) as {
          id: string;
          data: string | null;
        }[];
        return answers.find((a) => a.id === queryId)?.data ?? '';
      })
      .toContain('— Сдан.');
    const card = (await (await request.get(`/api/reports/${report.id}`)).json()) as {
      status: string;
    };
    expect(card.status).toBe('submitted');
    // Тот же виджет: строка отмечена, на вкладке «Просрочено» — 0; нового сообщения нет.
    const after = await messages(request, chat);
    expect(after.at(-1)!.messageId).toBe(widget.messageId);
    const marked = JSON.parse(after.at(-1)!.widget!) as WidgetData;
    expect(marked.r[row]![3]).toBe(1);
    expect(marked.t[0]).toEqual(['Просрочено', 0]);
  });
});
