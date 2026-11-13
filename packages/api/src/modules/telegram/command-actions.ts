import { messageTemplates, orgMenuSettings, telegramChat } from '@buhuchet/db';
import { bishkekDate } from '@buhuchet/domain';
import {
  commandMessageFor,
  commandTexts,
  contractorCardMessage,
  findContractorAnswer,
} from './command-view';
import type { BotAction, BotPressResult } from './press';

/*
 * «Найти контрагента» из меню бота (поток Т, задача Т5; прототип v102 modules/tg-menu.js —
 * `tgAct('cpFind')`, `tgAct('cpCard')`): ответ на просьбу «напишите название или ИНН» и кнопка с
 * названием найденного контрагента.
 *
 * Право «Просматривать контрагентов» проверяет ядро при каждом ответе и нажатии; здесь — область
 * «Свои / Все контрагенты» (контрагент вне области или в архиве — «Нет права», как чужой) и включённые
 * «Напоминания в Telegram» организации. Данные действия не меняют, поэтому работают и при выключенных
 * «Действиях из Telegram»; в предел частоты входят (`limited`). Номер контрагента в кнопке сам ничего
 * не разрешает: карточка читается заново в организации нажавшего (RLS) и в его области.
 */

/** Ответ на просьбу поиска: карточка, кнопки с названиями или «не найден — напишите иначе». */
export const findContractorAction: BotAction = {
  permission: 'cpView',
  limited: true,
  reply: (ctx, reply) =>
    ctx.asUser(async (tx, access) => {
      const orgId = ctx.user.orgId;
      if (!access || !orgId || !('text' in reply)) return { say: await ctx.text('tgActNoRight') };
      const { features } = await orgMenuSettings(tx, orgId);
      if (!features.telegram) return { say: await ctx.text('tgActNoRight') };
      const today = bishkekDate(ctx.deps.clock.now());
      const t = commandTexts(await messageTemplates(tx), ctx.tr);
      const answer = await findContractorAnswer(
        ctx.deps,
        tx,
        { subject: access.subject, orgId },
        reply.text,
        { today, t, tr: ctx.tr },
      );
      if ('again' in answer) return answer;
      const chat = await telegramChat(tx, ctx.user.userId);
      return {
        send: {
          message: commandMessageFor(answer.message, ctx.user.orgName, chat?.shared === true),
          kind: 'bot_cmd',
        },
      };
    }),
};

/** Кнопка с названием контрагента: карточка новым сообщением; кнопка остаётся активной. */
export const contractorCardAction: BotAction = {
  permission: 'cpView',
  limited: true,
  run: (ctx) =>
    ctx.asUser(async (tx, access) => {
      const noRight = async (): Promise<BotPressResult> => ({
        reply: await ctx.text('tgActNoRight'),
        alert: true,
      });
      const orgId = ctx.user.orgId;
      if (!access || !orgId || !ctx.arg) return noRight();
      const { features } = await orgMenuSettings(tx, orgId);
      if (!features.telegram) return noRight();
      const today = bishkekDate(ctx.deps.clock.now());
      const t = commandTexts(await messageTemplates(tx), ctx.tr);
      const card = await contractorCardMessage(
        ctx.deps,
        tx,
        { subject: access.subject, orgId },
        ctx.arg,
        { today, t, tr: ctx.tr },
      );
      // Контрагент ушёл из области, в архив или удалён — «Нет права», кнопка остаётся как была.
      if (!card) return noRight();
      const chat = await telegramChat(tx, ctx.user.userId);
      return {
        send: {
          message: commandMessageFor(card, ctx.user.orgName, chat?.shared === true),
          kind: 'bot_cmd',
        },
      };
    }),
};
