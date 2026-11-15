import { afterEach, describe, expect, it } from 'vitest';
import {
  createFakeTelegram,
  setFakeTelegramPressCheck,
  takeFakeTelegramProblems,
} from './telegram';
import {
  clipTelegramText,
  telegramCallbackTextProblems,
  telegramCaptionProblems,
  telegramHtmlProblem,
  telegramKeyboardProblems,
  telegramSendProblems,
  telegramWidgetDataProblems,
} from './telegram-rules';

afterEach(() => {
  setFakeTelegramPressCheck(null);
  takeFakeTelegramProblems();
});

describe('правила Bot API для сообщения бота', () => {
  it('текст: пустой, длиннее 4096 знаков, незаполненная подстановка', () => {
    expect(telegramSendProblems('Сдать сегодня: 3')).toEqual([]);
    expect(telegramSendProblems('  ')).toEqual(['text_empty']);
    expect(telegramSendProblems('а'.repeat(4096))).toEqual([]);
    expect(telegramSendProblems('а'.repeat(4097))).toEqual(['text_too_long:4097']);
    expect(telegramSendProblems('Срок {срок}')).toEqual(['placeholder:{срок}']);
    expect(telegramSendProblems('Сводка на {n1}')).toEqual(['placeholder:{n1}']);
    // Фигурные скобки с пробелом или знаками — не подстановка шаблона.
    expect(telegramSendProblems('Пример: { a: 1 } и {}')).toEqual([]);
  });

  it('разметка HTML: только теги Telegram, закрыты по порядку, «<», «>» и «&» — сущностями', () => {
    expect(telegramHtmlProblem('<b>Сводка</b> <i>на</i> <a href="https://x.kg">день</a>')).toEqual({
      problem: null,
      visible: 'Сводка на день',
    });
    expect(telegramHtmlProblem('<b>Итого &lt; 5 &amp; &#8470;</b>')).toEqual({
      problem: null,
      visible: 'Итого x 5 x x',
    });
    expect(telegramHtmlProblem('<div>текст</div>').problem).toBe('html_tag:div');
    expect(telegramHtmlProblem('<b><i>текст</b></i>').problem).toBe('html_nesting:b');
    expect(telegramHtmlProblem('<b>текст').problem).toBe('html_unclosed:b');
    expect(telegramHtmlProblem('<b текст').problem).toBe('html_unclosed_tag');
    expect(telegramHtmlProblem('A & B').problem).toBe('html_entity');
    expect(telegramHtmlProblem('5 > 3').problem).toBe('html_stray_gt');
    // Длина HTML-сообщения — по видимому тексту, а не по разметке.
    expect(telegramSendProblems(`<b>${'а'.repeat(4096)}</b>`, { html: true })).toEqual([]);
    expect(telegramSendProblems('<b></b>', { html: true })).toEqual(['text_empty']);
    // Простой текст разметку не разбирает: «<» в нём — обычный знак.
    expect(telegramSendProblems('Сумма < 5 & > 3')).toEqual([]);
  });

  it('кнопки: подпись, один вид, данные до 64 байт, копирование до 256 знаков, ссылка https, ряд и всего', () => {
    expect(
      telegramKeyboardProblems([
        [
          { text: 'В работу', data: 'repWork:r1' },
          { text: 'Скопировать', copy: '482913' },
          { text: 'Открыть', url: 'https://test.buhuchet.kg/reports' },
          { text: 'Сдан ✓', data: 'off', disabled: true },
        ],
      ]),
    ).toEqual([]);
    expect(telegramKeyboardProblems([[{ text: ' ', data: 'a' }]])).toEqual(['button_text_empty']);
    expect(telegramKeyboardProblems([[{ text: 'Срок {срок}', data: 'a' }]])).toEqual([
      'placeholder:{срок}',
    ]);
    expect(telegramKeyboardProblems([[{ text: 'Два', data: 'a', url: 'https://x.kg' }]])).toEqual([
      'button_kind:Два',
    ]);
    expect(telegramKeyboardProblems([[{ text: 'Нет' }]])).toEqual(['button_kind:Нет']);
    // 64 байта UTF-8: кириллица — по 2 байта на букву.
    expect(telegramKeyboardProblems([[{ text: 'к', data: 'a'.repeat(64) }]])).toEqual([]);
    expect(telegramKeyboardProblems([[{ text: 'к', data: 'я'.repeat(33) }]])).toEqual([
      'button_data:66',
    ]);
    expect(telegramKeyboardProblems([[{ text: 'к', data: '' }]])).toEqual(['button_data:0']);
    expect(telegramKeyboardProblems([[{ text: 'к', copy: 'x'.repeat(257) }]])).toEqual([
      'button_copy:257',
    ]);
    expect(telegramKeyboardProblems([[{ text: 'к', copy: 'Код {код}' }]])).toEqual([
      'placeholder:{код}',
    ]);
    expect(telegramKeyboardProblems([[{ text: 'к', url: 'http://x.kg' }]])).toEqual(['button_url']);
    const row = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `${i}`, data: 'a' }));
    expect(telegramKeyboardProblems([row(9)])).toEqual(['row_too_wide:9']);
    expect(telegramKeyboardProblems(Array.from({ length: 13 }, () => row(8)))).toEqual([
      'too_many_buttons:104',
    ]);
  });

  it('подпись картинки — до 1024 знаков, может быть пустой; скрытый ответ — до 200', () => {
    expect(telegramCaptionProblems('', false)).toEqual([]);
    expect(telegramCaptionProblems('а'.repeat(1025), false)).toEqual(['text_too_long:1025']);
    expect(telegramCaptionProblems('<b>Сводка</b>', true)).toEqual([]);
    expect(telegramCallbackTextProblems(undefined)).toEqual([]);
    expect(telegramCallbackTextProblems('')).toEqual([]);
    expect(telegramCallbackTextProblems('а'.repeat(200))).toEqual([]);
    expect(telegramCallbackTextProblems('а'.repeat(201))).toEqual(['text_too_long:201']);
    expect(telegramSendProblems('Меню', { menu: [['Сегодня', ' ']] })).toEqual(['menu_text_empty']);
    expect(telegramSendProblems('Таблица', { rich: '<p>{n}</p>' })).toEqual(['placeholder:{n}']);
  });

  it('данные виджета и ответ на его запрос — до 1 КБ, без незаполненных подстановок', () => {
    expect(telegramWidgetDataProblems(undefined)).toEqual([]);
    expect(telegramWidgetDataProblems('{"h":"Неделя","r":[{"t":"НДС"}]}')).toEqual([]);
    expect(telegramWidgetDataProblems('{"h":"Неделя {даты}"}')).toEqual(['placeholder:{даты}']);
    expect(telegramWidgetDataProblems('я'.repeat(513))).toEqual(['widget_data_too_long:1026']);
  });

  it('обрезка текста: лишнее — многоточием, половина эмодзи не остаётся', () => {
    expect(clipTelegramText('коротко', 200)).toBe('коротко');
    expect(clipTelegramText('абвгд', 4)).toBe('абв…');
    expect(clipTelegramText('аб😀где', 4)).toBe('аб…');
    expect(clipTelegramText('а'.repeat(300), 200)).toHaveLength(200);
  });
});

