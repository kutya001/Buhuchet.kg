import { randomUUID } from 'node:crypto';
import {
  answerContractorTelegramAsk,
  attachPayClaimReceipt,
  botChatUsers,
  closePendingClientFiles,
  contractorPageSectionShown,
  contractorTelegramChats,
  contractorTelegramPressTarget,
  contractorTelegramReceiptTarget,
  contractorTelegramRecipients,
  insertContractorTelegramMessage,
  lockContractorTelegramMessage,
  lockPendingClientFile,
  openReceiptAsks,
  releaseRateLimit,
  saveContractorTelegramMessage,
  sentFilesLastDay,
  sentUploadState,
  takeRateLimit,
  telegramBotRich,
  withOrgContext,
  type ContractorTelegramTarget,
  type LockedContractorTelegramMessage,
  type RateLimit,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  BOT_ASK_CANCEL,
  botAskLive,
  botKeyboard,
  botPlainText,
  closeBotAsk,
  cpReceiptArg,
  cpReceiptFileOk,
  CP_TG_FILE_TO_ACTION,
  CP_TG_RECEIPT_ACTION,
  FILE_MAX_BYTES,
  fileToBotMessage,
  fileUploadProblem,
  formatText,
  monthLabel,
  parseCpReceiptArg,
  pressBotButton,
  receiptAskBotMessage,
  receiptOfferBotMessage,
  SENT_FILES_PER_DAY,
  sentUploadOn,
  type BotMessage,
  type IsoDate,
  type PayClaimPurpose,
  type SentFileRefusal,
  type TelegramTemplateKey,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import { z } from '@hono/zod-openapi';
import type { ApiDeps } from '../../../deps';
import { orgAccessClosed, orgClosedNow } from '../../contractor-page/org-closed';
import { addSentFiles, SentFilesRefused } from '../../files/sent-add';
import { serverTexts } from '../../l10n/texts';
import { botSendOptions } from '../outbox';
import type { BotPress } from '../press';
import type { BotIncoming } from '../reply';
import { botTemplateText } from './template';

/*
 * Чек к оплате и файлы клиента через бота (доработки 14.11.2026, блок 2, пункт 1 и блок 4, пункт 4,
 * этап 2; прототип v115 modules/cp-telegram.js: `pgFileOn`, `pgFileIn`, `pgFileFromTg`,
 * `tgAct('cp-file-to')`, `pgRcptOffer`, `tgAct('cp-receipt')`). Клиент — не сотрудник: входа, прав и
 * области у него нет, поэтому бот сверяет сам, что чат подключён к этому контрагенту этой организации и
 * подключение действует. Файлы ложатся в «Отправленные файлы» контрагента общим входом `addSentFiles` —
 * с теми же правилами, что со страницы: галочки, 20 в сутки вместе со страницей, до 20 МБ, тип по
 * содержимому. Чек становится чеком сообщения «ждёт подтверждения» (`contractor_pay_claims`).
 */

/** Файлов и чеков из одного чата — не больше стольких в час: каждый — скачивание и хранилище. */
export const CP_TG_FILE_RATE_LIMIT: RateLimit = {
  kind: 'cp_tg_file',
  max: 30,
  windowSeconds: 3600,
};

/** Одно сообщение клиента с файлом принимается один раз: Telegram повторяет доставку. */
export const CP_TG_FILE_ONCE: RateLimit = {
  kind: 'cp_tg_file_once',
  max: 1,
  windowSeconds: 43_200,
};

/**
 * «От какой компании?» — нажатия одного вопроса по одному (`leaseSeconds`: пока файл передаётся, второе
 * нажатие — «устарела»), не больше 10 попыток: файл не уйдёт двум контрагентам, а не переданный (Telegram
 * не отдал файл) можно отправить снова.
 */
export const CP_TG_FILE_TO_ONCE: RateLimit = {
  kind: 'cp_tg_file_to',
  max: 10,
  windowSeconds: 43_200,
  leaseSeconds: 300,
};

const MB = FILE_MAX_BYTES / 1048576;

/**
 * Может ли контрагент сейчас отправлять файлы через бота (прототип `pgFileOn`): те же правила, что у
 * отправки со страницы (`sentUploadOn`: страница включена и не закрыта, раздел «Файлы» показан, галочки
 * учётной политики и контрагента); что Telegram подключён, проверяет вызывающий. Нельзя — кнопки
 * «Прислать чек» под сообщениями нет.
 */
export async function clientFilesOn(tx: Tx, contractorId: string): Promise<boolean> {
  const state = await sentUploadState(tx, contractorId);
  return !!state && sentUploadOn(state);
}

/** Подключение действует (как у нажатий: раздел «Telegram» страницы показан, чат в рассылке). */
async function activeLink(
  tx: Tx,
  link: { linkId: string; contractorId: string },
): Promise<{ name: string } | null> {
  if (!(await contractorPageSectionShown(tx, link.contractorId, 'tg'))) return null;
  const found = (await contractorTelegramRecipients(tx, link.contractorId)).find(
    (r) => r.linkId === link.linkId,
  );
  return found ? { name: found.name } : null;
}

/** Комментарий чека в «Отправленных файлах» (прототип `pgRcptNote`). */
async function receiptNote(
  deps: ApiDeps,
  purpose: PayClaimPurpose,
  month: YearMonth | null,
): Promise<string> {
  const t = await serverTexts(deps);
  if (purpose === 'tax') {
    return formatText(t('cppage.tg.receipt_note.tax'), { month: month ? monthLabel(month) : '' });
  }
  return month
    ? formatText(t('cppage.tg.receipt_note.fee'), { month: monthLabel(month).toLowerCase() })
    : t('cppage.tg.receipt_note.fee_any');
}

/** Сообщение клиенту, записанное до отправки (как у «К оплате»). */
interface ClientSend {
  id: string;
  chatId: number;
  message: BotMessage;
}

/**
 * «Если есть чек об оплате, пришлите его» после «Оплатил» под «К оплате» (прототип `pgRcptOffer`):
 * только пока клиент может отправлять файлы. Строка сообщения вида `receipt` пишется в транзакции
 * нажатия с месяцем и итогом оплаченного сообщения; в кнопке — номер оплаченного сообщения.
 */
export async function receiptOffer(
  tx: Tx,
  o: {
    contractorId: string;
    linkId: string;
    chatId: number;
    paidId: string;
    month: YearMonth;
    total: Tyiyn;
  },
): Promise<ClientSend | null> {
  if (!(await clientFilesOn(tx, o.contractorId))) return null;
  const [text, button] = await Promise.all([
    botTemplateText(tx, 'tgCpReceiptOffer'),
    botTemplateText(tx, 'tgBtnCpReceipt'),
  ]);
  const message = receiptOfferBotMessage({ text, button, arg: cpReceiptArg('tax', o.paidId) });
  const id = await insertContractorTelegramMessage(tx, {
    contractorId: o.contractorId,
    linkId: o.linkId,
    chatId: o.chatId,
    kind: 'receipt',
    month: o.month,
    total: o.total,
    payload: message,
  });
  return id ? { id, chatId: o.chatId, message } : null;
}

export type ReceiptPressOutcome =
  | { refusal: TelegramTemplateKey }
  | { reply?: string; after: BotMessage | null; send: ClientSend | null };

/**
 * «Прислать чек» (прототип `tgAct('cp-receipt').run`) — в транзакции нажатия, под блокировкой строки
 * сообщения с кнопкой: бот просит прислать чек ответом и ждёт его до конца дня. Та же просьба уже открыта
 * — бот напоминает, что ждёт. Файлы отправлять нельзя — «Ваш бухгалтер не принимает файлы через бота».
 * Чек относится к оплаченному сообщению: «Оплата за обслуживание до …» — к этому, предложение после
 * «Оплатил» — к «К оплате» из данных своей кнопки; месяц и сумма — из записи.
 */
export async function receiptPress(
  tx: Tx,
  o: {
    target: ContractorTelegramTarget;
    current: LockedContractorTelegramMessage;
    arg: string | null;
    chatId: number;
    messageId: number;
    today: IsoDate;
  },
): Promise<ReceiptPressOutcome> {
  const parsed = parseCpReceiptArg(o.arg);
  if (!parsed) return { refusal: 'tgActStale' };
  // Номер оплаченного сообщения — только у предложения после «Оплатил»; под самим сообщением — оно.
  if (parsed.paidId ? o.target.kind !== 'receipt' : o.target.kind !== 'fee') {
    return { refusal: 'tgActStale' };
  }
  if (!(await clientFilesOn(tx, o.target.contractorId))) return { refusal: 'tgCpFileOff' };
  const arg = cpReceiptArg(parsed.purpose, parsed.paidId ?? o.target.id);
  const open = await openReceiptAsks(tx, o.chatId, o.today);
  if (open.some((a) => a.linkId === o.target.linkId && a.arg === arg)) {
    return { reply: await botTemplateText(tx, 'tgActAskWait'), after: null, send: null };
  }
  const [text, cancel] = await Promise.all([
    botTemplateText(tx, 'tgCpReceiptAsk'),
    botTemplateText(tx, 'tgBtnCancel'),
  ]);
  const asked = receiptAskBotMessage({ text, cancel, arg, day: o.today });
  // Кнопка, которой открыта просьба: когда чек принят, она гаснет с подписью «✓ Чек отправлен».
  const message: BotMessage = {
    ...asked,
    ask: { ...asked.ask!, src: { messageId: o.messageId, action: CP_TG_RECEIPT_ACTION } },
  };
  const id = await insertContractorTelegramMessage(tx, {
    contractorId: o.target.contractorId,
    linkId: o.target.linkId,
    chatId: o.chatId,
    kind: 'receipt',
    month: o.current.month,
    total: o.current.total,
    payload: message,
  });
  return { after: null, send: id ? { id, chatId: o.chatId, message } : null };
}

/**
 * «Отмена» под просьбой «Пришлите чек» (прототип `tgAct('askCancel')`): бот перестаёт ждать, кнопка
 * гаснет с подписью «Отменено».
 */
export async function receiptCancel(
  tx: Tx,
  o: {
    target: ContractorTelegramTarget;
    current: LockedContractorTelegramMessage;
    today: IsoDate;
    done: string;
  },
): Promise<ReceiptPressOutcome> {
  if (
    o.target.kind !== 'receipt' ||
    o.current.answered ||
    !botAskLive(o.current.message, o.today)
  ) {
    return { refusal: 'tgActStale' };
  }
  if (!(await answerContractorTelegramAsk(tx, o.target.id))) return { refusal: 'tgActStale' };
  const after = closeBotAsk(
    pressBotButton(o.current.message, BOT_ASK_CANCEL, null, { done: o.done }),
  );
  await saveContractorTelegramMessage(tx, o.target.id, after);
  return { reply: await botTemplateText(tx, 'tgActCancelled'), after, send: null };
}

/** Доступ организации закрыт по подписке: файл не принимается (доработки 20.11.2026, блок 4, пункт 4). */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-24
async function sayOrgClosed(deps: ApiDeps, chatId: number): Promise<void> {
  await sayTo(deps, chatId, (await serverTexts(deps))('cppage.tg.org_closed'));
}

/** Доступ организации закрылся, пока файл из чата скачивался: транзакция записи откатывается. */
class OrgClosedOnSend extends Error {
  constructor() {
    super('org_closed');
    this.name = 'OrgClosedOnSend';
  }
}

/** Отправить текст клиенту; ошибка Telegram не роняет разбор. */
async function sayTo(deps: ApiDeps, chatId: number, text: string): Promise<void> {
  try {
    await deps.telegram?.sendMessage(chatId, text);
  } catch (err) {
    deps.logger.warn({ err, purpose: 'cp_file' }, 'Telegram: ответ контрагенту не отправлен');
  }
}

/** Поменять кнопки сообщения после действия; ошибка Telegram не роняет разбор. */
async function editButtons(
  deps: ApiDeps,
  chatId: number,
  messageId: number,
  message: BotMessage,
): Promise<void> {
  try {
    await deps.telegram?.editKeyboard(chatId, messageId, botKeyboard(message));
  } catch (err) {
    deps.logger.warn({ err, purpose: 'cp_file' }, 'Telegram: кнопки сообщения не обновлены');
  }
}

type Refusal = { key: TelegramTemplateKey; values?: Readonly<Record<string, string | number>> };

/**
 * Отказ общего входа — шаблоном бота. Чек (`receipt`): размер и тип — как у ответа боту
 * (прототип `tgFileWhy`), иначе — «Такие файлы не принимаются» (`pgFileBad`). `close` — просьба
 * «Пришлите чек» после такого отказа закрывается (прототип: `say`, а не `again`).
 */
function refusalOf(r: SentFileRefusal, receipt: boolean): Refusal & { close: boolean } {
  switch (r.code) {
    case 'sent_off':
      return { key: 'tgCpFileOff', close: true };
    case 'sent_day_left':
    case 'sent_day_limit':
      return { key: 'tgCpFileLimit', values: { лимит: SENT_FILES_PER_DAY }, close: true };
    case 'sent_too_large':
      return receipt
        ? { key: 'tgFileBig', values: { мб: MB }, close: false }
        : { key: 'tgCpFileNo', values: { мб: MB }, close: false };
    default:
      return receipt
        ? { key: 'tgFileType', close: false }
        : { key: 'tgCpFileNo', values: { мб: MB }, close: false };
  }
}

/**
 * Скачать файл у Telegram и отдать общему входу «Отправленные файлы» — вне транзакции. Отказ — шаблоном
 * бота; сбой — «Не получилось».
 */
async function sendClientFile(
  deps: ApiDeps,
  o: {
    orgId: string;
    contractorId: string;
    chatId: number;
    senderName: string;
    file: NonNullable<BotIncoming['file']>;
    name: string;
    comment: string | null;
    receipt: boolean;
  },
): Promise<{ ids: string[] } | (Refusal & { close: boolean }) | 'closed'> {
  const loaded = await deps.telegram!.loadFile(o.file.fileId, FILE_MAX_BYTES);
  if (!loaded.ok) {
    if (loaded.reason === 'too_large') return refusalOf({ code: 'sent_too_large' }, o.receipt);
    deps.logger.warn(
      { purpose: 'cp_file', description: loaded.description },
      'Telegram: файл контрагента не скачан',
    );
    return { key: 'tgActFailed', close: false };
  }
  if (loaded.body.byteLength === 0) return refusalOf({ code: 'sent_forbidden' }, o.receipt);
  try {
    return await addSentFiles(deps, {
      orgId: o.orgId,
      contractorId: o.contractorId,
      source: 'telegram',
      senderName: o.senderName,
      tgChatId: o.chatId,
      comment: o.comment,
      receipt: o.receipt,
      // Доступ организации могли закрыть, пока файл скачивался: проверка — и в транзакциях записи; ответ —
      // как при закрытом доступе до скачивания, просьба «Пришлите чек» остаётся (п. К-24).
      guard: async (tx) => {
        if (await orgAccessClosed(tx, bishkekDate(deps.clock.now()))) throw new OrgClosedOnSend();
      },
      files: [{ name: o.name, bytes: loaded.body }],
    });
  } catch (err) {
    if (err instanceof OrgClosedOnSend) return 'closed';
    if (err instanceof SentFilesRefused) return refusalOf(err.refusal, o.receipt);
    deps.logger.error({ err }, 'Telegram: файл контрагента не принят');
    deps.errors?.capture(err);
    return { key: 'tgActFailed', close: false };
  }
}

/** Пределы файла из чата: одно сообщение — один раз, не больше `CP_TG_FILE_RATE_LIMIT` в час. */
async function fileSlot(deps: ApiDeps, msg: BotIncoming): Promise<'ok' | 'repeat' | 'limited'> {
  if (msg.messageId !== null) {
    const once = await takeRateLimit(deps.db, CP_TG_FILE_ONCE, `${msg.chatId}:${msg.messageId}`);
    if (!once.ok) return 'repeat';
  }
  const slot = await takeRateLimit(deps.db, CP_TG_FILE_RATE_LIMIT, String(msg.chatId));
  return slot.ok ? 'ok' : 'limited';
}

/**
 * Файл или текст в личном чате клиента — до ответа на просьбы бота сотруднику. true — разобрано здесь
 * (ответ клиенту отправлен), false — это не клиенту: разбирает основа бота.
 *
 * Ответ на просьбу «Пришлите чек» — чек (прототип `tgAct('cp-receipt').reply`). Без ответа на неё —
 * последняя открытая за сегодня, а нет её — файл без просьбы (`pgFileFromTg`): один подключённый
 * контрагент — файл ему, несколько — «От какой компании?». Чат привязан и к учётной записи сотрудника:
 * без ответа на просьбу «Пришлите чек» файл — для бота сотрудника (docs/deviations.md п. О-79).
 */
export async function clientFile(deps: ApiDeps, msg: BotIncoming): Promise<boolean> {
  if (!deps.telegram || msg.fromId !== msg.chatId) return false;
  if (!msg.file && msg.replyTo === null) return false;
  const today = bishkekDate(deps.clock.now());
  if (msg.replyTo !== null) {
    const ask = await contractorTelegramReceiptTarget(deps.db, msg.chatId, msg.replyTo, today);
    if (ask) return receiptReply(deps, msg, ask, today);
  }
  if (!msg.file) return false;
  // ОТКЛОНЕНИЕ: docs/deviations.md#О-79
  if ((await botChatUsers(deps.db, msg.chatId)).length > 0) return false;
  // Ответ на закрытую или вчерашнюю просьбу (или на предложение прислать чек) другой просьбе не
  // достаётся — это файл без просьбы.
  const replied =
    msg.replyTo === null
      ? null
      : await contractorTelegramPressTarget(deps.db, msg.chatId, msg.replyTo);
  if (replied?.kind !== 'receipt') {
    const ask = await contractorTelegramReceiptTarget(deps.db, msg.chatId, null, today);
    // Без ответа файл — чек открытой просьбы, только если чат подключён к одному контрагенту: иначе
    // клиент мог отправить его другой фирме — тогда «От какой компании?» (защита — строже прототипа).
    // ОТКЛОНЕНИЕ: docs/deviations.md#К-11
    if (ask) {
      const chats = await contractorTelegramChats(deps.db, msg.chatId);
      const sole = chats.every((c) => c.orgId === ask.orgId && c.contractorId === ask.contractorId);
      if (sole) return receiptReply(deps, msg, ask, today);
    }
  }
  return freeFile(deps, msg, today);
}

/** Чек ответом на просьбу «Пришлите чек». */
async function receiptReply(
  deps: ApiDeps,
  msg: BotIncoming,
  ask: ContractorTelegramTarget & { messageId: number },
  today: IsoDate,
): Promise<boolean> {
  const say = async (r: Refusal) =>
    sayTo(deps, msg.chatId, await botTemplateText(deps.db, r.key, r.values));
  if (!ask.linked) {
    await say({ key: 'tgCpNotLinked' });
    return true;
  }
  if (await orgClosedNow(deps, ask.orgId)) {
    await sayOrgClosed(deps, msg.chatId);
    return true;
  }
  // Бот ждал файл (прототип: `again`): объясняет и ждёт дальше.
  if (!msg.file) {
    await say({ key: 'tgAskNeedFile' });
    return true;
  }
  const slot = await fileSlot(deps, msg);
  if (slot === 'repeat') return true;
  if (slot === 'limited') {
    await sayTo(deps, msg.chatId, (await serverTexts(deps))('cppage.tg.file_limit'));
    return true;
  }
  const name = msg.file.name.trim();
  const problem = fileUploadProblem({ name, size: msg.file.size });
  if (problem === 'file_too_large') {
    await say({ key: 'tgFileBig', values: { мб: MB } });
    return true;
  }
  if (problem) {
    await say({ key: 'tgFileType' });
    return true;
  }
  if (!cpReceiptFileOk(name)) {
    await say({ key: 'tgCpReceiptType' });
    return true;
  }

  const org = { orgId: ask.orgId, userId: null };
  // Закрыть просьбу после отказа, который ждать дальше не даёт (файлы выключили, лимит за сутки).
  const closeAsk = async () => {
    const closed = await withOrgContext(deps.db, org, async (tx) => {
      const current = await lockContractorTelegramMessage(tx, ask.id, msg.chatId);
      if (!current || !(await answerContractorTelegramAsk(tx, ask.id))) return null;
      const after = closeBotAsk(current.message);
      await saveContractorTelegramMessage(tx, ask.id, after);
      return after;
    });
    if (closed) await editButtons(deps, msg.chatId, ask.messageId, closed);
  };

  // Что ждёт просьба, можно ли сейчас отправлять файлы и не исчерпаны ли сутки — до скачивания.
  type Pre =
    | (Refusal & { close: boolean })
    | {
        purpose: PayClaimPurpose;
        paidId: string;
        month: YearMonth | null;
        total: Tyiyn | null;
        sender: string;
        src: number | null;
      };
  const pre = await withOrgContext(deps.db, org, async (tx): Promise<Pre> => {
    const current = await lockContractorTelegramMessage(tx, ask.id, msg.chatId);
    if (!current || current.answered || !botAskLive(current.message, today)) {
      return { key: 'tgActStale', close: false };
    }
    if (!current.linked) return { key: 'tgCpNotLinked', close: false };
    const arg = parseCpReceiptArg(current.message.ask?.arg ?? null);
    if (!arg?.paidId) return { key: 'tgActStale', close: false };
    if (!(await clientFilesOn(tx, ask.contractorId))) return refusalOf({ code: 'sent_off' }, true);
    if ((await sentFilesLastDay(tx, ask.contractorId)) >= SENT_FILES_PER_DAY) {
      return refusalOf({ code: 'sent_day_limit' }, true);
    }
    return {
      purpose: arg.purpose,
      paidId: arg.paidId,
      month: current.month,
      total: current.total,
      sender: current.name,
      src: current.message.ask?.src?.messageId ?? null,
    };
  });
  if ('key' in pre) {
    if (pre.close) await closeAsk();
    await say(pre);
    return true;
  }

  const note = await receiptNote(deps, pre.purpose, pre.month);
  const caption = (msg.caption ?? '').trim();
  const sent = await sendClientFile(deps, {
    orgId: ask.orgId,
    contractorId: ask.contractorId,
    chatId: msg.chatId,
    senderName: pre.sender,
    file: msg.file,
    name,
    comment: caption ? `${note}. ${caption}` : note,
    receipt: true,
  });
  if (sent === 'closed') {
    await sayOrgClosed(deps, msg.chatId);
    return true;
  }
  if ('key' in sent) {
    if (sent.close) await closeAsk();
    await say(sent);
    return true;
  }

  // Чек принят: он — чек сообщения «ждёт подтверждения», просьба закрыта, кнопка «Прислать чек» гаснет.
  // Сначала — просьба: второй файл ответом на ту же просьбу (пришёл почти сразу) её уже закрытой застанет
  // и останется просто файлом, без второго «Оплатил».
  const source =
    pre.src === null ? null : await contractorTelegramPressTarget(deps.db, msg.chatId, pre.src);
  const done = (await serverTexts(deps))('cppage.tg.receipt_done');
  let attached = false;
  try {
    const edits = await withOrgContext(deps.db, org, async (tx) => {
      const out: { messageId: number; message: BotMessage }[] = [];
      const current = await lockContractorTelegramMessage(tx, ask.id, msg.chatId);
      if (!current || !(await answerContractorTelegramAsk(tx, ask.id))) return out;
      const closed = closeBotAsk(current.message);
      await saveContractorTelegramMessage(tx, ask.id, closed);
      out.push({ messageId: ask.messageId, message: closed });
      await attachPayClaimReceipt(tx, {
        contractorId: ask.contractorId,
        purpose: pre.purpose,
        month: pre.month,
        amount: pre.total,
        tgMessageId: pre.paidId,
        sentFileId: sent.ids[0]!,
      });
      attached = true;
      if (source && source.orgId === ask.orgId && pre.src !== null) {
        const src = await lockContractorTelegramMessage(tx, source.id, msg.chatId);
        const button = src?.message.buttons
          ?.flat()
          .find((b) => b.action === CP_TG_RECEIPT_ACTION && !b.off);
        if (src && button) {
          const pressed = pressBotButton(src.message, CP_TG_RECEIPT_ACTION, button.arg ?? null, {
            done,
          });
          await saveContractorTelegramMessage(tx, source.id, pressed);
          out.push({ messageId: pre.src, message: pressed });
        }
      }
      return out;
    });
    for (const e of edits) await editButtons(deps, msg.chatId, e.messageId, e.message);
  } catch (err) {
    // Файл уже у бухгалтера в «Отправленных файлах»; не записана только связь с «Оплатил».
    deps.logger.error({ err }, 'Telegram: чек контрагента не связан с сообщением об оплате');
    deps.errors?.capture(err);
    attached = true;
  }
  await say({ key: attached ? 'tgCpReceiptOk' : 'tgCpFileOk' });
  return true;
}

/** Подключение чата, которое сейчас действует. */
interface ActiveLink {
  linkId: string;
  orgId: string;
  contractorId: string;
  contractor: string;
  sender: string;
}

/** Файл без просьбы бота (прототип `pgFileFromTg`). */
async function freeFile(deps: ApiDeps, msg: BotIncoming, today: IsoDate): Promise<boolean> {
  const file = msg.file!;
  const chats = await contractorTelegramChats(deps.db, msg.chatId);
  // Чат ни к одному контрагенту не подключён — файл не клиента: как раньше, без ответа.
  if (!chats.length) return false;
  const say = async (r: Refusal) =>
    sayTo(deps, msg.chatId, await botTemplateText(deps.db, r.key, r.values));
  const slot = await fileSlot(deps, msg);
  if (slot === 'repeat') return true;
  if (slot === 'limited') {
    await sayTo(deps, msg.chatId, (await serverTexts(deps))('cppage.tg.file_limit'));
    return true;
  }
  // Тип и размер — сразу, до вопроса «От какой компании?» (прототип `pgFileBad`).
  const name = file.name.trim();
  if (fileUploadProblem({ name, size: file.size })) {
    await say({ key: 'tgCpFileNo', values: { мб: MB } });
    return true;
  }
  const active: ActiveLink[] = [];
  // Контрагенты организаций с закрытым доступом в «От какой компании?» не попадают (п. К-24); о закрытом
  // доступе бот говорит только действующему подключению — бывшему клиенту, как прежде, «не подключён».
  let closed = 0;
  for (const link of chats) {
    const on = await withOrgContext(deps.db, { orgId: link.orgId, userId: null }, async (tx) => {
      const found = await activeLink(tx, link);
      return found && (await orgAccessClosed(tx, today)) ? ('closed' as const) : found;
    });
    if (on === 'closed') closed += 1;
    else if (on) active.push({ ...link, sender: on.name });
  }
  if (!active.length) {
    if (closed) await sayOrgClosed(deps, msg.chatId);
    else await say({ key: 'tgCpNotLinked' });
    return true;
  }
  if (active.length > 1) {
    await askWhich(deps, msg, active, today);
    return true;
  }
  const link = active[0]!;
  const out = await toContractor(deps, link, msg.chatId, file, name, msg.caption);
  if (out === 'closed') await sayOrgClosed(deps, msg.chatId);
  else await say('key' in out ? out : { key: 'tgCpFileOk' });
  return true;
}

/**
 * Можно ли отправить файл этому контрагенту сейчас (галочки, сутки) и отправить его. Отказ — шаблоном.
 */
async function toContractor(
  deps: ApiDeps,
  link: ActiveLink,
  chatId: number,
  file: NonNullable<BotIncoming['file']>,
  name: string,
  caption: string | null,
): Promise<{ ids: string[] } | Refusal | 'closed'> {
  const pre = await withOrgContext(
    deps.db,
    { orgId: link.orgId, userId: null },
    async (tx): Promise<Refusal | null> => {
      if (!(await clientFilesOn(tx, link.contractorId)))
        return refusalOf({ code: 'sent_off' }, false);
      if ((await sentFilesLastDay(tx, link.contractorId)) >= SENT_FILES_PER_DAY) {
        return refusalOf({ code: 'sent_day_limit' }, false);
      }
      return null;
    },
  );
  if (pre) return pre;
  return sendClientFile(deps, {
    orgId: link.orgId,
    contractorId: link.contractorId,
    chatId,
    senderName: link.sender,
    file,
    name,
    comment: caption,
    receipt: false,
  });
}

/** Что ждёт ответа «От какой компании?»: файл у Telegram и подпись к нему. */
const PendingFile = z.object({
  fileTo: z.object({
    /** Номер вопроса: одинаковый у строк всех организаций одного «От какой компании?». */
    q: z.string().uuid(),
    fileId: z.string().min(1).max(256),
    name: z.string().min(1).max(1024),
    size: z.number().int().nonnegative(),
    caption: z.string().max(4096).nullable(),
    day: z.string(),
  }),
});

/**
 * «От какой компании?» (прототип `pgFileFromTg`): у каждого подключения чата — строка вида `file` в его
 * организации (в ней — только свой контрагент и файл у Telegram), на кнопке — номер этой строки. Само
 * сообщение с кнопками уходит одно, сразу; строкам номер сообщения не ставится.
 */
async function askWhich(
  deps: ApiDeps,
  msg: BotIncoming,
  active: readonly ActiveLink[],
  today: IsoDate,
): Promise<void> {
  const file = msg.file!;
  const text = await botTemplateText(deps.db, 'tgCpFileWhich');
  const fileTo = {
    q: randomUUID(),
    fileId: file.fileId,
    name: file.name.trim(),
    size: file.size,
    caption: msg.caption,
    day: today,
  };
  const links: { arg: string; name: string }[] = [];
  for (const link of active) {
    const id = await withOrgContext(deps.db, { orgId: link.orgId, userId: null }, (tx) =>
      insertContractorTelegramMessage(tx, {
        contractorId: link.contractorId,
        linkId: link.linkId,
        chatId: msg.chatId,
        kind: 'file',
        payload: { text, fileTo } as BotMessage,
      }),
    );
    if (id) links.push({ arg: id, name: link.contractor });
  }
  const message = fileToBotMessage({ text, links });
  const plain = !(await telegramBotRich(deps.db));
  try {
    const res = await deps.telegram!.sendMessage(
      msg.chatId,
      botPlainText(message),
      botSendOptions(message, { plain }),
    );
    if (!res.ok) {
      deps.logger.warn(
        { purpose: 'cp_file', errorCode: res.errorCode, description: res.description },
        'Telegram: вопрос «От какой компании?» не отправлен',
      );
    }
  } catch (err) {
    deps.logger.warn(
      { err, purpose: 'cp_file' },
      'Telegram: вопрос «От какой компании?» не отправлен',
    );
  }
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Ответ на «От какой компании?» (прототип `tgAct('cp-file-to')`): кнопка — строка файла в организации
 * выбранного контрагента; её ищем в организациях подключений этого чата (RLS), сверяем, что подключение
 * действует. Отказ до скачивания — скрытым ответом на нажатие, после — сообщением в чат; при отказе
 * вопрос остаётся открытым — можно выбрать снова (прототип: `{eph:no}`). Файл принят — строки вопроса во
 * всех организациях отвечены, файл из них стёрт, кнопки гаснут, остаются видны, на выбранной —
 * «✓ <контрагент>» (прототип: `done`, `off:['cp-file-to']`).
 */
export async function clientFileToPress(
  deps: ApiDeps,
  press: BotPress,
  arg: string | null,
): Promise<void> {
  const answer = async (text?: string) => {
    try {
      await deps.telegram?.answerCallback(press.callbackId, text, { alert: !!text });
    } catch (err) {
      deps.logger.warn({ err, purpose: 'cp_file' }, 'Telegram: ответ на нажатие не отправлен');
    }
  };
  const refuse = async (r: Refusal) => answer(await botTemplateText(deps.db, r.key, r.values));
  if (!deps.telegram || !arg || !ID_RE.test(arg)) {
    await refuse({ key: 'tgActStale' });
    return;
  }
  // Нажатия одного вопроса — по одному: пока одно передаёт файл, второе его не отправит второму
  // контрагенту; после него строки вопроса уже отвечены («устарела») или открыты (отказ — можно снова).
  const subject = `${press.chatId}:${press.messageId}`;
  const lease = await takeRateLimit(deps.db, CP_TG_FILE_TO_ONCE, subject);
  if (!lease.ok) {
    await refuse({ key: 'tgActStale' });
    return;
  }
  try {
    await fileToChosen(deps, press, arg, answer, refuse);
  } finally {
    await releaseRateLimit(deps.db, CP_TG_FILE_TO_ONCE, subject, lease.ticket);
  }
}

async function fileToChosen(
  deps: ApiDeps,
  press: BotPress,
  arg: string,
  answer: (text?: string) => Promise<void>,
  refuse: (r: Refusal) => Promise<void>,
): Promise<void> {
  const chats = await contractorTelegramChats(deps.db, press.chatId);
  type Found =
    | { link: ActiveLink; file: z.infer<typeof PendingFile>['fileTo'] }
    | Refusal
    | 'org_closed'
    | null;
  let found: Found = null;
  for (const orgId of new Set(chats.map((c) => c.orgId))) {
    found = await withOrgContext(deps.db, { orgId, userId: null }, async (tx): Promise<Found> => {
      const row = await lockPendingClientFile(tx, arg, press.chatId);
      if (!row) return null;
      const parsed = PendingFile.safeParse(row.payload);
      const today = bishkekDate(deps.clock.now());
      if (row.answered || !parsed.success || parsed.data.fileTo.day !== today) {
        return { key: 'tgActStale' };
      }
      const chat = chats.find((c) => c.linkId === row.linkId && c.orgId === orgId);
      const on = chat
        ? await activeLink(tx, { linkId: row.linkId, contractorId: row.contractorId })
        : null;
      if (!chat || !on) return { key: 'tgCpNotLinked' };
      if (await orgAccessClosed(tx, today)) return 'org_closed';
      if (!(await clientFilesOn(tx, row.contractorId)))
        return refusalOf({ code: 'sent_off' }, false);
      if ((await sentFilesLastDay(tx, row.contractorId)) >= SENT_FILES_PER_DAY) {
        return refusalOf({ code: 'sent_day_limit' }, false);
      }
      return { link: { ...chat, sender: on.name }, file: parsed.data.fileTo };
    });
    if (found) break;
  }
  if (!found) {
    await refuse({ key: 'tgActStale' });
    return;
  }
  if (found === 'org_closed') {
    await answer((await serverTexts(deps))('cppage.tg.org_closed'));
    return;
  }
  if ('key' in found) {
    await refuse(found);
    return;
  }
  // Ответ на нажатие — до скачивания: Telegram ждёт его недолго.
  await answer();
  const { link, file } = found;
  const out = await toContractor(
    deps,
    link,
    press.chatId,
    { fileId: file.fileId, name: file.name, size: file.size },
    file.name,
    file.caption,
  );
  if (out === 'closed') {
    // Вопрос остаётся: после оплаты выбрать можно снова.
    await sayOrgClosed(deps, press.chatId);
    return;
  }
  if ('key' in out) {
    // Файл не принят — вопрос остаётся: выбрать можно снова (этого или другого контрагента).
    await sayTo(deps, press.chatId, await botTemplateText(deps.db, out.key, out.values));
    return;
  }
  // Строки вопроса — в каждой организации чата (своя транзакция, RLS): отвечены, файл из них стёрт.
  const rows: Awaited<ReturnType<typeof closePendingClientFiles>> = [];
  for (const orgId of new Set(chats.map((c) => c.orgId))) {
    rows.push(
      ...(await withOrgContext(deps.db, { orgId, userId: null }, (tx) =>
        closePendingClientFiles(tx, press.chatId, file.q),
      )),
    );
  }
  const t = await serverTexts(deps);
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const asked = fileToBotMessage({
    text: '',
    links: rows.map((r) => ({ arg: r.id, name: r.contractor })),
  });
  await editButtons(
    deps,
    press.chatId,
    press.messageId,
    pressBotButton(asked, CP_TG_FILE_TO_ACTION, arg, {
      done: formatText(t('cppage.tg.file_to_done'), { contractor: link.contractor }),
      off: [CP_TG_FILE_TO_ACTION],
    }),
  );
  await sayTo(deps, press.chatId, await botTemplateText(deps.db, 'tgCpFileOk'));
}
