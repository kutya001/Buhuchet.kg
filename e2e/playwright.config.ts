import { defineConfig, devices } from '@playwright/test';

const DESKTOP = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } };
const MOBILE = { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } };
/** Тесты, которые меняют общую запись демо-организации. */
const SHARED = /\.shared\.spec\.ts$/;

// Сквозные тесты идут против уже запущенного приложения: в CI — docker-compose (как на VPS),
// локально — `pnpm dev` или `docker compose --profile app up`. Адрес — E2E_BASE_URL.
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: '../playwright-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'ru-RU',
    timezoneId: 'Asia/Bishkek',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Подделка Telegram Bot API (fake-telegram.ts): бот сайта из .env.example шлёт сообщения ей.
  webServer: {
    command: 'node fake-telegram.ts',
    url: 'http://127.0.0.1:8091/health',
    reuseExistingServer: true,
    stdout: 'ignore',
  },
  // Каждый пункт приёмки проверяется на ПК (1280 px) и телефоне (390 px). Тесты, которые меняют общую
  // запись демо-организации (учётная политика, адрес страницы, настройки), — в файлах *.shared.spec.ts:
  // они идут после всех остальных и по одному (сначала ПК, потом телефон), чтобы выключенный на время
  // модуль не попал в чужую проверку меню или прав.
  projects: [
    { name: 'desktop', use: DESKTOP, testIgnore: SHARED },
    { name: 'mobile', use: MOBILE, testIgnore: SHARED },
    {
      name: 'desktop-shared',
      use: DESKTOP,
      testMatch: SHARED,
      dependencies: ['desktop', 'mobile'],
    },
    { name: 'mobile-shared', use: MOBILE, testMatch: SHARED, dependencies: ['desktop-shared'] },
  ],
});
