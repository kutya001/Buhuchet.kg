import {
  claimOutbox,
  claimPlatformOutbox,
  enqueueTelegram,
  finishOutbox,
  finishPlatformOutbox,
  telegramBotRich,
  telegramOutboxOrgs,
  withOrgContext,
  type ClaimedOutbox,
  type OutboxMessage,
  type OutboxOutcome,
  type Tx,
} from '@buhuchet/db';
import { redactBotToken, type TelegramSendOptions } from '@buhuchet/adapters';
import {
  botHasMarkup,
  botKeyboard,
  botRichHtml,
  OUTBOX_BATCH,
  OUTBOX_LEASE_SECONDS,
  OUTBOX_MAX_BATCHES,
  OUTBOX_MAX_TRIES,
  OUTBOX_PAUSE_MS,
  outboxRetryDelaySeconds,
  type BotMessage,
} from '@buhuchet/domain';
import type { Job, JobContext } from '../../deps';

/*
 * Очередь Telegram (ТЗ «Уведомления в Telegram», Админка → «Модуль Телеграмм»; прототип
 * admin/telegram.js: «отправляются пачками», «после 5 повторов» — «Ошибка»; задача 2.25,
 * docs/decisions.md, п. Б-5). Напоминания за день и события (новая задача, возврат на доработку и
 * т. п.) ставятся в очередь в той же транзакции, что и действие, и уходят пачками по 25 с паузой
 * 1,2 с; временная ошибка повторяется позже (сколько попросил Telegram, иначе 1, 2, 4, 8 минут),
 * после 5 попыток или при постоянной ошибке (бот заблокирован, чат не найден) — «Ошибка».
 */

/** Пауза между пачками; в тестах — без ожидания. */
export type Pause = (ms: number) => Promise<void>;
const realPause: Pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Текст исключения отправки — для журнала: адрес запроса к Telegram содержит токен бота
 * (`/bot<токен>/`); переходник вычищает его сам, здесь — ещё раз для любого другого `deps.telegram`.
 */
export { redactBotToken };

/** Строка очереди: у сообщения с таблицами и кнопками — ещё описание и «простым текстом» получателя. */
type QueuedRow = Pick<ClaimedOutbox, 'id' | 'chatId' | 'text' | 'tries'> &
  Partial<Pick<ClaimedOutbox, 'message' | 'plain'>>;

/**
 * Как отправить сообщение с описанием (поток Т, задача Т1): кнопки под сообщением — всегда; вид с
 * таблицами — если в сообщении есть выделенный заголовок или таблицы и получателю не нужен простой
 * текст (свой переключатель или выключенные таблицы платформы); код подтверждения — моноширинным.
 */
export function botSendOptions(
  message: BotMessage,
  o: { plain: boolean },
): Pick<TelegramSendOptions, 'keyboard' | 'rich' | 'code'> {
  const keyboard = botKeyboard(message);
  return {
    ...(keyboard.length ? { keyboard } : {}),
    ...(!o.plain && botHasMarkup(message) ? { rich: botRichHtml(message) } : {}),
    ...(message.code !== undefined ? { code: message.code } : {}),
  };
}

/** Отправить одну строку и решить, что с ней дальше. */
async function sendOne(
  ctx: JobContext,
  row: QueuedRow,
  rich: boolean,
  now: () => Date,
): Promise<OutboxOutcome> {
  const fail = (error: string, permanent: boolean, retryAfter?: number): OutboxOutcome =>
    permanent || row.tries >= OUTBOX_MAX_TRIES
      ? { id: row.id, result: 'error', error }
      : {
          id: row.id,
          result: 'retry',
          error,
          at: new Date(now().getTime() + outboxRetryDelaySeconds(row.tries, retryAfter) * 1000),
        };
  if (!ctx.telegram) return fail('Telegram-бот не подключён', false);
  try {
    const res = await ctx.telegram.sendMessage(row.chatId, row.text, {
      disableLinkPreview: true,
      ...(row.message ? botSendOptions(row.message, { plain: !rich || row.plain === true }) : {}),
    });
    if (res.ok) {
      // Номер сообщения нужен только сообщению с кнопками: по нему бот находит его при нажатии.
      return {
        id: row.id,
        result: 'sent',
        at: now(),
        ...(row.message ? { messageId: res.messageId } : {}),
      };
    }
    return fail(`${res.errorCode}: ${res.description}`, res.permanent, res.retryAfterSeconds);
  } catch (err) {
    return fail(redactBotToken(err instanceof Error ? err.message : String(err)), false);
  }
}

/**
 * Разобрать очередь пачками по 25 строк, между пачками — пауза. Строку сначала берут (попытка засчитана,
 * другой запуск её не возьмёт), отправляют вне транзакции и записывают итог. Возвращает число
 * отправленных.
 */
