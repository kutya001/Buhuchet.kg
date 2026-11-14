import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorTelegramCounts,
  contractorTelegramRecipients,
  feeSubject,
  insertContractorTelegramMessage,
  logContractorTelegramPay,
  manualFeeSentAt,
  messageTemplates,
  withOrgContext,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekTime,
  botMessageProblem,
  botTemplate,
  contractorFees,
  CP_TG_FEE_MESSAGES,
  feeBotMessage,
  feeTelegramDue,
  feeTelegramRefusal,
  feeTelegramShown,
  fillTemplate,
  formatDateRu,
  formatSomWithUnit,
  formatText,
  monthLabel,
  type CpTgFeeMessageKey,
  type CpTgFeeRefusal,
  type IsoDate,
  type TelegramTemplateKey,
  type Translate,
} from '@buhuchet/domain';
import {
  ContractorFeeTelegram,
  ContractorFeeTelegramSend,
  ContractorFeeTelegramSent,
  FeeContractorParam,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../../deps';
import type { AppEnv } from '../../../env';
import { apiFail } from '../../../errors';
import { orgContextOf, requirePermission } from '../../../middleware/access';
import { error, scopeSqlOf, subjectOf, todayOf, translateOf } from '../../contractors/common';
import { inFee } from '../../fees/common';
import { deliverClientMessages, type PreparedClientMessage } from './pay';
import { feeRequisiteOf } from './requisite';

/*
 * «Напомнить в Telegram» об оплате за обслуживание (доработки 14.11.2026, блок 4, пункт 5; прототип v110
 * modules/cp-telegram.js: `pgFeeTgShow`, `pgFeeTgWhy`, `pgFeeTgDlg`, `pgFeeSend`): кнопка вкладки
 * «Обслуживание» карточки контрагента рядом с «Напомнить в WhatsApp». Права — как у WhatsApp: функция
 * «Плата за обслуживание» (`inFee`), право «Видеть плату за обслуживание» и контрагент в области
 * группы «Контрагенты»; имена подключённых Telegram в окне — ещё и с правом «Просматривать
 * контрагентов» (как список «Telegram контрагента» карточки). Сумму, месяцы и срок сервер считает сам —
 * из запроса берётся только текст. Не чаще раза в сутки на контрагента; получатели — подключённые
 * Telegram, кроме нажавших «Не напоминать». Реквизиты для обслуживания уходят только клиенту и только
 * пока ему показаны «Как оплатить» и «Оплата за обслуживание» (docs/deviations.md п. К-9, К-10).
 */

const json = <S>(schema: S) => ({ 'application/json': { schema } });

const notFound = { description: 'Нет такого контрагента или он вне области', content: error };
const unauthorized = { description: 'Нет входа', content: error };
const off = {
  description:
    '«Плата за обслуживание» выключена, нет права «Видеть плату за обслуживание» или «Просматривать контрагентов»',
  content: error,
};

const contractorNotFound = (): never =>
  apiFail(404, 'contractor_not_found', 'Контрагент не найден');

function feeTgFail(
  status: 409,
  code: CpTgFeeMessageKey,
  params?: Readonly<Record<string, string>>,
): never {
  return apiFail(status, code, formatText(CP_TG_FEE_MESSAGES[code], params), params);
}

async function templateText(
  tx: Tx,
  key: TelegramTemplateKey,
  values: Readonly<Record<string, string>> = {},
): Promise<string> {
  const templates = await messageTemplates(tx);
  return fillTemplate(botTemplate(key, templates[key]), values);
}

/** Состояние кнопки и окна на сейчас — одно правило для окна и для отправки. */
async function feeTelegramOf(
  tx: Tx,
  c: Context<AppEnv>,
  o: { id: string; today: IsoDate; t: Translate; features: Record<string, boolean>; lock: boolean },
) {
  const found = await feeSubject(tx, o.id, scopeSqlOf(subjectOf(c)));
  if (!found) return null;
  const cp = found.subject;
  const fees = contractorFees(cp, found.payments, o.today);
  const linked = (await contractorTelegramCounts(tx, cp.id)).on;
  const shown = feeTelegramShown({
    telegram: !!o.features.telegram,
    cppage: !!o.features.cppage,
    fee: !!o.features.fee,
    oneOff: cp.oneOff,
    debt: fees.debt,
    linked,
  });
  if (!shown) return { cp, fees, shown, refusal: null, params: null } as const;
  const sentAt = await manualFeeSentAt(tx, cp.id, o.today, { lock: o.lock });
  const requisite = await feeRequisiteOf(tx, o.t, { id: cp.id, oneOff: cp.oneOff });
  const reachable = await contractorTelegramRecipients(tx, cp.id);
  const recipients = reachable.filter((r) => !r.noDebt);
  const refusal: CpTgFeeRefusal | null = feeTelegramRefusal({
    archived: cp.archived,
    sentAt: sentAt ? bishkekTime(sentAt) : null,
    requisite: requisite.state,
    reachable: reachable.length,
    recipients: recipients.length,
  });
  const params = refusal
    ? {
        contractor: cp.name,
        time: sentAt ? bishkekTime(sentAt) : '',
        section: requisite.state === 'hidden' ? o.t(`org.page.section.${requisite.section}`) : '',
      }
    : null;
  return { cp, fees, shown, refusal, params, requisite, reachable, recipients } as const;
}

export const contractorFeeTelegramRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/fee-telegram',
  tags: ['contractor-page'],
  summary: '«Напомнить в Telegram» об оплате за обслуживание: кнопка и окно',
  middleware: [requirePermission('fee'), requirePermission('cpView')] as const,
  request: { params: FeeContractorParam },
  responses: {
    200: {
      description:
        'Есть ли кнопка, что мешает отправке и данные окна: получатели, текст, реквизиты для обслуживания',
      content: json(ContractorFeeTelegram),
    },
    401: unauthorized,
    403: off,
    404: notFound,
  },
});

