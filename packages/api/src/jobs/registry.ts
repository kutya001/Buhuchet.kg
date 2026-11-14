import type { AppConfig } from '@buhuchet/adapters';
import {
  cleanupContractorPageGrants,
  cleanupContractorTelegramLinks,
  cleanupLoginAttempts,
  cleanupRateLimits,
  schema,
} from '@buhuchet/db';
import { formatMomentRu } from '@buhuchet/domain';
import { lt } from 'drizzle-orm';
import type { Job } from '../deps';
import { cleanupPendingFiles } from '../modules/files/cleanup';
import { syncServiceStatusesJob } from '../modules/contractors/job';
import { cleanupVideoUploadsJob } from '../modules/kb/video-cleanup';
import { duesRecalcJob } from '../modules/platform-dicts/admin-dues';
import { createDueReportsJob } from '../modules/reports/job';
import { contractorDebtJob } from '../modules/telegram/client/debt';
import { contractorPayJob } from '../modules/telegram/client/pay';

import { botMenuCommands } from '../modules/telegram/command-view';
import { telegramSendJob } from '../modules/telegram/outbox';
import { telegramRemindersJob } from '../modules/telegram/reminders';
import { alertTexts, sendPlatformAlert } from './alerts';
import { watchLoginLocksJob } from './login-locks';

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
    // Одноразовые ссылки «Подключить Telegram» с истёкшим сроком (задача К3).
    await cleanupContractorTelegramLinks(ctx.db);
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
  watchLoginLocksJob,
  cleanupRateLimitsJob,
  syncServiceStatusesJob,
  cleanupContractorPageGrantsJob,
  contractorPayJob,
  contractorDebtJob,
  createDueReportsJob,
  cleanupPendingFilesJob,
  duesRecalcJob,
  cleanupVideoUploadsJob,
];

/** Ошибки доставки вебхуку — не чаще одного оповещения за столько часов. */
export const WEBHOOK_ALERT_HOURS = 3;

/**
 * Вебхук бота: Telegram присылает обновления на `<APP_BASE_URL>/api/telegram/webhook` с секретом
 * TELEGRAM_WEBHOOK_SECRET. Сайт сообщает адрес сам каждые 10 минут (повтор с теми же данными ничего не
 * меняет), поэтому после того как переменные бота заданы или секрет сменён, ручного шага с токеном нет.
 * У бота один вебхук: у стенда и рабочего сайта боты разные, иначе они перебивали бы друг друга.
 * Тут же сайт сообщает Telegram меню команд бота («/today — Сегодня»; поток Т, задача Т5) и идёт проверка
 * доставки (ревью безопасности Р-8 А, docs/decisions.md п. О-30): Telegram отметил
 * ошибку доставки обновления сайту с прошлой проверки — оповещение администратору платформы (не чаще
 * раза в 3 часа).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#14 — токен бота и секрет берутся из окружения, а не из Админки.
export function telegramWebhookJob(webhook: { url: string; secretToken: string }): Job {
  const period = 10;
  return {
    name: 'telegram.register-webhook',
    cron: `*/${period} * * * *`,
    lookbackMinutes: period,
    async run(ctx) {
      if (!ctx.telegram) return;
      await ctx.telegram.setWebhook(webhook.url, webhook.secretToken);
      // Меню команд бота (поток Т, задача Т5): подписи — из шаблонов, поэтому обновляются тут же. Сбой
      // меню проверке вебхука не мешает.
      try {
        await ctx.telegram.setCommands(await botMenuCommands(ctx.db));
      } catch (err) {
        ctx.logger.warn({ err }, 'Telegram: меню команд бота не обновлено');
      }
      const info = await ctx.telegram.getWebhookInfo();
      const now = ctx.clock.now();
      // С запасом в минуту: проверки идут раз в 10 минут, ошибка между ними не теряется.
      const since = now.getTime() - (period + 1) * 60_000;
      if (!info.lastErrorAt || info.lastErrorAt.getTime() <= since) return;
      ctx.logger.warn(
        { error: info.lastError, at: info.lastErrorAt.toISOString(), pending: info.pendingUpdates },
        'Telegram: ошибка доставки вебхуку',
      );
      const t = await alertTexts(ctx);
      const bucket = Math.floor(info.lastErrorAt.getTime() / (WEBHOOK_ALERT_HOURS * 3_600_000));
      await sendPlatformAlert(ctx, {
        key: `webhook:${bucket}`,
        text: t('alert.webhook', {
          error: info.lastError ?? '—',
          at: formatMomentRu(info.lastErrorAt),
          n: info.pendingUpdates,
        }),
      });
    },
  };
}

/**
 * Задачи для этих настроек: напоминания за день и отправка очереди Telegram (задача 2.25; без бота они
 * ничего не делают), вебхук бота — только если бот задан и сайт открыт по https.
 */
export function jobsFor(
  config: Pick<AppConfig, 'APP_BASE_URL' | 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_WEBHOOK_SECRET'>,
): readonly Job[] {
  const all = [...jobs, telegramRemindersJob(config.APP_BASE_URL), telegramSendJob()];
  if (
    !config.TELEGRAM_BOT_TOKEN ||
    !config.TELEGRAM_WEBHOOK_SECRET ||
    !config.APP_BASE_URL.startsWith('https://')
  ) {
    return all;
  }
  return [
    ...all,
    telegramWebhookJob({
      url: new URL('/api/telegram/webhook', config.APP_BASE_URL).href,
      secretToken: config.TELEGRAM_WEBHOOK_SECRET,
    }),
  ];
}
