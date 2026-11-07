import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from './client';
import { schedulerJobs, schedulerRuns } from './schema';

/*
 * Запуски задач по расписанию и их состояние для оповещений (ревью безопасности Р-9 и Р-8,
 * docs/decisions.md п. О-30). Слот задачи сначала занимается строкой `scheduler_runs`: первым
 * запуском (вставка) или повтором упавшей попытки (рост `attempts`). Занимает один вызов — второй
 * параллельный ничего не получит, поэтому и повтор выполняется один раз. Обе таблицы служебные: без
 * организации, роль приложения читает и пишет (`platformService`).
 */

export type JobAlert = 'failing' | 'missed';

export interface JobState {
  job: string;
  lastSlot: Date | null;
  lastOkAt: Date | null;
  fails: number;
  lastError: string | null;
  alert: JobAlert | null;
  alertedAt: Date | null;
}

/**
 * Занять слот: первая попытка — новая строка; повтор — только если прошлая попытка упала, с её конца
 * прошло `retryDelaysMinutes[попытка − 1]` минут и попыток меньше `maxAttempts`. Возвращает номер
 * занятой попытки или null — слот уже выполнен, выполняется или ждёт своей паузы.
 */
export async function claimJobSlot(
  db: Db,
  o: {
    job: string;
    slot: Date;
    now: Date;
    maxAttempts: number;
    retryDelaysMinutes: readonly number[];
  },
): Promise<number | null> {
  const now = o.now.toISOString();
  // Пауза перед повтором по номеру прошлой попытки: «case attempts when 1 then 2 when 2 then 10 …».
  const delay = o.retryDelaysMinutes.length
    ? sql`case ${schedulerRuns.attempts} ${sql.join(
        o.retryDelaysMinutes.map((m, i) => sql`when ${i + 1} then ${Math.max(0, Math.trunc(m))}`),
        sql` `,
      )} else 0 end`
    : sql`0`;
  const rows = await db
    .insert(schedulerRuns)
    .values({ job: o.job, slot: o.slot, startedAt: o.now })
    .onConflictDoUpdate({
      target: [schedulerRuns.job, schedulerRuns.slot],
      set: {
        attempts: sql`${schedulerRuns.attempts} + 1`,
        startedAt: o.now,
        finishedAt: null,
        ok: null,
      },
      setWhere: sql`${schedulerRuns.ok} = false
        and ${schedulerRuns.attempts} < ${o.maxAttempts}
        and ${schedulerRuns.finishedAt} <= ${now}::timestamptz
          - make_interval(mins => (${delay})::integer)`,
    })
    .returning({ attempts: schedulerRuns.attempts });
  const attempt = rows[0]?.attempts ?? null;
  if (attempt !== null) {
    // Последний занятый слот задачи: по нему видно, что задача давно не запускалась.
    await db
      .insert(schedulerJobs)
      .values({ job: o.job, lastSlot: o.slot })
      .onConflictDoUpdate({
        target: schedulerJobs.job,
        set: {
          lastSlot: sql`greatest(${schedulerJobs.lastSlot}, excluded.last_slot)`,
          // Задача снова запускается — оповещение «не запускалась» закрыто.
          alert: sql`nullif(${schedulerJobs.alert}, 'missed')`,
        },
      });
  }
  return attempt;
}

/** Записать итог попытки. Поздний итог уже повторённой попытки (номер не совпал) не пишется. */
export async function finishJobRun(
  db: Db,
  o: { job: string; slot: Date; attempt: number; now: Date; error: string | null },
): Promise<void> {
  await db
    .update(schedulerRuns)
    .set({ finishedAt: o.now, ok: o.error === null, error: o.error })
    .where(
      and(
        eq(schedulerRuns.job, o.job),
        eq(schedulerRuns.slot, o.slot),
        eq(schedulerRuns.attempts, o.attempt),
      ),
    );
}

/**
 * Попытки, которые начались раньше `startedBefore` и не закончились (функцию оборвало по времени,
 * процесс остановили), — отметить неудачными с текстом `error`. Возвращает отмеченные: их засчитывают
 * в неудачи подряд, а слот можно повторить.
 */
export async function failHungJobRuns(
  db: Db,
  o: { startedBefore: Date; now: Date; error: string },
): Promise<{ job: string; slot: Date; attempts: number }[]> {
  return db
    .update(schedulerRuns)
    .set({ finishedAt: o.now, ok: false, error: o.error })
    .where(and(isNull(schedulerRuns.finishedAt), lte(schedulerRuns.startedAt, o.startedBefore)))
    .returning({
      job: schedulerRuns.job,
      slot: schedulerRuns.slot,
      attempts: schedulerRuns.attempts,
    });
}

/** Состояние всех задач, которые хоть раз запускались. */
export async function jobStates(db: Db): Promise<Map<string, JobState>> {
  const rows = await db.select().from(schedulerJobs);
  return new Map(rows.map((r) => [r.job, r]));
}

/**
 * Итог попытки в состоянии задачи: успех сбрасывает неудачи подряд, неудача прибавляет одну.
 * Возвращает состояние после записи.
 */
export async function recordJobOutcome(
  db: Db,
  o: { job: string; now: Date; error: string | null },
): Promise<JobState> {
  const ok = o.error === null;
  const [row] = await db
    .insert(schedulerJobs)
    .values({
      job: o.job,
      fails: ok ? 0 : 1,
      lastError: o.error,
      lastOkAt: ok ? o.now : null,
    })
    .onConflictDoUpdate({
      target: schedulerJobs.job,
      set: ok
        ? { fails: 0, lastOkAt: o.now }
        : { fails: sql`${schedulerJobs.fails} + 1`, lastError: o.error },
    })
    .returning();
  return row!;
}

/**
 * Отметить оповещение задачи: `alert` — какое открыто (null — закрыть). `onlyIf` — только если сейчас
 * открыто именно оно (так «снова работает» уходит один раз, даже если два вызова закончились разом).
 * true — отметка поставлена.
 */
export async function setJobAlert(
  db: Db,
  o: { job: string; alert: JobAlert | null; now: Date; onlyIf?: JobAlert | null },
): Promise<boolean> {
  const current =
    o.onlyIf === undefined
      ? undefined
      : o.onlyIf === null
        ? isNull(schedulerJobs.alert)
        : eq(schedulerJobs.alert, o.onlyIf);
  const rows = await db
    .update(schedulerJobs)
    .set({ alert: o.alert, alertedAt: o.alert === null ? null : o.now })
    .where(current ? and(eq(schedulerJobs.job, o.job), current) : eq(schedulerJobs.job, o.job))
    .returning({ job: schedulerJobs.job });
  return rows.length > 0;
}

/**
 * Поставить оповещение администраторам платформы в очередь Telegram (функция `app.platform_alert`,
 * миграция 0095): каждому незаблокированному администратору с привязанным Telegram. Тот же `key`
 * второго сообщения не ставит. Возвращает, скольким поставлено.
 */
export async function platformAlert(
  db: Db,
  o: { text: string; key: string; now: Date },
): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql`select app.platform_alert(${o.text}, ${o.key}, ${o.now.toISOString()}::timestamptz) as n`,
  );
  return Number(rows[0]?.n ?? 0);
}
