import { createServer, type ServerResponse } from 'node:http';

// Подделка Telegram Bot API для сквозных тестов. Сайт шлёт сюда сообщения бота (TELEGRAM_API_BASE в
// .env.example), тесты читают их: код «Забыли пароль?», подтверждение привязки. Запускает Playwright
// (webServer в playwright.config.ts). Слушает все адреса: сайт в Docker обращается к этому компьютеру
// как host.docker.internal (через мост Docker, не 127.0.0.1). Хранит сообщения только в памяти, пока
// идут тесты; коды в них — от локальной базы с демо-данными.
//   POST /bot<токен>/sendMessage, /bot<токен>/setWebhook, /bot<токен>/getWebhookInfo — как Bot API;
//   GET /messages?chat=<id> — что бот отправил в этот чат; GET /health;
//   POST /webhook-info {url, error} — что ответит getWebhookInfo (Админка → «Телеграм» → «Бот платформы»).

const PORT = Number(process.env.FAKE_TELEGRAM_PORT ?? 8091);

interface Sent {
  chatId: string;
  text: string;
}

const sent: Sent[] = [];
let nextId = 1;
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
  if (req.method === 'GET' && url.pathname === '/messages') {
    const chat = url.searchParams.get('chat');
    return reply(
      res,
      200,
      sent.filter((m) => m.chatId === chat),
    );
  }
  const method =
    url.pathname === '/webhook-info' ? 'webhookInfo' : /^\/bot[^/]+\/(\w+)$/.exec(url.pathname)?.[1];
  if (req.method !== 'POST' || !method) return reply(res, 404, notFound);
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    body += chunk;
  });
  req.on('end', () => {
    let data: { chat_id?: number | string; text?: string; url?: string; error?: string };
    try {
      data = JSON.parse(body || '{}') as typeof data;
    } catch {
      return reply(res, 400, { ok: false, error_code: 400, description: 'Bad Request' });
    }
    if (method === 'sendMessage') {
      sent.push({ chatId: String(data.chat_id), text: String(data.text ?? '') });
      return reply(res, 200, { ok: true, result: { message_id: nextId++ } });
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
