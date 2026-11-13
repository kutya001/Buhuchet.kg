import { adminLeadById, setLeadStatus, type AdminLeadRecord, type Tx } from '@buhuchet/db';
import {
  LEAD_BOT_ACTIONS,
  leadBotCanRefuse,
  leadBotCanWork,
  leadBotFirm,
  leadBotReason,
  leadStatusChange,
  type LeadStatus,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import type { BotAction, BotPressResult, BotReplyContext, BotReplyResult } from './press';

/*
 * Кнопки под сообщением о заявке с сайта (поток Т, задача Т6; пакет заказчика 13.11.2026, идея 14;
 * прототип v103 admin/tg-leads.js — `tgAct('leadWork')`, `leadNo`, `leadNoWhy`). «Взять в работу» — только
 * у новой заявки; «Отклонить» — пока заявка не «Подключена» и не «Отказ»: бот просит причину ответом на
 * своё сообщение и ждёт до конца дня, без причины заявка не меняется. Иначе — «Кнопка устарела»: заявку
 * уже взял другой администратор, её изменили на сайте или удалили.
 *
 * Действуют только у администратора платформы: остальным — «Нет права» (сообщение о заявке уходит
 * только администраторам, но проверяется при каждом нажатии и ответе). Статус меняет та же функция
 * базы, что и «Заявки» на сайте (`setLeadStatus` → `app.admin_lead_status`): она сама проверяет, что
 * в контексте — незаблокированный администратор платформы, и сверяет версию заявки; запись истории
 * заявки получает отметку «через Telegram». Снять «Отказ», «Подключена» и «Создать организацию» — только
 * на сайте.
 */

type Ctx = BotReplyContext;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Заявка кнопки от имени нажавшего; отказ — ключом шаблона. */
async function openLead(ctx: Ctx, tx: Tx): Promise<AdminLeadRecord | TelegramTemplateKey> {
  if (!ctx.user.isPlatformAdmin) return 'tgActNoRight';
  if (!ctx.arg || !UUID_RE.test(ctx.arg)) return 'tgActStale';
  // Представление отдаёт заявку только незаблокированному администратору платформы.
  return (await adminLeadById(tx, ctx.arg)) ?? 'tgActStale';
}

const stateOf = (lead: AdminLeadRecord) => ({
  status: lead.status,
  statusBefore: lead.statusBefore,
  hasOrg: !!lead.createdOrgId,
});

/** Та же смена статуса, что на сайте; false — заявку успели изменить («Кнопка устарела»). */
async function setStatus(
  ctx: Ctx,
  tx: Tx,
  lead: AdminLeadRecord,
  to: LeadStatus,
  reason: string | null,
): Promise<boolean> {
  const next = await setLeadStatus(tx, {
    id: lead.id,
    version: lead.version,
    to,
    before: to === 'rejected' ? lead.status : null,
    text: reason,
    now: ctx.deps.clock.now(),
  });
  return next !== null;
}

const refused = async (ctx: Ctx, key: TelegramTemplateKey): Promise<BotPressResult> => ({
  reply: await ctx.text(key),
  alert: true,
});

const said = async (ctx: Ctx, key: TelegramTemplateKey): Promise<BotReplyResult> => ({
  say: await ctx.text(key),
});

/** «Взять в работу»: «Новая» → «В работе». */
const leadWork: BotAction = {
  change: true,
  run: (ctx) =>
    ctx.asUser(async (tx) => {
      const lead = await openLead(ctx, tx);
      if (typeof lead === 'string') return refused(ctx, lead);
      const step = leadStatusChange(stateOf(lead), 'in_progress');
      if (!leadBotCanWork(lead.status) || !step || step === 'locked' || step.kind !== 'step') {
        return refused(ctx, 'tgActStale');
      }
      if (!(await setStatus(ctx, tx, lead, 'in_progress', null))) {
        return refused(ctx, 'tgActStale');
      }
      return {
        done: ctx.tr('telegram.done.work'),
        reply: await ctx.text('tgActLeadWork', { фирма: leadBotFirm(lead.firm) }),
      };
    }),
};

/** Можно ли отказать по заявке сейчас — тем же правилом, что «Отказ» на сайте. */
const canRefuse = (lead: AdminLeadRecord) => {
  const change = leadStatusChange(stateOf(lead), 'rejected');
  return (
    leadBotCanRefuse(lead.status) && !!change && change !== 'locked' && change.kind === 'reject'
  );
};

/** «Отклонить»: бот просит причину ответом на своё сообщение; заявка пока не меняется. */
const leadNo: BotAction = {
  limited: true,
  run: (ctx) =>
    ctx.asUser(async (tx) => {
      const lead = await openLead(ctx, tx);
      if (typeof lead === 'string') return refused(ctx, lead);
      if (!canRefuse(lead)) return refused(ctx, 'tgActStale');
      return {
        ask: {
          text: await ctx.text('tgLeadAskWhy', { фирма: leadBotFirm(lead.firm) }),
          action: LEAD_BOT_ACTIONS.why,
          kind: 'text',
        },
      };
    }),
};

/**
 * Причина отказа — текст до 300 знаков; ответ проходит те же проверки, что и нажатие: заявку могли взять,
 * подключить или удалить, пока бот ждал ответ.
 */
const leadNoWhy: BotAction = {
  change: true,
  reply: (ctx, reply) =>
    ctx.asUser(async (tx) => {
      const reason = 'text' in reply ? leadBotReason(reply.text) : '';
      if (!reason) return { again: await ctx.text('tgAskNeedText') };
      const lead = await openLead(ctx, tx);
      if (typeof lead === 'string') return said(ctx, lead);
      if (!canRefuse(lead)) return said(ctx, 'tgActStale');
      if (!(await setStatus(ctx, tx, lead, 'rejected', reason))) return said(ctx, 'tgActStale');
      return {
        done: ctx.tr('telegram.done.lead_no'),
        off: [LEAD_BOT_ACTIONS.work],
        say: await ctx.text('tgLeadRefused', {
          фирма: leadBotFirm(lead.firm),
          причина: reason,
        }),
      };
    }),
};

/** Обработчики кнопок заявки для реестра `BOT_ACTIONS`. */
export const LEAD_BOT_HANDLERS: Readonly<Record<string, BotAction>> = {
  [LEAD_BOT_ACTIONS.work]: leadWork,
  [LEAD_BOT_ACTIONS.no]: leadNo,
  [LEAD_BOT_ACTIONS.why]: leadNoWhy,
};
