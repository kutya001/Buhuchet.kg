import { expect, test } from '@playwright/test';

type Dictionary = { lang: string; version: string; texts: Record<string, string> };

test.describe('Этап 1: словарь текстов интерфейса', () => {
  test('словарь открыт без входа и перепроверяется по версии (ETag, 304)', async ({ request }) => {
    const res = await request.get('/api/l10n');
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('no-cache');
    const body = (await res.json()) as Dictionary;
    expect(body.lang).toBe('ru');
    expect(res.headers()['etag']).toBe(`"${body.version}"`);
    // Тексты прототипа (refDB.json) и тексты экранов продукта.
    expect(body.texts['nav.home']).toBe('Главная');
    expect(body.texts['health.title']).toBeTruthy();

    const again = await request.get('/api/l10n', {
      headers: { 'if-none-match': res.headers()['etag']! },
    });
    expect(again.status()).toBe(304);
  });

  test('страница приходит с текстами словаря в первом ответе, без мигания', async ({
    page,
    request,
  }) => {
    const { texts } = (await (await request.get('/api/l10n')).json()) as Dictionary;
    // Страница собирается на каждый запрос, и её разметка до выполнения скриптов уже содержит
    // тексты словаря: заголовок — готовым элементом h1, а не только в данных для браузера.
    const res = await request.get('/health');
    expect(res.headers()['cache-control']).toContain('no-store');
    const html = await res.text();
    const title = texts['health.title']!;
    expect(html).toMatch(
      new RegExp(`<h1[^>]*>${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`),
    );
    expect(html).toContain(`content="${texts['app.description']}"`);

    await page.goto('/health');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(texts['health.title']!);
    await expect(page.getByTestId('check-database')).toContainText(texts['health.check.database']!);
  });
});
