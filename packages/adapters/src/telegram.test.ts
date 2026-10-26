import { describe, expect, it, vi } from 'vitest';
import { createFakeTelegram, createTelegramBotApi, isValidWebhookSecret } from './telegram';

function fetchReturning(body: unknown) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body)));
}

describe('createTelegramBotApi', () => {
  it('отправляет sendMessage и возвращает номер сообщения', async () => {
    const fetch = fetchReturning({ ok: true, result: { message_id: 42 } });
    const bot = createTelegramBotApi({ token: '1:abc', fetch });
    const res = await bot.sendMessage(100, '<b>Срок</b>', { html: true });
    expect(res).toEqual({ ok: true, messageId: 42 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.telegram.org/bot1:abc/sendMessage');
    expect(JSON.parse(String(init.body))).toMatchObject({
      chat_id: 100,
      text: '<b>Срок</b>',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  it('не ждёт Telegram дольше заданного: запрос прерывается', async () => {
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const bot = createTelegramBotApi({ token: 't', fetch: hanging });
    await expect(bot.sendMessage(1, 'код', { timeoutMs: 20 })).rejects.toThrow();
    expect(hanging.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it('429 — повторить позже, 403 — повтор бессмыслен', async () => {
    const limited = createTelegramBotApi({
      token: 't',
      fetch: fetchReturning({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 7 },
      }),
    });
    expect(await limited.sendMessage(1, 'x')).toEqual({
      ok: false,
      errorCode: 429,
      description: 'Too Many Requests',
      retryAfterSeconds: 7,
      permanent: false,
    });
    const blocked = createTelegramBotApi({
      token: 't',
      fetch: fetchReturning({
        ok: false,
        error_code: 403,
        description: 'bot was blocked by the user',
      }),
    });
    expect(await blocked.sendMessage(1, 'x')).toMatchObject({ ok: false, permanent: true });
    const unknown = createTelegramBotApi({ token: 't', fetch: fetchReturning({ ok: false }) });
    expect(await unknown.sendMessage(1, 'x')).toMatchObject({
      ok: false,
      errorCode: 0,
      permanent: false,
    });
  });

  it('setWebhook передаёт секрет и падает при ошибке', async () => {
    const fetch = fetchReturning({ ok: true, result: true });
    await createTelegramBotApi({ token: 't', fetch, apiBase: 'http://tg.local' }).setWebhook(
      'https://test.buhuchet.kg/api/telegram/webhook',
      'secret',
    );
    expect(fetch.mock.calls[0]![0]).toBe('http://tg.local/bott/setWebhook');
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toMatchObject({
      secret_token: 'secret',
    });
    const failing = createTelegramBotApi({
      token: 't',
      fetch: fetchReturning({ ok: false, description: 'bad url' }),
    });
    await expect(failing.setWebhook('x', 'y')).rejects.toThrow(/bad url/);
  });
});

describe('createFakeTelegram', () => {
  it('запоминает сообщения и имитирует ошибки', async () => {
    const tg = createFakeTelegram();
    tg.failNext({
      ok: false,
      errorCode: 429,
      description: 'limit',
      retryAfterSeconds: 3,
      permanent: false,
    });
    expect(await tg.sendMessage(1, 'a')).toMatchObject({ ok: false, retryAfterSeconds: 3 });
    expect(await tg.sendMessage(1, 'b')).toEqual({ ok: true, messageId: 1 });
    expect(tg.sent).toEqual([{ chatId: 1, text: 'b', options: {} }]);
    await tg.setWebhook('u', 's');
    expect(tg.webhook).toEqual({ url: 'u', secretToken: 's' });
  });
});

describe('isValidWebhookSecret', () => {
  it('сравнивает секрет целиком', () => {
    expect(isValidWebhookSecret('webhook-secret', 'webhook-secret')).toBe(true);
    expect(isValidWebhookSecret('webhook-secreT', 'webhook-secret')).toBe(false);
    expect(isValidWebhookSecret('short', 'webhook-secret')).toBe(false);
    expect(isValidWebhookSecret(undefined, 'webhook-secret')).toBe(false);
  });
});
