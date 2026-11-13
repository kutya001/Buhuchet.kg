import { describe, expect, it } from 'vitest';
import {
  asBotMessage,
  botKeyboard,
  botMessageProblem,
  botPlainText,
  botPressData,
  botRichHtml,
  codeBotMessage,
  findBotButton,
  parseBotPress,
  pressBotButton,
  type BotMessage,
} from './bot-message';

const digest: BotMessage = {
  heading: 'Сегодня, 13 ноября',
  sub: 'ОсОО «Ромашка»',
  text: 'Сдать 2, оплатить 1.',
  tables: [
    {
      title: 'Сдать',
      open: true,
      head: ['Контрагент', 'Отчёт', 'Сумма'],
      rows: [
        ['ОсОО «А&Б»', 'НДС', '1 250,50'],
        ['ИП <Иванов>', 'ЕН', ''],
      ],
      foot: ['Итого', '', '1 250,50'],
      numeric: [2],
    },
  ],
  buttons: [
    [
      { text: 'Сдан', action: 'repDone', arg: 'r1' },
      { text: 'Напомнить позже', action: 'snooze', arg: 'r1' },
    ],
    [{ text: 'Открыть на сайте', url: 'https://buhuchet.kg/reports' }],
  ],
};

describe('сообщение бота: два вида из одного описания', () => {
  it('простой текст — как tgPlain прототипа: строка таблицы «• ячейка — ячейка», пустые ячейки пропущены', () => {
    expect(botPlainText(digest)).toBe(
      [
        'Сегодня, 13 ноября',
        'ОсОО «Ромашка»',
        'Сдать 2, оплатить 1.',
        'Сдать · 2',
        '• ОсОО «А&Б» — НДС — 1 250,50',
        '• ИП <Иванов> — ЕН',
        'Итого — 1 250,50',
      ].join('\n'),
    );
  });

  it('вид с таблицами: раздел с числом строк, числовой столбец вправо, текст экранирован', () => {
    const html = botRichHtml(digest);
    expect(html).toContain('<b>Сегодня, 13 ноября</b>');
    expect(html).toContain('<details open><summary>Сдать · 2</summary><table bordered compact>');
    expect(html).toContain('<th align="right">Сумма</th>');
    expect(html).toContain('<td>ОсОО «А&amp;Б»</td>');
    expect(html).toContain('<td>ИП &lt;Иванов&gt;</td>');
    expect(html).toContain('<td align="right"><b>1 250,50</b></td>');
  });

  it('таблица без названия — без раскрывающегося раздела', () => {
    const html = botRichHtml({ text: 'т', tables: [{ rows: [['а', 'б']] }] });
    expect(html).toBe('т<table bordered compact><tr><td>а</td><td>б</td></tr></table>');
  });

  it('код подтверждения — моноширинный в обоих видах и с кнопкой «Скопировать код»', () => {
    const m = codeBotMessage(
      '482913 — код для восстановления пароля.',
      '482913',
      'Скопировать код',
    );
    expect(botRichHtml(m)).toBe('<code>482913</code> — код для восстановления пароля.');
    expect(botPlainText(m).startsWith('482913')).toBe(true);
    expect(botKeyboard(m)).toEqual([[{ text: 'Скопировать код', copy: '482913' }]]);
    expect(botMessageProblem(m)).toBeNull();
  });
});

