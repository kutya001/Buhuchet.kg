import { describe, expect, it } from 'vitest';
import { UI_TEXTS } from '../l10n/texts';
import {
  incomingEntry,
  INBOX_FILE_NAME_MAX,
  INBOX_SENDER_MAX,
  INBOX_TEXT_MAX,
  JOURNAL_KINDS,
  JOURNAL_STATUSES,
  journalKindKey,
  journalLine,
  journalRetryable,
  outboxHide,
} from './journal';
import { OUTBOX_KINDS } from './notify';

/*
 * Журнал переписки бота (решение заказчика 17.11.2026; прототип v132 admin/tg-log.js): что из
 * полученного обновления хранится. Главное правило — код и одноразовая ссылка не хранятся никогда.
 */

const from = { id: 7, first_name: 'Айгуль', username: 'aigul', is_bot: false };
const chat = { id: 7001, type: 'private' };
const message = (over: Record<string, unknown>) => ({
  update_id: 55,
  message: { message_id: 10, from, chat, ...over },
});

describe('полученное сообщение для журнала', () => {
  it('текст и команда — с текстом; собеседник — «Имя @имя»; ответ — с номером сообщения бота', () => {
    expect(
      incomingEntry(
        message({ text: ' Сдам завтра\nдо обеда ', reply_to_message: { message_id: 9 } }),
      ),
    ).toEqual({
      updateId: 55,
      chatId: 7001,
      group: false,
      sender: 'Айгуль @aigul',
      kind: 'text',
      text: 'Сдам завтра\nдо обеда',
      hide: null,
      data: null,
      replyTo: 9,
      fileName: null,
      fileSize: null,
    });
    expect(incomingEntry(message({ text: '/today' }))).toMatchObject({
      kind: 'command',
      text: '/today',
    });
    expect(incomingEntry(message({ text: '/start' }))).toMatchObject({
      kind: 'command',
      text: '/start',
      hide: null,
    });
  });

  it('код из шести цифр и ссылка «/start <ключ>» — без текста, только вид', () => {
    const code = incomingEntry(message({ text: ' 123456 ' }));
    expect(code).toMatchObject({ kind: 'code', hide: 'code', text: null });
    const token = 'A'.repeat(43);
    for (const text of [`/start ${token}`, `/start cp_${token}`, `/start l_${token}`]) {
      const link = incomingEntry(message({ text }));
      expect(link, text).toMatchObject({ kind: 'link', hide: 'link', text: null });
      expect(JSON.stringify(link)).not.toContain(token);
    }
    expect(JSON.stringify(code)).not.toContain('123456');
    // Код в подписи к файлу тоже не хранится, сам файл — в журнале.
    expect(
      incomingEntry(
        message({ document: { file_name: 'чек.pdf', file_size: 10 }, caption: '654321' }),
      ),
    ).toMatchObject({ kind: 'file', text: null, fileName: 'чек.pdf' });
  });

  it('нажатие кнопки — данные кнопки и номер сообщения бота; запрос виджета — тоже нажатие', () => {
    expect(
      incomingEntry({
        update_id: 56,
        callback_query: { id: 'q', from, data: 'repWork:r1', message: { message_id: 41, chat } },
      }),
    ).toMatchObject({ kind: 'press', data: 'repWork:r1', replyTo: 41, text: null, chatId: 7001 });
    expect(
      incomingEntry({ widget_query: { id: 'w', from, chat, message_id: 42, data: 'd:3' } }),
    ).toMatchObject({ kind: 'press', data: null, replyTo: 42, updateId: null });
    // Данные кнопки длиннее предела Telegram обрезаются.
    expect(
      incomingEntry({
        callback_query: { from, data: 'x'.repeat(200), message: { message_id: 1, chat } },
      })!.data,
    ).toHaveLength(64);
  });

  it('файл и фото: имя, размер и подпись; у фото имени нет, размер — самого большого', () => {
    expect(
      incomingEntry(
        message({
          document: { file_id: 'f', file_name: 'Выписка.pdf', file_size: 2048 },
          caption: 'Вот',
        }),
      ),
    ).toMatchObject({ kind: 'file', fileName: 'Выписка.pdf', fileSize: 2048, text: 'Вот' });
    expect(
      incomingEntry(
        message({ photo: [{ file_size: 100 }, { file_size: 900 }, { file_size: 400 }] }),
      ),
    ).toMatchObject({ kind: 'file', fileName: null, fileSize: 900, text: null });
    expect(incomingEntry(message({ photo: [{}] }))).toMatchObject({ kind: 'file', fileSize: null });
  });

  it('группа: только подключение и «бота добавили / удалили»; переписка сотрудников в журнал не идёт', () => {
    const group = { id: -100500, type: 'supergroup' };
    expect(
      incomingEntry({ message: { message_id: 1, from, chat: group, text: 'Всем привет' } }),
    ).toBeNull();
    expect(
      incomingEntry({ message: { message_id: 1, from, chat: group, text: '123456' } }),
    ).toBeNull();
    expect(
      incomingEntry({
        message: { message_id: 1, from, chat: group, document: { file_name: 'a.pdf' } },
      }),
    ).toBeNull();
    expect(
      incomingEntry({
        message: { message_id: 1, from, chat: group, text: `/start@bot g_${'B'.repeat(43)}` },
      }),
    ).toMatchObject({ kind: 'link', hide: 'link', text: null, group: true });
    const member = (status: string) =>
      incomingEntry({ my_chat_member: { chat: group, from, new_chat_member: { status } } });
    expect(member('member')).toMatchObject({ kind: 'joined', group: true, chatId: -100500 });
    expect(member('administrator')).toMatchObject({ kind: 'joined' });
    expect(member('left')).toMatchObject({ kind: 'left' });
    expect(member('kicked')).toMatchObject({ kind: 'left' });
    expect(member('restricted')).toBeNull();
    // «Бота добавили» в личном чате (человек нажал «Старт» или заблокировал бота) — не событие группы.
    expect(
      incomingEntry({ my_chat_member: { chat, from, new_chat_member: { status: 'kicked' } } }),
    ).toBeNull();
  });

  it('в журнал не идут: сообщения ботов, каналы, пустые и чужие виды обновлений', () => {
    const bot = { ...from, is_bot: true };
    expect(incomingEntry(message({ from: bot, text: 'я бот' }))).toBeNull();
    expect(
      incomingEntry({ callback_query: { from: bot, data: 'x', message: { message_id: 1, chat } } }),
    ).toBeNull();
    expect(
      incomingEntry({
        message: { message_id: 1, from, chat: { id: 1, type: 'channel' }, text: 'x' },
      }),
    ).toBeNull();
    expect(incomingEntry(message({ text: ' \n ' }))).toBeNull();
    expect(incomingEntry(message({ sticker: { file_id: 's' } }))).toBeNull();
    expect(incomingEntry({ edited_message: { text: 'x', chat, from } })).toBeNull();
    expect(
      incomingEntry({ message: { text: 'x', from, chat: { id: 'семь', type: 'private' } } }),
    ).toBeNull();
    for (const bad of [null, undefined, 'x', 5, [], {}]) expect(incomingEntry(bad)).toBeNull();
  });

  it('длинное и «грязное» обрезается: текст, имя собеседника и имя файла — без управляющих знаков', () => {
    const long = incomingEntry(message({ text: 'я'.repeat(INBOX_TEXT_MAX + 50) }))!;
    expect([...long.text!]).toHaveLength(INBOX_TEXT_MAX);
    expect(long.text!.endsWith('…')).toBe(true);
    expect(incomingEntry(message({ text: 'a\u0000b\u0007c' }))!.text).toBe('abc');
    const noisy = incomingEntry(
      message({
        from: { first_name: `Имя\n‮левое ${'д'.repeat(300)}`, username: 'u' },
        document: { file_name: `сч\u0000ёт\n${'x'.repeat(400)}.pdf` },
      }),
    )!;
    expect([...noisy.sender!].length).toBeLessThanOrEqual(INBOX_SENDER_MAX);
    expect(noisy.sender).not.toMatch(/[\n‮]/);
    expect([...noisy.fileName!].length).toBeLessThanOrEqual(INBOX_FILE_NAME_MAX);
    expect(noisy.fileName).not.toMatch(/[\n\u0000]/);
    expect(incomingEntry(message({ from: {}, text: 'x' }))!.sender).toBeNull();
  });
});

