import { setFakeTelegramPressCheck, takeFakeTelegramProblems } from '@buhuchet/adapters';
import { BOT_PRESS_OFF, parseBotPress } from '@buhuchet/domain';
import { afterAll, afterEach, beforeEach, expect } from 'vitest';
import { HANDLED_PRESS_ACTIONS } from './modules/telegram/actions';

/*
 * Общая проверка сообщений бота (пакет 14.11.2026, этап 3, поток Т): после каждого теста API — ни одно
 * сообщение подставному боту не нарушило правил Telegram (длина, разметка, кнопки), не ушло с
 * незаполненной подстановкой шаблона и не принесло кнопку, которую никто не разбирает (нажатие ответит
 * «Кнопка устарела»). Тест, который нарочно шлёт такое сообщение, сам забирает нарушения
 * (`takeFakeTelegramProblems`) и проверяет их.
 */

setFakeTelegramPressCheck((data) => {
  if (data === BOT_PRESS_OFF) return null;
  const press = parseBotPress(data);
  return press && HANDLED_PRESS_ACTIONS.has(press.action) ? null : `button_action:${data}`;
});

// Нарушение из `beforeAll` или отправка, закончившаяся после прошлого теста, — не вина этого теста.
beforeEach(() => {
  expect(
    takeFakeTelegramProblems(),
    'сообщения бота против правил Telegram: из beforeAll или после прошлого теста',
  ).toEqual([]);
});

afterEach(() => {
  expect(takeFakeTelegramProblems(), 'сообщения бота против правил Telegram').toEqual([]);
});

// Уборка файла (`afterAll`) тоже может отправить сообщение.
afterAll(() => {
  expect(
    takeFakeTelegramProblems(),
    'сообщения бота против правил Telegram: после тестов файла',
  ).toEqual([]);
});
