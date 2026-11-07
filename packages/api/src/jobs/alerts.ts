import { platformAlert } from '@buhuchet/db';
import { formatText, type UiTextParams } from '@buhuchet/domain';
import type { JobContext } from '../deps';
import { serverTexts } from '../modules/l10n/texts';
import { sendPlatformOutbox } from '../modules/telegram/outbox';

/*
 * Оповещения администратору платформы в Telegram о сбоях (ревью безопасности Р-8 А, docs/decisions.md
 * п. О-30): сообщение ставится в очередь без организации каждому незаблокированному администратору
 * платформы с привязанным Telegram и сразу отправляется, мимо задачи `telegram.send` — она сама может
 * быть тем, что сломалось. Не ушло сразу — уйдёт со следующей отправкой очереди (повторы, «Ошибка»
 * после 5 попыток, Админка → «Телеграм» → «Журнал»: тип «Сбой в работе сайта»). На тестовом стенде — с
 * пометкой «🧪 Тестовый стенд», от бота стенда его администраторам (база стенда своя).
 */

/**
 * Пометка сообщения со стенда — та же, что у сообщения о заявке (`STAND_MARK` в modules/admin/leads.ts,
 * сверяет тест). Не импортом: этот файл входит в сборку worker, а модуль заявок тянет типы сайта.
 */
export const ALERT_STAND_MARK = '🧪 Тестовый стенд ';

/** Тексты словаря для оповещений: `t(ключ, подстановки)`. */
export type AlertTexts = (key: string, params?: UiTextParams) => string;

export async function alertTexts(ctx: JobContext): Promise<AlertTexts> {
  const t = await serverTexts(ctx);
  return (key, params) => formatText(t(key), params);
}

/** Название задачи: из словаря `alert.job.<имя>` (точки и дефисы — «_»), иначе её имя. */
export function jobTitle(t: AlertTexts, name: string): string {
  const key = `alert.job.${name.replace(/[.-]/g, '_')}`;
  const title = t(key);
  return title === key ? name : title;
}

/**
 * Поставить оповещение и сразу отправить. `key` — постоянный признак события: тот же ключ второго
 * сообщения не ставит (два запуска, увидевшие один сбой, сообщат о нём один раз). Возвращает, скольким
 * администраторам поставлено.
 */
export async function sendPlatformAlert(
  ctx: JobContext,
  o: { key: string; text: string },
): Promise<number> {
  const text = (ctx.config.APP_ENV === 'staging' ? ALERT_STAND_MARK : '') + o.text;
  const queued = await platformAlert(ctx.db, { text, key: o.key, now: ctx.clock.now() });
  // Чтобы по журналу было видно, что оповещение было и сколько получателей (без текста).
  ctx.logger.warn({ alert: o.key, queued }, 'оповещение администратору платформы');
  if (queued > 0 && ctx.telegram) {
    try {
      await sendPlatformOutbox(ctx, { maxBatches: 1 });
    } catch (err) {
      ctx.logger.warn({ err, alert: o.key }, 'оповещение не отправлено сразу: уйдёт с очередью');
    }
  }
  return queued;
}
