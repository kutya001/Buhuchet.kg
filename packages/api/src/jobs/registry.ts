import type { AppConfig } from '@buhuchet/adapters';
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

/**
 * Вебхук бота: Telegram присылает обновления на `<APP_BASE_URL>/api/telegram/webhook` с секретом
 * TELEGRAM_WEBHOOK_SECRET. Сайт сообщает адрес сам каждые 10 минут (повтор с теми же данными ничего не
 * меняет), поэтому после того как переменные бота заданы или секрет сменён, ручного шага с токеном нет.
 * У бота один вебхук: у стенда и рабочего сайта боты разные, иначе они перебивали бы друг друга.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#14 — токен бота и секрет берутся из окружения, а не из Админки.
export function telegramWebhookJob(webhook: { url: string; secretToken: string }): Job {
  return {
    name: 'telegram.register-webhook',
    cron: '*/10 * * * *',
    lookbackMinutes: 10,
    async run(ctx) {
      await ctx.telegram?.setWebhook(webhook.url, webhook.secretToken);
    },
  };
}

/** Задачи для этих настроек: вебхук бота — только если бот задан и сайт открыт по https. */
export function jobsFor(
  config: Pick<AppConfig, 'APP_BASE_URL' | 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_WEBHOOK_SECRET'>,
): readonly Job[] {
  if (
    !config.TELEGRAM_BOT_TOKEN ||
    !config.TELEGRAM_WEBHOOK_SECRET ||
    !config.APP_BASE_URL.startsWith('https://')
  ) {
    return jobs;
  }
  return [
    ...jobs,
    telegramWebhookJob({
      url: new URL('/api/telegram/webhook', config.APP_BASE_URL).href,
      secretToken: config.TELEGRAM_WEBHOOK_SECRET,
    }),
  ];
}
