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

  it('кнопки под сообщением: нажатие, копирование, ссылка, неактивная кнопка', async () => {
    const fetch = fetchReturning({ ok: true, result: { message_id: 7 } });
    const bot = createTelegramBotApi({ token: '1:abc', fetch });
    await bot.sendMessage(100, 'Отчёт', {
      keyboard: [
        [
          { text: 'Сдан', data: 'repDone:r1' },
          { text: 'Готово', data: 'off', disabled: true },
        ],
        [
          { text: 'Скопировать код', copy: '482913' },
          { text: 'Открыть', url: 'https://buhuchet.kg' },
        ],
        [],
      ],
    });
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body)).reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: 'Сдан', callback_data: 'repDone:r1' },
          { text: 'Готово', callback_data: 'off', disabled: {} },
        ],
        [
          { text: 'Скопировать код', copy_text: { text: '482913' } },
          { text: 'Открыть', url: 'https://buhuchet.kg' },
        ],
      ],
    });
  });

  it('код подтверждения — моноширинный, остальной текст экранируется', async () => {
    const fetch = fetchReturning({ ok: true, result: { message_id: 7 } });
    const bot = createTelegramBotApi({ token: '1:abc', fetch });
    await bot.sendMessage(100, '482913 — код для «A&B» <x>', { code: '482913' });
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toMatchObject({
      text: '<code>482913</code> — код для «A&amp;B» &lt;x&gt;',
      parse_mode: 'HTML',
    });
    // Кода в тексте нет — обычный текст без разметки.
    await bot.sendMessage(100, 'Текст <b>', { code: '111111' });
    const plain = JSON.parse(String(fetch.mock.calls[1]![1].body));
    expect(plain.text).toBe('Текст <b>');
    expect(plain.parse_mode).toBeUndefined();
  });

  it('вид с таблицами — sendRichMessage; не принят — тот же текст обычным сообщением с кнопками', async () => {
    const keyboard = [[{ text: 'Проверить кнопки', data: 'test' }]];
    const ok = fetchReturning({ ok: true, result: { message_id: 9 } });
    const rich = createTelegramBotApi({ token: '1:abc', fetch: ok });
    expect(
      await rich.sendMessage(100, 'простой', {
        rich: '<table><tr><td>а</td></tr></table>',
        keyboard,
      }),
    ).toEqual({ ok: true, messageId: 9 });
    expect(ok.mock.calls).toHaveLength(1);
    expect(ok.mock.calls[0]![0]).toBe('https://api.telegram.org/bot1:abc/sendRichMessage');
    expect(JSON.parse(String(ok.mock.calls[0]![1].body))).toEqual({
      chat_id: 100,
      rich_message: { html: '<table><tr><td>а</td></tr></table>' },
      reply_markup: { inline_keyboard: [[{ text: 'Проверить кнопки', callback_data: 'test' }]] },
    });

    for (const code of [400, 404]) {
      const replies = [
        { ok: false, error_code: code, description: 'Bad Request: rich message is not supported' },
        { ok: true, result: { message_id: 10 } },
      ];
      const fetch = vi.fn(
        async (_url: string, _init: RequestInit) => new Response(JSON.stringify(replies.shift())),
      );
      const bot = createTelegramBotApi({ token: '1:abc', fetch });
      expect(await bot.sendMessage(100, 'простой', { rich: '<table></table>', keyboard })).toEqual({
        ok: true,
        messageId: 10,
      });
      expect(fetch.mock.calls[1]![0]).toBe('https://api.telegram.org/bot1:abc/sendMessage');
      expect(JSON.parse(String(fetch.mock.calls[1]![1].body))).toMatchObject({
        text: 'простой',
        reply_markup: { inline_keyboard: [[{ text: 'Проверить кнопки', callback_data: 'test' }]] },
      });
    }

    // Лимит и блокировка бота — не про вид сообщения: второй попытки нет.
    const limited = fetchReturning({
      ok: false,
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 5 },
    });
    const bot = createTelegramBotApi({ token: '1:abc', fetch: limited });
    expect(await bot.sendMessage(100, 'простой', { rich: '<table></table>' })).toMatchObject({
      ok: false,
      retryAfterSeconds: 5,
    });
    expect(limited.mock.calls).toHaveLength(1);
  });

  it('ответ на нажатие и правка кнопок', async () => {
    const fetch = fetchReturning({ ok: true, result: true });
    const bot = createTelegramBotApi({ token: '1:abc', fetch });
    expect(await bot.answerCallback('cb1')).toBe(true);
    expect(await bot.answerCallback('cb2', 'Нет права', { alert: true })).toBe(true);
    expect(
      await bot.editKeyboard(100, 7, [[{ text: 'Сдан ✓', data: 'off', disabled: true }]]),
    ).toBe(true);
    const bodies = fetch.mock.calls.map(([url, init]) => [
      url.split('/').pop(),
      JSON.parse(String(init.body)),
    ]);
    expect(bodies).toEqual([
      ['answerCallbackQuery', { callback_query_id: 'cb1' }],
      ['answerCallbackQuery', { callback_query_id: 'cb2', text: 'Нет права', show_alert: true }],
      [
        'editMessageReplyMarkup',
        {
          chat_id: 100,
          message_id: 7,
          reply_markup: {
            inline_keyboard: [[{ text: 'Сдан ✓', callback_data: 'off', disabled: {} }]],
          },
        },
      ],
    ]);
    const refused = createTelegramBotApi({
      token: '1:abc',
      fetch: fetchReturning({ ok: false, error_code: 400, description: 'query is too old' }),
    });
    expect(await refused.answerCallback('cb3', 'x')).toBe(false);
    expect(await refused.editKeyboard(100, 7, [])).toBe(false);
  });

  it('loadFile: getFile и скачивание по пути файла; содержимое — без адреса с токеном', async () => {
    const fetch = vi.fn(async (url: string, _init: RequestInit) =>
      url.endsWith('/getFile')
        ? new Response(
            JSON.stringify({
              ok: true,
              result: { file_path: 'documents/file 1.pdf', file_size: 3 },
            }),
          )
        : new Response(new Uint8Array([1, 2, 3])),
    );
    const bot = createTelegramBotApi({ token: '1:abc', fetch });
    const res = await bot.loadFile('FILE', 20);
    expect(res).toEqual({ ok: true, body: new Uint8Array([1, 2, 3]) });
    expect(fetch.mock.calls[0]![0]).toBe('https://api.telegram.org/bot1:abc/getFile');
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toEqual({ file_id: 'FILE' });
    expect(fetch.mock.calls[1]![0]).toBe(
      'https://api.telegram.org/file/bot1:abc/documents/file%201.pdf',
    );
    expect(fetch.mock.calls[1]![1]).toMatchObject({ method: 'GET' });
    expect(fetch.mock.calls[1]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it('loadFile: больше предела — по словам Telegram, по заголовку и по фактическому размеру', async () => {
    const file = (info: unknown, body: Response) =>
      createTelegramBotApi({
        token: 't',
        fetch: vi.fn(async (url: string) =>
          url.endsWith('/getFile') ? new Response(JSON.stringify(info)) : body,
        ),
      });
    const tooLarge = { ok: false, reason: 'too_large', description: '' };
    const path = { ok: true, result: { file_path: 'a.pdf' } };
    expect(
      await file(
        { ok: true, result: { file_path: 'a.pdf', file_size: 11 } },
        new Response(),
      ).loadFile('f', 10),
    ).toEqual(tooLarge);
    expect(
      await file(
        { ok: false, error_code: 400, description: 'Bad Request: file is too big' },
        new Response(),
      ).loadFile('f', 10),
    ).toEqual(tooLarge);
    expect(
      await file(
        path,
        new Response(new Uint8Array(2), { headers: { 'content-length': '11' } }),
      ).loadFile('f', 10),
    ).toEqual(tooLarge);
    expect(await file(path, new Response(new Uint8Array(11))).loadFile('f', 10)).toEqual(tooLarge);
  });

  it('loadFile: ошибка Telegram, чужой путь и сбой сети — отказ без токена в тексте', async () => {
    const bot = (fetch: (url: string) => Promise<Response>) =>
      createTelegramBotApi({ token: '1:secret', fetch: vi.fn(fetch) });
    const info = (result: unknown) => new Response(JSON.stringify(result));
    expect(
      await bot(async () =>
        info({ ok: false, error_code: 400, description: 'wrong file_id' }),
      ).loadFile('f', 10),
    ).toEqual({ ok: false, reason: 'failed', description: 'getFile: 400 wrong file_id' });
    // Путь встаёт в адрес после токена: «..», начало с «/» и посторонние знаки не принимаются.
    for (const path of ['../bot2:x/getMe', '/etc/passwd', 'a?b=1', 'a#b', 'a\\b']) {
      const calls: string[] = [];
      const res = await bot(async (url) => {
        calls.push(url);
        return info({ ok: true, result: { file_path: path } });
      }).loadFile('f', 10);
      expect(res).toMatchObject({ ok: false, reason: 'failed' });
      expect(calls).toHaveLength(1);
    }
    expect(
      await bot(async (url) =>
        url.endsWith('/getFile')
          ? info({ ok: true, result: { file_path: 'a.pdf' } })
          : new Response('', { status: 404 }),
      ).loadFile('f', 10),
    ).toEqual({ ok: false, reason: 'failed', description: 'файл: HTTP 404' });
    const down = await bot(async (url) => {
      if (url.endsWith('/getFile')) return info({ ok: true, result: { file_path: 'a.pdf' } });
      throw new TypeError(`fetch failed ${url}`);
    }).loadFile('f', 10);
    expect(down).toEqual({
      ok: false,
      reason: 'failed',
      description: 'fetch failed https://api.telegram.org/file/bot<скрыт>/a.pdf',
    });
    expect(JSON.stringify(down)).not.toContain('1:secret');
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

  it('ошибка сети: токен бота из адреса в текст и причину ошибки не попадает', async () => {
    const fetch = vi.fn(async (url: string) => {
      throw new TypeError(`Failed to parse URL from ${url}`, { cause: new Error(url) });
    });
    const bot = createTelegramBotApi({ token: '1:secret', fetch });
    const err = await bot.sendMessage(100, 'Текст').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('TypeError');
    expect((err as Error).message).toBe(
      'Failed to parse URL from https://api.telegram.org/bot<скрыт>/sendMessage',
    );
    expect((err as Error).cause).toBeUndefined();
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('1:secret');
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

  it('getWebhookInfo: адрес, последняя ошибка и её время; ошибка Bot API — исключение', async () => {
    const fetch = fetchReturning({
      ok: true,
      result: {
        url: 'https://test.buhuchet.kg/api/telegram/webhook',
        pending_update_count: 2,
        last_error_date: 1_793_512_800,
        last_error_message: 'Wrong response from the webhook: 502 Bad Gateway',
      },
    });
    const info = await createTelegramBotApi({
      token: 't',
      fetch,
      apiBase: 'http://tg.local',
    }).getWebhookInfo();
    expect(fetch.mock.calls[0]![0]).toBe('http://tg.local/bott/getWebhookInfo');
    expect(info).toEqual({
      url: 'https://test.buhuchet.kg/api/telegram/webhook',
      pendingUpdates: 2,
      lastErrorAt: new Date(1_793_512_800 * 1000),
      lastError: 'Wrong response from the webhook: 502 Bad Gateway',
    });
    const empty = await createTelegramBotApi({
      token: 't',
      fetch: fetchReturning({ ok: true, result: { url: '' } }),
    }).getWebhookInfo();
    expect(empty).toEqual({ url: '', pendingUpdates: 0, lastErrorAt: null, lastError: null });
    const failing = createTelegramBotApi({
      token: 't',
      fetch: fetchReturning({ ok: false, error_code: 401, description: 'Unauthorized' }),
    });
    await expect(failing.getWebhookInfo()).rejects.toThrow(/Unauthorized/);
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
    expect(tg.messageIds).toEqual([1]);
    await tg.answerCallback('cb', 'Готово', { alert: true });
    await tg.editKeyboard(1, 1, [[{ text: 'к', data: 'off', disabled: true }]]);
    expect(tg.answers).toEqual([{ callbackId: 'cb', text: 'Готово', alert: true }]);
    expect(tg.edits).toEqual([
      { chatId: 1, messageId: 1, keyboard: [[{ text: 'к', data: 'off', disabled: true }]] },
    ]);
    await tg.setWebhook('u', 's');
    expect(tg.webhook).toEqual({ url: 'u', secretToken: 's' });
    expect(await tg.getWebhookInfo()).toEqual({
      url: 'u',
      pendingUpdates: 0,
      lastErrorAt: null,
      lastError: null,
    });
    tg.webhookInfo = { lastError: 'x' };
    expect((await tg.getWebhookInfo()).lastError).toBe('x');
    tg.webhookInfo = new Error('down');
    await expect(tg.getWebhookInfo()).rejects.toThrow('down');
    // Файлы, «присланные боту»: содержимое по номеру файла, предел размера.
    tg.files.set('f1', new Uint8Array(5));
    expect(await tg.loadFile('f1', 5)).toEqual({ ok: true, body: new Uint8Array(5) });
    expect(await tg.loadFile('f1', 4)).toMatchObject({ ok: false, reason: 'too_large' });
    expect(await tg.loadFile('нет', 5)).toMatchObject({ ok: false, reason: 'failed' });
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