/**
 * Кнопка и окно «Напомнить в Telegram» (прототип `pgFeeTgBtn`, `pgFeeTgDlg`): текст по шаблону
 * `tgCpFeeRemind` — месяцы долга, сумма и срок; реквизиты для обслуживания — те, что уйдут клиенту
 * (счёт организации видит каждый сотрудник). Метод только читает.
 */
export function contractorFeeTelegramHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorFeeTelegramRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const out = await inFee(
      deps,
      c,
      async (tx, settings): Promise<ContractorFeeTelegram | null> => {
        const s = await feeTelegramOf(tx, c, {
          id,
          today,
          t,
          features: settings.features,
          lock: false,
        });
        if (!s) return null;
        if (!s.shown) return { shown: false, refusal: null, params: null, dialog: null };
        if (s.refusal || s.requisite.state !== 'ok') {
          return { shown: true, refusal: s.refusal, params: s.params, dialog: null };
        }
        const due = feeTelegramDue(s.fees, s.cp.feeDay, today);
        const [text, paid] = await Promise.all([
          templateText(tx, 'tgCpFeeRemind', {
            контрагент: s.cp.name,
            месяц: (due.months.length ? due.months : [today.slice(0, 7)])
              .map(monthLabel)
              .join(', '),
            сумма: formatSomWithUnit(s.fees.debt),
            срок: formatDateRu(due.payBy),
          }),
          templateText(tx, 'tgBtnCpPaid'),
        ]);
        return {
          shown: true,
          refusal: null,
          params: null,
          dialog: {
            contractor: s.cp.name,
            debt: s.fees.debt,
            recipients: s.recipients.map((r) => r.name),
            off: s.reachable.length - s.recipients.length,
            text,
            requisite: s.requisite.block.text,
            copy: s.requisite.block.copy?.text ?? null,
            paid,
          },
        };
      },
    );
    if (!out) return contractorNotFound();
    return c.json(out, 200);
  };
}

export const contractorFeeTelegramSendRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/fee-telegram',
  tags: ['contractor-page'],
  summary: '«Отправить» в окне «Напомнить в Telegram»: сообщение подключённым Telegram контрагента',
  middleware: [requirePermission('fee'), requirePermission('cpView')] as const,
  request: {
    params: FeeContractorParam,
    body: { required: true, content: json(ContractorFeeTelegramSend) },
  },
  responses: {
    200: {
      description: 'Напоминание отправлено: скольким записано и скольким ушло',
      content: json(ContractorFeeTelegramSent),
    },
    400: { description: 'Текст пустой или длиннее 1000 знаков', content: error },
    401: unauthorized,
    403: off,
    404: notFound,
    409: {
      description:
        'Кнопки нет (функции, долг, подключённый Telegram); контрагент в архиве; сегодня уже напоминали; нет реквизитов для обслуживания или их раздел страницы скрыт; раздел «Telegram» не действует; все нажали «Не напоминать»; Telegram не принял ни одного сообщения',
      content: error,
    },
  },
});

/**
 * «Отправить» (прототип `pgFeeSend`): сообщение «Оплата за обслуживание до …» с текстом сотрудника,
 * реквизитами для обслуживания и «Оплатил» — каждому получателю; строка сообщения пишется до отправки
 * (сумма долга — для «Оплатил»), отправка — после транзакции. Проверки — те же, что у кнопки, под
 * блокировкой контрагента: две вкладки дважды не отправят. История — после отправки: сумма и сколько
 * получателей; реквизиты в ответе метода не возвращаются.
 */
export function contractorFeeTelegramSendHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorFeeTelegramSendRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { text } = c.req.valid('json');
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const prepared = await inFee(deps, c, async (tx, settings) => {
      const s = await feeTelegramOf(tx, c, {
        id,
        today,
        t,
        features: settings.features,
        lock: true,
      });
      if (!s) return null;
      if (!s.shown) feeTgFail(409, 'cp_tg_fee_off');
      if (s.refusal) feeTgFail(409, s.refusal, s.params ?? undefined);
      if (s.requisite.state !== 'ok') throw new Error('Напоминание: реквизиты не найдены');
      const due = feeTelegramDue(s.fees, s.cp.feeDay, today);
      const [heading, paid] = await Promise.all([
        templateText(tx, 'tgCpFeeHead', { срок: formatDateRu(due.payBy) }),
        templateText(tx, 'tgBtnCpPaid'),
      ]);
      const message = feeBotMessage({
        heading,
        contractor: s.cp.name,
        text,
        requisite: s.requisite.block,
        paid,
      });
      const problem = botMessageProblem(message);
      if (problem) throw new Error(`Напоминание об оплате за обслуживание: ${problem}`);
      const messages: PreparedClientMessage[] = [];
      for (const r of s.recipients) {
        const rowId = await insertContractorTelegramMessage(tx, {
          contractorId: s.cp.id,
          linkId: r.linkId,
          chatId: r.chatId,
          kind: 'fee',
          total: s.fees.debt,
          auto: false,
          day: today,
          payload: message,
        });
        if (rowId) messages.push({ id: rowId, chatId: r.chatId, message });
      }
      return { messages, total: s.fees.debt };
    });
    if (!prepared) return contractorNotFound();
    const ctx = orgContextOf(c);
    const org = { orgId: ctx.orgId, userId: ctx.userId ?? null };
    const delivered = await deliverClientMessages(deps, org, prepared.messages);
    if (delivered === 0) feeTgFail(409, 'cp_tg_fee_failed');
    await withOrgContext(deps.db, org, (tx) =>
      logContractorTelegramPay(tx, id, 'page_tg_pay', [
        { field: 'tgFee', to: { total: prepared.total, recipients: delivered } },
      ]),
    );
    return c.json({ recipients: prepared.messages.length, delivered }, 200);
  };
}
