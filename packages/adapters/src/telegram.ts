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
 * Картинка сообщения (оформленная рассылка, поток Т, задача Т6): сам файл или номер файла у Telegram —
 * его Telegram возвращает после первой отправки, и остальным получателям картинка уходит без загрузки.
 */
export type TelegramPhoto =
  { fileId: string } | { bytes: Uint8Array; name: string; contentType: string };

/** Итог отправки картинки: номер сообщения и номер файла у Telegram (для следующих отправок). */
export type TelegramPhotoResult =
  | { ok: true; messageId: number; fileId: string | null }
  | Extract<TelegramSendResult, { ok: false }>;

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
   * Кнопки меню под полем ввода (ряды подписей; поток Т, задача Т5): нажатие шлёт боту подпись обычным
   * сообщением. Остаются у человека, пока бот их не заменит. Вместе с кнопками под сообщением не
   * отправляются — Telegram принимает одно из двух, и `keyboard` важнее. Пустой список — убрать меню.
   */
  menu?: readonly (readonly string[])[];
  /**
   * Вид с таблицами и раскрывающимися разделами (HTML для sendRichMessage). Если Telegram такое
   * сообщение не принял, уходит обычное сообщение с текстом `text`: напоминание должно дойти всегда.
   */
  rich?: string;
  /** Сколько ждать ответа Telegram, мс (по умолчанию 10 с); дольше — ошибка, запрос прерывается. */
  timeoutMs?: number;
  /**
   * Скрытое сообщение в группе (поток Т, задача Т8; Bot API 10.3 `ephemeral_message_parameters`): его
   * видит только `receiverUserId`; в ответ на нажатие — с номером нажатия (`callbackQueryId`), тогда у
   * бота 15 секунд. Telegram доставляет его без гарантии и может убрать сам.
   */
  ephemeral?: { receiverUserId: number; callbackQueryId?: string };
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
/** Команда меню бота: латиница, цифры и «_» (до 32 знаков) и подпись (до 256 знаков). */
export interface TelegramCommand {
  command: string;
  description: string;
}

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
   * Картинка с подписью (до 1024 знаков) и кнопками под ней. `html` — подпись с разметкой HTML (её
   * экранирует вызывающий). Ошибка сети — исключение с вычищенным текстом, как у `sendMessage`.
   */
  sendPhoto(
    chatId: string | number,
    photo: TelegramPhoto,
    options?: Pick<TelegramSendOptions, 'html' | 'keyboard' | 'timeoutMs'> & {
      caption?: string;
    },
  ): Promise<TelegramPhotoResult>;
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
  /**
   * Команды бота в его меню в личных чатах («/today — Сегодня»; поток Т, задача Т5): список заменяется
   * целиком. Ошибка Bot API — исключение.
   */
  setCommands(commands: readonly TelegramCommand[]): Promise<void>;
  /** Состояние вебхука (Админка → «Телеграм» → «Проверить вебхук»); ошибка Bot API — исключение. */
  getWebhookInfo(): Promise<TelegramWebhookInfo>;
  /** Выйти из группы (поток Т, задача Т8: общий чат фирмы отключён). false — Telegram не принял. */
  leaveChat(chatId: string | number): Promise<boolean>;
  /**
   * Виджет в личном чате (поток Т, задача Т9; Bot API 10.4 `sendWidget`): HTML (до 32 КБ, до 4 КБ после
   * сжатия), данные виджета `chatData` (до 1 КБ) и подпись — её показывает старое приложение Telegram.
   * Виджет отправляется с запретом пересылки и копирования; запросы виджета к боту разрешены.
   */
  sendWidget(chatId: string | number, widget: TelegramWidget): Promise<TelegramSendResult>;
  /** Новые данные отправленного виджета (`editMessageWidgetData`); HTML не меняется. */
  editWidgetData(chatId: string | number, messageId: number, chatData: string): Promise<boolean>;
  /** Ответ на запрос виджета (`answerWidgetQuery`, до 1 КБ): его получает только спросивший виджет. */
  answerWidgetQuery(queryId: string, data?: string): Promise<boolean>;
}

