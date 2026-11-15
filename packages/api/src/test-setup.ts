import { setFakeTelegramPressCheck, takeFakeTelegramProblems } from '@buhuchet/adapters';
import {
  BOT_PRESS_OFF,
  CP_TG_CLIENT_ACTIONS,
  CP_TG_FILE_TO_ACTION,
  GROUP_MINE,
  parseBotPress,
} from '@buhuchet/domain';
import { afterEach, expect } from 'vitest';
import { BOT_ACTIONS } from './modules/telegram/actions';

/*
 * Общая проверка сообщений бота (пакет 14.11.2026, этап 3, поток Т): после каждого теста API — ни одно
 * сообщение подставному боту не нарушило правил Telegram (длина, разметка, кнопки), не ушло с
 * незаполненной подстановкой шаблона и не принесло кнопку, которую никто не разбирает (нажатие ответит
 * «Кнопка устарела»). Тест, который нарочно шлёт такое сообщение, сам забирает нарушения
 * (`takeFakeTelegramProblems`) и проверяет их.
 */

/** Коды кнопок, которые разбирает вебхук: реестр основы, кнопки клиента и «Мои» в общем чате. */
const HANDLED_ACTIONS = new Set<string>([
  ...Object.keys(BOT_ACTIONS),
  ...CP_TG_CLIENT_ACTIONS,
  CP_TG_FILE_TO_ACTION,
  GROUP_MINE,
]);

setFakeTelegramPressCheck((data) => {
  if (data === BOT_PRESS_OFF) return null;
  const press = parseBotPress(data);
  return press && HANDLED_ACTIONS.has(press.action) ? null : `button_action:${data}`;
});

afterEach(() => {
  expect(takeFakeTelegramProblems(), 'сообщения бота против правил Telegram').toEqual([]);
});
