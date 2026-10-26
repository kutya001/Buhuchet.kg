import { cleanupLoginAttempts, schema } from '@buhuchet/db';
import { lt } from 'drizzle-orm';
import type { Job } from '../deps';

const { schedulerRuns } = schema;

const DAY_MS = 86_400_000;

/** Журнал запусков хранится 30 дней. */
export const cleanupSchedulerRuns: Job = {
  name: 'system.cleanup-scheduler-runs',
  cron: '30 3 * * *',
  lookbackMinutes: 24 * 60,
  async run(ctx) {
    const border = new Date(ctx.clock.now().getTime() - 30 * DAY_MS);
    await ctx.db.delete(schedulerRuns).where(lt(schedulerRuns.slot, border));
  },
};

/**
 * Счёт неверных паролей по логину забывается через час: такие строки удаляются каждые 10 минут, чтобы
 * таблица не росла от выдуманных логинов.
 */
export const cleanupLoginAttemptsJob: Job = {
  name: 'auth.cleanup-login-attempts',
  cron: '*/10 * * * *',
  lookbackMinutes: 10,
  async run(ctx) {
    await cleanupLoginAttempts(ctx.db);
  },
};

/**
 * Все задачи по расписанию. Модули добавляют сюда свои: создание отчётов, напоминания 7 и 3 дня
 * и в день срока, сводка по понедельникам, отправка очереди Telegram.
 */
export const jobs: readonly Job[] = [cleanupSchedulerRuns, cleanupLoginAttemptsJob];
