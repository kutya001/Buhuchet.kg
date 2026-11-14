import { createServer, type ServerResponse } from 'node:http';

// Подделка Telegram Bot API для сквозных тестов. Сайт шлёт сюда сообщения бота (TELEGRAM_API_BASE в
// .env.example), тесты читают их: код «Забыли пароль?», подтверждение привязки. Запускает Playwright
// (webServer в playwright.config.ts). Слушает все адреса: сайт в Docker обращается к этому компьютеру
// как host.docker.internal (через мост Docker, не 127.0.0.1). Хранит сообщения только в памяти, пока
// идут тесты; коды в них — от локальной базы с демо-данными.
//   POST /bot<токен>/sendMessage, /bot<токен>/sendRichMessage (сообщение с таблицами),
//   /bot<токен>/answerCallbackQuery (скрытый ответ на нажатие кнопки), /bot<токен>/editMessageReplyMarkup
//   (кнопки после нажатия), /bot<токен>/setWebhook, /bot<токен>/getWebhookInfo, /bot<токен>/setMyCommands
//   (команды меню бота) — как Bot API;
//   /bot<токен>/getFile и GET /file/bot<токен>/<путь> — файл, который человек прислал боту (поток Т,
//   задача Т2); сам файл тест кладёт заранее: POST /files {id, name, base64} или {id, tooBig: true};
//   GET /messages?chat=<id> — что бот отправил в этот чат: `text` — текст без разметки (как его видит
//   человек), `html` — вид с таблицами, `keyboard` — кнопки сейчас, `menu` — кнопки меню под полем ввода
//   (ряды подписей; поток Т, задача Т5), `messageId` — номер в чате; GET /commands — команды меню бота;
//   GET /answers — скрытые ответы на нажатия; GET /left — группы, из которых бот вышел (`leaveChat`), у
//   скрытого сообщения в группе — `receiver` (поток Т, задача Т8); GET /health;
//   POST /webhook-info {url, error} — что ответит getWebhookInfo (Админка → «Телеграм» → «Бот платформы»).
//   /bot<токен>/sendPhoto — картинка с подписью (оформленная рассылка, поток Т, задача Т6): файлом
//   (multipart) или номером файла, который подделка выдала раньше; в /messages — `photo` (номер файла и
//   размер загруженного), `text` — подпись без разметки.
//   /bot<токен>/sendWidget, /bot<токен>/editMessageWidgetData, /bot<токен>/answerWidgetQuery — виджет
//   «Мои отчёты на неделю» (поток Т, задача Т9): в /messages — `widget` (данные виджета сейчас), `text` —
//   подпись; GET /widget-answers — ответы бота на запросы виджета.

const PORT = Number(process.env.FAKE_TELEGRAM_PORT ?? 8091);

interface Sent {
  chatId: string;
  messageId: number;
  text: string;
  /** Вид с таблицами (sendRichMessage); у обычного сообщения нет. */
  html?: string;
  /** Ряды кнопок под сообщением — как в `reply_markup.inline_keyboard`. */
  keyboard?: unknown;
  /** Кнопки меню под полем ввода — ряды подписей из `reply_markup.keyboard`; `[]` — меню убрано. */
  menu?: string[][];
  /** Картинка: номер файла у «Telegram» и размер, если файл загружали (иначе — отправлен по номеру). */
  photo?: { fileId: string; bytes?: number };
  /** Скрытое сообщение в группе: кто его видит (поток Т, задача Т8). */
  receiver?: number;
  /** Виджет (поток Т, задача Т9): данные виджета сейчас (`chat_data`). */
  widget?: string;
}

const sent: Sent[] = [];
// Файлы, «присланные боту»: номер файла → путь на сервере Telegram и содержимое; `tooBig` — файл больше
// 20 МБ, такой Bot API не отдаёт («file is too big»).
const files = new Map<string, { path: string; body: Buffer; tooBig: boolean }>();
const answers: { id: string; text: string; alert: boolean }[] = [];
// Группы, из которых бот вышел (`leaveChat`, поток Т, задача Т8).
const left: string[] = [];
// Ответы бота на запросы виджета (`answerWidgetQuery`, поток Т, задача Т9).
const widgetAnswers: { id: string; data: string | null }[] = [];
let commands: unknown = [];
let nextId = 1;
// Картинки, которые загружали: номер файла → размер.
const photos = new Map<string, number>();

