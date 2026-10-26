import { expect, test } from '@playwright/test';

// Telegram и «Забыли пароль?» через настоящий сайт. Бот в сквозных тестах не подключён (как на стенде,
// пока нет токена), а демо-сотрудникам Telegram не привязывается: код и привязку по ссылке проверяют
// тесты API с ботом-подделкой (packages/api/src/modules/auth/reset.test.ts, modules/telegram).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo';

test.describe('Этап 1: Telegram и «Забыли пароль?» (API)', () => {
  test('без привязанного Telegram «Забыли пароль?» объясняет, кто сбросит пароль', async ({
    request,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const ask = (login: string) =>
      request.post('/api/auth/password-reset', { headers: { origin }, data: { login } });

    const employee = await ask('nurlan');
    expect(employee.status()).toBe(409);
    expect(await employee.json()).toMatchObject({
      error: {
        code: 'telegram_not_linked',
        message: 'Telegram не привязан. Пароль сбросит владелец организации.',
      },
    });
    const owner = await ask('erkin');
    expect(await owner.json()).toMatchObject({
      error: { message: 'Telegram не привязан. Пароль сбросит администратор платформы.' },
    });
    const unknown = await ask('no-such-user');
    expect(unknown.status()).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { message: 'Нет такого логина' } });
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
