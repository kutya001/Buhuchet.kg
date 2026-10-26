import { z } from 'zod';

/**
 * Все настройки приложения — только из переменных окружения и только через этот файл.
 * Список переменных с пояснениями — в `.env.example`.
 */

// «True», «TRUE » из панели настроек тоже понимаются: регистр и пробелы по краям не важны.
const bool = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(['true', 'false', '1', '0']))
  .transform((v) => v === 'true' || v === '1');

export const AppEnvironment = z.enum(['local', 'test', 'staging', 'production']);
export type AppEnvironment = z.infer<typeof AppEnvironment>;

const DatabaseFields = z.object({
  /** Обязательна: без неё стенд или рабочий сайт мог бы получить поведение «local» (демо, FIXED_NOW). */
  APP_ENV: AppEnvironment,
  /** Подключение приложения: роль без права обходить RLS. */
  DATABASE_URL: z.string().min(1),
  /** Подключение владельца схемы: только миграции и начальное наполнение. */
  DATABASE_ADMIN_URL: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  /** Пароль демо-сотрудников для `pnpm db:seed`; без него войти в демо-организацию нельзя. */
  DEMO_PASSWORD: z.string().min(1).optional(),
});

/**
 * Логины демо-сотрудников открыты (demoDB.json), поэтому на стенде пароль демо — своя строка от
 * 12 символов, не из .env.example; на рабочем сайте демо-организации нет и пароль не задаётся.
 */
function checkDemoPassword(
  env: { APP_ENV: AppEnvironment; DEMO_PASSWORD?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (!env.DEMO_PASSWORD) return;
  if (env.APP_ENV === 'production') {
    ctx.addIssue({
      code: 'custom',
      path: ['DEMO_PASSWORD'],
      message: 'на рабочем сайте демо-организации нет — не задаётся',
    });
  } else if (
    env.APP_ENV === 'staging' &&
    (env.DEMO_PASSWORD.length < 12 || env.DEMO_PASSWORD === 'demo')
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['DEMO_PASSWORD'],
      message: 'на стенде — своя строка от 12 символов, не из .env.example',
    });
  }
}

const DatabaseEnv = DatabaseFields.superRefine(checkDemoPassword);

// Ключи, регион и корзину вставляют копированием: лишний пробел или перевод строки в конце ломает подпись S3.
const StorageEnv = z.object({
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().trim().min(1).default('us-east-1'),
  S3_BUCKET: z.string().trim().min(3),
  S3_ACCESS_KEY_ID: z.string().trim().min(1),
  S3_SECRET_ACCESS_KEY: z.string().trim().min(1),
  S3_FORCE_PATH_STYLE: bool.default(true),
});

/** Имя бота-подделки из .env.example (локально и в CI). */
const EXAMPLE_BOT_USERNAME = 'buhuchet_local_bot';

