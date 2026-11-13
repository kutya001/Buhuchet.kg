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

/**
 * Кнопка под сообщением (inline keyboard): нажатие с данными (`data`, до 64 байт — приходит боту как
 * callback_query), копирование текста (`copy`) или ссылка (`url`). `disabled` — кнопка неактивна.
 */
export interface TelegramButton {
  text: string;
  data?: string;
  copy?: string;
  url?: string;
  disabled?: boolean;
}

export interface TelegramSendOptions {
  /** Разметка HTML (по умолчанию — обычный текст). */
  html?: boolean;
  disableLinkPreview?: boolean;
  /**
   * Код подтверждения в тексте: показывается моноширинным — в Telegram копируется нажатием. Текст при
   * этом обычный (без разметки): переходник экранирует его сам.
   */
  code?: string;
  /** Ряды кнопок под сообщением. */
  keyboard?: readonly (readonly TelegramButton[])[];
  /**
   * Вид с таблицами и раскрывающимися разделами (HTML для sendRichMessage). Если Telegram такое
   * сообщение не принял, уходит обычное сообщение с текстом `text`: напоминание должно дойти всегда.
   */
  rich?: string;
  /** Сколько ждать ответа Telegram, мс (по умолчанию 10 с); дольше — ошибка, запрос прерывается. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** Сколько ждать файл, присланный боту, мс: до 20 МБ с серверов Telegram. */
const FILE_TIMEOUT_MS = 30_000;

/**
 * Файл, присланный боту (поток Т, задача Т2): содержимое либо почему его нет — файл больше предела
 * (`too_large`) или Telegram его не отдал (`failed`: устаревший номер файла, сбой сети).
 */
export type TelegramFileResult =
  | { ok: true; body: Uint8Array }
  | { ok: false; reason: 'too_large' | 'failed'; description: string };

/**
 * Состояние вебхука по ответу Telegram (getWebhookInfo): адрес, куда Telegram шлёт обновления (пусто —
 * вебхук не поставлен), последняя ошибка доставки и сколько обновлений ждут доставки.
 */
export interface TelegramWebhookInfo {
  url: string;
  pendingUpdates: number;
  lastErrorAt: Date | null;
  lastError: string | null;
}

export interface Telegram {
  sendMessage(
    chatId: string | number,
    text: string,
    options?: TelegramSendOptions,
  ): Promise<TelegramSendResult>;
  /**
   * Ответ на нажатие кнопки: без текста — просто снять ожидание; с текстом — скрытый ответ (до 200
   * знаков), его видит только нажавший; `alert` — окном. false — Telegram ответ не принял.
   */
  answerCallback(
    callbackId: string,
    text?: string,
    options?: { alert?: boolean },
  ): Promise<boolean>;
  /** Заменить кнопки под отправленным сообщением. false — Telegram правку не принял. */
  editKeyboard(
    chatId: string | number,
    messageId: number,
    keyboard: readonly (readonly TelegramButton[])[],
  ): Promise<boolean>;
  /**
   * Скачать файл, присланный боту, по его номеру из сообщения (`file_id`): не больше `maxBytes`.
   * Адрес файла содержит токен бота, поэтому наружу он не отдаётся — только содержимое. Ошибка сети —
   * не исключение, а `failed` с вычищенным текстом.
   */
  loadFile(fileId: string, maxBytes: number): Promise<TelegramFileResult>;
  setWebhook(url: string, secretToken: string): Promise<void>;
  /** Состояние вебхука (Админка → «Телеграм» → «Проверить вебхук»); ошибка Bot API — исключение. */
  getWebhookInfo(): Promise<TelegramWebhookInfo>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

/** Токен бота стоит в адресе запроса к Telegram: в тексте ошибки он заменяется. */
export function redactBotToken(message: string): string {
  return message.replace(/\/bot[^/\s]+/g, '/bot<скрыт>');
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Тело ответа не больше предела: читается по частям, сверх предела не дочитывается (заголовку размера
 * верить нельзя). null — тело больше предела.
 */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    return all.byteLength > maxBytes ? null : all;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

/** Клавиатура в виде Bot API. Неактивная кнопка — `disabled` (Bot API 10.3), данные остаются. */
function replyMarkup(keyboard: readonly (readonly TelegramButton[])[] | undefined) {
  const rows = (keyboard ?? []).filter((row) => row.length > 0);
  return {
    inline_keyboard: rows.map((row) =>
      row.map((b) => ({
        text: b.text,
        ...(b.copy !== undefined
          ? { copy_text: { text: b.copy } }
          : b.url !== undefined
            ? { url: b.url }
            : { callback_data: b.data ?? '' }),
        ...(b.disabled ? { disabled: {} } : {}),
      })),
    ),
  };
}

export function createTelegramBotApi(options: {
  token: string;
  fetch?: FetchLike;
  apiBase?: string;
}): Telegram {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const base = `${options.apiBase ?? 'https://api.telegram.org'}/bot${options.token}`;
  const fileBase = `${options.apiBase ?? 'https://api.telegram.org'}/file/bot${options.token}`;

  async function call<T>(
    method: string,
    body: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<BotApiResponse<T>> {
    try {
      const res = await doFetch(`${base}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return (await res.json()) as BotApiResponse<T>;
    } catch (err) {
      // Адрес запроса содержит токен бота, и текст ошибки сети может его повторить («Failed to parse
      // URL from …/bot<токен>/…»): наружу — новая ошибка с вычищенным текстом и без исходной причины.
      const safe = new Error(redactBotToken(err instanceof Error ? err.message : String(err)));
      safe.name = err instanceof Error ? err.name : 'Error';
      throw safe;
    }
  }

  return {
    async sendMessage(chatId, text, opts = {}) {
      const markup = opts.keyboard?.length ? { reply_markup: replyMarkup(opts.keyboard) } : {};
      let data: BotApiResponse<{ message_id: number }> | null = null;
      if (opts.rich !== undefined) {
        data = await call<{ message_id: number }>(
          'sendRichMessage',
          { chat_id: chatId, rich_message: { html: opts.rich }, ...markup },
          opts.timeoutMs,
        );
        // Сообщение с таблицей не принято (старый сервер Bot API, неверная разметка) — тот же текст
        // уходит обычным сообщением. Лимит и блокировка бота — не про вид сообщения: их не повторяем.
        if (!data.ok && (data.error_code === 400 || data.error_code === 404)) data = null;
      }
      if (!data) {
        const code = opts.code;
        const body =
          code !== undefined && code !== '' && text.includes(code)
            ? escapeHtml(text)
                .split(escapeHtml(code))
                .join(`<code>${escapeHtml(code)}</code>`)
            : null;
        data = await call<{ message_id: number }>(
          'sendMessage',
          {
            chat_id: chatId,
            text: body ?? text,
            ...(opts.html || body !== null ? { parse_mode: 'HTML' } : {}),
            link_preview_options: { is_disabled: opts.disableLinkPreview ?? true },
            ...markup,
          },
          opts.timeoutMs,
        );
      }
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
    async answerCallback(callbackId, text, opts = {}) {
      const data = await call<boolean>('answerCallbackQuery', {
        callback_query_id: callbackId,
        ...(text ? { text, show_alert: opts.alert === true } : {}),
      });
      return data.ok;
    },
    async editKeyboard(chatId, messageId, keyboard) {
      const data = await call<unknown>('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: replyMarkup(keyboard),
      });
      return data.ok;
    },
    async loadFile(fileId, maxBytes) {
      const failed = (description: string): TelegramFileResult => ({
        ok: false,
        reason: 'failed',
        description: redactBotToken(description),
      });
      const tooLarge: TelegramFileResult = { ok: false, reason: 'too_large', description: '' };
      try {
        const info = await call<{ file_path?: string; file_size?: number }>('getFile', {
          file_id: fileId,
        });
        if (!info.ok || !info.result?.file_path) {
          // Файл больше 20 МБ Bot API не отдаёт: «Bad Request: file is too big».
          if (/too big/i.test(info.description ?? '')) return tooLarge;
          return failed(`getFile: ${info.error_code ?? 0} ${info.description ?? ''}`);
        }
        if ((info.result.file_size ?? 0) > maxBytes) return tooLarge;
        // Путь приходит от Telegram и встаёт в адрес после токена: только обычные знаки пути.
        const path = info.result.file_path;
        if (!/^[\w.\-/ ]+$/.test(path) || path.includes('..') || path.startsWith('/')) {
          return failed('getFile: неожиданный путь файла');
        }
        const res = await doFetch(
          `${fileBase}/${path.split('/').map(encodeURIComponent).join('/')}`,
          {
            method: 'GET',
            // Перенаправление увело бы запрос с токеном в адресе на другой сервер.
            redirect: 'error',
            signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
          },
        );
        if (!res.ok) return failed(`файл: HTTP ${res.status}`);
        if (Number(res.headers.get('content-length') ?? 0) > maxBytes) return tooLarge;
        const body = await readCapped(res, maxBytes);
        return body ? { ok: true, body } : tooLarge;
      } catch (err) {
        return failed(err instanceof Error ? err.message : String(err));
      }
    },
    async setWebhook(url, secretToken) {
      const data = await call<boolean>('setWebhook', {
        url,
        secret_token: secretToken,
        allowed_updates: ['message', 'callback_query'],
      });
      if (!data.ok) throw new Error(`Telegram setWebhook: ${data.description ?? data.error_code}`);
    },
    async getWebhookInfo() {
      const data = await call<{
        url?: string;
        pending_update_count?: number;
        last_error_date?: number;
        last_error_message?: string;
      }>('getWebhookInfo', {});
      if (!data.ok || !data.result) {
        throw new Error(`Telegram getWebhookInfo: ${data.description ?? data.error_code}`);
      }
      const r = data.result;
      return {
        url: r.url ?? '',
        pendingUpdates: r.pending_update_count ?? 0,
        lastErrorAt: r.last_error_date ? new Date(r.last_error_date * 1000) : null,
        lastError: r.last_error_message ?? null,
      };
    },
  };
}

export interface FakeTelegram extends Telegram {
  /** Отправленные сообщения; кнопки — в `options.keyboard`, вид с таблицами — в `options.rich`. */
  readonly sent: Array<{ chatId: string | number; text: string; options: TelegramSendOptions }>;
  /** Номера отправленных сообщений — в том же порядке, что `sent` (для нажатий кнопок в тестах). */
  readonly messageIds: number[];
  /** Ответы на нажатия кнопок (скрытые ответы). */
  readonly answers: Array<{ callbackId: string; text: string | undefined; alert: boolean }>;
  /** Правки кнопок под отправленными сообщениями. */
  readonly edits: Array<{
    chatId: string | number;
    messageId: number;
    keyboard: readonly (readonly TelegramButton[])[];
  }>;
  /** Файлы, которые «прислали боту»: номер файла → содержимое (для `loadFile`). */
  readonly files: Map<string, Uint8Array>;
  webhook?: { url: string; secretToken: string };
  /** Что ответит getWebhookInfo: по умолчанию — поставленный адрес без ошибок; `Error` — исключение. */
  webhookInfo?: Partial<TelegramWebhookInfo> | Error;
  /** Следующие отправки вернут эти ответы (по очереди), затем — успех. */
  failNext(...results: Extract<TelegramSendResult, { ok: false }>[]): void;
}

/** Бот для тестов: запоминает сообщения, умеет имитировать ошибки. */
export function createFakeTelegram(): FakeTelegram {
  const failures: Extract<TelegramSendResult, { ok: false }>[] = [];
  let nextId = 1;
  const fake: FakeTelegram = {
    sent: [],
    messageIds: [],
    answers: [],
    edits: [],
    files: new Map(),
    async sendMessage(chatId, text, options = {}) {
      const failure = failures.shift();
      if (failure) return failure;
      const messageId = nextId++;
      fake.sent.push({ chatId, text, options });
      fake.messageIds.push(messageId);
      return { ok: true, messageId };
    },
    async answerCallback(callbackId, text, options = {}) {
      fake.answers.push({ callbackId, text, alert: options.alert === true });
      return true;
    },
    async editKeyboard(chatId, messageId, keyboard) {
      fake.edits.push({ chatId, messageId, keyboard });
      return true;
    },
    async loadFile(fileId, maxBytes) {
      const body = fake.files.get(fileId);
      if (!body) return { ok: false, reason: 'failed', description: 'нет такого файла' };
      if (body.byteLength > maxBytes) return { ok: false, reason: 'too_large', description: '' };
      return { ok: true, body };
    },
    async setWebhook(url, secretToken) {
      fake.webhook = { url, secretToken };
    },
    async getWebhookInfo() {
      if (fake.webhookInfo instanceof Error) throw fake.webhookInfo;
      return {
        url: fake.webhook?.url ?? '',
        pendingUpdates: 0,
        lastErrorAt: null,
        lastError: null,
        ...fake.webhookInfo,
      };
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
