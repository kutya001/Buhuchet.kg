import {
  bellCleanup,
  bellDigestTime,
  feeDebtorList,
  loadReminderData,
  orgIds,
  productionCalendarEntries,
  withOrgContext,
  type Tx,
} from '@buhuchet/db';
import {
  bellDayPlans,
  bellDayRows,
  cpNoticeDay,
  formatText,
  hasPermission,
  type IsoDate,
  type Translate,
} from '@buhuchet/domain';
import type { Job } from '../../deps';
import { scopeSqlOf } from '../contractors/common';
import { serverTexts } from '../l10n/texts';
import { putBell, type BellPut } from './bell';
import { reminderInputs } from './reminders';

/*
 * Строки дня колокольчика (доработки 16.11.2026, блок 3; прототип v122 `bellStaffDay`): в час напоминаний
 * организации каждому сотруднику — «Сроки на сегодня», «Ждут подтверждения сдачи», «Задачи» и в «День
 * сводки» — «Сводка недели», по тем же правилам и переключателям профиля, что сообщение дня Telegram
 * (`reminderInputs`), но и тем, у кого Telegram не привязан, и в организациях без «Напоминаний в Telegram».
 */

/** Строки дня организации из контекста за день `day`. */
export async function bellDayPuts(tx: Tx, day: IsoDate, tr: Translate): Promise<BellPut[]> {
  const [data, entries] = await Promise.all([
    loadReminderData(tx, day),
    productionCalendarEntries(tx),
  ]);
  const { people, reports, tasks, policy } = reminderInputs(data, entries, day, tr);
  const byId = new Map(data.employees.map((e) => [e.employeeId, e]));
  const out: BellPut[] = [];
  for (const plan of bellDayPlans(people, { reports, tasks }, policy)) {
    const e = byId.get(plan.employeeId);
    if (!e) continue;
    // Должники за обслуживание — как раздел «Долги» сводки недели: функция и право, область получателя.
    const debtors =
      plan.week?.boss && data.features.fee === true && hasPermission(e.subject, 'fee')
        ? (await feeDebtorList(tx, { scope: scopeSqlOf(e.subject), today: day })).length
        : 0;
    for (const row of bellDayRows(plan, day, debtors, tr)) {
      out.push({
        userId: e.userId,
        kind: row.kind,
        event: row.event,
        target: row.target,
        need: row.need,
        text: row.text,
        eventKey: row.eventKey,
      });
    }
  }
  return out;
}

/**
 * Задача расписания раз в 5 минут: организация — в запуск своего часа напоминаний (`cpNoticeDay` по
 * `slot`, каждое время — ровно в один запуск за день; пропущенный запуск догоняется со своим временем).
 * Повтор запуска строк не удваивает: ключ события — вид и день.
 */
export const bellDayJob: Job = {
  name: 'telegram.bell-day',
  cron: '*/5 * * * *',
  lookbackMinutes: 60,
  async run(ctx, slot) {
    const t = await serverTexts(ctx);
    const tr: Translate = (key, params) => formatText(t(key), params);
    const failed: string[] = [];
    let put = 0;
    for (const orgId of await orgIds(ctx.db)) {
      try {
        put += await withOrgContext(ctx.db, { orgId, kind: 'job' }, async (tx) => {
          const day = cpNoticeDay(await bellDigestTime(tx), slot);
          if (!day) return 0;
          return putBell(tx, await bellDayPuts(tx, day, tr), ctx.clock.now());
        });
      } catch (err) {
        failed.push(orgId);
        ctx.logger.error(
          { job: 'telegram.bell-day', orgId, err },
          'строки дня колокольчика не собраны',
        );
      }
    }
    if (put) ctx.logger.info({ job: 'telegram.bell-day', put }, 'строки дня колокольчика');
    if (failed.length) {
      throw new Error(`telegram.bell-day: не собраны строки организаций: ${failed.length}`);
    }
  },
};

/**
 * Уборка колокольчика раз в сутки (по умолчанию 90 дней, `BELL_KEEP_DAYS`): строки каждой организации —
 * в её контексте, строки администраторов платформы — без организации (`app.bell_cleanup`).
 */
export const bellCleanupJob: Job = {
  name: 'telegram.bell-cleanup',
  cron: '50 3 * * *',
  lookbackMinutes: 24 * 60,
  async run(ctx) {
    let removed = await bellCleanup(ctx.db);
    const failed: string[] = [];
    for (const orgId of await orgIds(ctx.db)) {
      try {
        removed += await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) => bellCleanup(tx));
      } catch (err) {
        failed.push(orgId);
        ctx.logger.error({ job: 'telegram.bell-cleanup', orgId, err }, 'колокольчик не убран');
      }
    }
    if (removed) ctx.logger.info({ job: 'telegram.bell-cleanup', removed }, 'колокольчик убран');
    if (failed.length) {
      throw new Error(`telegram.bell-cleanup: не убраны организации: ${failed.length}`);
    }
  },
};
