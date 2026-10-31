import {
  claimOutbox,
  enqueueTelegram,
  finishOutbox,
  telegramOutboxOrgs,
  withOrgContext,
  type ClaimedOutbox,
  type OutboxMessage,
  type OutboxOutcome,
  type Tx,
} from '@buhuchet/db';
import {
  OUTBOX_BATCH,
  OUTBOX_LEASE_SECONDS,
  OUTBOX_MAX_BATCHES,
  OUTBOX_MAX_TRIES,
  OUTBOX_PAUSE_MS,
  outboxRetryDelaySeconds,
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

/** Отправить одну строку и решить, что с ней дальше. */
async function sendOne(ctx: JobContext, row: ClaimedOutbox, now: () => Date): Promise<OutboxOutcome> {
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
    const res = await ctx.telegram.sendMessage(row.chatId, row.text, { disableLinkPreview: true });
    if (res.ok) return { id: row.id, result: 'sent', at: now() };
    return fail(`${res.errorCode}: ${res.description}`, res.permanent, res.retryAfterSeconds);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), false);
  }
}

/**
 * Разобрать очередь организации: пачки по 25 строк, между пачками — пауза. Строку сначала берут
 * (попытка засчитана, другой запуск её не возьмёт), отправляют вне транзакции и записывают итог.
 * `ids` — только эти строки (сразу после действия). Возвращает число отправленных.
 */
export async function sendOrgOutbox(
  ctx: JobContext,
  orgId: string,
  o: { ids?: readonly string[]; pause?: Pause; maxBatches?: number } = {},
): Promise<number> {
  const pause = o.pause ?? realPause;
  const now = () => ctx.clock.now();
  let sent = 0;
  for (let batch = 0; batch < (o.maxBatches ?? OUTBOX_MAX_BATCHES); batch++) {
    if (batch > 0) await pause(OUTBOX_PAUSE_MS);
    const rows = await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
      claimOutbox(tx, {
        now: now(),
        limit: OUTBOX_BATCH,
        leaseSeconds: OUTBOX_LEASE_SECONDS,
        ...(o.ids ? { ids: o.ids } : {}),
      }),
    );
    if (!rows.length) break;
    const outcomes: OutboxOutcome[] = [];
    for (const row of rows) outcomes.push(await sendOne(ctx, row, now));
    await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) => finishOutbox(tx, outcomes));
    sent += outcomes.filter((x) => x.result === 'sent').length;
    for (const x of outcomes) {
      if (x.result !== 'sent') {
        ctx.logger.warn(
          { job: 'telegram.send', orgId, id: x.id, result: x.result, error: x.error },
          'Telegram: сообщение не отправлено',
        );
      }
    }
    if (rows.length < OUTBOX_BATCH) break;
  }
  return sent;
}

/** Отправка очереди каждую минуту: по организациям, у которых есть что отправить. */
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
          ctx.logger.error({ job: 'telegram.send', orgId, err }, 'очередь организации не разобрана');
        }
      }
      if (failed.length) throw new Error(`telegram.send: не разобрана очередь организаций: ${failed.length}`);
    },
  };
}

/**
 * Сообщение о событии (новая задача, на подтверждении, подтверждена, на доработку, отменена, отчёт «На
 * исправление») — в очередь в транзакции действия: если действие откатится, сообщения не будет.
 */
export function queueEvents(tx: Tx, messages: readonly OutboxMessage[]): Promise<string[]> {
  return enqueueTelegram(tx, messages);
}

/**
 * После действия — сразу отправить его сообщения (ТЗ: «сообщение о новой задаче… приходит сразу»), не
 * дожидаясь очереди. Ошибка не роняет метод: строки остаются в очереди и уйдут с повтором.
 */
export async function flushEvents(ctx: JobContext, orgId: string, ids: readonly string[]): Promise<void> {
  if (!ids.length || !ctx.telegram) return;
  try {
    await sendOrgOutbox(ctx, orgId, { ids, maxBatches: 1 });
  } catch (err) {
    ctx.logger.warn({ err, orgId }, 'Telegram: сообщения о событии отправит очередь');
  }
}
