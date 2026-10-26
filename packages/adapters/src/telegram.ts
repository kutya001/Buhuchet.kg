import { timingSafeEqual } from 'node:crypto';

/**
 * Telegram: отправка сообщений ботом и проверка вебхука. Очередь, повторы и паузы под лимиты Telegram
 * живут в API и базе; переходник только отправляет одно сообщение и честно сообщает результат.
 */

export type TelegramSendResult =
  | { ok: true; messageId: number }
  | {
      ok: false;
      /** 429: подождать столько секунд и повторить. */
      retryAfterSeconds?: number;
      errorCode: number;
      description: string;
      /** Повтор бессмыслен: бот заблокирован, чат не найден и т. п. */
      permanent: boolean;
    };

export interface TelegramSendOptions {
  /** Разметка HTML (по умолчанию — обычный текст). */
  html?: boolean;
  disableLinkPreview?: boolean;
  /** Сколько ждать ответа Telegram, мс (по умолчанию 10 с); дольше — ошибка, запрос прерывается. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export interface Telegram {
  sendMessage(
    chatId: string | number,
    text: string,
    options?: TelegramSendOptions,
  ): Promise<TelegramSendResult>;
  setWebhook(url: string, secretToken: string): Promise<void>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export function createTelegramBotApi(options: {
  token: string;
  fetch?: FetchLike;
  apiBase?: string;
}): Telegram {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const base = `${options.apiBase ?? 'https://api.telegram.org'}/bot${options.token}`;

  async function call<T>(
    method: string,
    body: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<BotApiResponse<T>> {
    const res = await doFetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return (await res.json()) as BotApiResponse<T>;
  }

  return {
    async sendMessage(chatId, text, opts = {}) {
      const data = await call<{ message_id: number }>(
        'sendMessage',
        {
          chat_id: chatId,
          text,
          ...(opts.html ? { parse_mode: 'HTML' } : {}),
          link_preview_options: { is_disabled: opts.disableLinkPreview ?? true },
        },
        opts.timeoutMs,
      );
      if (data.ok && data.result) return { ok: true, messageId: data.result.message_id };
      const errorCode = data.error_code ?? 0;
      return {
        ok: false,
        errorCode,
        description: data.description ?? 'unknown error',
        ...(data.parameters?.retry_after !== undefined
          ? { retryAfterSeconds: data.parameters.retry_after }
          : {}),
        permanent: errorCode === 400 || errorCode === 403,
      };
    },
    async setWebhook(url, secretToken) {
      const data = await call<boolean>('setWebhook', {
        url,
        secret_token: secretToken,
        allowed_updates: ['message', 'callback_query'],
      });
      if (!data.ok) throw new Error(`Telegram setWebhook: ${data.description ?? data.error_code}`);
    },
  };
}

export interface FakeTelegram extends Telegram {
  readonly sent: Array<{ chatId: string | number; text: string; options: TelegramSendOptions }>;
  webhook?: { url: string; secretToken: string };
  /** Следующие отправки вернут эти ответы (по очереди), затем — успех. */
  failNext(...results: Extract<TelegramSendResult, { ok: false }>[]): void;
}

/** Бот для тестов: запоминает сообщения, умеет имитировать ошибки. */
export function createFakeTelegram(): FakeTelegram {
  const failures: Extract<TelegramSendResult, { ok: false }>[] = [];
  let nextId = 1;
  const fake: FakeTelegram = {
    sent: [],
    async sendMessage(chatId, text, options = {}) {
      const failure = failures.shift();
      if (failure) return failure;
      fake.sent.push({ chatId, text, options });
      return { ok: true, messageId: nextId++ };
    },
    async setWebhook(url, secretToken) {
      fake.webhook = { url, secretToken };
    },
    failNext(...results) {
      failures.push(...results);
    },
  };
  return fake;
}

/** Проверка заголовка `X-Telegram-Bot-Api-Secret-Token` вебхука. */
export function isValidWebhookSecret(header: string | null | undefined, secret: string): boolean {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
