import type {
  AppConfig,
  Clock,
  JobDefinition,
  Logger,
  Storage,
  Telegram,
} from '@buhuchet/adapters';
import type { Db } from '@buhuchet/db';
import type { FileSource } from './modules/files/sources';

export interface JobContext {
  db: Db;
  storage: Storage;
  clock: Clock;
  logger: Logger;
  telegram: Telegram | null;
}

export type Job = JobDefinition<JobContext>;

/** Всё, что нужно API. Собирается в runtime.ts из окружения, в тестах — из подделок. */
export interface ApiDeps extends JobContext {
  config: Pick<
    AppConfig,
    | 'APP_ENV'
    | 'APP_VERSION'
    | 'APP_BASE_URL'
    | 'CRON_SECRET'
    | 'TELEGRAM_WEBHOOK_SECRET'
    | 'TELEGRAM_BOT_USERNAME'
  >;
  jobs: readonly Job[];
  /** Не быстрее скольких миллисекунд отвечает «Забыли пароль?» (по умолчанию 1,5 с; в тестах — 0). */
  resetResponseFloorMs?: number;
  /** Не чаще скольких миллисекунд словарь сверяется с базой (по умолчанию 1 с; в тестах — 0). */
  l10nRecheckMs?: number;
  /** Источники файлов (по умолчанию `FILE_SOURCES`; тесты подставляют запись с контрагентом). */
  fileSources?: Readonly<Record<string, FileSource>>;
}
