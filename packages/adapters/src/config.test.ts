import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  hasDatabaseEnv,
  hasStorageEnv,
  integrationTestsRequired,
  loadConfig,
  loadDatabaseConfig,
  loadStorageConfig,
} from './config';

const base = {
  APP_ENV: 'local',
  DATABASE_URL: 'postgres://app:app@localhost:5432/buhuchet',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'buhuchet',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  CRON_SECRET: 'local-cron-secret-0000',
};

describe('loadConfig', () => {
  it('заполняет значения по умолчанию', () => {
    const cfg = loadConfig(base);
    expect(cfg.APP_ENV).toBe('local');
    expect(cfg.S3_FORCE_PATH_STYLE).toBe(true);
    expect(cfg.DATABASE_POOL_MAX).toBe(5);
    expect(cfg.LOG_LEVEL).toBe('info');
  });

  it('перечисляет все недостающие настройки сразу', () => {
    try {
      loadConfig({ DATABASE_URL: '' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const problems = (e as ConfigError).problems.join('\n');
      expect(problems).toContain('DATABASE_URL');
      expect(problems).toContain('S3_BUCKET');
      expect(problems).toContain('CRON_SECRET');
    }
  });

  it('APP_ENV обязательна', () => {
    const { APP_ENV: _omit, ...withoutEnv } = base;
    expect(() => loadConfig(withoutEnv)).toThrow(/APP_ENV/);
  });

  it('на стенде и рабочем сайте секрет планировщика не примерный и не короткий', () => {
    const strong = 'f'.repeat(40);
    for (const APP_ENV of ['staging', 'production']) {
      expect(() =>
        loadConfig({ ...base, APP_ENV, CRON_SECRET: 'local-cron-secret-change-me-0000000000' }),
      ).toThrow(/CRON_SECRET/);
      expect(() => loadConfig({ ...base, APP_ENV, CRON_SECRET: 'short-secret-0000' })).toThrow(
        /CRON_SECRET/,
      );
      expect(loadConfig({ ...base, APP_ENV, CRON_SECRET: strong }).CRON_SECRET).toBe(strong);
    }
  });

  it('запрещает фиксированное время на рабочем сайте', () => {
    expect(() =>
      loadConfig({ ...base, APP_ENV: 'production', FIXED_NOW: '2026-10-18T06:00:00Z' }),
    ).toThrow(/FIXED_NOW/);
    expect(
      loadConfig({
        ...base,
        APP_ENV: 'staging',
        CRON_SECRET: 's'.repeat(32),
        FIXED_NOW: '2026-10-18T06:00:00Z',
      }).FIXED_NOW,
    ).toBe('2026-10-18T06:00:00Z');
  });

  it('токен бота и секрет вебхука задаются вместе', () => {
    expect(() => loadConfig({ ...base, TELEGRAM_BOT_TOKEN: '1:abc' })).toThrow(
      /TELEGRAM_WEBHOOK_SECRET/,
    );
    const cfg = loadConfig({
      ...base,
      TELEGRAM_BOT_TOKEN: '1:abc',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-0000',
    });
    expect(cfg.TELEGRAM_BOT_TOKEN).toBe('1:abc');
  });

  it('S3_FORCE_PATH_STYLE понимает false и 0, регистр и пробелы не важны', () => {
    expect(loadConfig({ ...base, S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE).toBe(false);
    expect(loadConfig({ ...base, S3_FORCE_PATH_STYLE: '0' }).S3_FORCE_PATH_STYLE).toBe(false);
    expect(loadConfig({ ...base, S3_FORCE_PATH_STYLE: ' True\n' }).S3_FORCE_PATH_STYLE).toBe(true);
    expect(() => loadConfig({ ...base, S3_FORCE_PATH_STYLE: 'да' })).toThrow(ConfigError);
  });
});

describe('частичные конфигурации', () => {
  it('база и хранилище читаются по отдельности', () => {
    expect(
      loadDatabaseConfig({ APP_ENV: 'test', DATABASE_URL: 'postgres://x' }).DATABASE_POOL_MAX,
    ).toBe(5);
    expect(loadStorageConfig(base).S3_REGION).toBe('us-east-1');
    expect(() => loadStorageConfig({})).toThrow(ConfigError);
  });

  it('ключи и регион S3 без пробелов и перевода строки по краям (вставка копированием)', () => {
    const cfg = loadStorageConfig({
      ...base,
      S3_REGION: ' eu-west-1\n',
      S3_ACCESS_KEY_ID: 'key\n',
      S3_SECRET_ACCESS_KEY: '  secret \r\n',
    });
    expect(cfg.S3_REGION).toBe('eu-west-1');
    expect(cfg.S3_ACCESS_KEY_ID).toBe('key');
    expect(cfg.S3_SECRET_ACCESS_KEY).toBe('secret');
    expect(() => loadStorageConfig({ ...base, S3_SECRET_ACCESS_KEY: ' \n' })).toThrow(ConfigError);
  });

  it('признаки наличия окружения', () => {
    expect(hasStorageEnv(base)).toBe(true);
    expect(hasStorageEnv({})).toBe(false);
    expect(hasDatabaseEnv({ DATABASE_URL: 'a', DATABASE_ADMIN_URL: 'b' })).toBe(true);
    expect(hasDatabaseEnv({ DATABASE_URL: 'a' })).toBe(false);
    expect(integrationTestsRequired({ REQUIRE_INTEGRATION_TESTS: '1' })).toBe(true);
    expect(integrationTestsRequired({})).toBe(false);
  });
});