describe('кнопки под сообщением', () => {
  it('клавиатура: действие — данные «действие:запись», ссылка и копирование — как есть', () => {
    expect(botKeyboard(digest)).toEqual([
      [
        { text: 'Сдан', data: 'repDone:r1' },
        { text: 'Напомнить позже', data: 'snooze:r1' },
      ],
      [{ text: 'Открыть на сайте', url: 'https://buhuchet.kg/reports' }],
    ]);
  });

  it('данные кнопки: uuid записи помещается в 64 байта; неверный код действия — ошибка', () => {
    const id = '7b1e9c2a-5d43-4f0e-9a6b-0c1d2e3f4a5b';
    expect(botPressData('repDone', id)).toBe(`repDone:${id}`);
    expect(botPressData('test')).toBe('test');
    expect(() => botPressData('Плохое')).toThrow();
    expect(() => botPressData('off')).toThrow();
    expect(() => botPressData('act', 'a b')).toThrow();
  });

  it('разбор нажатия: чужие и испорченные данные — null', () => {
    expect(parseBotPress('repDone:r1')).toEqual({ action: 'repDone', arg: 'r1' });
    expect(parseBotPress('test')).toEqual({ action: 'test', arg: null });
    expect(parseBotPress('off')).toBeNull();
    expect(parseBotPress('')).toBeNull();
    expect(parseBotPress('act:a:b')).toBeNull();
    expect(parseBotPress('act:' + 'x'.repeat(41))).toBeNull();
    expect(parseBotPress('x'.repeat(65))).toBeNull();
    expect(parseBotPress('DROP TABLE')).toBeNull();
  });

  it('нажатие принимается только от кнопки, которая есть в сообщении и активна', () => {
    expect(findBotButton(digest, 'repDone', 'r1')?.text).toBe('Сдан');
    expect(findBotButton(digest, 'repDone', 'r2')).toBeNull();
    expect(findBotButton(digest, 'delete', 'r1')).toBeNull();
    expect(findBotButton(digest, 'repDone', null)).toBeNull();
  });

  it('после действия кнопка неактивна с новой подписью, отменённые действием кнопки гаснут', () => {
    const after = pressBotButton(digest, 'repDone', 'r1', { done: 'Сдан ✓', off: ['snooze'] });
    expect(after.buttons?.[0]).toEqual([
      { text: 'Сдан ✓', action: 'repDone', arg: 'r1', off: true },
      { text: 'Напомнить позже', action: 'snooze', arg: 'r1', off: true },
    ]);
    expect(findBotButton(after, 'repDone', 'r1')).toBeNull();
    expect(findBotButton(after, 'snooze', 'r1')).toBeNull();
    expect(botKeyboard(after)[0]).toEqual([
      { text: 'Сдан ✓', data: 'off', disabled: true },
      { text: 'Напомнить позже', data: 'off', disabled: true },
    ]);
    // Ссылка осталась рабочей, исходное сообщение не изменилось.
    expect(botKeyboard(after)[1]).toEqual(botKeyboard(digest)[1]);
    expect(findBotButton(digest, 'repDone', 'r1')).not.toBeNull();
    // Действие без изменений кнопок — то же сообщение.
    expect(pressBotButton(digest, 'repDone', 'r1', {})).toBe(digest);
  });
});

describe('проверка сообщения до отправки', () => {
  it('пустое сообщение, код не из текста, широкая таблица, неверная кнопка', () => {
    expect(botMessageProblem(digest)).toBeNull();
    expect(botMessageProblem({})).toBe('пустое сообщение');
    expect(botMessageProblem({ text: 'нет кода', code: '123456' })).toBe('кода нет в тексте');
    expect(
      botMessageProblem({ text: 'т', tables: [{ rows: [Array.from({ length: 21 }, () => 'x')] }] }),
    ).toBe('в таблице больше 20 столбцов');
    expect(botMessageProblem({ text: 'т', buttons: [[{ text: '', action: 'a' }]] })).toBe(
      'подпись кнопки',
    );
    expect(botMessageProblem({ text: 'т', buttons: [[{ text: 'к' }]] })).toMatch(/одно из/);
    expect(
      botMessageProblem({ text: 'т', buttons: [[{ text: 'к', action: 'a', url: 'https://x' }]] }),
    ).toMatch(/одно из/);
    expect(botMessageProblem({ text: 'т', buttons: [[{ text: 'к', copy: '' }]] })).toBe(
      'текст копирования',
    );
    expect(botMessageProblem({ text: 'т', buttons: [[{ text: 'к', action: 'Плохое' }]] })).toBe(
      'данные кнопки',
    );
  });

  it('сообщение из базы: не объект и неверные поля — null', () => {
    expect(asBotMessage(JSON.parse(JSON.stringify(digest)))).toEqual(digest);
    expect(asBotMessage(null)).toBeNull();
    expect(asBotMessage([])).toBeNull();
    expect(asBotMessage({ text: 5 })).toBeNull();
    expect(asBotMessage({ tables: [{ rows: [[1]] }] })).toBeNull();
    expect(asBotMessage({ buttons: [[{ action: 'a' }]] })).toBeNull();
    expect(asBotMessage({ buttons: [{ text: 'к' }] })).toBeNull();
  });
});
