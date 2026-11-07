import { expect, test } from '@playwright/test';
import {
  botMessages,
  hire,
  pressStart,
  linkTelegram,
  signIn,
  tellBot,
  uniqueChat,
  uniqueLogin,
  WEBHOOK_SECRET,
} from './helpers';

// Telegram и «Забыли пароль?» через настоящий сайт с ботом-подделкой (fake-telegram.ts): сайт шлёт
// сообщения бота ей, тесты их читают. Демо-сотрудникам Telegram не привязывается — привязывают
// новые сотрудники. Код из Telegram до входа с новым паролем — e2e/login.spec.ts.

test.describe('Этап 1: Telegram и «Забыли пароль?» (API)', () => {
  test('«Забыли пароль?» отвечает одинаково для любого логина (п. 4 расхождений, решение Б)', async ({
    request,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const answers = new Set<string>();
    for (const login of ['nurlan', 'erkin', `no-such-user-${Date.now()}`]) {
      const res = await request.post('/api/auth/password-reset', {
        headers: { origin },
        data: { login },
      });
      expect(res.status()).toBe(200);
      answers.add(JSON.stringify(await res.json()));
    }
    expect([...answers]).toEqual([
      JSON.stringify({
        message:
          'Если к логину привязан Telegram, бот пришлёт код. Если код не пришёл, пароль сбросит владелец организации.',
      }),
    ]);
    for (const login of ['nurlan', `no-such-user-${Date.now()}`]) {
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

  test('привязка по ссылке: бот привязывает чат и присылает подтверждение; «Отвязать» снимает привязку', async ({
    request,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const login = uniqueLogin('e2e-tg');
    const { temporaryPassword } = await hire(request, origin, login);
    await signIn(request, origin, login, temporaryPassword);
    // Пока временный пароль не сменён, привязать Telegram нельзя.
    expect((await request.post('/api/telegram/link', { headers: { origin } })).status()).toBe(403);
    await request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });

    const link = await request.post('/api/telegram/link', { headers: { origin } });
    expect(link.status()).toBe(200);
    const { url, expiresAt } = (await link.json()) as { url: string; expiresAt: string };
    expect(url).toMatch(/^https:\/\/t\.me\/\w+\?start=[\w-]+$/);
    const minutes = (new Date(expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    const chat = uniqueChat();
    expect((await pressStart(request, url, chat)).status()).toBe(200);
    const me = await (await request.get('/api/auth/me')).json();
    expect(me.telegram).toMatchObject({ name: `@e2e_${chat}` });
    await expect.poll(() => botMessages(request, chat)).toHaveLength(1);
    expect((await botMessages(request, chat))[0]).toContain(login);

    // Ссылка одноразовая: второй раз она не привязывает.
    const other = uniqueChat();
    expect((await pressStart(request, url, other)).status()).toBe(200);
    await expect.poll(() => botMessages(request, other)).toHaveLength(1);
    expect((await (await request.get('/api/auth/me')).json()).telegram).toMatchObject({
      name: `@e2e_${chat}`,
    });

    const unlink = await request.delete('/api/telegram/link', { headers: { origin } });
    expect(unlink.status()).toBe(200);
    expect((await (await request.get('/api/auth/me')).json()).telegram).toBeNull();
  });

  test('(решение заказчика 07.11.2026, Р-13 Б) другой Telegram вместо прежнего — только кодом, который бот прислал в прежний чат', async ({
    request,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const login = uniqueLogin('e2e-relink');
    const { temporaryPassword } = await hire(request, origin, login);
    await signIn(request, origin, login, temporaryPassword);
    await request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    const telegram = async () =>
      ((await (await request.get('/api/auth/me')).json()) as { telegram: unknown }).telegram;
    const first = uniqueChat();
    await linkTelegram(request, origin, first);
    expect(await telegram()).toMatchObject({ name: `@e2e_${first}` });

    // Ссылку открыли в другом Telegram: чат не сменился, код — в прежний чат, новый просит его.
    const second = uniqueChat();
    await linkTelegram(request, origin, second);
    expect(await telegram()).toMatchObject({ name: `@e2e_${first}` });
    await expect.poll(() => botMessages(request, first)).toHaveLength(2);
    const notice = (await botMessages(request, first))[1]!;
    expect(notice).toContain(`хотят привязать другой Telegram: @e2e_${second}`);
    const code = /код (\d{6})/.exec(notice)?.[1];
    expect(code, notice).toBeTruthy();
    await expect
      .poll(() => botMessages(request, second))
      .toEqual([expect.stringContaining('пришлите его сюда')]);

    // Неверный код — «Осталось попыток: 4»; верный из нового чата привязывает его.
    expect((await tellBot(request, second, code === '000000' ? '111111' : '000000')).status()).toBe(
      200,
    );
    await expect
      .poll(() => botMessages(request, second))
      .toEqual([expect.anything(), 'Неверный код. Осталось попыток: 4.']);
    expect((await tellBot(request, second, code!)).status()).toBe(200);
    expect(await telegram()).toMatchObject({ name: `@e2e_${second}` });
    await expect.poll(() => botMessages(request, first)).toHaveLength(3);
    expect((await botMessages(request, first))[2]).toContain(
      `привязан другой Telegram: @e2e_${second}`,
    );
    await expect.poll(() => botMessages(request, second)).toHaveLength(3);
    expect((await botMessages(request, second))[2]).toContain(login);
  });

  test('вебхук без секрета или с чужим секретом не принимается', async ({ request }) => {
    const update = {
      update_id: 1,
      message: { text: '/start', chat: { id: uniqueChat(), type: 'private' } },
    };
    expect((await request.post('/api/telegram/webhook', { data: update })).status()).toBe(401);
    const wrong = await request.post('/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': `${WEBHOOK_SECRET}-wrong` },
      data: update,
    });
    expect(wrong.status()).toBe(401);
  });
});
