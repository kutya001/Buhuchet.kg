import type { FakeTelegram } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import type { BotMessage } from '@buhuchet/domain';
import {
  AdminTelegramLogList,
  AdminTelegramMessage,
  AdminTelegramSummary,
  ListValues,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiRequest,
  createStaffFixture,
  sendToBot,
  signIn,
  telegramPress,
  telegramUpdate,
  TEST_PASSWORD,
  unzipTexts,
} from '../../testing';
import { viewOf } from './telegram-journal';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/*
 * Журнал переписки бота в обе стороны (решение заказчика 17.11.2026; прототип v132 admin/tg-log.js;
 * docs/decisions.md п. Т-16): полученное пишет вебхук, текст виден, код и одноразовая ссылка — нет,
 * номера чата, адресов и данных кнопок в ответах нет.
 */

// Длинные номера чатов: журнал проверяется на их отсутствие подстрокой.
const CHAT_A = 700_300_001;
const CHAT_B = 700_300_002;
const CHAT_STRANGER = 700_300_003;
const BOT_MESSAGE = 501;
const LINK_TOKEN = 'A'.repeat(43);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const MESSAGE: BotMessage = {
  heading: 'Возврат на исправление',
  text: 'Отчёт вернули: нет выписки банка',
  tables: [{ head: ['Отчёт', 'Срок'], rows: [['ЕН', '20.10']], numeric: [1] }],
  buttons: [
    [
      { text: 'В работу', action: 'repWork', arg: 'r1' },
      { text: 'Открыть', url: 'https://secret.example/open?key=abc' },
    ],
    [{ text: 'Скопировать', copy: 'ТЕКСТ-ДЛЯ-КОПИРОВАНИЯ' }],
  ],
};

