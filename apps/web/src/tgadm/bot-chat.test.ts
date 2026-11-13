import { botTestMessage, BOT_TEST_ACTION, codeBotMessage } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { pressChatButton, type BotChatActions, type BotChatItem } from './bot-chat';

const test = botTestMessage('Проверка', 'Проверить кнопки');
const list: readonly BotChatItem[] = [
  { kind: 'day', text: 'Сегодня' },
  { kind: 'message', message: codeBotMessage('482913 — код', '482913', 'Скопировать код') },
  { kind: 'message', message: test },
];
const button = test.buttons![0]![0]!;

describe('макет чата бота: нажатие кнопки-действия', () => {
  it('скрытый ответ встаёт строкой «Видно только вам», кнопка без новой подписи остаётся активной', () => {
    const actions: BotChatActions = { [BOT_TEST_ACTION]: () => ({ reply: 'Кнопки работают' }) };
    const next = pressChatButton(list, 2, button, actions);
    expect(next).toHaveLength(4);
    expect(next[3]).toEqual({ kind: 'hidden', text: 'Кнопки работают' });
    expect(next[2]).toEqual(list[2]);
  });

  it('выполненное действие: кнопка гаснет с новой подписью, второе нажатие список не меняет', () => {
    const actions: BotChatActions = { [BOT_TEST_ACTION]: () => ({ done: 'Готово' }) };
    const next = pressChatButton(list, 2, button, actions);
    const item = next[2]!;
    expect(item.kind === 'message' && item.message.buttons![0]![0]).toMatchObject({
      text: 'Готово',
      off: true,
    });
    expect(next).toHaveLength(3);
    const off = item.kind === 'message' ? item.message.buttons![0]![0]! : button;
    expect(pressChatButton(next, 2, off, actions)).toBe(next);
  });

  it('неизвестное действие, чужая кнопка и строка не с сообщением список не меняют', () => {
    const actions: BotChatActions = { [BOT_TEST_ACTION]: () => ({ reply: 'x' }) };
    expect(pressChatButton(list, 2, button, {})).toBe(list);
    // Имя действия из прототипа объекта («toString») действием не считается.
    expect(pressChatButton(list, 2, { ...button, action: 'toString' }, actions)).toBe(list);
    // Кнопки проверки нет в сообщении с кодом.
    expect(pressChatButton(list, 1, button, actions)).toBe(list);
    expect(pressChatButton(list, 0, button, actions)).toBe(list);
    expect(pressChatButton(list, 9, button, actions)).toBe(list);
  });
});