async function sendBatches(
  ctx: JobContext,
  q: {
    claim: (now: Date) => Promise<QueuedRow[]>;
    finish: (outcomes: OutboxOutcome[]) => Promise<void>;
    orgId: string | null;
  },
  o: { pause?: Pause; maxBatches?: number },
): Promise<number> {
  const pause = o.pause ?? realPause;
  const now = () => ctx.clock.now();
  let sent = 0;
  for (let batch = 0; batch < (o.maxBatches ?? OUTBOX_MAX_BATCHES); batch++) {
    if (batch > 0) await pause(OUTBOX_PAUSE_MS);
    const rows = await q.claim(now());
    if (!rows.length) break;
    const outcomes: OutboxOutcome[] = [];
    // «Сообщения с таблицами» платформы читаются раз на пачку и только если в ней есть такие сообщения.
    const rich = rows.some((r) => r.message) ? await telegramBotRich(ctx.db) : true;
    for (const row of rows) outcomes.push(await sendOne(ctx, row, rich, now));
    await q.finish(outcomes);
    sent += outcomes.filter((x) => x.result === 'sent').length;
    for (const x of outcomes) {
      if (x.result !== 'sent') {
        ctx.logger.warn(
          { job: 'telegram.send', orgId: q.orgId, id: x.id, result: x.result, error: x.error },
          'Telegram: сообщение не отправлено',
        );
      }
    }
    if (rows.length < OUTBOX_BATCH) break;
  }
  return sent;
}

/**
 * Разобрать очередь организации (`sendBatches`). `ids` — только эти строки (сразу после действия).
 * Возвращает число отправленных.
 */
export function sendOrgOutbox(
  ctx: JobContext,
  orgId: string,
  o: { ids?: readonly string[]; pause?: Pause; maxBatches?: number } = {},
): Promise<number> {
  return sendBatches(
    ctx,
    {
      orgId,
      claim: (now) =>
        withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
          claimOutbox(tx, {
            now,
            limit: OUTBOX_BATCH,
            leaseSeconds: OUTBOX_LEASE_SECONDS,
            ...(o.ids ? { ids: o.ids } : {}),
          }),
        ),
      finish: (outcomes) =>
        withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) => finishOutbox(tx, outcomes)),
    },
    o,
  );
}

/**
 * Строки без организации — сообщения администраторам платформы: заявка с сайта с кнопками (поток Т,
 * задача Т6) и те, что Админка → «Телеграм» снова поставила в очередь «Повторить отправку» (задача
 * 2.41). Под RLS их не видно ни в одной организации, поэтому их берут и отмечают функции базы; у
 * сообщения с кнопками запоминается номер в чате — по нему бот принимает нажатие.
 */
export function sendPlatformOutbox(
  ctx: JobContext,
  o: { pause?: Pause; maxBatches?: number } = {},
): Promise<number> {
  return sendBatches(
    ctx,
    {
      orgId: null,
      claim: (now) =>
        claimPlatformOutbox(ctx.db, {
          now,
          limit: OUTBOX_BATCH,
          leaseSeconds: OUTBOX_LEASE_SECONDS,
        }),
      finish: (outcomes) => finishPlatformOutbox(ctx.db, outcomes),
    },
    o,
  );
}

/**
 * Отправка очереди каждую минуту: по организациям, у которых есть что отправить, затем строки без
 * организации (администраторам платформы).
 */
export function telegramSendJob(pause?: Pause): Job {
  return {
    name: 'telegram.send',
    cron: '* * * * *',
    lookbackMinutes: 1,
    async run(ctx) {
      if (!ctx.telegram) return;
      const failed: string[] = [];
      for (const orgId of await telegramOutboxOrgs(ctx.db, ctx.clock.now())) {
        try {
          await sendOrgOutbox(ctx, orgId, pause ? { pause } : {});
        } catch (err) {
          failed.push(orgId);
          ctx.logger.error(
            { job: 'telegram.send', orgId, err },
            'очередь организации не разобрана',
          );
        }
      }
      try {
        await sendPlatformOutbox(ctx, pause ? { pause } : {});
      } catch (err) {
        failed.push('platform');
        ctx.logger.error({ job: 'telegram.send', err }, 'очередь платформы не разобрана');
      }
      if (failed.length)
        throw new Error(`telegram.send: не разобрана очередь организаций: ${failed.length}`);
    },
  };
}

/**
 * Сообщение о событии (новая задача, на подтверждении, подтверждена, на доработку, отменена, отчёт «На
 * исправление») — в очередь в транзакции действия: если действие откатится, сообщения не будет.
 */
export function queueEvents(
  tx: Tx,
  messages: readonly OutboxMessage[],
  now: Date,
): Promise<string[]> {
  return enqueueTelegram(tx, messages, now);
}

/**
 * После действия — сразу отправить его сообщения (ТЗ: «сообщение о новой задаче… приходит сразу»), не
 * дожидаясь очереди. Ошибка не роняет метод: строки остаются в очереди и уйдут с повтором.
 */
export async function flushEvents(
  ctx: JobContext,
  orgId: string,
  ids: readonly string[],
): Promise<void> {
  if (!ids.length || !ctx.telegram) return;
  try {
    await sendOrgOutbox(ctx, orgId, { ids, maxBatches: 1 });
  } catch (err) {
    ctx.logger.warn({ err, orgId }, 'Telegram: сообщения о событии отправит очередь');
  }
}
