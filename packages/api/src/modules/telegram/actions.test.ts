import { CP_TG_CLIENT_ACTIONS, CP_TG_FILE_TO_ACTION, GROUP_MINE } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { BOT_ACTIONS } from './actions';

/*
 * Старые кнопки продолжают работать (пакет 14.11.2026, этап 3, поток Т): под уже отправленными
 * сообщениями остаются кнопки с прежними кодами действий, и после выпуска их нажимают. Код, который
 * хоть раз ушёл в Telegram, не удаляется и не переименовывается — иначе такое нажатие ответит лишь
 * «Кнопка устарела». Новый код — строкой в этот список.
 */
const SHIPPED_PRESS_ACTIONS = [
  // «Проверить бота» (Т1)
  'test',
  // Запрос на подключение Telegram контрагента и ответ на вопрос клиента (К5, К4)
  'cptgOk',
  'cptgNo',
  'cptgAns',
  // Действия сотрудника из чата (Т2)
  'repWork',
  'repDone',
  'repFile',
  'taskWork',
  'taskDone',
  'taskFile',
  'confOk',
  'confBack',
  'confWhy',
  'askCancel',
  // «Напомнить» в «Сводке недели» (Т3), «Это не я» (Т4), «Найти контрагента» (Т5)
  'nudge',
  'notMe',
  'cpFind',
  'cpCard',
  // Заявка с сайта в чате администратора платформы (Т6)
  'leadWork',
  'leadNo',
  'leadNoWhy',
  // Кнопки клиента в Telegram контрагента (К4, К5, пакет 14.11.2026)
  'cpPaid',
  'cpAsk',
  'cpNoDebt',
  'cpReq',
  'cpReceipt',
  'cpFileTo',
  // «Мои» под сводкой в общем чате фирмы (Т8)
  'grpMine',
] as const;

const handled = new Set<string>([
  ...Object.keys(BOT_ACTIONS),
  ...CP_TG_CLIENT_ACTIONS,
  CP_TG_FILE_TO_ACTION,
  GROUP_MINE,
]);

describe('коды кнопок бота', () => {
  it('каждый код, уже ушедший в Telegram, по-прежнему разбирается', () => {
    expect(SHIPPED_PRESS_ACTIONS.filter((code) => !handled.has(code))).toEqual([]);
  });

  it('новый код кнопки записан в список отправленных', () => {
    const shipped = new Set<string>(SHIPPED_PRESS_ACTIONS);
    expect([...handled].filter((code) => !shipped.has(code))).toEqual([]);
  });

  it('у кнопки клиента и действия сотрудника коды не пересекаются, кроме «Отмены»', () => {
    // «Отмена» под просьбой бота — общая: клиенту её разбирает `clientPress`, сотруднику — ядро.
    const both = CP_TG_CLIENT_ACTIONS.filter((code) => Object.hasOwn(BOT_ACTIONS, code));
    expect(both).toEqual(['askCancel']);
  });
});
