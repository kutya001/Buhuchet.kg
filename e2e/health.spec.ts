import { expect, test } from '@playwright/test';

test.describe('Этап 0: приложение работает на любой площадке', () => {
  test('страница «здоровья» показывает, что база и хранилище доступны', async ({ page }) => {
    await page.goto('/health');
    await expect(page.getByRole('heading', { name: 'Проверка работы системы' })).toBeVisible();
    await expect(page.getByTestId('health')).toContainText('Всё работает');
    await expect(page.getByTestId('check-database')).toContainText('доступна');
    await expect(page.getByTestId('check-storage')).toContainText('доступна');
  });

  test('API здоровья отвечает 200 и не кэшируется', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('no-store');
    expect(await res.json()).toMatchObject({
      status: 'ok',
      checks: { database: 'ok', storage: 'ok' },
    });
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
