import { createServer, type ServerResponse } from 'node:http';

// Подделка Telegram Bot API для сквозных тестов. Сайт шлёт сюда сообщения бота (TELEGRAM_API_BASE в
// .env.example), тесты читают их: код «Забыли пароль?», подтверждение привязки. Запускает Playwright
// (webServer в playwright.config.ts). Слушает все адреса: сайт в Docker обращается к этому компьютеру
// как host.docker.internal (через мост Docker, не 127.0.0.1). Хранит сообщения только в памяти, пока
// идут тесты; коды в них — от локальной базы с демо-данными.
//   POST /bot<токен>/sendMessage, /bot<токен>/sendRichMessage (сообщение с таблицами),
//   /bot<токен>/answerCallbackQuery (скрытый ответ на нажатие кнопки), /bot<токен>/editMessageReplyMarkup
//   (кнопки после нажатия), /bot<токен>/setWebhook, /bot<токен>/getWebhookInfo — как Bot API;
//   GET /messages?chat=<id> — что бот отправил в этот чат: `text` — текст без разметки (как его видит
//   человек), `html` — вид с таблицами, `keyboard` — кнопки сейчас, `messageId` — номер в чате;
//   GET /answers — скрытые ответы на нажатия; GET /health;
//   POST /webhook-info {url, error} — что ответит getWebhookInfo (Админка → «Телеграм» → «Бот платформы»).

const PORT = Number(process.env.FAKE_TELEGRAM_PORT ?? 8091);

interface Sent {
  chatId: string;
  messageId: number;
  text: string;
  /** Вид с таблицами (sendRichMessage); у обычного сообщения нет. */
  html?: string;
  /** Ряды кнопок под сообщением — как в `reply_markup.inline_keyboard`. */
  keyboard?: unknown;
}

const sent: Sent[] = [];
const answers: { id: string; text: string; alert: boolean }[] = [];
let nextId = 1;

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
  if (req.method === 'GET' && url.pathname === '/messages') {
    const chat = url.searchParams.get('chat');
    return reply(
      res,
      200,
      sent.filter((m) => m.chatId === chat),
    );
  }
  const method =
    url.pathname === '/webhook-info'
      ? 'webhookInfo'
      : /^\/bot[^/]+\/(\w+)$/.exec(url.pathname)?.[1];
  if (req.method !== 'POST' || !method) return reply(res, 404, notFound);
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    body += chunk;
  });
  req.on('end', () => {
    let data: {
      chat_id?: number | string;
      text?: string;
      url?: string;
      error?: string;
      parse_mode?: string;
      rich_message?: { html?: string };
      reply_markup?: { inline_keyboard?: unknown };
      message_id?: number;
      callback_query_id?: string;
      show_alert?: boolean;
    };
    try {
      data = JSON.parse(body || '{}') as typeof data;
    } catch {
      return reply(res, 400, { ok: false, error_code: 400, description: 'Bad Request' });
    }
    const keyboard = data.reply_markup?.inline_keyboard;
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
      });
      return reply(res, 200, { ok: true, result: { message_id: messageId } });
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
    if (method === 'setWebhook') {
      webhook.url = String(data.url ?? '');
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
