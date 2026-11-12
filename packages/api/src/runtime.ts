import {
  clockFromConfig,
  createLogger,
  createS3Storage,
  createSentryReporter,
  createTelegramBotApi,
  loadConfig,
  type AppConfig,
} from '@buhuchet/adapters';
import path from 'node:path';
import { createDb } from '@buhuchet/db';
import type { ApiDeps } from './deps';
import { jobsFor } from './jobs/registry';
import { fileTechDocs } from './modules/admin/techdocs-source';

export interface Runtime {
  config: AppConfig;
  deps: ApiDeps;
  close(): Promise<void>;
}

/** Собрать зависимости API из переменных окружения. Единственное место, где они соединяются. */
export function createRuntime(
  service: 'web' | 'worker',
  config: AppConfig = loadConfig(),
): Runtime {
  const logger = createLogger({
    level: config.LOG_LEVEL,
    environment: config.APP_ENV,
    version: config.APP_VERSION,
    service,
  });
  const database = createDb(config.DATABASE_URL, {
    max: config.DATABASE_POOL_MAX,
    caCert: config.DATABASE_CA_CERT,
    applicationName: `buhuchet-${service}`,
  });
  const deps: ApiDeps = {
    config,
    db: database.db,
    storage: createS3Storage(config),
    clock: clockFromConfig(config),
    logger,
    telegram: config.TELEGRAM_BOT_TOKEN
      ? createTelegramBotApi({
          token: config.TELEGRAM_BOT_TOKEN,
          ...(config.TELEGRAM_API_BASE ? { apiBase: config.TELEGRAM_API_BASE } : {}),
        })
      : null,
    jobs: jobsFor(config),
    errors: createSentryReporter({
      dsn: config.SENTRY_DSN,
      environment: config.APP_ENV,
      release: config.APP_VERSION,
      service,
      logger,
    }),
    // Папка данных лежит рядом с сайтом (apps/web/techdocs): её собирает scripts/build-techdocs.mjs.
    ...(service === 'web'
      ? {
          techDocs: fileTechDocs(
            [
              path.join(process.cwd(), 'techdocs'),
              path.join(process.cwd(), 'apps/web/techdocs'),
            ],
            (err) => logger.warn({ err }, 'Техническая документация: данные не прочитаны'),
          ),
        }
      : {}),
  };
  return { config, deps, close: () => database.close() };
}

/**
 * Проверка настроек при запуске сайта (`apps/web/instrumentation.ts`): без нужных настроек сайт не стартует,
 * как и worker. Падает с ConfigError и списком того, чего не хватает.
 */
export function assertWebConfig(): void {
  loadConfig();
}
