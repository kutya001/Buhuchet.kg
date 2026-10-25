import { defineConfig, devices } from '@playwright/test';

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
  // Каждый пункт приёмки проверяется на ПК (1280 px) и телефоне (390 px).
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
});
