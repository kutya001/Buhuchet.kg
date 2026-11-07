import type {
  AppConfig,
  Clock,
  JobDefinition,
  Logger,
  Storage,
  Telegram,
} from '@buhuchet/adapters';
import type { DocumentReader } from '@buhuchet/adapters/documents';
import type { Db, RateLimit } from '@buhuchet/db';
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
  /**
   * Чтение PDF «Из свидетельства и выписки» (по умолчанию — настоящее, загружается при первом
   * «Распознать»; тесты подставляют поддельное).
   */
  documents?: DocumentReader;
  /**
   * Предел попыток входа и восстановления пароля с одного адреса (docs/deviations.md п. О-12). По
   * умолчанию — `AUTH_IP_LIMIT` на стенде и рабочем сайте; на своём компьютере, в тестах и сквозных
   * тестах (APP_ENV local и test) предела нет: там все запросы идут с одной машины. Тест предела
   * задаёт его сам.
   */
  authIpLimit?: RateLimit | null;
}
