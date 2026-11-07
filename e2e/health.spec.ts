import { expect, test } from '@playwright/test';
import { platformAdmin } from './admin';

test.describe('Этап 0: приложение работает на любой площадке', () => {
  // Без входа — только «работает или нет»; подробности — администратору платформы
  // (docs/deviations.md п. О-9, их проверяет тест API).
  test('страница «здоровья» показывает, что база и хранилище работают', async ({ page }) => {
    await page.goto('/health');
    await expect(page.getByRole('heading', { name: 'Проверка работы системы' })).toBeVisible();
    await expect(page.getByTestId('health')).toContainText('Всё работает');
    await expect(page.getByTestId('check-database')).toHaveCount(0);
  });

  test('администратор платформы видит на странице «здоровья» проверки, версию и среду', async ({
    page,
    baseURL,
  }) => {
    await platformAdmin(page.request, new URL(baseURL!).origin);
    await page.goto('/health');
    await expect(page.getByTestId('health')).toContainText('Всё работает');
    await expect(page.getByTestId('check-database')).toBeVisible();
    await expect(page.getByTestId('check-storage')).toBeVisible();
  });

  test('API здоровья отвечает 200 и не кэшируется', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('подробности «здоровья» и описание API без входа закрыты', async ({ request }) => {
    expect((await request.get('/api/admin/health')).status()).toBe(401);
    expect((await request.get('/api/openapi.json')).status()).toBe(401);
  });

  test('сайт не индексируется', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(await robots.text()).toContain('Disallow: /');
  });

  test('страницы нельзя встроить в чужой сайт', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('запуск задач по расписанию требует секрет планировщика', async ({ request }) => {
    const res = await request.post('/api/cron/tick');
    expect(res.status()).toBe(401);
  });
});