describe('подставной бот проверяет каждое сообщение', () => {
  it('нарушения — в списке бота и в общем списке; сообщение всё равно принимается', async () => {
    const tg = createFakeTelegram();
    expect(
      await tg.sendMessage(1, 'Срок {срок}', { keyboard: [[{ text: '', data: 'a' }]] }),
    ).toEqual({ ok: true, messageId: 1 });
    await tg.sendPhoto(
      1,
      { bytes: new Uint8Array([1]), name: 'a.png', contentType: 'image/png' },
      { caption: 'а'.repeat(1025) },
    );
    await tg.answerCallback('cb', 'а'.repeat(201));
    await tg.editKeyboard(1, 1, [[{ text: 'к', data: 'я'.repeat(40) }]]);
    await tg.sendWidget(1, { html: '<p></p>', chatData: '{}', caption: '{даты}' });
    await tg.editWidgetData(1, 4, '{"u":"Обновлено в {время}"}');
    await tg.answerWidgetQuery('q', '{"ok":true}');
    await tg.answerCallback('cb2');
    await tg.sendMessage(1, 'Всё верно');
    const expected = [
      {
        method: 'sendMessage',
        problems: ['placeholder:{срок}', 'button_text_empty'],
        text: 'Срок {срок}',
      },
      { method: 'sendPhoto', problems: ['text_too_long:1025'], text: 'а'.repeat(120) },
      { method: 'answerCallback', problems: ['text_too_long:201'], text: 'а'.repeat(120) },
      { method: 'editKeyboard', problems: ['button_data:80'], text: '' },
      { method: 'sendWidget', problems: ['placeholder:{даты}'], text: '{даты}' },
      {
        method: 'editWidgetData',
        problems: ['placeholder:{время}'],
        text: '{"u":"Обновлено в {время}"}',
      },
    ];
    expect(tg.problems).toEqual(expected);
    expect(takeFakeTelegramProblems()).toEqual(expected);
    expect(takeFakeTelegramProblems()).toEqual([]);
    expect(tg.sent).toHaveLength(3);
  });

  it('коды кнопок сверяются проверкой тестов; у бота с pressCheck = false — нет', async () => {
    setFakeTelegramPressCheck((data) =>
      data.startsWith('known') ? null : `button_action:${data}`,
    );
    const tg = createFakeTelegram();
    await tg.sendMessage(1, 'Отчёт', {
      keyboard: [
        [
          { text: 'В работу', data: 'known:1' },
          { text: 'Старый', data: 'gone:1' },
          { text: 'Ссылка', url: 'https://x.kg' },
        ],
      ],
    });
    await tg.editKeyboard(1, 1, [[{ text: 'Снова', data: 'gone:2' }]]);
    expect(takeFakeTelegramProblems().map((p) => p.problems)).toEqual([
      ['button_action:gone:1'],
      ['button_action:gone:2'],
    ]);
    const own = createFakeTelegram();
    own.pressCheck = false;
    await own.sendMessage(1, 'Отчёт', { keyboard: [[{ text: 'Своё', data: 'mine' }]] });
    expect(takeFakeTelegramProblems()).toEqual([]);
  });
});
