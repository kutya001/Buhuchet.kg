import 'server-only';
import { isPageAddress, PAGE_COOKIE, PAGE_COOKIE_SECURE } from '@buhuchet/domain';
import { siteInfo } from '@buhuchet/api/web';
import { NextResponse, type NextRequest } from 'next/server';

/** Тело «Отправить файл» — список имён и размеров, не больше 64 КБ (сами файлы идут мимо сайта). */
const BODY_MAX = 64 * 1024;

const hostOf = (url: string | null): string | null => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
};

/**
 * Тело запроса, но не больше `max` байт: заявленную длину видно сразу, остальное читается по кускам и
 * обрывается на пределе (у обработчиков маршрутов Next.js своего предела тела нет). Больше — null.
 */
async function readLimited(req: NextRequest, max: number): Promise<string | null> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

const json = (status: number, code: string) =>
  NextResponse.json(
    { error: { code, message: '' } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );

/**
 * «Отправить файл» на странице контрагента (доработки 14.11.2026, блок 2; прототип v112 `pubUpDlg`).
 * Адрес — под адресом страницы: только сюда браузер отправляет cookie этой ссылки (путь
 * /<адрес организации>/inn/<ИНН>), как у «Подключить Telegram». Можно ли отправлять, решает API в том же
 * процессе по этой cookie; его ответ уходит браузеру как есть. Запрос с другого сайта не принимается:
 * Origin обязателен и должен быть адресом нашего сайта. Адрес клиента (X-Forwarded-For) уходит в API для
 * предела отправок с одного адреса.
 */
export async function proxySent(
  req: NextRequest,
  params: Promise<{ slug: string; inn: string }>,
  send: (o: {
    slug: string;
    inn: string;
    body: unknown;
    headers: Record<string, string>;
  }) => Promise<Response>,
): Promise<NextResponse> {
  const { slug, inn } = await params;
  if (!isPageAddress(slug, inn)) return json(404, 'page_unavailable');
  const origin = req.headers.get('origin');
  const from = hostOf(origin);
  const own = [hostOf(siteInfo().baseUrl), req.headers.get('host')];
  if (!origin || !from || !own.includes(from)) return json(403, 'page_unavailable');
  const text = await readLimited(req, BODY_MAX);
  if (text === null) return json(400, 'validation_failed');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, 'validation_failed');
  }
  const cookie = [PAGE_COOKIE, PAGE_COOKIE_SECURE]
    .flatMap((name) => {
      const value = req.cookies.get(name)?.value;
      return value ? [`${name}=${value}`] : [];
    })
    .join('; ');
  const forwarded = req.headers.get('x-forwarded-for');
  const res = await send({
    slug,
    inn,
    body,
    headers: { cookie, origin, ...(forwarded ? { 'x-forwarded-for': forwarded } : {}) },
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
