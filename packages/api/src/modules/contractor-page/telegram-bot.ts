import {
  ContractorTelegramRefusedError,
  contractorTelegramLinkOf,
  contractorTelegramQuestionOf,
  decideContractorTelegram,
  lockContractorTelegramMessage,
  logContractorTelegramPay,
} from '@buhuchet/db';
import {
  CP_TG_ANSWER_ACTION,
  CP_TG_NO_ACTION,
  CP_TG_OK_ACTION,
  cpTgQuestion,
  cpTgQuestionForHistory,
  formatText,
  hasPermission,
  type BotMessage,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import { serverTexts } from '../l10n/texts';
import { notifyContractorTelegramClient } from '../telegram/client';
import { sendClientAnswer } from '../telegram/client/pay';
import type { BotAction, BotPressResult, BotReplyResult } from '../telegram/press';
import { telegramSectionFor } from './telegram';

/*
 * Кнопки «Подтвердить» и «Отклонить» под сообщением бота сотруднику о запросе на подключение Telegram
 * контрагента (доработки 13.11.2026, задача К5; прототип v94 modules/cp-telegram.js: `tgAct('cptg-ok')`,
 * `tgAct('cptg-no')`). Решение — то же, что кнопками карточки контрагента, и по тем же правилам: права
 * «Просматривать контрагентов» и «Управлять страницей контрагента», контрагент в области «Свои / Все
 * контрагенты», запрос ещё ждёт, «Подтвердить» — только пока раздел «Telegram» страницы действует,
 * подключено не больше 5. Привязку чата, блокировки и «Действия из Telegram» проверяет основа бота;
 * номер запроса из кнопки ничего не разрешает сам — запрос ищется в организации нажавшего (RLS).
 */

const decide = (action: 'approve' | 'reject'): BotAction => ({
  change: true,
  permission: 'cpPage',
  run: (ctx) =>
    ctx.asUser(async (tx, access): Promise<BotPressResult> => {
      const refuse = async (key: 'tgActStale' | 'tgActNoRight'): Promise<BotPressResult> => ({
        reply: await ctx.text(key),
        alert: true,
      });
      if (!access || !ctx.user.orgId || !ctx.arg) return refuse('tgActNoRight');
      // На сайте список и решения видит только право «Просматривать контрагентов» — так же и из чата.
      if (!hasPermission(access.subject, 'cpView')) return refuse('tgActNoRight');
      const link = await contractorTelegramLinkOf(tx, ctx.arg);
      if (!link) return refuse('tgActStale');
      const found = await telegramSectionFor(
        tx,
        ctx.deps,
        { orgId: ctx.user.orgId, subject: access.subject },
        link.contractorId,
      );
      // Контрагент вне области «Свои контрагенты» — как нет права (прототип `scope`).
      if (found === 'hidden') return refuse('tgActNoRight');
      // Запрос уже рассмотрен или страница выключена — кнопка устарела (прототип `stale`).
      if (found === 'off' || link.status !== 'wait' || !found.pageOn) return refuse('tgActStale');
      const t = await serverTexts(ctx.deps);
      // Защита строже прототипа, как в карточке: новое подключение — только пока раздел «Telegram»
      // страницы действует.
      // ОТКЛОНЕНИЕ: docs/deviations.md#К-5
      if (action === 'approve' && !found.sectionOn) {
        return { reply: t('err.cp_tg_section_off'), alert: true };
      }
      try {
        const decision = await decideContractorTelegram(tx, {
          contractorId: link.contractorId,
          linkId: ctx.arg,
          action,
          version: link.version,
        });
        // Клиенту бот пишет сразу после записи решения: своего шага «после транзакции» у нажатия
        // нет. Сообщение не дошло — решение остаётся.
        await notifyContractorTelegramClient(
          ctx.deps,
          decision.chatId,
          decision.status === 'on' ? 'tgCpOn' : 'tgCpNo',
          decision.contractor,
          tx,
        );
        return {
          done: t(action === 'approve' ? 'cppage.tg.bot.done_ok' : 'cppage.tg.bot.done_no'),
          off: [CP_TG_OK_ACTION, CP_TG_NO_ACTION],
          reply:
            action === 'approve'
              ? formatText(t('cppage.tg.bot.approved'), {
                  name: decision.name,
                  contractor: decision.contractor,
                })
              : t('cppage.tg.toast.reject'),
        };
      } catch (err) {
        if (err instanceof ContractorTelegramRefusedError) {
          return { reply: t(`err.${err.code}`), alert: true };
        }
        throw err;
      }
    }),
});

/**
 * Ответ сотрудника на вопрос клиента (доработки 13.11.2026, задача К4; прототип v94 `pgTgAnswer`, шаблоны
 * `tgCpAskStaff` и `tgCpAnswer`): сообщение «Вопрос контрагента» — просьба бота без дня, сотрудник
 * отвечает на него текстом, и ответ уходит в тот чат клиента, откуда пришёл вопрос. Права — как у
 * просмотра контрагента на сайте: «Просматривать контрагентов» и контрагент в области «Свои / Все
 * контрагенты»; клиенту — только пока его подключение действует (то же правило, что у рассылки).
 * Номер вопроса из просьбы ничего не разрешает сам — вопрос ищется в организации отвечающего (RLS).
 * Принятый ответ закрывает просьбу (основа бота): одна просьба — один ответ, как в прототипе. Текст —
 * как у вопроса: одной строкой, до 500 знаков, в истории — первые 200; история — от имени сотрудника,
 * с пометкой «через Telegram». Telegram не принял сообщение — просьба остаётся открытой, истории нет.
 */
const answer: BotAction = {
  change: true,
  permission: 'cpView',
  reply: (ctx, reply) =>
    ctx.asUser(async (tx, access): Promise<BotReplyResult> => {
      const text = 'text' in reply ? cpTgQuestion(reply.text) : null;
      if (!text) return { again: await ctx.text('tgAskNeedText') };
      const refuse = async (key: TelegramTemplateKey): Promise<BotReplyResult> => ({
        say: await ctx.text(key),
      });
      if (!access || !ctx.user.orgId || !ctx.arg) return refuse('tgActNoRight');
      const question = await contractorTelegramQuestionOf(tx, ctx.arg);
      if (!question) return refuse('tgActStale');
      const found = await telegramSectionFor(
        tx,
        ctx.deps,
        { orgId: ctx.user.orgId, subject: access.subject },
        question.contractorId,
      );
      // Контрагент вне области «Свои контрагенты» — как нет права.
      if (found === 'hidden') return refuse('tgActNoRight');
      // Строка вопроса блокируется: ответ и нажатия клиента по этому сообщению идут по одному.
      const current = await lockContractorTelegramMessage(tx, ctx.arg, question.chatId);
      if (!current) return refuse('tgActStale');
      if (found === 'off' || !current.linked) {
        return { say: ctx.tr('cppage.tg.bot.answer_unlinked') };
      }
      const message: BotMessage = {
        heading: ctx.tr('cppage.tg.answer_heading'),
        text: await ctx.text('tgCpAnswer', { бухгалтер: access.shortName, ответ: text }),
      };
      if (!(await sendClientAnswer(ctx.deps, tx, question.chatId, message))) {
        return { again: ctx.tr('cppage.tg.bot.answer_failed') };
      }
      await logContractorTelegramPay(tx, question.contractorId, 'page_tg_answer', [
        { field: 'tgAnswer', to: { name: current.name, text: cpTgQuestionForHistory(text) } },
      ]);
      return { say: ctx.tr('cppage.tg.bot.answer_sent') };
    }),
};

/**
 * Действия сотрудника в чате бота по Telegram контрагента: кнопки под запросом на подключение и ответ
 * на вопрос клиента — строки реестра `BOT_ACTIONS`.
 */
export const cpTelegramActions: Readonly<Record<string, BotAction>> = {
  [CP_TG_OK_ACTION]: decide('approve'),
  [CP_TG_NO_ACTION]: decide('reject'),
  [CP_TG_ANSWER_ACTION]: answer,
};
