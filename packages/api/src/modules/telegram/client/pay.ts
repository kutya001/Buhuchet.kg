import {
  botChatUsers,
  answerContractorTelegramAsk,
  autoPayLinkIds,
  contextOrgName,
  contractorTelegramAskTarget,
  contractorTelegramPayOn,
  contractorTelegramPressTarget,
  contractorTelegramRecipients,
  contractorsWithTelegram,
  cpNoticeSettingsOf,
  getContractor,
  insertContractorTelegramMessage,
  insertTelegramPayClaim,
  loadEmployeeAccess,
  lockContractorTelegramMessage,
  logContractorTelegramPay,
  markContractorTelegramMessage,
  messageTemplates,
  notifyTarget,
  orgIds,
  orgMenuSettings,
  pageClosedNotice,
  payClaimMonths,
  refreshContractorTelegramMessage,
  reportMonthPlanRows,
  reportPayDueMonths,
  saveContractorTelegramMessage,
  setContractorTelegramNoDebt,
  takeRateLimit,
  telegramBotRich,
  telegramChat,
  unsentAutoPayMessages,
  withOrgContext,
  type RateLimit,
  type Tx,
} from '@buhuchet/db';
import {
  addDays,
  bishkekDate,
  BOT_ASK_CANCEL,
  BOT_HIDDEN_REPLY_MAX,
  botKeyboard,
  botMessageProblem,
  botPlainText,
  botTemplate,
  CP_PAY_DAYS,
  CP_TG_ANSWER_ACTION,
  CP_TG_ASK_ACTION,
  CP_TG_CLIENT_ACTIONS,
  CP_TG_FILE_TO_ACTION,
  CP_TG_NODEBT_ACTION,
  CP_TG_PAID_ACTION,
  CP_TG_QUESTIONS_PER_HOUR,
  CP_TG_RECEIPT_ACTION,
  CP_TG_REQ_ACTION,
  CP_TG_REQ_PER_HOUR,
  cpNoticeDay,
  cpNoticeDayDue,
  cpTgQuestion,
  cpTgQuestionForHistory,
  fillTemplate,
  findBotButton,
  formatDateRu,
  formatSomWithUnit,
  formatText,
  canSeeContractor,
  hasPermission,
  monthLabel,
  monthPayAutoDue,
  monthPayBotMessage,
  parseBotPress,
  parseCpReqArg,
  pressBotButton,
  relinkCodeOf,
  transferBotMessage,
  withOrganization,
  type BotAsk,
  type BotMessage,
  type IsoDate,
  type MonthPayLine,
  type TelegramTemplateKey,
  type TransferBlock,
  type Translate,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import { z } from '@hono/zod-openapi';
import type { ApiDeps, Job, JobContext } from '../../../deps';
import { serverTexts } from '../../l10n/texts';
import { monthPayRows } from '../../reports/month-pay-rows';
import { bellContractor } from '../bell';
import { botSendOptions, flushEvents, queueEvents } from '../outbox';
import type { BotPress } from '../press';
import { clientFileToPress, receiptCancel, receiptOffer, receiptPress } from './receipt';
import { feeRequisite, payRequisite } from './requisite';

/*
 * «К оплате» клиенту в Telegram (доработки 13.11.2026, задача К4; прототип v94 modules/cp-telegram.js:
 * `pgPayMsg`, `pgPaySend`, `tgAct('cp-paid')`, `tgAct('cp-ask')`, `pgTgAsk`). Клиент — не сотрудник:
 * входа, прав и области у него нет. Поэтому каждое нажатие и каждый ответ бот сверяет сам: сообщение
 * — из своей таблицы сообщений клиенту, чат — тот, куда оно ушло, подключение ещё действует, кнопка в
 * сообщении была и не погашена. Месяц и сумму бот берёт из своей записи, а не из данных кнопки.
 * Данных других контрагентов, задач и сотрудников клиент не получает.
 */

/** Вопросов бухгалтеру из одного подключения — не больше стольких в час. */
export const CP_TG_ASK_RATE_LIMIT: RateLimit = {
  kind: 'cp_tg_ask',
  max: CP_TG_QUESTIONS_PER_HOUR,
  windowSeconds: 3600,
};

/**
 * «Показать реквизиты для перевода» из одного подключения — не больше стольких в час: каждое нажатие
 * присылает новые сообщения, чат клиента не завалить.
 */
export const CP_TG_REQ_RATE_LIMIT: RateLimit = {
  kind: 'cp_tg_req',
  max: CP_TG_REQ_PER_HOUR,
  windowSeconds: 3600,
};

/**
 * «Прислать чек» из одного подключения — не больше стольких в час: каждое нажатие после «Отмены» — новая
 * просьба и новое сообщение в чате.
 */
export const CP_TG_RECEIPT_RATE_LIMIT: RateLimit = {
  kind: 'cp_tg_receipt',
  max: CP_TG_REQ_PER_HOUR,
  windowSeconds: 3600,
};

/** Сколько раз задача пробует отправить само «К оплате». */
const AUTO_PAY_MAX_ATTEMPTS = 3;

type Ctx = JobContext;

const translateOf = async (ctx: Ctx): Promise<Translate> => {
  const t = await serverTexts(ctx);
  return (key, params) => formatText(t(key), params);
};

/** Текст шаблона бота: справочник платформы, а пока шаблона там нет — текст по умолчанию. */
async function templateText(
  db: Ctx['db'] | Tx,
  key: TelegramTemplateKey,
  values: Readonly<Record<string, string | number>> = {},
): Promise<string> {
  const templates = await messageTemplates(db);
  return fillTemplate(botTemplate(key, templates[key]), values);
}

const clip = (text: string) =>
  text.length > BOT_HIDDEN_REPLY_MAX ? `${text.slice(0, BOT_HIDDEN_REPLY_MAX - 1)}…` : text;

/** Сообщение клиенту, записанное до отправки. */
export interface PreparedClientMessage {
  id: string;
  chatId: number;
  message: BotMessage;
}

/**
 * Отправить записанные сообщения клиенту и отметить каждое: ушло — номер сообщения в чате (по нему
 * бот примет нажатия), не ушло — счёт попыток. Ошибка Telegram метод не роняет. Ответ — сколько ушло.
 */
export async function deliverClientMessages(
  ctx: Ctx,
  org: { orgId: string; userId: string | null },
  prepared: readonly PreparedClientMessage[],
): Promise<number> {
  if (!prepared.length) return 0;
  const plain = ctx.telegram ? !(await telegramBotRich(ctx.db)) : true;
  let delivered = 0;
  for (const p of prepared) {
    let messageId: number | null = null;
    if (ctx.telegram) {
      try {
        const res = await ctx.telegram.sendMessage(
          p.chatId,
          botPlainText(p.message),
          botSendOptions(p.message, { plain }),
        );
        if (res.ok) messageId = res.messageId;
        else {
          ctx.logger.warn(
            { purpose: 'cp_telegram', errorCode: res.errorCode, description: res.description },
            'Telegram: сообщение контрагенту не отправлено',
          );
        }
      } catch (err) {
        ctx.logger.warn(
          { err, purpose: 'cp_telegram' },
          'Telegram: сообщение контрагенту не отправлено',
        );
      }
    }
    try {
      await withOrgContext(ctx.db, { orgId: org.orgId, userId: org.userId }, (tx) =>
        markContractorTelegramMessage(tx, p.id, messageId),
      );
    } catch (err) {
      ctx.logger.warn(
        { err, purpose: 'cp_telegram' },
        'Telegram: отправка контрагенту не отмечена',
      );
    }
    if (messageId !== null) delivered += 1;
  }
  return delivered;
}

/** Расчёт месяца для сообщения клиенту. */
export interface ClientMonthPay {
  month: YearMonth;
  lines: readonly MonthPayLine[];
  total: Tyiyn;
  due: IsoDate;
}

/**
 * Сообщение «К оплате» (прототип v110 pgPayMsg): под текстом — блок «Реквизиты для перевода — …» с
 * кнопкой копирования по виду реквизита (`payRequisite`: тот же реквизит, что в разделе «Как оплатить»
 * страницы контрагента). Сотрудник, который отправляет сообщение, реквизита в ответе не получает — его
 * видит только клиент. Тексты словаря (`t`) читаются до транзакции: внутри неё второе соединение не
 * занимается.
 */
async function payMessage(
  tx: Tx,
  t: Translate,
  cp: {
    id: string;
    name: string;
    responsible: { id: string; shortName: string } | null;
  },
  pay: ClientMonthPay,
  requisite: TransferBlock,
): Promise<BotMessage> {
  const [text, paid, ask] = await Promise.all([
    templateText(tx, 'tgCpPay', {
      контрагент: cp.name,
      месяц: monthLabel(pay.month),
      сумма: formatSomWithUnit(pay.total),
      срок: formatDateRu(pay.due),
    }),
    templateText(tx, 'tgBtnCpPaid'),
    templateText(tx, 'tgBtnCpQ'),
  ]);
  const message = monthPayBotMessage({
    contractor: cp.name,
    accountant: cp.responsible?.shortName || null,
    month: pay.month,
    lines: pay.lines,
    total: pay.total,
    due: pay.due,
    requisite,
    text,
    labels: {
      heading: t('cppage.tg.pay.heading'),
      accountant: t('cppage.tg.pay.accountant'),
      tax: t('cppage.tg.pay.col_tax'),
      amount: t('cppage.tg.pay.col_amount'),
      due: t('cppage.tg.pay.col_due'),
      total: t('cppage.tg.pay.total'),
      paid,
      ask,
    },
  });
  const problem = botMessageProblem(message);
  if (problem) throw new Error(`Сообщение «К оплате» контрагенту: ${problem}`);
  return message;
}

/**
 * Записать «К оплате» каждому получателю (до отправки): строка сообщения клиенту с месяцем и итогом.
 * У самого сообщения (`auto`) повтор задачи вторую строку не создаёт — такой получатель пропускается;
 * не ушедшее с прошлого запуска (`retry`) собирается заново — в строке остаются сегодняшние итог и
 * сообщение. `t` — тексты словаря, прочитанные до транзакции. Без реквизитов для перевода «К оплате»
 * не уходит (доработки 14.11.2026, блок 4, пункт 1): их проверяет вызывающий (`payRequisite`).
 */
export async function prepareMonthPay(
  tx: Tx,
  t: Translate,
  o: {
    contractor: {
      id: string;
      name: string;
      responsible: { id: string; shortName: string } | null;
    };
    pay: ClientMonthPay;
    requisite: TransferBlock;
    recipients: readonly { linkId: string; chatId: number }[];
    auto: boolean;
    /** День отправки самого «К оплате»: одно на подключение, месяц и день (ключ в базе). */
    day?: IsoDate;
    retry?: readonly { id: string; chatId: number }[];
  },
): Promise<PreparedClientMessage[]> {
  if (!o.recipients.length && !o.retry?.length) return [];
  const message = await payMessage(tx, t, o.contractor, o.pay, o.requisite);
  const prepared: PreparedClientMessage[] = [];
  for (const r of o.retry ?? []) {
    const fresh = await refreshContractorTelegramMessage(tx, r.id, {
      total: o.pay.total,
      payload: message,
    });
    if (fresh) prepared.push({ id: r.id, chatId: r.chatId, message });
  }
  for (const r of o.recipients) {
    const id = await insertContractorTelegramMessage(tx, {
      contractorId: o.contractor.id,
      linkId: r.linkId,
      chatId: r.chatId,
      kind: 'pay',
      month: o.pay.month,
      total: o.pay.total,
      auto: o.auto,
      ...(o.day ? { day: o.day } : {}),
      payload: message,
    });
    if (id) prepared.push({ id, chatId: r.chatId, message });
  }
  return prepared;
}

/** Запись истории контрагента об отправке (прототип pgPaySend): месяц, итог и число получателей. */
export async function logMonthPaySent(
  ctx: Ctx,
  org: { orgId: string; userId: string | null },
  contractorId: string,
  sent: { month: YearMonth; total: Tyiyn; recipients: number; auto: boolean },
): Promise<void> {
  await withOrgContext(ctx.db, org, (tx) =>
    logContractorTelegramPay(tx, contractorId, 'page_tg_pay', [
      {
        field: 'tgPay',
        to: {
          month: sent.month,
          total: sent.total,
          recipients: sent.recipients,
          ...(sent.auto ? { auto: true } : {}),
        },
      },
    ]),
  );
}

/**
 * Видит ли сотрудник плату за обслуживание этого контрагента: право «Видеть плату за обслуживание» и
 * контрагент в его области группы «Контрагенты» (как у методов платы).
 */
export function seesFee(
  access: Awaited<ReturnType<typeof loadEmployeeAccess>>,
  cp: { responsibleEmployeeId: string | null },
): boolean {
  return (
    !!access && hasPermission(access.subject, 'fee') && canSeeContractor(access.subject, 'cps', cp)
  );
}

/**
 * Сообщение ответственному сотруднику (без него, заблокированному или без Telegram — первому
 * владельцу с Telegram; прототип pgTgStaff) с заголовком: строка очереди в транзакции действия
 * клиента или задачи. `ask` — бот ждёт ответ сотрудника на это сообщение (вопрос клиента);
 * `dedupeKey` — одно такое сообщение: повтор с тем же ключом строки не добавляет; `allowed` — кому
 * сообщение можно (не проходит — следующему по порядку). Ответ — номера строк очереди: после
 * транзакции их отправляет `flushEvents`.
 */
export async function queueStaffNotice(
  tx: Tx,
  ctx: Ctx,
  contractorId: string,
  heading: string,
  build: (contractor: string) => Promise<string>,
  opts: {
    ask?: BotAsk;
    dedupeKey?: string;
    /** Кому можно сообщение: кто не проходит (нет права на сумму), пропускается — следующему. */
    allowed?: (employeeId: string) => Promise<boolean>;
  } = {},
): Promise<string[]> {
  const { ask, dedupeKey, allowed } = opts;
  const notice = await pageClosedNotice(tx, contractorId);
  if (!notice) return [];
  for (const employeeId of notice.employeeIds) {
    const target = await notifyTarget(tx, employeeId);
    if (!target?.chatId) continue;
    if (allowed && !(await allowed(employeeId))) continue;
    const chat = await telegramChat(tx, target.userId);
    if (!chat) continue;
    const orgName = await contextOrgName(tx);
    // Заголовок — как в прототипе («Контрагент сообщил об оплате», «Вопрос контрагента»).
    const message: BotMessage = {
      heading,
      text: withOrganization(await build(notice.contractor), orgName, chat.shared),
      ...(ask ? { ask } : {}),
    };
    return queueEvents(
      tx,
      [
        {
          userId: target.userId,
          chatId: chat.chatId,
          kind: 'cp_tg_request',
          text: botPlainText(message),
          message,
          ...(dedupeKey ? { dedupeKey } : {}),
        },
      ],
      ctx.clock.now(),
    );
  }
  return [];
}

type PressOutcome =
  | { refusal: TelegramTemplateKey; values?: Readonly<Record<string, string>> }
  | {
      reply?: string;
      after: BotMessage | null;
      staff: string[];
      /** Сообщение клиенту после действия («напишите ваш вопрос»). */
      send: PreparedClientMessage | null;
      /** Сообщения клиенту без действий на кнопках (реквизиты): сразу, без записи о сообщении. */
      direct?: readonly BotMessage[];
    };

/**
 * Сообщения клиенту, на которых нечего принимать (только кнопки копирования), — сразу после
 * транзакции, мимо таблицы сообщений и журнала «Телеграм» (клиент — не пользователь). Ошибка Telegram
 * метод не роняет.
 */
async function sendDirect(
  deps: ApiDeps,
  chatId: number,
  messages: readonly BotMessage[],
): Promise<void> {
  if (!deps.telegram || !messages.length) return;
  const plain = !(await telegramBotRich(deps.db));
  for (const message of messages) {
    try {
      const res = await deps.telegram.sendMessage(
        chatId,
        botPlainText(message),
        botSendOptions(message, { plain }),
      );
      if (!res.ok) {
        deps.logger.warn(
          { purpose: 'cp_requisite', errorCode: res.errorCode, description: res.description },
          'Telegram: реквизиты контрагенту не отправлены',
        );
      }
    } catch (err) {
      deps.logger.warn(
        { err, purpose: 'cp_requisite' },
        'Telegram: реквизиты контрагенту не отправлены',
      );
    }
  }
}

/**
 * Нажатие кнопки клиентом. true — нажатие относится к сообщению клиенту и обработано здесь (ответ
 * Telegram на нажатие отправлен); false — это не сообщение клиенту, нажатие разбирает основа бота.
 */
export async function clientPress(deps: ApiDeps, press: BotPress): Promise<boolean> {
  // Кнопки работают только в личном чате, и нажать может только его хозяин (как у основы бота).
  if (press.chatType !== 'private' || press.fromId !== press.chatId) return false;
  // «От какой компании?» под файлом без просьбы (доработки 14.11.2026, блок 2, пункт 1, этап 2): у этого
  // сообщения строки с номером в чате нет — кнопка ведёт к строке файла в организации контрагента.
  const early = parseBotPress(press.data);
  if (early?.action === CP_TG_FILE_TO_ACTION) {
    await clientFileToPress(deps, press, early.arg);
    return true;
  }
  const target = await contractorTelegramPressTarget(deps.db, press.chatId, press.messageId);
  if (!target) return false;

  const answer = async (text?: string, alert = false) => {
    try {
      await deps.telegram?.answerCallback(press.callbackId, text ? clip(text) : undefined, {
        alert,
      });
    } catch (err) {
      deps.logger.warn({ err, purpose: 'cp_press' }, 'Telegram: ответ на нажатие не отправлен');
    }
  };
  const refuse = async (key: TelegramTemplateKey, values?: Readonly<Record<string, string>>) =>
    answer(await templateText(deps.db, key, values), true);

  const parsed = parseBotPress(press.data);
  const action = parsed?.action;
  if (!parsed || !(CP_TG_CLIENT_ACTIONS as readonly string[]).includes(action ?? '')) {
    await refuse('tgActStale');
    return true;
  }
  if (!target.linked) {
    await refuse('tgCpNotLinked');
    return true;
  }
  // Каждое «Показать реквизиты» присылает новые сообщения: не больше стольких в час с подключения.
  if (action === CP_TG_REQ_ACTION) {
    const limit = await takeRateLimit(deps.db, CP_TG_REQ_RATE_LIMIT, target.linkId);
    if (!limit.ok) {
      await answer((await serverTexts(deps))('cppage.tg.req_limit'), true);
      return true;
    }
  }
  if (action === CP_TG_RECEIPT_ACTION) {
    const limit = await takeRateLimit(deps.db, CP_TG_RECEIPT_RATE_LIMIT, target.linkId);
    if (!limit.ok) {
      await answer((await serverTexts(deps))('cppage.tg.receipt_limit'), true);
      return true;
    }
  }

  let outcome: PressOutcome;
  try {
    // Тексты словаря — до транзакции: пока она держит строку сообщения, второе соединение не занимается.
    const t = await serverTexts(deps);
    outcome = await withOrgContext(
      deps.db,
      { orgId: target.orgId, userId: null },
      async (tx): Promise<PressOutcome> => {
        // Строка сообщения блокируется: два быстрых нажатия и повтор от Telegram идут по одному.
        const current = await lockContractorTelegramMessage(tx, target.id, press.chatId);
        if (!current || !findBotButton(current.message, parsed.action, parsed.arg)) {
          return { refusal: 'tgActStale' };
        }
        if (!current.linked) return { refusal: 'tgCpNotLinked' };

        // «Оплатил» под напоминанием об оплате за обслуживание (доработки 14.11.2026, блок 4, пункт 5;
        // прототип v110 tgAct('cp-feepaid')): сумма — из записи сообщения (долг на момент отправки).
        if (parsed.action === CP_TG_PAID_ACTION && target.kind === 'fee') {
          if (!current.total) return { refusal: 'tgActStale' };
          // Функцию «Плата за обслуживание» выключили после отправки — кнопка устарела.
          const { features } = await orgMenuSettings(tx, target.orgId);
          if (!features.fee) return { refusal: 'tgActStale' };
          const cp = await getContractor(tx, target.contractorId, {
            scope: undefined,
            today: bishkekDate(deps.clock.now()),
          });
          if (!cp) return { refusal: 'tgActStale' };
          const { total } = current;
          await logContractorTelegramPay(tx, target.contractorId, 'page_tg_paid', [
            { field: 'tgFeePaid', to: { total, name: current.name } },
          ]);
          // Сообщение «ждёт подтверждения» (доработки 14.11.2026, блок 4, пункт 4, этап 2): пока его не
          // отклонили, «Оплата за обслуживание до …» за месяц начисления больше не уходит; у ручного
          // напоминания месяц — последний месяц долга или текущий (прототип v115 `pgFeeMsg`).
          await insertTelegramPayClaim(tx, {
            contractorId: target.contractorId,
            purpose: 'fee',
            month: current.month,
            amount: total,
            tgMessageId: target.id,
          });
          await bellContractor(
            deps,
            tx,
            target.contractorId,
            { event: 'fee_paid', messageId: target.id, amount: total },
            t,
          );
          const staff = await queueStaffNotice(
            tx,
            deps,
            target.contractorId,
            t('cppage.tg.staff.paid_heading'),
            (contractor) =>
              templateText(tx, 'tgCpFeePaidStaff', {
                контрагент: contractor,
                телеграм: current.name,
                сумма: formatSomWithUnit(total),
              }),
            // ОТКЛОНЕНИЕ: docs/deviations.md#К-10 — сумма платы за обслуживание только тому, кто её
            // видит (право «Видеть плату за обслуживание»): ответственному без права — первому
            // владельцу с Telegram (ТЗ: «без права эти поля скрыты везде»; прототип pgTgStaff не
            // проверяет).
            {
              allowed: async (employeeId) =>
                seesFee(await loadEmployeeAccess(tx, employeeId), {
                  responsibleEmployeeId: cp.responsible?.id ?? null,
                }),
            },
          );
          const done = t('cppage.tg.paid_done');
          const after = pressBotButton(current.message, parsed.action, parsed.arg, { done });
          await saveContractorTelegramMessage(tx, target.id, after);
          return { reply: await templateText(tx, 'tgCpPaidOk'), after, staff, send: null };
        }

        if (parsed.action === CP_TG_PAID_ACTION) {
          if (!current.month || !current.total) return { refusal: 'tgActStale' };
          const { month, total } = current;
          await logContractorTelegramPay(tx, target.contractorId, 'page_tg_paid', [
            { field: 'tgPaid', to: { month, total, name: current.name } },
          ]);
          // Пока сообщение не отклонили, само «К оплате» за этот месяц больше не уходит.
          await insertTelegramPayClaim(tx, {
            contractorId: target.contractorId,
            purpose: 'tax',
            month,
            amount: total,
            tgMessageId: target.id,
          });
          // «Если есть чек об оплате, пришлите его» (доработки 14.11.2026, блок 4, пункт 4, этап 2;
          // прототип v115 pgRcptOffer) — пока клиент может отправлять файлы.
          const offer = await receiptOffer(tx, {
            contractorId: target.contractorId,
            linkId: target.linkId,
            chatId: press.chatId,
            paidId: target.id,
            month,
            total,
          });
          await bellContractor(
            deps,
            tx,
            target.contractorId,
            { event: 'cp_paid_tg', messageId: target.id, month, amount: total },
            t,
          );
          const staff = await queueStaffNotice(
            tx,
            deps,
            target.contractorId,
            t('cppage.tg.staff.paid_heading'),
            (contractor) =>
              templateText(tx, 'tgCpPaidStaff', {
                контрагент: contractor,
                телеграм: current.name,
                месяц: monthLabel(month),
                сумма: formatSomWithUnit(total),
              }),
          );
          const done = t('cppage.tg.paid_done');
          const after = pressBotButton(current.message, parsed.action, parsed.arg, { done });
          await saveContractorTelegramMessage(tx, target.id, after);
          return { reply: await templateText(tx, 'tgCpPaidOk'), after, staff, send: offer };
        }

        // «Прислать чек» и «Отмена» под просьбой прислать его (доработки 14.11.2026, блок 4, пункт 4,
        // этап 2; прототип v115 tgAct('cp-receipt'), tgAct('askCancel')).
        if (parsed.action === CP_TG_RECEIPT_ACTION || parsed.action === BOT_ASK_CANCEL) {
          const today = bishkekDate(deps.clock.now());
          const r =
            parsed.action === CP_TG_RECEIPT_ACTION
              ? await receiptPress(tx, {
                  target,
                  current,
                  arg: parsed.arg,
                  chatId: press.chatId,
                  messageId: press.messageId,
                  today,
                })
              : await receiptCancel(tx, {
                  target,
                  current,
                  today,
                  done: t('telegram.done.cancelled'),
                });
          if ('refusal' in r) return r;
          return { reply: r.reply, after: r.after, staff: [], send: r.send };
        }

        // «Не напоминать» под напоминанием о долге (задача К5; прототип tgAct('cp-nodebt')): клиент
        // выключает напоминания у своего чата; история контрагента — в той же транзакции.
        if (parsed.action === CP_TG_NODEBT_ACTION) {
          await setContractorTelegramNoDebt(tx, {
            linkId: target.linkId,
            chatId: press.chatId,
            noDebt: true,
          });
          const done = t('cppage.tg.nodebt_done');
          const after = pressBotButton(current.message, parsed.action, parsed.arg, { done });
          await saveContractorTelegramMessage(tx, target.id, after);
          return { reply: await templateText(tx, 'tgCpNoDebtOk'), after, staff: [], send: null };
        }

        // «Показать реквизиты для перевода» под напоминанием о долге (доработки 14.11.2026, блок 4,
        // пункт 3; прототип v110 tgAct('cp-req')): по каждой сумме долга из напоминания — реквизиты на
        // момент нажатия отдельным сообщением с подписью, чьи они, и кнопкой копирования. Какие суммы —
        // из сохранённой кнопки (`findBotButton` выше), реквизиты — только пока клиенту показан «Как
        // оплатить». Кнопка не гаснет: реквизиты можно попросить снова.
        if (parsed.action === CP_TG_REQ_ACTION) {
          const parts = parseCpReqArg(parsed.arg);
          const today = bishkekDate(deps.clock.now());
          const cp = await getContractor(tx, target.contractorId, { scope: undefined, today });
          if (!cp) return { refusal: 'tgActStale' };
          const { features } = await orgMenuSettings(tx, target.orgId);
          const direct: BotMessage[] = [];
          if (parts.tax) {
            const req = await payRequisite(tx, t, cp);
            if (req.state === 'ok') {
              direct.push(
                transferBotMessage({
                  heading: t('cppage.tg.req.tax'),
                  contractor: cp.name,
                  block: req.block,
                }),
              );
            }
          }
          if (parts.fee && features.fee) {
            const block = await feeRequisite(tx, t, cp);
            if (block) {
              direct.push(
                transferBotMessage({ heading: t('cppage.tg.req.fee'), contractor: cp.name, block }),
              );
            }
          }
          if (!direct.length) return { refusal: 'tgCpNoReq', values: { контрагент: cp.name } };
          for (const m of direct) {
            const problem = botMessageProblem(m);
            if (problem) throw new Error(`Реквизиты контрагенту: ${problem}`);
          }
          return { after: null, staff: [], send: null, direct };
        }

        // «Вопрос бухгалтеру»: бот просит написать вопрос ответом на своё сообщение. Просьба уже
        // открыта (клиент нажал кнопку второй раз) — новая не создаётся, бот повторяет подсказку.
        const how = await templateText(tx, 'tgCpAskHow');
        if (parsed.action === CP_TG_ASK_ACTION) {
          const open = await contractorTelegramAskTarget(tx, press.chatId, null);
          if (open?.linked && open.linkId === target.linkId) {
            return { reply: how, after: null, staff: [], send: null };
          }
          const message: BotMessage = { text: how };
          const id = await insertContractorTelegramMessage(tx, {
            contractorId: target.contractorId,
            linkId: target.linkId,
            chatId: press.chatId,
            kind: 'ask',
            payload: message,
          });
          return {
            after: null,
            staff: [],
            send: id ? { id, chatId: press.chatId, message } : null,
          };
        }
        return { refusal: 'tgActStale' };
      },
    );
  } catch (err) {
    deps.logger.error({ err, action }, 'Telegram: нажатие кнопки контрагентом не обработано');
    deps.errors?.capture(err);
    await refuse('tgActFailed');
    return true;
  }
  if ('refusal' in outcome) {
    await refuse(outcome.refusal, outcome.values);
    return true;
  }

  await answer(outcome.reply);
  if (outcome.after) {
    try {
      await deps.telegram?.editKeyboard(press.chatId, press.messageId, botKeyboard(outcome.after));
    } catch (err) {
      deps.logger.warn({ err, purpose: 'cp_press' }, 'Telegram: кнопки сообщения не обновлены');
    }
  }
  if (outcome.send) {
    await deliverClientMessages(deps, { orgId: target.orgId, userId: null }, [outcome.send]);
  }
  if (outcome.direct) await sendDirect(deps, press.chatId, outcome.direct);
  await flushEvents(deps, target.orgId, outcome.staff);
  return true;
}

/** Текст в личном чате; ответ на сообщение бота — с номером этого сообщения. */
const ClientTextMessage = z.object({
  text: z.string().min(1).max(4096),
  chat: z.object({ id: z.number().int(), type: z.literal('private') }),
  reply_to_message: z.object({ message_id: z.number().int() }).optional(),
});

/**
 * Текст клиента после «Вопрос бухгалтеру» (прототип pgTgAsk): вопрос уходит ответственному сотруднику
 * с названием контрагента и пишется в историю контрагента; клиенту бот отвечает «Вопрос передан».
 * Сообщение сотруднику — просьба бота без дня (действие `CP_TG_ANSWER_ACTION`): его ответ на это
 * сообщение уходит клиенту (`contractor-page/telegram-bot.ts`, прототип pgTgAnswer). Принимается ответ на просьбу бота, а без ответа — текст в течение суток после просьбы, кроме команды
 * с «/» и кроме чата, привязанного и к учётной записи сотрудника (docs/deviations.md п. О-79). true — текст
 * принят как вопрос (или отклонён пределом); false — бот вопроса не ждёт, отвечает обычный разбор.
 */
export async function clientQuestion(deps: ApiDeps, raw: unknown): Promise<boolean> {
  const parsed = ClientTextMessage.safeParse(raw);
  if (!parsed.success) return false;
  const { chat, text } = parsed.data;
  const replyTo = parsed.data.reply_to_message?.message_id ?? null;
  // Без ответа на просьбу код замены Telegram сотрудника вопросом не считается: тот же чат может
  // быть привязан и к учётной записи.
  if (replyTo === null && relinkCodeOf(text)) return false;
  // ОТКЛОНЕНИЕ: docs/deviations.md#О-79
  // Чат привязан и к учётной записи сотрудника (любой организации): без ответа на просьбу текст —
  // для бота сотрудника (команда, ответ на его просьбу), а не вопрос клиента.
  if (replyTo === null && (await botChatUsers(deps.db, chat.id)).length > 0) return false;
  // Команда бота («/today») без ответа на просьбу — не вопрос: её разбирает меню бота.
  if (replyTo === null && text.trimStart().startsWith('/')) return false;
  const target = await contractorTelegramAskTarget(deps.db, chat.id, replyTo);
  if (!target) return false;
  const question = cpTgQuestion(text);
  if (!question) return false;

  const send = async (body: string) => {
    try {
      await deps.telegram?.sendMessage(chat.id, body);
    } catch (err) {
      deps.logger.warn({ err, purpose: 'cp_question' }, 'Telegram: ответ контрагенту не отправлен');
    }
  };
  // Подключение больше не действует (отключён, архив, организация заблокирована) — как в прототипе:
  // «Этот Telegram не подключён к контрагенту». Так бот отвечает только на ответ на свою просьбу:
  // просто текст в чате разбирает обычный разбор (тот же чат может быть привязан и к сотруднику).
  if (!target.linked) {
    if (replyTo === null) return false;
    await send(await templateText(deps.db, 'tgCpNotLinked'));
    return true;
  }
  const limit = await takeRateLimit(deps.db, CP_TG_ASK_RATE_LIMIT, target.linkId);
  if (!limit.ok) {
    await send((await serverTexts(deps))('cppage.tg.ask_limit'));
    return true;
  }

  const t = await serverTexts(deps);
  const result = await withOrgContext(
    deps.db,
    { orgId: target.orgId, userId: null },
    async (tx): Promise<{ staff: string[] } | 'unlinked' | null> => {
      const current = await lockContractorTelegramMessage(tx, target.id, chat.id);
      if (!current || current.answered) return null;
      // Раздел «Telegram» страницы скрыт или функция выключена — вопрос не принимается.
      if (!current.linked) return 'unlinked';
      if (!(await answerContractorTelegramAsk(tx, target.id))) return null;
      await logContractorTelegramPay(tx, target.contractorId, 'page_tg_question', [
        { field: 'tgQuestion', to: { name: current.name, text: cpTgQuestionForHistory(question) } },
      ]);
      await bellContractor(
        deps,
        tx,
        target.contractorId,
        { event: 'cp_question', messageId: target.id, question },
        t,
      );
      // Ответ сотрудника на это сообщение уходит клиенту: просьба без дня ждёт ответа именно на него.
      const staff = await queueStaffNotice(
        tx,
        deps,
        target.contractorId,
        t('cppage.tg.staff.ask_heading'),
        (contractor) =>
          templateText(tx, 'tgCpAskStaff', {
            контрагент: contractor,
            телеграм: current.name,
            вопрос: question,
          }),
        { ask: { action: CP_TG_ANSWER_ACTION, arg: target.id, kind: 'text' } },
      );
      return { staff };
    },
  );
  if (!result) return false;
  if (result === 'unlinked') {
    if (replyTo === null) return false;
    await send(await templateText(deps.db, 'tgCpNotLinked'));
    return true;
  }
  await send(await templateText(deps.db, 'tgCpAskSent'));
  await flushEvents(deps, target.orgId, result.staff);
  return true;
}

/**
 * Ответ сотрудника клиенту (прототип pgTgAnswer) — сразу, из транзакции ответа сотрудника: у ответа боту
 * нет шага «после транзакции» для чата, который не привязан к пользователю. Сообщение без кнопок: в
 * таблицу сообщений клиенту оно не пишется (принимать на нём нечего), в журнал «Телеграм» — тоже
 * (клиент — не пользователь, docs/deviations.md п. К-4). true — Telegram принял сообщение.
 */
export async function sendClientAnswer(
  deps: ApiDeps,
  tx: Tx,
  chatId: number,
  message: BotMessage,
): Promise<boolean> {
  if (!deps.telegram) return false;
  const plain = !(await telegramBotRich(tx));
  try {
    const res = await deps.telegram.sendMessage(
      chatId,
      botPlainText(message),
      botSendOptions(message, { plain }),
    );
    if (res.ok) return true;
    deps.logger.warn(
      { purpose: 'cp_answer', errorCode: res.errorCode, description: res.description },
      'Telegram: ответ контрагенту не отправлен',
    );
  } catch (err) {
    deps.logger.warn({ err, purpose: 'cp_answer' }, 'Telegram: ответ контрагенту не отправлен');
  }
  return false;
}

/** Что отправить одной организации: «К оплате» клиентам и сообщения сотрудникам («не отправлено»). */
interface AutoPayPlan {
  batches: {
    contractorId: string;
    month: YearMonth;
    total: Tyiyn;
    prepared: PreparedClientMessage[];
  }[];
  staff: string[];
}

/**
 * «Не отправлено «К оплате»: у <контрагент> нет реквизитов для перевода» ответственному (прототип v110
 * `pgNoReqWhy`) с подсказкой, где их добавить; раздел «Как оплатить» скрыт — подсказка о нём. Одно
 * сообщение на контрагента и месяц (ключ очереди): повтор задачи второго не ставит.
 */
async function queueNoRequisite(
  tx: Tx,
  ctx: Ctx,
  t: Translate,
  cp: { id: string; paysTo: 'emp' | 'org'; responsible: { shortName: string } | null },
  month: YearMonth,
  state: 'none' | 'hidden',
): Promise<string[]> {
  const hint =
    state === 'hidden'
      ? t('cppage.tg.rq.hidden_staff')
      : cp.paysTo === 'emp'
        ? t('cppage.tg.rq.emp_hint', {
            employee: cp.responsible?.shortName || t('cppage.tg.rq.no_resp'),
          })
        : t('cppage.tg.rq.org_hint');
  // Колокольчик (приёмка «Колокольчик против Telegram», поток Т): та же весть строкой — ответственному и
  // без Telegram, одна на контрагента и месяц; нажатие — карточка контрагента.
  await bellContractor({ now: ctx.clock.now(), t }, tx, cp.id, { event: 'cp_no_req', month });
  return queueStaffNotice(
    tx,
    ctx,
    cp.id,
    t('cppage.tg.staff.noreq_heading'),
    async (contractor) =>
      `${await templateText(tx, 'tgCpNoReq', { контрагент: contractor })} ${hint}`,
    { dedupeKey: `cp_pay_noreq:${cp.id}:${month}` },
  );
}

/**
 * Само «К оплате» одной организации: что отправить. Всё — в одной транзакции задачи. null — у
 * организации время отправки не в этом запуске (строка «К оплате» блока «Telegram-уведомления»).
 */
async function prepareAutoPay(
  tx: Tx,
  ctx: Ctx,
  t: Translate,
  orgId: string,
  slot: Date,
): Promise<AutoPayPlan | null> {
  if (!(await contractorTelegramPayOn(tx))) return null;
  const settings = await cpNoticeSettingsOf(tx, orgId);
  // День, за который уходит «К оплате», — день времени отправки (запуск 00:00 отправляет за 23:56–23:59
  // прошлого дня).
  const today = cpNoticeDay(settings.payAt, slot);
  if (!today) return null;
  const out: AutoPayPlan = { batches: [], staff: [] };
  const { features } = await orgMenuSettings(tx, orgId);
  const taxpay = features.taxpay;
  for (const contractorId of await contractorsWithTelegram(tx)) {
    const cp = await getContractor(tx, contractorId, { scope: undefined, today });
    if (!cp) continue;
    const recipients = await contractorTelegramRecipients(tx, contractorId);
    if (!recipients.length) continue;
    // Реквизиты — один раз на контрагента и только когда есть что отправить.
    let requisite: Awaited<ReturnType<typeof payRequisite>> | null = null;
    // Клиент сообщил «Оплатил» за месяц (и сообщение не отклонено) — само «К оплате» за него больше не
    // уходит (прототип v115 pgPaidMark).
    let paid: Set<YearMonth> | null = null;
    // Месяцы ищутся по срокам оплаты ближайших дней, а не отсчётом от сегодняшнего: месяц годового
    // отчёта — декабрь, а платить по нему в марте — мае.
    const months = await reportPayDueMonths(tx, {
      contractorId,
      from: today,
      to: addDays(today, CP_PAY_DAYS),
    });
    for (const month of months) {
      const reports = await reportMonthPlanRows(tx, {
        scope: undefined,
        today,
        taxpay,
        month,
        contractorId,
      });
      const { pay, rows } = monthPayRows(reports, month, taxpay);
      if (!pay.due || !monthPayAutoDue(pay, today)) continue;
      paid ??= await payClaimMonths(tx, contractorId, 'tax');
      if (paid.has(month)) continue;
      // Новое — только в отмеченный день «за N» до ближайшего срока оплаты, одно на подключение,
      // месяц и день; не ушедшее в прошлый раз — повторяется (до трёх попыток) сегодняшним сообщением и
      // только действующим получателям, в какой бы день ни пришёлся запуск.
      const ticked = cpNoticeDayDue(today, pay.due, settings.payDays);
      const unsent = await unsentAutoPayMessages(tx, contractorId, month, AUTO_PAY_MAX_ATTEMPTS);
      const retry = unsent.filter((m) => recipients.some((r) => r.linkId === m.linkId));
      const done = ticked ? await autoPayLinkIds(tx, contractorId, month, today) : null;
      const fresh = done
        ? recipients.filter((r) => !done.has(r.linkId) && !retry.some((m) => m.linkId === r.linkId))
        : [];
      if (!fresh.length && !retry.length) continue;
      requisite ??= await payRequisite(tx, t, cp);
      // Без реквизитов для перевода «К оплате» не уходит и само (доработки 14.11.2026, блок 4,
      // пункт 1): ответственному — «не отправлено» с подсказкой, один раз на месяц.
      if (requisite.state !== 'ok') {
        if (fresh.length) {
          out.staff.push(...(await queueNoRequisite(tx, ctx, t, cp, month, requisite.state)));
        }
        continue;
      }
      const prepared = await prepareMonthPay(tx, t, {
        contractor: cp,
        pay: { month, lines: rows, total: pay.total, due: pay.due },
        requisite: requisite.block,
        recipients: fresh,
        auto: true,
        day: today,
        retry,
      });
      if (prepared.length) out.batches.push({ contractorId, month, total: pay.total, prepared });
    }
  }
  return out;
}

/**
 * «Отправлять «К оплате» контрагентам» (строка «К оплате» блока «Telegram-уведомления», прототип v115:
 * «в отмеченные дни до ближайшего срока оплаты месяца, пока месяц не оплачен, если все суммы месяца
 * указаны»): запуск каждые 5 минут, организация — в запуск, на который приходится её время отправки,
 * каждая — своей транзакцией. Одно сообщение на месяц, подключение и день (ключ в базе): повтор и
 * одновременный запуск второй строки не создают. Если Telegram сообщение принял, а отметка об этом не
 * записалась, оно уйдёт ещё раз при следующем запуске — потерять сообщение хуже, чем повторить.
 * Заблокированной организации бот не пишет. Организация, у которой запуск упал, остальным не мешает.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-11
export const contractorPayJob: Job = {
  name: 'contractor-page.telegram-pay',
  // Каждые 5 минут по Бишкеку: время отправки организации — любая минута суток (`cpNoticeDay`).
  cron: '*/5 * * * *',
  lookbackMinutes: 60,
  async run(ctx, slot) {
    const failed: string[] = [];
    let sent = 0;
    let orgs = 0;
    const t = await translateOf(ctx);
    for (const orgId of await orgIds(ctx.db)) {
      try {
        const plan = await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
          prepareAutoPay(tx, ctx, t, orgId, slot),
        );
        if (!plan) continue;
        orgs += 1;
        await flushEvents(ctx, orgId, plan.staff);
        for (const b of plan.batches) {
          const delivered = await deliverClientMessages(ctx, { orgId, userId: null }, b.prepared);
          sent += delivered;
          if (delivered > 0) {
            await logMonthPaySent(ctx, { orgId, userId: null }, b.contractorId, {
              month: b.month,
              total: b.total,
              recipients: delivered,
              auto: true,
            });
          }
        }
      } catch (err) {
        failed.push(orgId);
        ctx.logger.error(
          { job: 'contractor-page.telegram-pay', orgId, err },
          '«К оплате» контрагентам организации не отправлено',
        );
      }
    }
    if (orgs) {
      ctx.logger.info({ job: 'contractor-page.telegram-pay', orgs, sent }, '«К оплате» отправлено');
    }
    if (failed.length) {
      throw new Error(`contractor-page.telegram-pay: не отправлено организаций: ${failed.length}`);
    }
  },
};
