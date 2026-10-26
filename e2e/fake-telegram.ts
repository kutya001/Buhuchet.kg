import { createServer, type ServerResponse } from 'node:http';

// Подделка Telegram Bot API для сквозных тестов. Сайт шлёт сюда сообщения бота (TELEGRAM_API_BASE в
// .env.example), тесты читают их: код «Забыли пароль?», подтверждение привязки. Запускает Playwright
// (webServer в playwright.config.ts). Слушает все адреса: сайт в Docker обращается к этому компьютеру
// как host.docker.internal. Хранит сообщения только в памяти, пока идут тесты.
//   POST /bot<токен>/sendMessage, /bot<токен>/setWebhook — как Bot API;
//   GET /messages?chat=<id> — что бот отправил в этот чат; GET /health.

const PORT = Number(process.env.FAKE_TELEGRAM_PORT ?? 8091);

interface Sent {
  chatId: string;
  text: string;
}

const sent: Sent[] = [];
let nextId = 1;

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
  const method = /^\/bot[^/]+\/(\w+)$/.exec(url.pathname)?.[1];
  if (req.method !== 'POST' || !method) return reply(res, 404, notFound);
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    body += chunk;
  });
  req.on('end', () => {
    const data = JSON.parse(body || '{}') as { chat_id?: number | string; text?: string };
    if (method === 'sendMessage') {
      sent.push({ chatId: String(data.chat_id), text: String(data.text ?? '') });
      return reply(res, 200, { ok: true, result: { message_id: nextId++ } });
    }
    if (method === 'setWebhook') return reply(res, 200, { ok: true, result: true });
    return reply(res, 404, notFound);
  });
}).listen(PORT, '0.0.0.0');
