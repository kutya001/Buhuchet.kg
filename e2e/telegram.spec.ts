import { expect, test } from '@playwright/test';

// Telegram и «Забыли пароль?» через настоящий сайт. Бот в сквозных тестах не подключён (как на стенде,
// пока нет токена), а демо-сотрудникам Telegram не привязывается: код и привязку по ссылке проверяют
// тесты API с ботом-подделкой (packages/api/src/modules/auth/reset.test.ts, modules/telegram).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo';

test.describe('Этап 1: Telegram и «Забыли пароль?» (API)', () => {
  test('«Забыли пароль?» отвечает одинаково для любого логина (п. 4 расхождений, решение Б)', async ({
    request,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    // Без бота кода не будет ни у кого — об этом и ответ, логин не важен.
    for (const login of ['nurlan', 'erkin', 'no-such-user']) {
      const res = await request.post('/api/auth/password-reset', {
        headers: { origin },
        data: { login },
      });
      expect(res.status()).toBe(503);
      expect(await res.json()).toMatchObject({ error: { code: 'telegram_unavailable' } });
    }
    for (const login of ['nurlan', 'no-such-user']) {
      const res = await request.post('/api/auth/password-reset/confirm', {
        headers: { origin },
        data: { login, code: '123456', newPassword: 'Новый-пароль-2' },
      });
      expect(res.status()).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: 'reset_code_invalid', message: 'Код неверный или истёк' },
      });
    }
  });

  test('без бота ссылка привязки недоступна, а вебхук не принимается', async ({
    request,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const login = await request.post('/api/auth/login', {
      headers: { origin },
      data: { login: 'meerim', password: DEMO_PASSWORD },
    });
    expect(login.status()).toBe(200);
    expect((await login.json()).telegram).toBeNull();
    const link = await request.post('/api/telegram/link', { headers: { origin } });
    expect(link.status()).toBe(503);
    expect(await link.json()).toMatchObject({ error: { code: 'telegram_unavailable' } });
    await request.post('/api/auth/logout', { headers: { origin } });

    const webhook = await request.post('/api/telegram/webhook', {
      data: { update_id: 1, message: { text: '/start', chat: { id: 1, type: 'private' } } },
    });
    expect(webhook.status()).toBe(404);
  });
});
