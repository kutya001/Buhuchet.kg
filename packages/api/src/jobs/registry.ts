import type { AppConfig } from '@buhuchet/adapters';
import {
  cleanupContractorPageGrants,
  cleanupLoginAttempts,
  cleanupRateLimits,
  schema,
} from '@buhuchet/db';
import { lt } from 'drizzle-orm';
import type { Job } from '../deps';
import { cleanupPendingFiles } from '../modules/files/cleanup';
import { syncServiceStatusesJob } from '../modules/contractors/job';
import { duesRecalcJob } from '../modules/platform-dicts/admin-dues';
import { createDueReportsJob } from '../modules/reports/job';

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

/** Строки частоты действий (выгрузки «В Excel») старше суток удаляются раз в час. */
export const cleanupRateLimitsJob: Job = {
  name: 'system.cleanup-rate-limits',
  cron: '15 * * * *',
  lookbackMinutes: 60,
  async run(ctx) {
    await cleanupRateLimits(ctx.db);
  },
};

/**
 * Запомненные браузеры страницы контрагента: истёкшие через 30 дней, после «Сменить код» и у
 * выключенных страниц — удаляются раз в сутки (проверка при открытии их и так не пускает).
 */
export const cleanupContractorPageGrantsJob: Job = {
  name: 'contractor-page.cleanup-grants',
  cron: '40 3 * * *',
  lookbackMinutes: 24 * 60,
  async run(ctx) {
    await cleanupContractorPageGrants(ctx.db);
  },
};

/**
 * Незаконченные загрузки файлов (браузер не положил файл в хранилище или окно закрыли) старше суток
 * убираются раз в час — время загрузки ставит база по настоящим часам, поэтому и срок — по ним.
 */
export const cleanupPendingFilesJob: Job = {
  name: 'files.cleanup-pending',
  cron: '45 * * * *',
  lookbackMinutes: 60,
  async run(ctx) {
    await cleanupPendingFiles(ctx);
  },
};

/**
 * Все задачи по расписанию. Модули добавляют сюда свои: создание отчётов, напоминания 7 и 3 дня
 * и в день срока, сводка по понедельникам, отправка очереди Telegram. Данные организации задача
 * читает и меняет в `withOrgContext(ctx.db, { orgId, kind: 'job' })`: предел времени запроса у задач
 * больше, чем у методов API (docs/decisions.md, п. 38).
 */
export const jobs: readonly Job[] = [
  cleanupSchedulerRuns,
  cleanupLoginAttemptsJob,
  cleanupRateLimitsJob,
  syncServiceStatusesJob,
  cleanupContractorPageGrantsJob,
  createDueReportsJob,
  cleanupPendingFilesJob,
  duesRecalcJob,
];

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
