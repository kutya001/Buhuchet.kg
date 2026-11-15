import { askBotMessage, BOT_BUTTON_TEXT_MAX, type BotMessage } from '../telegram/bot-message';
import type { PayClaimPurpose } from './pay-claims';
import { CP_TG_FILE_TO_ACTION, CP_TG_RECEIPT_ACTION } from './telegram-pay';

/*
 * Чек к оплате и файлы клиента через бота (доработки 14.11.2026, блок 2, пункт 1 и блок 4, пункт 4,
 * этап 2; прототип v115 modules/cp-telegram.js: `PG_RCPT_EXT`, `pgRcptBtn`, `pgRcptOffer`,
 * `tgAct('cp-receipt')`, `pgFileFromTg`, `tgAct('cp-file-to')`). «Прислать чек» — после «Оплатил» под
 * «К оплате» и прямо под «Оплата за обслуживание до …»; чек необязателен. Файл без просьбы бота из чата,
 * подключённого к нескольким контрагентам, — вопрос «От какой компании?» кнопками с названиями.
 */

/** Чек — фото или PDF (прототип `PG_RCPT_EXT`). */
export const CP_RECEIPT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'] as const;

/** Подходит ли файл как чек: по расширению имени (у фото из Telegram имя «….jpg»). */
export function cpReceiptFileOk(name: string): boolean {
  const at = name.lastIndexOf('.');
  if (at < 1) return false;
  return (CP_RECEIPT_EXTENSIONS as readonly string[]).includes(name.slice(at + 1).toLowerCase());
}

/** Кнопок «От какой компании?» под одним сообщением — не больше (столько подключений отдаёт база). */
export const CP_TG_FILE_TO_MAX = 20;

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Данные кнопки «Прислать чек»: `fee` или `tax` — чек к этому сообщению (под «Оплата за обслуживание до
 * …»); `tax.<номер>` — к сообщению «К оплате» с этим номером (кнопка под предложением прислать чек после
 * «Оплатил»). Номер сообщения — в данных кнопки, сохранённой в записи: нажатие сверяется с ней.
 */
export function cpReceiptArg(purpose: PayClaimPurpose, paidId?: string): string {
  return paidId ? `${purpose}.${paidId}` : purpose;
}

/** Разобрать данные кнопки «Прислать чек»; null — данные не наши. */
export function parseCpReceiptArg(
  arg: string | null,
): { purpose: PayClaimPurpose; paidId: string | null } | null {
  if (!arg) return null;
  const at = arg.indexOf('.');
  const purpose = at < 0 ? arg : arg.slice(0, at);
  if (purpose !== 'tax' && purpose !== 'fee') return null;
  if (at < 0) return { purpose, paidId: null };
  const paidId = arg.slice(at + 1);
  return ID_RE.test(paidId) ? { purpose, paidId } : null;
}

/** Предложение прислать чек после «Оплатил» (прототип `pgRcptOffer`): текст и кнопка «Прислать чек». */
export function receiptOfferBotMessage(o: {
  text: string;
  button: string;
  arg: string;
}): BotMessage {
  return {
    text: o.text,
    buttons: [[{ text: o.button, action: CP_TG_RECEIPT_ACTION, arg: o.arg }]],
  };
}

/**
 * Просьба «Пришлите чек ответом на это сообщение» (прототип `tgAct('cp-receipt').run` → `ask`): бот ждёт
 * файл до конца дня `day`, под просьбой — «Отмена». В просьбе — те же данные, что у нажатой кнопки: по
 * ним бот найдёт оплаченное сообщение.
 */
export function receiptAskBotMessage(o: {
  text: string;
  cancel: string;
  arg: string;
  day: string;
}): BotMessage {
  return askBotMessage(
    o.text,
    { action: CP_TG_RECEIPT_ACTION, arg: o.arg, kind: 'file', day: o.day },
    o.cancel,
  );
}

/** Название контрагента на кнопке: одной строкой, длинное — с многоточием. */
const buttonText = (name: string): string => {
  const one = name.replace(/\s+/g, ' ').trim();
  return one.length > BOT_BUTTON_TEXT_MAX ? `${one.slice(0, BOT_BUTTON_TEXT_MAX - 1)}…` : one;
};

/**
 * «От какой компании?» (прототип `pgFileFromTg`): по кнопке с названием на каждое подключение чата, по
 * одной в ряду; данные кнопки (`arg`) — номер строки файла у этого подключения.
 */
export function fileToBotMessage(o: {
  text: string;
  links: readonly { arg: string; name: string }[];
}): BotMessage {
  return {
    text: o.text,
    buttons: o.links
      .slice(0, CP_TG_FILE_TO_MAX)
      .map((l) => [{ text: buttonText(l.name), action: CP_TG_FILE_TO_ACTION, arg: l.arg }]),
  };
}
