import {
  bellDigestTime,
  contextOrgName,
  memoryNoticeLevel,
  orgIds,
  orgSubscriptionTerms,
  orgUsage,
  pendingSubscriptionPayment,
  platformNotice,
  saveStorageCheck,
  setMemoryNoticeLevel,
  subscriptionNoticeSettings,
  withOrgContext,
  type StorageCheckObject,
} from '@buhuchet/db';
import {
  bishkekDate,
  cpNoticeDay,
  memoryWarnEvent,
  memoryWarnLevel,
  subscriptionCalc,
  subscriptionCheckWait,
  subscriptionReminder,
} from '@buhuchet/domain';
import type { Job, JobContext } from '../deps';
import {
  notifyStorageCheck,
  notifySubOwners,
  subCheckWaitText,
  subNoticeContext,
} from '../modules/telegram/subs';

/*
 * Задачи по расписанию подписок и хранилища (доработки 20.11.2026, блок 4, пункт 3; блок 2, пункт 5;
 * пакет 2, блок 3, пункт 6; блок 6, пункт 3; поток Т, этап 1, П13; прототип schedJobs `subs.reminders`,
 * `subs.memory-checks`, `files.storage-reconcile`, `admin/subs-admin.js` `subDaily`). Каждая организация —
 * своей транзакцией в её контексте; повтор запуска ничего не удваивает: ключи сообщений — с днём.
 * Решение — docs/decisions.md п. Т-18.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-24

/** Одна организация упала — остальные идут дальше, запуск в конце отмечается сбоем. */
async function eachOrg(
  ctx: JobContext,
  job: string,
  fn: (orgId: string) => Promise<number>,
): Promise<number> {
  const failed: string[] = [];
  let done = 0;
  for (const orgId of await orgIds(ctx.db)) {
    try {
      done += await fn(orgId);
    } catch (err) {
      failed.push(orgId);
      ctx.logger.error({ job, orgId, err }, 'организация не обработана');
    }
  }
  if (failed.length) throw new Error(`${job}: не обработаны организации: ${failed.length}`);
  return done;
}

/**
 * «Подписки: напоминания об оплате» — раз в 5 минут; организация — в запуск своего часа напоминаний
 * (`cpNoticeDay` по `slot`, как строки дня колокольчика): за 7 дней (настройка подписок) до «Оплачено
 * до» и каждый день после — владельцам «истекает» или «просрочена» с суммой продления на тот же срок и
 * пакет (прототип `subRemindText`). Демо, «Нет подписки» и чек на проверке — без напоминаний. Отвечает,
 * скольким организациям напомнили.
 */
export function subsRemindersJob(baseUrl: string): Job {
  return {
    name: 'subs.reminders',
    cron: '*/5 * * * *',
    lookbackMinutes: 60,
    async run(ctx, slot) {
      const nc = await subNoticeContext(ctx, baseUrl);
      const settings = await subscriptionNoticeSettings(ctx.db);
      return eachOrg(ctx, 'subs.reminders', (orgId) =>
        withOrgContext(ctx.db, { orgId, kind: 'job' }, async (tx) => {
          const day = cpNoticeDay(await bellDigestTime(tx), slot);
          if (!day) return 0;
          const usage = await orgUsage(tx, day, { bytes: false });
          if (!usage || usage.demo || !usage.paidUntil) return 0;
          const reminder = subscriptionReminder({
            paidUntil: usage.paidUntil,
            pending: usage.status === 'pending',
            today: day,
            remindDays: settings.remindDays,
          });
          const terms = reminder && (await orgSubscriptionTerms(tx));
          if (!reminder || !terms) return 0;
          const renew = subscriptionCalc({
            kind: 'renew',
            prices: settings.prices,
            plan: terms.plan,
            sub: terms.sub,
            seats: terms.sub.seats,
            extraGb: terms.sub.extraGb,
            startMode: 'now',
            today: day,
          }).total;
          const org = (await contextOrgName(tx)) ?? '';
          const paidUntil = usage.paidUntil;
          const { added } = await notifySubOwners(
            tx,
            nc,
            orgId,
            reminder.event === 'soon'
              ? { event: 'soon', org, paidUntil, days: reminder.days, renew }
              : { event: 'over', org, paidUntil, renew },
            `sub_remind:${day}`,
          );
          return added ? 1 : 0;
        }),
      );
    },
  };
}