const AppEnv = z
  .object({
    APP_VERSION: z.string().min(1).default('0.0.0-dev'),
    APP_BASE_URL: z.url().default('http://localhost:3000'),
    /** Порт отдельного сервера API на VPS (packages/api/src/standalone.ts). */
    API_PORT: z.coerce.number().int().positive().default(3001),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Секрет, с которым планировщик (Vercel Cron, worker, cron) вызывает /api/cron/*. */
    CRON_SECRET: z.string().min(16),
    /** Токен от BotFather: «цифры:строка» (проверка формата — как в прототипе admin/telegram.js). */
    TELEGRAM_BOT_TOKEN: z
      .string()
      .trim()
      .regex(/^\d{6,12}:[\w-]{30,}$/, 'токен бота: «123456789:…» из BotFather')
      .optional(),
    /** Секрет вебхука: Telegram принимает только латиницу, цифры, _ и - (до 256 символов). */
    TELEGRAM_WEBHOOK_SECRET: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{16,256}$/, 'секрет вебхука: от 16 латинских букв, цифр, _ и -')
      .optional(),
    /** Имя бота без «@» (buhuchet_bot): из него строится ссылка привязки t.me/<имя>?start=<токен>. */
    TELEGRAM_BOT_USERNAME: z
      .string()
      .trim()
      .transform((v) => v.replace(/^@/, ''))
      .pipe(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{3,31}$/, 'имя бота: латиница, цифры и _'))
      .optional(),
    /**
     * Адрес Bot API вместо https://api.telegram.org — только локально и в тестах: сквозные тесты
     * подменяют Telegram своим сервером-подделкой (e2e/fake-telegram.ts).
     */
    TELEGRAM_API_BASE: z.url().optional(),
    SENTRY_DSN: z.string().min(1).optional(),
    /** Зафиксировать «сейчас» (демо-стенд, сквозные тесты). На рабочем сайте запрещено. */
    FIXED_NOW: z.iso.datetime().optional(),
  })
  .extend(DatabaseFields.shape)
  .extend(StorageEnv.shape)
  .superRefine((env, ctx) => {
    if (env.APP_ENV === 'production' && env.FIXED_NOW) {
      ctx.addIssue({
        code: 'custom',
        path: ['FIXED_NOW'],
        message: 'на рабочем сайте время не фиксируется',
      });
    }
    if (
      (env.APP_ENV === 'staging' || env.APP_ENV === 'production') &&
      (env.CRON_SECRET.length < 32 || /change-me/i.test(env.CRON_SECRET))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['CRON_SECRET'],
        message:
          'на стенде и рабочем сайте — своя случайная строка от 32 символов, не из .env.example',
      });
    }
    if (
      (env.APP_ENV === 'staging' || env.APP_ENV === 'production') &&
      !env.APP_BASE_URL.startsWith('https://')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_BASE_URL'],
        message:
          'на стенде и рабочем сайте — адрес сайта по https (по нему сверяется Origin и ставится cookie входа)',
      });
    }
    if (env.APP_ENV === 'staging' || env.APP_ENV === 'production') {
      if (env.TELEGRAM_API_BASE) {
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_API_BASE'],
          message: 'на стенде и рабочем сайте бот говорит только с api.telegram.org — не задаётся',
        });
      }
      // Имя бота из примера может занять кто угодно: ссылка привязки с токеном ушла бы чужому боту
      // (регистр в именах Telegram не важен).
      if (env.TELEGRAM_BOT_USERNAME?.toLowerCase() === EXAMPLE_BOT_USERNAME) {
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_BOT_USERNAME'],
          message: 'на стенде и рабочем сайте — имя своего бота, не из .env.example',
        });
      }
      if (env.TELEGRAM_BOT_TOKEN && /change-me/i.test(env.TELEGRAM_BOT_TOKEN)) {
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_BOT_TOKEN'],
          message: 'на стенде и рабочем сайте — токен своего бота от BotFather, не из .env.example',
        });
      }
      // Секрет из .env.example открыт всем: с ним кто угодно прислал бы сайту поддельное сообщение бота.
      const secret = env.TELEGRAM_WEBHOOK_SECRET;
      if (secret && (secret.length < 32 || /change-me/i.test(secret))) {
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_WEBHOOK_SECRET'],
          message:
            'на стенде и рабочем сайте — своя случайная строка от 32 символов, не из .env.example',
        });
      }
    }
    for (const key of ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_USERNAME'] as const) {
      if (Boolean(env.TELEGRAM_BOT_TOKEN) !== Boolean(env[key])) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message:
            'TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и TELEGRAM_BOT_USERNAME задаются вместе',
        });
      }
    }
    checkDemoPassword(env, ctx);
  });

export type AppConfig = z.infer<typeof AppEnv>;
export type DatabaseConfig = z.infer<typeof DatabaseEnv>;
export type StorageConfig = z.infer<typeof StorageEnv>;

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Не хватает настроек окружения или они неверны:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'ConfigError';
  }
}

function parse<T extends z.ZodType>(schema: T, env: Env): z.infer<T> {
  // Пустая строка в .env означает «не задано».
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`),
    );
  }
  return result.data;
}

/** Полная конфигурация веб-приложения, API и worker. */
export function loadConfig(env: Env = process.env): AppConfig {
  return parse(AppEnv, env);
}

/** Настройки для инструментов базы (миграции, наполнение, тесты базы). */
export function loadDatabaseConfig(env: Env = process.env): DatabaseConfig {
  return parse(DatabaseEnv, env);
}

/** Настройки хранилища (тесты хранилища, подготовка корзины). */
export function loadStorageConfig(env: Env = process.env): StorageConfig {
  return parse(StorageEnv, env);
}

/** Есть ли в окружении всё для хранилища — для необязательных интеграционных тестов. */
export function hasStorageEnv(env: Env = process.env): boolean {
  return StorageEnv.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v))).success;
}

/** Есть ли в окружении всё для базы. */
export function hasDatabaseEnv(env: Env = process.env): boolean {
  return Boolean(env.DATABASE_URL && env.DATABASE_ADMIN_URL);
}

/** В CI интеграционные тесты обязательны: без окружения они падают, а не пропускаются. */
export function integrationTestsRequired(env: Env = process.env): boolean {
  return env.REQUIRE_INTEGRATION_TESTS === '1';
}
