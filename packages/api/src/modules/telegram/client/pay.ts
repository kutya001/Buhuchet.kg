import {
  answerContractorTelegramAsk,
  autoPayLinkIds,
  contextOrgName,
  contractorPageSectionShown,
  contractorTaxRequisiteText,
  contractorTelegramAskTarget,
  contractorTelegramPayOn,
  contractorTelegramPressTarget,
  contractorTelegramRecipients,
  contractorsWithTelegram,
  getContractor,
  insertContractorTelegramMessage,
  lockContractorTelegramMessage,
  logContractorTelegramPay,
  markContractorTelegramMessage,
  messageTemplates,
  notifyTarget,
  orgIds,
  orgMenuSettings,
  pageClosedNotice,
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
  BOT_HIDDEN_REPLY_MAX,
  botKeyboard,
  botMessageProblem,
  botPlainText,
  botTemplate,
  CP_PAY_DAYS,
  CP_TG_ASK_ACTION,
  CP_TG_CLIENT_ACTIONS,
  CP_TG_NODEBT_ACTION,
  CP_TG_PAID_ACTION,
  CP_TG_QUESTIONS_PER_HOUR,
  cpTgQuestion,
  cpTgQuestionForHistory,
  fillTemplate,
  findBotButton,
  formatDateRu,
  formatSomWithUnit,
  formatText,
  monthLabel,
  monthPayAutoDue,
  monthPayBotMessage,
  parseBotPress,
  pressBotButton,
  relinkCodeOf,
  withOrganization,
  type BotMessage,
  type IsoDate,
  type MonthPayLine,
  type TelegramTemplateKey,
  type Translate,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import { z } from '@hono/zod-openapi';
import type { ApiDeps, Job, JobContext } from '../../../deps';
import { serverTexts } from '../../l10n/texts';
import { monthPayRows } from '../../reports/month-pay-rows';
import { botSendOptions, flushEvents, queueEvents } from '../outbox';
import type { BotPress } from '../press';

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
 * Сообщение «К оплате» (прототип pgPayMsg): реквизит для налогов — тот же, что в разделе «Как
 * оплатить» страницы контрагента, и только пока этот раздел клиенту показан (скрыт — реквизита нет и
 * в Telegram: бот не отдаёт того, чего не отдаёт страница). Сотрудник, который отправляет сообщение,
 * реквизита в ответе не получает — его видит только клиент. Тексты словаря (`t`) читаются до
 * транзакции: внутри неё второе соединение не занимается.
 */
async function payMessage(
  tx: Tx,
  t: Translate,
  cp: {
    id: string;
    name: string;
    paysTo: 'emp' | 'org';
    responsible: { id: string; shortName: string } | null;
  },
  pay: ClientMonthPay,
  taxpay: boolean,
): Promise<BotMessage> {
  const requisite =
    taxpay && (await contractorPageSectionShown(tx, cp.id, 'pay'))
      ? await contractorTaxRequisiteText(
          tx,
          { paysTo: cp.paysTo, responsibleId: cp.responsible?.id ?? null },
          t,
        )
      : null;
  const [text, copy, paid, ask] = await Promise.all([
    templateText(tx, 'tgCpPay', {
      контрагент: cp.name,
      месяц: monthLabel(pay.month),
      сумма: formatSomWithUnit(pay.total),
      срок: formatDateRu(pay.due),
    }),
    templateText(tx, 'tgBtnCpReq'),
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
      copy,
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
 * сообщение. `t` — тексты словаря, прочитанные до транзакции.
 */
export async function prepareMonthPay(
  tx: Tx,
  t: Translate,
  o: {
    contractor: {
      id: string;
      name: string;
      paysTo: 'emp' | 'org';
      responsible: { id: string; shortName: string } | null;
    };
    pay: ClientMonthPay;
    taxpay: boolean;
    recipients: readonly { linkId: string; chatId: number }[];
    auto: boolean;
    retry?: readonly { id: string; chatId: number }[];
  },
): Promise<PreparedClientMessage[]> {
  if (!o.recipients.length && !o.retry?.length) return [];
  const message = await payMessage(tx, t, o.contractor, o.pay, o.taxpay);
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
 * Сообщение ответственному сотруднику (без него, заблокированному или без Telegram — первому
 * владельцу с Telegram; прототип pgTgStaff) с заголовком: строка очереди в транзакции действия
 * клиента. Ответ — номера строк очереди: после транзакции их отправляет `flushEvents`.
 */
async function queueStaffNotice(
  tx: Tx,
  ctx: Ctx,
  contractorId: string,
  heading: string,
  build: (contractor: string) => Promise<string>,
): Promise<string[]> {
  const notice = await pageClosedNotice(tx, contractorId);
  if (!notice) return [];
  for (const employeeId of notice.employeeIds) {
    const target = await notifyTarget(tx, employeeId);
    if (!target?.chatId) continue;
    const chat = await telegramChat(tx, target.userId);
    if (!chat) continue;
    const orgName = await contextOrgName(tx);
    // Заголовок — как в прототипе («Контрагент сообщил об оплате», «Вопрос контрагента»).
    const message: BotMessage = {
      heading,
      text: withOrganization(await build(notice.contractor), orgName, chat.shared),
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
        },
      ],
      ctx.clock.now(),
    );
  }
  return [];
}

type PressOutcome =
  | { refusal: TelegramTemplateKey }
  | {
      reply?: string;
      after: BotMessage | null;
      staff: string[];
      /** Сообщение клиенту после действия («напишите ваш вопрос»). */
      send: PreparedClientMessage | null;
    };

/**
 * Нажатие кнопки клиентом. true — нажатие относится к сообщению клиенту и обработано здесь (ответ
 * Telegram на нажатие отправлен); false — это не сообщение клиенту, нажатие разбирает основа бота.
 */
export async function clientPress(deps: ApiDeps, press: BotPress): Promise<boolean> {
  // Кнопки работают только в личном чате, и нажать может только его хозяин (как у основы бота).
  if (press.chatType !== 'private' || press.fromId !== press.chatId) return false;
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
  const refuse = async (key: TelegramTemplateKey) => answer(await templateText(deps.db, key), true);

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

        if (parsed.action === CP_TG_PAID_ACTION) {
          if (!current.month || !current.total) return { refusal: 'tgActStale' };
          const { month, total } = current;
          await logContractorTelegramPay(tx, target.contractorId, 'page_tg_paid', [
            { field: 'tgPaid', to: { month, total, name: current.name } },
          ]);
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
          return { reply: await templateText(tx, 'tgCpPaidOk'), after, staff, send: null };
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
    await refuse(outcome.refusal);
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
 * Отвечает сотрудник пока сам — по телефону или в своём мессенджере (docs/deviations.md п. К-4).
 * Принимается ответ на просьбу бота, а без ответа — текст в течение суток после просьбы. true — текст
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
      // ОТКЛОНЕНИЕ: docs/deviations.md#К-4 — ответить клиенту из Telegram сотрудник пока не может
      // («ответ боту» основы бота — задача Т2), поэтому вместо шаблонов `tgCpAskStaff` и `tgCpAskSent`
      // («Ответьте на это сообщение — ответ уйдёт клиенту», «Ответ придёт сюда») — тексты без обещания.
      const staff = await queueStaffNotice(
        tx,
        deps,
        target.contractorId,
        t('cppage.tg.staff.ask_heading'),
        async (contractor) =>
          formatText(t('cppage.tg.ask_staff'), {
            contractor,
            name: current.name,
            text: question,
          }),
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
  await send(t('cppage.tg.ask_sent'));
  await flushEvents(deps, target.orgId, result.staff);
  return true;
}

/** Само «К оплате» одной организации: что отправить. Всё — в одной транзакции задачи. */
async function prepareAutoPay(
  tx: Tx,
  t: Translate,
  orgId: string,
  today: IsoDate,
): Promise<
  { contractorId: string; month: YearMonth; total: Tyiyn; prepared: PreparedClientMessage[] }[]
> {
  if (!(await contractorTelegramPayOn(tx))) return [];
  const { features } = await orgMenuSettings(tx, orgId);
  const taxpay = features.taxpay;
  const out: Awaited<ReturnType<typeof prepareAutoPay>> = [];
  for (const contractorId of await contractorsWithTelegram(tx)) {
    const cp = await getContractor(tx, contractorId, { scope: undefined, today });
    if (!cp) continue;
    const recipients = await contractorTelegramRecipients(tx, contractorId);
    if (!recipients.length) continue;
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
      const done = await autoPayLinkIds(tx, contractorId, month);
      // Не ушедшее с прошлого запуска — повторяется (до трёх попыток) сегодняшним сообщением и только
      // действующим получателям; новое — записывается.
      const unsent = await unsentAutoPayMessages(tx, contractorId, month, AUTO_PAY_MAX_ATTEMPTS);
      const prepared = await prepareMonthPay(tx, t, {
        contractor: cp,
        pay: { month, lines: rows, total: pay.total, due: pay.due },
        taxpay,
        recipients: recipients.filter((r) => !done.has(r.linkId)),
        auto: true,
        retry: unsent.filter((m) => recipients.some((r) => r.linkId === m.linkId)),
      });
      if (prepared.length) out.push({ contractorId, month, total: pay.total, prepared });
    }
  }
  return out;
}

/**
 * «Отправлять «К оплате» контрагентам» (прототип: «приходит клиенту за 5 дней до ближайшего срока
 * оплаты, если все суммы месяца указаны»): раз в день по всем организациям, каждая — своей транзакцией.
 * Одно сообщение на месяц и подключение (ключ в базе): повтор и одновременный запуск второй строки не
 * создают, пропущенный день догоняется, пока срок не прошёл. Если Telegram сообщение принял, а отметка
 * об этом не записалась, оно уйдёт ещё раз при следующем запуске — потерять сообщение хуже, чем
 * повторить. Заблокированной организации бот не пишет. Организация, у которой запуск упал, остальным
 * не мешает.
 */
export const contractorPayJob: Job = {
  name: 'contractor-page.telegram-pay',
  // 10:05 по Бишкеку (расписания задач — по времени Бишкека).
  cron: '5 10 * * *',
  lookbackMinutes: 24 * 60,
  async run(ctx) {
    const today = bishkekDate(ctx.clock.now());
    const failed: string[] = [];
    let sent = 0;
    const t = await translateOf(ctx);
    for (const orgId of await orgIds(ctx.db)) {
      try {
        const batches = await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
          prepareAutoPay(tx, t, orgId, today),
        );
        for (const b of batches) {
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
    ctx.logger.info({ job: 'contractor-page.telegram-pay', today, sent }, '«К оплате» отправлено');
    if (failed.length) {
      throw new Error(`contractor-page.telegram-pay: не отправлено организаций: ${failed.length}`);
    }
  },
};