describe.skipIf(!databaseAvailable())(
  'Админка → «Телеграм» → «Журнал»: переписка в обе стороны',
  () => {
    let f: Fixture;
    let admin: string;
    let owner: string;
    const ids: Record<string, string> = {};
    const tg = () => f.deps.telegram as FakeTelegram;
    const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
    const list = async (query = '') => {
      const res = await get(`/api/admin/telegram/log${query}`);
      expect(res.status, query).toBe(200);
      return AdminTelegramLogList.parse(await res.json());
    };
    const inbox = () => f.t.admin.db.select().from(schema.telegramInbox);

    beforeAll(async () => {
      f = await createStaffFixture();
      admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
      owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
      const now = f.deps.clock.now().getTime();
      await f.t.admin.db.insert(schema.telegramLinks).values([
        { userId: f.a.ownerUserId, orgId: f.a.orgId, chatId: CHAT_A, username: 'owner_a' },
        { userId: f.people['acc-b']!.userId, orgId: f.b.orgId, chatId: CHAT_B, username: 'acc_b' },
      ]);
      const base = { orgId: f.a.orgId, userId: f.a.ownerUserId, chatId: CHAT_A };
      const rows: [string, typeof schema.telegramOutbox.$inferInsert][] = [
        [
          'msg',
          {
            ...base,
            kind: 'report_fix',
            text: 'Возврат на исправление\nОтчёт вернули: нет выписки банка',
            payload: MESSAGE,
            messageId: BOT_MESSAGE,
            status: 'sent',
            tries: 1,
            sentAt: new Date(now - HOUR),
            createdAt: new Date(now - HOUR),
          },
        ],
        [
          'old',
          {
            ...base,
            kind: 'reminders',
            text: 'Напоминание десять дней назад',
            status: 'sent',
            tries: 1,
            createdAt: new Date(now - 10 * DAY),
          },
        ],
        [
          'ancient',
          {
            ...base,
            kind: 'reminders',
            text: 'Напоминание сто дней назад',
            status: 'sent',
            tries: 1,
            createdAt: new Date(now - 100 * DAY),
          },
        ],
        [
          'code',
          {
            orgId: f.b.orgId,
            userId: f.people['acc-b']!.userId,
            chatId: CHAT_B,
            kind: 'code',
            text: null,
            status: 'sent',
            tries: 1,
            createdAt: new Date(now - 2 * HOUR),
          },
        ],
      ];
      for (const [key, v] of rows) {
        const [x] = await f.t.admin.db
          .insert(schema.telegramOutbox)
          .values(v)
          .returning({ id: schema.telegramOutbox.id });
        ids[key] = x!.id;
      }
      // Полученное — через вебхук, как от Telegram.
      for (const update of [
        telegramPress('repWork:r1', CHAT_A, BOT_MESSAGE),
        telegramUpdate('Исправлю до обеда, ок', CHAT_A, { username: 'owner_a' }),
        telegramUpdate('/today', CHAT_A, { username: 'owner_a' }),
        telegramUpdate('123456', CHAT_A, { username: 'owner_a' }),
        telegramUpdate(`/start ${LINK_TOKEN}`, CHAT_B, { username: 'acc_b' }),
        telegramUpdate('Кто вы?', CHAT_STRANGER, { username: 'stranger', firstName: 'Гость' }),
        telegramUpdate(null, CHAT_A, {
          document: { fileId: 'file-1', name: 'Выписка.pdf', size: 2048 },
          caption: 'Вот выписка',
        }),
      ]) {
        expect((await sendToBot(f.app, update)).status).toBe(200);
      }
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('вебхук пишет полученное: вид, итог, подпись нажатой кнопки; код и ссылка привязки — без текста', async () => {
      const rows = await inbox();
      const by = (kind: string) => rows.filter((r) => r.kind === kind);
      expect(by('press')).toEqual([
        expect.objectContaining({
          chatKind: 'private',
          orgId: f.a.orgId,
          userId: f.a.ownerUserId,
          button: 'В работу',
          replyMessageId: BOT_MESSAGE,
          text: null,
          status: 'done',
        }),
      ]);
      expect(
        by('text')
          .map((r) => [r.text, r.status, r.orgId])
          .sort(),
      ).toEqual(
        [
          ['Исправлю до обеда, ок', 'unknown', f.a.orgId],
          ['Кто вы?', 'unknown', null],
        ].sort(),
      );
      expect(by('command')).toEqual([
        expect.objectContaining({ text: '/today', status: 'done', userId: f.a.ownerUserId }),
      ]);
      expect(by('code')).toEqual([expect.objectContaining({ text: null, hide: 'code' })]);
      expect(by('link')).toEqual([
        expect.objectContaining({ text: null, hide: 'link', status: 'done' }),
      ]);
      expect(by('file')).toEqual([
        expect.objectContaining({ fileName: 'Выписка.pdf', fileSize: 2048, text: 'Вот выписка' }),
      ]);
      // Ни кода, ни ключа ссылки в таблице нет ни в одном столбце.
      const raw = JSON.stringify(rows);
      expect(raw).not.toContain('123456');
      expect(raw).not.toContain(LINK_TOKEN);
      // Чат без привязки: собеседник — со слов Telegram.
      expect(rows.find((r) => r.chatId === CHAT_STRANGER)).toMatchObject({
        sender: 'Гость @stranger',
        orgId: null,
        userId: null,
      });
    });

    it('повторная доставка того же обновления второй строки не даёт', async () => {
      const update = telegramUpdate('Повтор доставки', CHAT_STRANGER);
      expect((await sendToBot(f.app, update)).status).toBe(200);
      expect((await sendToBot(f.app, update)).status).toBe(200);
      const rows = (await inbox()).filter((r) => r.text === 'Повтор доставки');
      expect(rows).toHaveLength(1);
      await f.t.admin.db
        .delete(schema.telegramInbox)
        .where(eq(schema.telegramInbox.id, rows[0]!.id));
    });

    it('сбой журнала разбору не мешает, сбой разбора — «Ошибка» с текстом без токена бота', async () => {
      const bot = tg();
      const send = bot.sendMessage.bind(bot);
      bot.sendMessage = async () => {
        throw new Error(
          'fetch failed: https://api.telegram.org/bot1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/x',
        );
      };
      try {
        // Команда меню: ответ бот отправить не смог.
        await sendToBot(f.app, telegramUpdate('/overdue', CHAT_A, { username: 'owner_a' }));
      } finally {
        bot.sendMessage = send;
      }
      const [row] = (await inbox()).filter((r) => r.text === '/overdue');
      expect(row).toBeDefined();
      expect(JSON.stringify(row)).not.toContain('AAAAAAAAAA');
      await f.t.admin.db.delete(schema.telegramInbox).where(eq(schema.telegramInbox.id, row!.id));
      // Ответ бота, который не ушёл, — строка отправленного «Ошибка»; токена бота нет и в ней.
      const failed = (await list('?dir=out')).items.filter((r) => r.status === 'error');
      expect(failed.map((r) => r.kind)).toEqual(['bot_cmd']);
      expect(JSON.stringify(failed)).not.toContain('AAAAAAAAAA');
      const stored = await f.t.admin.db
        .select()
        .from(schema.telegramOutbox)
        .where(eq(schema.telegramOutbox.id, failed[0]!.id));
      expect(JSON.stringify(stored)).not.toContain('AAAAAAAAAA');
    });

    it('список: оба направления, период по умолчанию 7 дней, направление, срок хранения 90 дней', async () => {
      const week = await list();
      expect(week.items.map((r) => r.id)).not.toContain(ids.old);
      expect(week.items.map((r) => r.id)).toContain(ids.msg);
      expect(week.items.filter((r) => r.dir === 'in')).toHaveLength(7);
      // Отправленное: две строки наполнения и два ответа бота на команды («/today» ушёл, «/overdue» — нет).
      const out = week.items.filter((r) => r.dir === 'out');
      expect(out.map((r) => r.id)).toEqual(expect.arrayContaining([ids.msg, ids.code]));
      expect(out.map((r) => `${r.kind}:${r.status}`).sort()).toEqual(
        ['bot_cmd:error', 'bot_cmd:sent', 'code:sent', 'report_fix:sent'].sort(),
      );
      expect((await list('?dir=in')).items.every((r) => r.dir === 'in')).toBe(true);
      expect((await list('?dir=out')).total).toBe(4);
      expect((await list('?days=1&dir=out')).total).toBe(4);
      expect((await list('?days=30')).items.map((r) => r.id)).toContain(ids.old);
      // Старше срока хранения не показывается и за самый длинный период.
      expect((await list('?days=90')).items.map((r) => r.id)).not.toContain(ids.ancient);
      for (const bad of ['?days=5', '?days=365', '?dir=both', '?chat=x']) {
        expect((await get(`/api/admin/telegram/log${bad}`)).status, bad).toBe(400);
      }
    });

    it('строки: текст одной строкой, «Собеседник», вид чата; у кода и ссылки текста нет', async () => {
      const all = await list('?days=30&size=100');
      const find = (p: (r: (typeof all.items)[number]) => boolean) => all.items.find(p)!;
      expect(find((r) => r.id === ids.msg)).toMatchObject({
        src: 'outbox',
        dir: 'out',
        kind: 'report_fix',
        text: 'Возврат на исправление Отчёт вернули: нет выписки банка',
        hide: null,
        recipient: expect.stringContaining('@owner_a'),
        chatKind: 'private',
      });
      expect(find((r) => r.kind === 'in_press')).toMatchObject({
        src: 'inbox',
        dir: 'in',
        status: 'done',
        text: 'Нажата кнопка «В работу»',
        orgName: 'Организация А',
      });
      expect(find((r) => r.kind === 'in_command')).toMatchObject({
        text: '/today',
        status: 'done',
      });
      expect(find((r) => r.kind === 'in_code')).toMatchObject({ text: null, hide: 'code' });
      expect(find((r) => r.kind === 'in_link')).toMatchObject({ text: null, hide: 'link' });
      expect(find((r) => r.kind === 'in_file')).toMatchObject({
        text: 'Файл «Выписка.pdf» · Вот выписка',
      });
      expect(find((r) => r.recipient === 'Гость @stranger')).toMatchObject({
        orgId: null,
        status: 'unknown',
        text: 'Кто вы?',
      });
      expect(find((r) => r.id === ids.code)).toMatchObject({ text: null, hide: 'code' });
    });

    it('в ответах нет номера чата, адресов и текстов копирования кнопок, ключа ссылки', async () => {
      const texts = [
        await (await get('/api/admin/telegram/log?days=90&size=100')).text(),
        await (await get(`/api/admin/telegram/log/${ids.msg}`)).text(),
        await (await get('/api/admin/telegram/log/values?col=to&days=90')).text(),
      ];
      for (const text of texts) {
        for (const secret of [
          String(CHAT_A),
          String(CHAT_B),
          String(CHAT_STRANGER),
          'secret.example',
          'ТЕКСТ-ДЛЯ-КОПИРОВАНИЯ',
          LINK_TOKEN,
          '123456',
          'repWork',
        ]) {
          expect(text).not.toContain(secret);
        }
      }
    });

    it('поиск и фильтры — по тексту, направлению и виду чата; значения столбцов — с подписями', async () => {
      const found = await list(`?q=${encodeURIComponent('выписки банка')}&qcols=txt`);
      expect(found.items.map((r) => r.id)).toEqual([ids.msg]);
      const hidden = await list(`?q=${encodeURIComponent('Текст скрыт')}&qcols=txt`);
      expect(hidden.items.map((r) => r.hide).sort()).toEqual(['code', 'code', 'link']);
      const filter = encodeURIComponent(
        JSON.stringify({ kind: { type: 'enum', vals: ['in_press'] } }),
      );
      expect((await list(`?filters=${filter}`)).total).toBe(1);
      const values = async (col: string) =>
        ListValues.parse(await (await get(`/api/admin/telegram/log/values?col=${col}`)).json())
          .items;
      expect((await values('dir')).map((v) => [v.label, v.count]).sort()).toEqual([
        ['Отправлено', 4],
        ['Получено', 7],
      ]);
      expect((await values('kind')).map((v) => v.label)).toEqual(
        expect.arrayContaining(['Нажатие кнопки', 'Команда', 'Код', 'Привязка Telegram', 'Файл']),
      );
      expect((await values('st')).map((v) => v.label)).toEqual(
        expect.arrayContaining(['Отправлено', 'Обработано', 'Не распознано']),
      );
      expect((await values('ct')).map((v) => v.label)).toEqual(['Личный']);
    });

    it('«Вся переписка»: чат строки, оба направления и весь срок хранения; чужих чатов нет', async () => {
      const chat = await list(`?chat=${ids.msg}&size=100&sort=at.asc`);
      expect(chat.items.map((r) => r.id)).toContain(ids.old);
      expect(chat.items.map((r) => r.id)).not.toContain(ids.ancient);
      expect(chat.items.map((r) => r.id)).not.toContain(ids.code);
      expect(chat.items.every((r) => r.orgName === 'Организация А')).toBe(true);
      expect(chat.items.filter((r) => r.dir === 'in')).toHaveLength(5);
      expect(chat.items[0]!.id).toBe(ids.old);
      // Строки, которой нет, — пустой список, а не весь журнал.
      expect((await list('?chat=00000000-0000-4000-8000-000000000000')).total).toBe(0);
    });

    it('плашки: получено сегодня — по дню Бишкека', async () => {
      const summary = AdminTelegramSummary.parse(
        await (await get('/api/admin/telegram/log/summary')).json(),
      );
      // Ошибка — ответ бота на «/overdue», который не ушёл.
      expect(summary).toMatchObject({ pending: 0, errors: 1, receivedToday: 7 });
    });

    it('окно «Сообщение»: отправленное — как в чате, нажатая кнопка отмечена, ответы и соседние сообщения', async () => {
      const res = await get(`/api/admin/telegram/log/${ids.msg}`);
      expect(res.status).toBe(200);
      const card = AdminTelegramMessage.parse(await res.json());
      expect(card.message).toMatchObject({
        id: ids.msg,
        userId: f.a.ownerUserId,
        fullText: null,
        view: {
          heading: 'Возврат на исправление',
          text: 'Отчёт вернули: нет выписки банка',
          tables: [{ head: ['Отчёт', 'Срок'], rows: [['ЕН', '20.10']], numeric: [1] }],
          buttons: [
            [
              { text: 'В работу', kind: 'action', off: false, pressed: true },
              { text: 'Открыть', kind: 'url', off: false, pressed: false },
            ],
            [{ text: 'Скопировать', kind: 'copy', off: false, pressed: false }],
          ],
          image: false,
        },
      });
      expect(card.bot).toBeNull();
      expect(card.replies.map((r) => [r.kind, r.button])).toEqual([['in_press', 'В работу']]);
      expect(card.prevId).toBe(ids.old);
      expect(card.nextId).not.toBeNull();

      const press = card.replies[0]!;
      const got = AdminTelegramMessage.parse(
        await (await get(`/api/admin/telegram/log/${press.id}`)).json(),
      );
      expect(got.message).toMatchObject({ dir: 'in', button: 'В работу', view: null });
      expect(got.bot).toMatchObject({ id: ids.msg, view: { heading: 'Возврат на исправление' } });
      expect(got.replies).toEqual([]);
      expect(got.prevId).not.toBeNull();

      // «Раньше» и «Позже» проходят всю переписку чата по одному разу: от самого раннего до последнего.
      const chat = await list(`?chat=${ids.msg}&size=100`);
      const walked: string[] = [];
      for (let id: string | null = ids.old!; id;) {
        walked.push(id);
        expect(walked.length).toBeLessThanOrEqual(chat.total);
        id = AdminTelegramMessage.parse(
          await (await get(`/api/admin/telegram/log/${id}`)).json(),
        ).nextId;
      }
      expect(walked.sort()).toEqual(chat.items.map((r) => r.id).sort());
    });

    it('окно «Сообщение»: код — без текста и вида; старше 90 дней, чужой номер и не администратор — отказ', async () => {
      const code = AdminTelegramMessage.parse(
        await (await get(`/api/admin/telegram/log/${ids.code}`)).json(),
      );
      expect(code.message).toMatchObject({ hide: 'code', text: null, fullText: null, view: null });
      const all = await list('?size=100');
      const file = all.items.find((r) => r.kind === 'in_file')!;
      const card = AdminTelegramMessage.parse(
        await (await get(`/api/admin/telegram/log/${file.id}`)).json(),
      );
      expect(card.message).toMatchObject({
        fullText: 'Вот выписка',
        file: { name: 'Выписка.pdf', size: 2048 },
      });
      expect((await get(`/api/admin/telegram/log/${ids.ancient}`)).status).toBe(404);
      expect(
        (await get('/api/admin/telegram/log/00000000-0000-4000-8000-000000000000')).status,
      ).toBe(404);
      expect((await get('/api/admin/telegram/log/not-a-number')).status).toBe(400);
      expect((await get(`/api/admin/telegram/log/${ids.msg}`, owner)).status).toBe(403);
      expect((await get(`/api/admin/telegram/log/${ids.msg}`, '')).status).toBe(401);
      expect((await get('/api/admin/telegram/log?dir=in', owner)).status).toBe(403);
    });

    it('выгрузка в Excel — те же период и направление, текст и «Текст скрыт»', async () => {
      const file = await get('/api/admin/telegram/log/export?cols=at,dir,to,kind,txt,st&dir=in');
      expect(file.status).toBe(200);
      const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))[
        'xl/worksheets/sheet1.xml'
      ]!;
      expect(sheet).toContain('Исправлю до обеда, ок');
      expect(sheet).toContain('Текст скрыт: одноразовая ссылка');
      expect(sheet).toContain('Нажата кнопка «В работу»');
      expect(sheet).not.toContain('Отчёт вернули');
      expect(sheet).not.toContain(LINK_TOKEN);
    });

    it('вид сообщения для окна: от кнопки — только подпись, вид и состояние', () => {
      const view = viewOf(
        {
          text: 'Код 111222',
          code: '111222',
          image: '11111111-1111-4111-8111-111111111111',
          ask: { action: 'repFile', arg: 'r9', kind: 'file' },
          buttons: [[{ text: 'Готово', action: 'done', arg: 'r9', off: true }]],
        },
        new Set(['Готово']),
      );
      expect(view).toEqual({
        text: 'Код 111222',
        buttons: [[{ text: 'Готово', kind: 'action', off: true, pressed: true }]],
        image: true,
      });
      expect(JSON.stringify(view)).not.toContain('r9');
    });
  },
);
