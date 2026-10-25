import { expect, test } from '@playwright/test';

// Вход и сеансы через настоящий сайт (Next.js → API): cookie, общий слой и проверка Origin.
// Демо-организация наполняется с DEMO_PASSWORD (в CI — из .env.example). Неверные пароли здесь не
// вводятся: пять неверных подряд закрыли бы вход демо-сотруднику на 15 минут — это проверяют тесты
// API против базы (packages/api/src/modules/auth/auth.test.ts).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo';

test.describe('Этап 1: вход и сеансы (API)', () => {
  test('демо-сотрудник входит, «кто я» отвечает по cookie, после выхода cookie не действует', async ({
    request,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const login = await request.post('/api/auth/login', {
      headers: { origin },
      data: { login: 'meerim', password: DEMO_PASSWORD },
    });
    expect(login.status()).toBe(200);
    const setCookie = login.headers()['set-cookie'] ?? '';
    expect(setCookie).toMatch(/bh_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(await login.json()).toMatchObject({
      user: { login: 'meerim', mustChangePassword: false },
      employee: { roleName: 'Главный бухгалтер' },
    });

    const me = await request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    expect(me.headers()['cache-control']).toBe('no-store');

    const state = await request.storageState();
    const out = await request.post('/api/auth/logout', { headers: { origin } });
    expect(out.status()).toBe(200);
    expect((await request.get('/api/auth/me')).status()).toBe(401);

    // Старая cookie, отправленная снова, тоже не действует.
    const old = state.cookies.find((c) => c.name.endsWith('bh_session'))!;
    const replay = await request.get('/api/auth/me', {
      headers: { cookie: `${old.name}=${old.value}` },
    });
    expect(replay.status()).toBe(401);
  });

  test('без входа методы отвечают 401, неизвестный логин — «Нет такого логина»', async ({
    request,
    baseURL,
  }) => {
    const me = await request.get('/api/auth/me');
    expect(me.status()).toBe(401);
    expect(await me.json()).toMatchObject({ error: { code: 'unauthorized' } });

    const unknown = await request.post('/api/auth/login', {
      headers: { origin: new URL(baseURL!).origin },
      data: { login: 'no-such-user', password: 'whatever' },
    });
    expect(unknown.status()).toBe(401);
    expect(await unknown.json()).toMatchObject({
      error: { code: 'unknown_login', message: 'Нет такого логина' },
    });
  });

  test('вход с чужого сайта отклоняется', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      headers: { origin: 'https://evil.example' },
      data: { login: 'meerim', password: DEMO_PASSWORD },
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'origin_mismatch' } });
  });
});