/** Виджет для `sendWidget`. */
export interface TelegramWidget {
  html: string;
  chatData: string;
  caption: string;
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

/** Кнопки меню под полем ввода в виде Bot API; пустой список — убрать их. */
function menuMarkup(menu: readonly (readonly string[])[]) {
  const rows = menu.filter((row) => row.length > 0);
  return rows.length
    ? {
        keyboard: rows.map((row) => row.map((text) => ({ text }))),
        resize_keyboard: true,
        is_persistent: true,
      }
    : { remove_keyboard: true };
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

  /** Ответ Bot API об отказе — в виде, который понимает очередь. */
  const failure = (data: BotApiResponse<unknown>): Extract<TelegramSendResult, { ok: false }> => {
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
  };

  /** Запрос с файлом (multipart): поля — строки, файл — содержимое с именем и типом. */
  async function callForm<T>(
    method: string,
    fields: Readonly<Record<string, string>>,
    file: { field: string; bytes: Uint8Array; name: string; contentType: string },
    timeoutMs: number,
  ): Promise<BotApiResponse<T>> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set(
      file.field,
      new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
      file.name,
    );
    try {
      const res = await doFetch(`${base}/${method}`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return (await res.json()) as BotApiResponse<T>;
    } catch (err) {
      const safe = new Error(redactBotToken(err instanceof Error ? err.message : String(err)));
      safe.name = err instanceof Error ? err.name : 'Error';
      throw safe;
    }
  }

  return {
    async sendPhoto(chatId, photo, opts = {}) {
      type Sent = { message_id: number; photo?: { file_id?: string }[] };
      const markup = opts.keyboard?.length ? replyMarkup(opts.keyboard) : null;
      const caption: Record<string, string> = opts.caption ? { caption: opts.caption } : {};
      const mode: Record<string, string> = opts.html && opts.caption ? { parse_mode: 'HTML' } : {};
      const data =
        'fileId' in photo
          ? await call<Sent>(
              'sendPhoto',
              {
                chat_id: chatId,
                photo: photo.fileId,
                ...caption,
                ...mode,
                ...(markup ? { reply_markup: markup } : {}),
              },
              opts.timeoutMs,
            )
          : await callForm<Sent>(
              'sendPhoto',
              {
                chat_id: String(chatId),
                ...caption,
                ...mode,
                ...(markup ? { reply_markup: JSON.stringify(markup) } : {}),
              },
              { field: 'photo', ...photo },
              opts.timeoutMs ?? FILE_TIMEOUT_MS,
            );
      if (data.ok && data.result) {
        // Telegram отдаёт картинку в нескольких размерах; номер самого большого — для следующих отправок.
        const fileId = data.result.photo?.at(-1)?.file_id ?? null;
        return { ok: true, messageId: data.result.message_id, fileId };
      }
      return failure(data);
    },
    async sendMessage(chatId, text, opts = {}) {
      const markup = opts.keyboard?.length
        ? { reply_markup: replyMarkup(opts.keyboard) }
        : opts.menu
          ? { reply_markup: menuMarkup(opts.menu) }
          : {};
      const ephemeral = opts.ephemeral
        ? {
            ephemeral_message_parameters: {
              receiver_user_id: opts.ephemeral.receiverUserId,
              ...(opts.ephemeral.callbackQueryId
                ? { callback_query_id: opts.ephemeral.callbackQueryId }
                : {}),
            },
          }
        : {};
      let data: BotApiResponse<{ message_id: number }> | null = null;
      if (opts.rich !== undefined) {
        data = await call<{ message_id: number }>(
          'sendRichMessage',
          { chat_id: chatId, ...ephemeral, rich_message: { html: opts.rich }, ...markup },
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
            ...ephemeral,
            text: body ?? text,
            ...(opts.html || body !== null ? { parse_mode: 'HTML' } : {}),
            link_preview_options: { is_disabled: opts.disableLinkPreview ?? true },
            ...markup,
          },
          opts.timeoutMs,
        );
      }
      if (data.ok && data.result) {
        const result = data.result as { message_id: number; ephemeral_message_id?: number };
        // Скрытое сообщение (задача Т8): Telegram отдаёт его с номером 0 и `ephemeral_message_id`.
        // Нет этих признаков — сервер Bot API поле не знает, и сообщение увидели все в чате: оно
        // сразу удаляется, а отправка считается неудачной (защита — строже, docs/deviations.md п. Т-12).
        if (
          opts.ephemeral &&
          result.message_id !== 0 &&
          result.ephemeral_message_id === undefined
        ) {
          await call<boolean>('deleteMessage', {
            chat_id: chatId,
            message_id: result.message_id,
          }).catch(() => null);
          return {
            ok: false,
            errorCode: 0,
            description: 'ephemeral message is not supported',
            permanent: true,
          };
        }
        return { ok: true, messageId: result.message_id };
      }
      return failure(data);
    },
    async answerCallback(callbackId, text, opts = {}) {
      const data = await call<boolean>('answerCallbackQuery', {
        callback_query_id: callbackId,
        ...(text ? { text, show_alert: opts.alert === true } : {}),
      });
      return data.ok;
    },
    async leaveChat(chatId) {
      const data = await call<boolean>('leaveChat', { chat_id: chatId });
      return data.ok;
    },
    async sendWidget(chatId, widget) {
      const data = await call<{ message_id: number }>('sendWidget', {
        chat_id: chatId,
        html: widget.html,
        chat_data: widget.chatData,
        caption: widget.caption,
        allow_queries: true,
        protect_content: true,
      });
      if (data.ok && data.result) return { ok: true, messageId: data.result.message_id };
      return failure(data);
    },
    async editWidgetData(chatId, messageId, chatData) {
      const data = await call<unknown>('editMessageWidgetData', {
        chat_id: chatId,
        message_id: messageId,
        chat_data: chatData,
      });
      // «message is not modified» — данные уже такие.
      return data.ok || /not modified/i.test(data.description ?? '');
    },
    async answerWidgetQuery(queryId, text) {
      const data = await call<boolean>('answerWidgetQuery', {
        widget_query_id: queryId,
        ...(text ? { data: text } : {}),
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
    async setCommands(commands) {
      const data = await call<boolean>('setMyCommands', {
        commands: commands.map((c) => ({ command: c.command, description: c.description })),
        scope: { type: 'all_private_chats' },
      });
      if (!data.ok) {
        throw new Error(`Telegram setMyCommands: ${data.description ?? data.error_code}`);
      }
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
  readonly sent: Array<{
    chatId: string | number;
    text: string;
    options: TelegramSendOptions & { photo?: TelegramPhoto };
  }>;
  /**
   * Отправленные картинки (в `sent` они тоже есть: текст — подпись, `options.photo` — что отправлено).
   * Номер файла у «Telegram» — `tg-photo-<n>`; отправка по неизвестному номеру — отказ 400.
   */
  readonly photos: Array<{ chatId: string | number; photo: TelegramPhoto; fileId: string }>;
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
  /** Команды меню бота, заданные последним `setCommands`. */
  commands?: readonly TelegramCommand[];
  /** Что ответит getWebhookInfo: по умолчанию — поставленный адрес без ошибок; `Error` — исключение. */
  webhookInfo?: Partial<TelegramWebhookInfo> | Error;
  /** Следующие отправки вернут эти ответы (по очереди), затем — успех. */
  failNext(...results: Extract<TelegramSendResult, { ok: false }>[]): void;
  /** Группы, из которых бот вышел (поток Т, задача Т8). */
  readonly left: Array<string | number>;
  /** Виджеты (поток Т, задача Т9): отправленные, правки данных, ответы на запросы. */
  readonly widgets: Array<TelegramWidget & { chatId: string | number; messageId: number }>;
  readonly widgetEdits: Array<{ chatId: string | number; messageId: number; chatData: string }>;
  readonly widgetAnswers: Array<{ queryId: string; data: string | undefined }>;
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
    photos: [],
    left: [],
    widgets: [],
    widgetEdits: [],
    widgetAnswers: [],
    async leaveChat(chatId) {
      fake.left.push(chatId);
      return true;
    },
    async sendWidget(chatId, widget) {
      const failed = failures.shift();
      if (failed) return failed;
      const messageId = nextId++;
      fake.widgets.push({ ...widget, chatId, messageId });
      return { ok: true, messageId };
    },
    async editWidgetData(chatId, messageId, chatData) {
      fake.widgetEdits.push({ chatId, messageId, chatData });
      return true;
    },
    async answerWidgetQuery(queryId, data) {
      fake.widgetAnswers.push({ queryId, data });
      return true;
    },
    async sendPhoto(chatId, photo, options = {}) {
      const failed = failures.shift();
      if (failed) return failed;
      const known = fake.photos.map((p) => p.fileId);
      if ('fileId' in photo && !known.includes(photo.fileId)) {
        return {
          ok: false,
          errorCode: 400,
          description: 'Bad Request: wrong file identifier',
          permanent: true,
        };
      }
      const fileId = 'fileId' in photo ? photo.fileId : `tg-photo-${fake.photos.length + 1}`;
      const messageId = nextId++;
      const { caption, ...rest } = options;
      fake.photos.push({ chatId, photo, fileId });
      fake.sent.push({ chatId, text: caption ?? '', options: { ...rest, photo } });
      fake.messageIds.push(messageId);
      return { ok: true, messageId, fileId };
    },
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
    async setCommands(commands) {
      fake.commands = commands.map((c) => ({ ...c }));
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
