import type {
  AppConfig,
  Clock,
  ErrorReporter,
  JobDefinition,
  Logger,
  Storage,
  Telegram,
} from '@buhuchet/adapters';
import type { DocumentReader } from '@buhuchet/adapters/documents';
import type { Db, RateLimit } from '@buhuchet/db';
import type { TechDocsSource } from './modules/admin/techdocs-source';
import type { FileSource } from './modules/files/sources';
import type { BotAction } from './modules/telegram/press';

export interface JobContext {
  /** Среда — для пометки «🧪 Тестовый стенд» в оповещениях администратору платформы. */
  config: Pick<AppConfig, 'APP_ENV'>;
  db: Db;
  storage: Storage;
  clock: Clock;
  logger: Logger;
  telegram: Telegram | null;
  /** Ошибки сервера во внешний сервис (Sentry по `SENTRY_DSN`); нет — не отправляются. */
  errors?: ErrorReporter;
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
  /** Действия по кнопкам бота (по умолчанию `BOT_ACTIONS`; тесты подставляют свои). */
  botActions?: Readonly<Record<string, BotAction>>;
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
  /**
   * Код из Telegram при входе администратора платформы (docs/deviations.md п. О-13). Не задано — на
   * стенде и рабочем сайте он нужен, на своём компьютере и в тестах (APP_ENV local и test) — нет:
   * сквозные тесты входят администратором без Telegram. Тест кода задаёт его сам.
   */
  adminSecondFactor?: boolean;
  /**
   * Данные «Технической документации» Админки (собирает scripts/build-techdocs.mjs при сборке сайта).
   * Нет — модуль отвечает «Не удалось прочитать описание»; тесты подставляют свои.
   */
  techDocs?: TechDocsSource;
}