describe('строка журнала', () => {
  it('текст одной строкой; у кода и ссылки — нет; у сообщения клиенту — заголовок и текст без таблиц', () => {
    expect(journalLine({ hide: null, text: 'Строка 1\n\nСтрока  2 ', payload: null })).toBe(
      'Строка 1 Строка 2',
    );
    expect(journalLine({ hide: 'code', text: 'Код 123456', payload: null })).toBeNull();
    expect(journalLine({ hide: 'link', text: 'https://x', payload: null })).toBeNull();
    expect(
      journalLine({
        hide: null,
        text: null,
        payload: {
          heading: 'К оплате',
          sub: 'за октябрь',
          text: 'Срок — 20.11',
          tables: [{ head: ['Налог', 'Сумма'], rows: [['ЕН', '1 000']] }],
        },
      }),
    ).toBe('К оплате за октябрь Срок — 20.11');
    expect(journalLine({ hide: null, text: null, payload: null })).toBeNull();
    expect(journalLine({ hide: null, text: '  ', payload: null })).toBeNull();
  });

  it('скрыт текст у кодов и ссылки «Задать пароль»; «Повторить отправку» — только у отправленного с ошибкой, не у кода', () => {
    expect(outboxHide('code')).toBe('code');
    expect(outboxHide('setup_link')).toBe('link');
    expect(outboxHide('reminders')).toBeNull();
    expect(journalRetryable({ src: 'outbox', status: 'error', kind: 'reminders' })).toBe(true);
    expect(journalRetryable({ src: 'outbox', status: 'sent', kind: 'reminders' })).toBe(false);
    expect(journalRetryable({ src: 'outbox', status: 'error', kind: 'code' })).toBe(false);
    expect(journalRetryable({ src: 'inbox', status: 'error', kind: 'in_text' })).toBe(false);
    expect(journalRetryable({ src: 'client', status: 'error', kind: 'client_pay' })).toBe(false);
  });

  it('у каждого вида и статуса строки журнала есть подпись в словаре', () => {
    const texts = UI_TEXTS as Record<string, { ru: string }>;
    for (const kind of JOURNAL_KINDS) {
      expect(texts[journalKindKey(kind)]?.ru, kind).toBeTruthy();
    }
    for (const status of JOURNAL_STATUSES) {
      expect(texts[`tgadm.st.${status}`]?.ru, status).toBeTruthy();
    }
    expect(journalKindKey(OUTBOX_KINDS[0])).toBe(`telegram.kind.${OUTBOX_KINDS[0]}`);
    expect(journalKindKey('in_press')).toBe('tgadm.kind.in_press');
    expect(journalKindKey('client_pay')).toBe('tgadm.kind.client_pay');
  });
});
