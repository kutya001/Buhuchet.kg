import {
  BOT_CARD_ACTION,
  BOT_FIND_ACTION,
  CP_TG_CLIENT_ACTIONS,
  CP_TG_FILE_TO_ACTION,
  GROUP_MINE,
  NOT_ME_ACTION,
  STAFF_BOT_NUDGE,
} from '@buhuchet/domain';
import { cpTelegramActions } from '../contractor-page/telegram-bot';
import { testAction } from './bot-test';
import { contractorCardAction, findContractorAction } from './command-actions';
import { LEAD_BOT_HANDLERS } from './lead-actions';
import type { BotAction } from './press';
import { notMeAction } from './security-actions';
import { STAFF_BOT_HANDLERS } from './staff-actions';
import { nudgeAction } from './staff-nudge';

/**
 * Реестр действий по кнопкам бота: код действия → обработчик (как `FILE_SOURCES` у файлов). Поток,
 * который добавляет кнопку, добавляет сюда одну строку; обработчик лежит в папке его модуля.
 *
 * Код действия — латиница и цифры, с маленькой буквы, до 16 знаков (`botPressData`); вместе с
 * идентификатором записи — не длиннее 64 байт. Обработчик сам проверяет право, область «Свои / Все
 * контрагенты» и что запись не изменилась, и отвечает скрытым ответом (`tgActNoRight`, `tgActStale`).
 * В тестах свои действия — `deps.botActions`.
 */
export const BOT_ACTIONS: Readonly<Record<string, BotAction>> = {
  test: testAction,
  // «Подтвердить» и «Отклонить» под запросом на подключение Telegram контрагента (поток К, задача К5).
  ...cpTelegramActions,
  ...STAFF_BOT_HANDLERS,
  [STAFF_BOT_NUDGE]: nudgeAction,
  [NOT_ME_ACTION]: notMeAction,
  [BOT_FIND_ACTION]: findContractorAction,
  [BOT_CARD_ACTION]: contractorCardAction,
  ...LEAD_BOT_HANDLERS,
};

/**
 * Все коды кнопок, которые разбирает вебхук: реестр основы, кнопки клиента (`clientPress`) и «Мои» в
 * общем чате фирмы (`handleGroupPress`). Тесты сверяют с ним каждую отправленную кнопку и список кодов,
 * уже ушедших в Telegram (docs/decisions.md п. Т-13).
 */
export const HANDLED_PRESS_ACTIONS: ReadonlySet<string> = new Set([
  ...Object.keys(BOT_ACTIONS),
  ...CP_TG_CLIENT_ACTIONS,
  CP_TG_FILE_TO_ACTION,
  GROUP_MINE,
]);
