import { telegramNotMe, writeHistory, writePlatformHistory } from '@buhuchet/db';
import {
  NOT_ME_HOURS,
  notMeLate,
  parseNotMeArg,
  SECURITY_NOTICE_DEFS,
  telegramName,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import type { BotAction, BotPressResult } from './press';

/*
 * «Это не я» под сообщениями бота о безопасности (поток Т, задача Т4; пакет заказчика 13.11.2026,
 * идея 9; прототип v101 modules/tg-security.js — `tgAct('notMe')`). Кнопка стоит под «Пароль изменён»,
 * «Привязан другой Telegram» и «Telegram отвязан»; одно нажатие завершает все сеансы учётной записи и
 * закрывает вход, пока владелец организации (владельцу — администратор платформы) не выдаст новый
 * пароль. Другой Telegram, привязанный вместо чата, из которого нажали, отвязывается; ожидающие коды и
 * ссылки привязки отменяются. У администратора платформы вход не закрывается — пароль ему выдать некому.
 *
 * После сброса пароля владельцем или администратором платформы прежнему чату доверять нельзя: кнопки,
 * выданные до сброса, гаснут, а под сообщениями, пока действует временный пароль или разрешение
 * привязать Telegram без кода, кнопка только отвечает, что делать (docs/deviations.md п. Т-7).
 *
 * Это защита учётной записи, а не работа с данными организации (`security`): права не нужно,
 * выключатель «Действия из Telegram» не влияет, чат может быть уже отвязан. Кнопка действует
 * `NOT_ME_HOURS` часов; момент отправки — в записи кнопки, а её ядро сверяет с отправленным сообщением.
 * Всё делает одна функция базы от имени получателя сообщения (`app.telegram_not_me`), запись истории
 * получает отметку «через Telegram». Ответ бота — обычное сообщение: оно остаётся в переписке.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-7
export const notMeAction: BotAction = {
  security: true,
  limited: true,
  run: (ctx) =>
    ctx.asUser(async (tx) => {
      const refused = async (
        key: TelegramTemplateKey,
        values: Record<string, string | number> = {},
      ): Promise<BotPressResult> => ({ reply: await ctx.text(key, values), alert: true });
      // Пароль сбросил владелец или администратор платформы: прежний чат мог остаться у постороннего —
      // закрыть вход заново и отменить разрешение привязать Telegram из него нельзя.
      const afterReset = (): BotPressResult => ({
        reply: ctx.tr('telegram.notme.after_reset'),
        alert: true,
      });
      const pressed = parseNotMeArg(ctx.arg);
      if (!pressed) return refused('tgActStale');
      const now = ctx.deps.clock.now();
      if (notMeLate(pressed.sentAt, now)) return refused('tgActNotMeLate', { часов: NOT_ME_HOURS });
      if (pressed.inert) return afterReset();

      const { login, orgId, orgName, userId } = ctx.user;
      const event = ctx.tr(SECURITY_NOTICE_DEFS[pressed.notice].event);
      const result = await telegramNotMe(tx, {
        chatId: ctx.chatId,
        staffText: await ctx.text('tgNotMeStaff', { логин: login, событие: event }),
        ownerText: await ctx.text('tgNotMeOwner', {
          организация: orgName ?? '',
          логин: login,
          событие: event,
        }),
        now,
        hours: NOT_ME_HOURS,
      });
      // Вход уже закрыт этой кнопкой (или сообщения о безопасности с действующей кнопкой в этом чате
      // нет) — «Кнопка устарела».
      if (!result || result.status === 'locked') return refused('tgActStale');
      if (result.status === 'reset') return afterReset();
      if (result.status === 'denied') return refused('tgActNoRight');

      const entry = {
        entity: 'user' as const,
        entityId: userId,
        action: 'not_me' as const,
        changes: [
          { field: 'notMe', to: pressed.notice },
          { field: 'sessionsEnded', to: String(result.sessions) },
          ...(result.cut ? [{ field: 'telegram', from: telegramName(result.cut), to: null }] : []),
          ...(result.locked ? [{ field: 'loginLocked', from: false, to: true }] : []),
        ],
      };
      // История администратора платформы — в Админке: у его записи нет организации.
      if (orgId) await writeHistory(tx, entry);
      else await writePlatformHistory(tx, entry);

      const text = result.locked
        ? await ctx.text('tgNotMeDone', {
            логин: login,
            кто: ctx.tr(result.isOwner ? 'telegram.notme.who.admin' : 'telegram.notme.who.owner'),
          })
        : await ctx.text('tgNotMeAdmin', { логин: login });
      return {
        done: ctx.tr(result.locked ? 'telegram.done.not_me' : 'telegram.done.not_me_admin'),
        send: { message: { text }, kind: 'not_me' },
        // О владельце — администраторам платформы: эти строки без организации отправит очередь.
        queued: result.isOwner ? [] : result.queued,
      };
    }),
};