/** Текст сообщения с разметкой HTML — как его видит человек: без тегов, строки таблицы — с новой строки. */
function plainOf(html: string): string {
  return html
    .replace(/<\/(tr|summary|table|details|p)>|<br\s*\/?>|<(table|details)[^>]*>/g, '\n')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/g, ' — ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Картинка с подписью — в список сообщений чата; ответ — как у Bot API (номер файла — в `photo`). */
function sendPhoto(
  res: ServerResponse,
  m: {
    chatId: string;
    caption: string;
    html: boolean;
    keyboard: unknown;
    photo: Sent['photo'] & {};
  },
) {
  const messageId = nextId++;
  sent.push({
    chatId: m.chatId,
    messageId,
    text: m.html ? plainOf(m.caption) : m.caption,
    ...(m.html ? { html: m.caption } : {}),
    ...(m.keyboard ? { keyboard: m.keyboard } : {}),
    photo: m.photo,
  });
  return reply(res, 200, {
    ok: true,
    result: { message_id: messageId, photo: [{ file_id: m.photo.fileId }] },
  });
}

// Состояние вебхука: адрес из setWebhook или /webhook-info, последняя ошибка доставки (время — сейчас).
const webhook: { url: string; error: string } = { url: '', error: '' };

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const notFound = { ok: false, error_code: 404, description: 'Not Found' };

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://fake-telegram');
  if (req.method === 'GET' && url.pathname === '/health') return reply(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/answers') return reply(res, 200, answers);
  if (req.method === 'GET' && url.pathname === '/left') return reply(res, 200, left);
  if (req.method === 'GET' && url.pathname === '/widget-answers') {
    return reply(res, 200, widgetAnswers);
  }
  if (req.method === 'GET' && url.pathname === '/commands') return reply(res, 200, commands);
  if (req.method === 'GET' && url.pathname === '/messages') {
    const chat = url.searchParams.get('chat');
    return reply(
      res,
      200,
      sent.filter((m) => m.chatId === chat),
    );
  }
  const filePath = /^\/file\/bot[^/]+\/(.+)$/.exec(url.pathname)?.[1];
  if (req.method === 'GET' && filePath) {
    const path = decodeURIComponent(filePath);
    const file = [...files.values()].find((f) => f.path === path);
    if (!file) return reply(res, 404, notFound);
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': file.body.byteLength,
    });
    return res.end(file.body);
  }
  const method =
    url.pathname === '/webhook-info'
      ? 'webhookInfo'
      : url.pathname === '/files'
        ? 'files'
        : /^\/bot[^/]+\/(\w+)$/.exec(url.pathname)?.[1];
  if (req.method !== 'POST' || !method) return reply(res, 404, notFound);
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const type = String(req.headers['content-type'] ?? '');
    if (method === 'sendPhoto' && type.startsWith('multipart/form-data')) {
      void new Response(raw, { headers: { 'content-type': type } })
        .formData()
        .then(async (form) => {
          const file = form.get('photo');
          if (!(file instanceof Blob)) {
            return reply(res, 400, { ok: false, error_code: 400, description: 'no photo' });
          }
          const fileId = `photo-${photos.size + 1}`;
          photos.set(fileId, (await file.arrayBuffer()).byteLength);
          const markup = form.get('reply_markup');
          return sendPhoto(res, {
            chatId: String(form.get('chat_id') ?? ''),
            caption: String(form.get('caption') ?? ''),
            html: form.get('parse_mode') === 'HTML',
            keyboard: markup
              ? (JSON.parse(String(markup)) as { inline_keyboard?: unknown }).inline_keyboard
              : undefined,
            photo: { fileId, bytes: photos.get(fileId)! },
          });
        })
        .catch(() => reply(res, 400, { ok: false, error_code: 400, description: 'Bad Request' }));
      return;
    }
    const body = raw.toString('utf8');
    let data: {
      chat_id?: number | string;
      text?: string;
      url?: string;
      error?: string;
      parse_mode?: string;
      rich_message?: { html?: string };
      reply_markup?: {
        inline_keyboard?: unknown;
        keyboard?: { text?: string }[][];
        remove_keyboard?: boolean;
      };
      commands?: unknown;
      message_id?: number;
      callback_query_id?: string;
      show_alert?: boolean;
      ephemeral_message_parameters?: { receiver_user_id?: number };
      file_id?: string;
      photo?: string;
      caption?: string;
      id?: string;
      name?: string;
      base64?: string;
      tooBig?: boolean;
      html?: string;
      chat_data?: string;
      widget_query_id?: string;
      data?: string;
    };
    try {
      data = JSON.parse(body || '{}') as typeof data;
    } catch {
      return reply(res, 400, { ok: false, error_code: 400, description: 'Bad Request' });
    }
    const keyboard = data.reply_markup?.inline_keyboard;
    const menu = data.reply_markup?.remove_keyboard
      ? []
      : data.reply_markup?.keyboard?.map((row) => row.map((b) => String(b.text ?? '')));
    if (method === 'sendMessage' || method === 'sendRichMessage') {
      const html = method === 'sendRichMessage' ? String(data.rich_message?.html ?? '') : undefined;
      const text = String(data.text ?? '');
      const messageId = nextId++;
      sent.push({
        chatId: String(data.chat_id),
        messageId,
        text:
          html !== undefined ? plainOf(html) : data.parse_mode === 'HTML' ? plainOf(text) : text,
        ...(html !== undefined ? { html } : {}),
        ...(keyboard ? { keyboard } : {}),
        ...(menu ? { menu } : {}),
        ...(data.ephemeral_message_parameters?.receiver_user_id !== undefined
          ? { receiver: data.ephemeral_message_parameters.receiver_user_id }
          : {}),
      });
      // Скрытое сообщение Telegram отдаёт с номером 0 и своим `ephemeral_message_id`.
      return reply(res, 200, {
        ok: true,
        result: data.ephemeral_message_parameters
          ? { message_id: 0, ephemeral_message_id: messageId }
          : { message_id: messageId },
      });
    }
    if (method === 'sendPhoto') {
      const fileId = String(data.photo ?? '');
      if (!photos.has(fileId)) {
        return reply(res, 400, {
          ok: false,
          error_code: 400,
          description: 'Bad Request: wrong file identifier',
        });
      }
      return sendPhoto(res, {
        chatId: String(data.chat_id),
        caption: String(data.caption ?? ''),
        html: data.parse_mode === 'HTML',
        keyboard,
        photo: { fileId },
      });
    }
    if (method === 'sendWidget') {
      const messageId = nextId++;
      sent.push({
        chatId: String(data.chat_id),
        messageId,
        text: String(data.caption ?? ''),
        html: String(data.html ?? ''),
        widget: String(data.chat_data ?? ''),
      });
      return reply(res, 200, { ok: true, result: { message_id: messageId } });
    }
    if (method === 'editMessageWidgetData') {
      const message = sent.find(
        (m) =>
          m.chatId === String(data.chat_id) &&
          m.messageId === data.message_id &&
          m.widget !== undefined,
      );
      if (!message) {
        return reply(res, 400, { ok: false, error_code: 400, description: 'message not found' });
      }
      message.widget = String(data.chat_data ?? '');
      return reply(res, 200, { ok: true, result: true });
    }
    if (method === 'answerWidgetQuery') {
      widgetAnswers.push({
        id: String(data.widget_query_id ?? ''),
        data: data.data === undefined ? null : String(data.data),
      });
      return reply(res, 200, { ok: true, result: true });
    }
    if (method === 'answerCallbackQuery') {
      answers.push({
        id: String(data.callback_query_id ?? ''),
        text: String(data.text ?? ''),
        alert: data.show_alert === true,
      });
      return reply(res, 200, { ok: true, result: true });
    }
    if (method === 'editMessageReplyMarkup') {
      const message = sent.find(
        (m) => m.chatId === String(data.chat_id) && m.messageId === data.message_id,
      );
      if (!message) {
        return reply(res, 400, { ok: false, error_code: 400, description: 'message not found' });
      }
      message.keyboard = keyboard;
      return reply(res, 200, { ok: true, result: true });
    }
    if (method === 'files') {
      const id = String(data.id ?? '');
      if (!id) return reply(res, 400, { ok: false, error_code: 400, description: 'Bad Request' });
      files.set(id, {
        // Путь — как у Telegram: папка вида файла и имя из обычных знаков.
        path: `documents/file_${files.size + 1}${/\.\w+$/.exec(String(data.name ?? ''))?.[0] ?? ''}`,
        body: Buffer.from(String(data.base64 ?? ''), 'base64'),
        tooBig: data.tooBig === true,
      });
      return reply(res, 200, { ok: true });
    }
    if (method === 'getFile') {
      const file = files.get(String(data.file_id ?? ''));
      if (!file || file.tooBig) {
        return reply(res, 400, {
          ok: false,
          error_code: 400,
          description: file ? 'Bad Request: file is too big' : 'Bad Request: file not found',
        });
      }
      return reply(res, 200, {
        ok: true,
        result: {
          file_id: data.file_id,
          file_path: file.path,
          file_size: file.body.byteLength,
        },
      });
    }
    if (method === 'leaveChat') {
      left.push(String(data.chat_id));
      return reply(res, 200, { ok: true, result: true });
    }
    if (method === 'setWebhook') {
      webhook.url = String(data.url ?? '');
      return reply(res, 200, { ok: true, result: true });
    }
    if (method === 'setMyCommands') {
      commands = data.commands ?? [];
      return reply(res, 200, { ok: true, result: true });
    }
    if (method === 'getWebhookInfo') {
      return reply(res, 200, {
        ok: true,
        result: {
          url: webhook.url,
          pending_update_count: 0,
          ...(webhook.error
            ? {
                last_error_date: Math.floor(Date.now() / 1000),
                last_error_message: webhook.error,
              }
            : {}),
        },
      });
    }
    if (method === 'webhookInfo') {
      webhook.url = String(data.url ?? '');
      webhook.error = String(data.error ?? '');
      return reply(res, 200, { ok: true });
    }
    return reply(res, 404, notFound);
  });
}).listen(PORT, '0.0.0.0');