/**
 * «Подписки: память и чеки на проверке» — каждый день в 09:00 по Бишкеку: память 80 % и 100 % —
 * владельцам один раз, пока занятое не опустится ниже порога (порог помнит `org_memory_notices`);
 * непроверенный чек со следующего дня после отправки — повтор администраторам платформы «ждёт проверки
 * дней: N» (раз в день на чек). Отвечает, сколько сообщений поставлено.
 */
export function subsMemoryChecksJob(baseUrl: string): Job {
  return {
    name: 'subs.memory-checks',
    cron: '0 9 * * *',
    lookbackMinutes: 24 * 60,
    async run(ctx, slot) {
      const nc = await subNoticeContext(ctx, baseUrl);
      const settings = await subscriptionNoticeSettings(ctx.db);
      const today = bishkekDate(slot);
      let late = 0;
      const done = await eachOrg(ctx, 'subs.memory-checks', (orgId) =>
        withOrgContext(ctx.db, { orgId, kind: 'job' }, async (tx) => {
          const usage = await orgUsage(tx, today);
          if (!usage || usage.demo) return 0;
          let sent = 0;
          const level = memoryWarnLevel(usage.bytesUsed ?? 0, usage.bytesLimit);
          const was = await memoryNoticeLevel(tx);
          const event = memoryWarnEvent(was, level);
          if (level !== was) await setMemoryNoticeLevel(tx, level, nc.now);
          if (event && usage.bytesLimit !== null) {
            const org = (await contextOrgName(tx)) ?? '';
            const { added } = await notifySubOwners(
              tx,
              nc,
              orgId,
              { event, org, usedBytes: usage.bytesUsed ?? 0, limitBytes: usage.bytesLimit },
              `sub_mem:${level}:${today}`,
            );
            if (added) sent += 1;
          }
          const pay = await pendingSubscriptionPayment(tx);
          if (pay) {
            const wait = subscriptionCheckWait(
              bishkekDate(pay.createdAt),
              today,
              settings.checkDays,
            );
            if (wait.late) late += 1;
            if (wait.repeat) {
              const org = (await contextOrgName(tx)) ?? '';
              const facts = { payId: pay.id, orgName: org, kind: pay.kind, amount: pay.amount };
              const n = await platformNotice(tx, {
                kind: 'sub_check',
                text: subCheckWaitText(nc, facts, wait.days),
                key: `wait:${pay.id}:${today}`,
                now: nc.now,
              });
              if (n) sent += 1;
            }
          }
          return sent;
        }),
      );
      if (late)
        ctx.logger.info({ job: 'subs.memory-checks', late }, 'чеки ждут проверки дольше срока');
      return done;
    },
  };
}

/** Больше объектов сверка не читает: запуск записывается сбоем (память задачи). */
export const STORAGE_CHECK_MAX_OBJECTS = 200_000;

/**
 * «Файлы: сверка хранилища» — каждый день в 03:30 по Бишкеку: список объектов хранилища под `org/`
 * читается страницами вне транзакции, итог пишет `app.storage_check_save` (сама сверка ничего не
 * удаляет). Новые расхождения — администраторам платформы в Telegram (строку колокольчика кладёт его
 * чтение). Список не прочитался — запуск записывается с ошибкой, задача падает. Отвечает, сколько
 * объектов проверено.
 */
export function storageReconcileJob(baseUrl: string): Job {
  return {
    name: 'files.storage-reconcile',
    cron: '30 3 * * *',
    lookbackMinutes: 24 * 60,
    async run(ctx) {
      const started = ctx.clock.now();
      const objects: StorageCheckObject[] = [];
      try {
        let after: string | null = null;
        do {
          const page = await ctx.storage.list('org/', after);
          for (const o of page.items) {
            objects.push({ key: o.key, size: o.size, modifiedAt: o.modifiedAt });
          }
          if (objects.length > STORAGE_CHECK_MAX_OBJECTS) {
            throw new Error(`в хранилище больше ${STORAGE_CHECK_MAX_OBJECTS} объектов`);
          }
          after = page.next;
        } while (after);
      } catch (err) {
        // В итог — только вид и начало текста ошибки: ключей и адресов хранилища там нет.
        const e = err instanceof Error ? err : new Error(String(err));
        await saveStorageCheck(ctx.db, [], started, `${e.name}: ${e.message}`.slice(0, 300));
        throw err;
      }
      const saved = await saveStorageCheck(ctx.db, objects, started);
      const nc = await subNoticeContext(ctx, baseUrl);
      await notifyStorageCheck(ctx.db, nc, saved);
      return saved.objects;
    },
  };
}
