import {
  clockFromConfig,
  createLogger,
  createS3Storage,
  createTelegramBotApi,
  loadConfig,
  type AppConfig,
} from '@buhuchet/adapters';
import { createDb } from '@buhuchet/db';
import { createApp, type ApiApp } from './app';
import type { ApiDeps } from './deps';
import { jobs } from './jobs/registry';

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
    applicationName: `buhuchet-${service}`,
  });
  const deps: ApiDeps = {
    config,
    db: database.db,
    storage: createS3Storage(config),
    clock: clockFromConfig(config),
    logger,
    telegram: config.TELEGRAM_BOT_TOKEN
      ? createTelegramBotApi({ token: config.TELEGRAM_BOT_TOKEN })
      : null,
    jobs,
  };
  return { config, deps, close: () => database.close() };
}

let web: { runtime: Runtime; app: ApiApp } | undefined;

/**
 * Обработчик для Next.js catch-all роута: `export const GET = handleApiRequest` и т. д.
 * Зависимости создаются при первом запросе, а не при сборке, поэтому `next build` не требует настроек.
 */
export function handleApiRequest(request: Request): Promise<Response> | Response {
  if (!web) {
    const runtime = createRuntime('web');
    web = { runtime, app: createApp(runtime.deps) };
  }
  return web.app.fetch(request);
}
