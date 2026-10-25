import type {
  AppConfig,
  Clock,
  JobDefinition,
  Logger,
  Storage,
  Telegram,
} from '@buhuchet/adapters';
import type { Db } from '@buhuchet/db';

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
  config: Pick<AppConfig, 'APP_ENV' | 'APP_VERSION' | 'CRON_SECRET'>;
  jobs: readonly Job[];
}
