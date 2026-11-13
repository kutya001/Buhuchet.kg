import { isPageAddress, PAGE_COOKIE, PAGE_COOKIE_SECURE } from '@buhuchet/domain';
import { siteInfo } from '@buhuchet/api/web';
import { NextResponse, type NextRequest } from 'next/server';
import { localApi } from '../../../../../src/server-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hostOf = (url: string | null): string | null => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
};

/** «Страница недоступна» — тем же видом ответа, что у API; текст экран берёт из словаря по коду. */
const unavailable = (status: 403 | 404) =>
  NextResponse.json(
    { error: { code: 'page_unavailable', message: '' } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );

/**
 * «Подключить Telegram» на странице контрагента (доработки 13.11.2026, задача К3; прототип v92
 * pgTgPub). Адрес — под адресом страницы: только сюда браузер отправляет cookie этой ссылки (путь
 * /<адрес организации>/inn/<ИНН>). Выдать ли одноразовую ссылку на бота, решает API в том же процессе
 * по этой cookie; его ответ уходит браузеру как есть. Запрос с другого сайта не принимается: Origin
 * обязателен и должен быть адресом нашего сайта (как у изменяющих запросов API).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; inn: string }> },
) {
  const { slug, inn } = await params;
  if (!isPageAddress(slug, inn)) return unavailable(404);
  const origin = req.headers.get('origin');
  const from = hostOf(origin);
  const own = [hostOf(siteInfo().baseUrl), req.headers.get('host')];
  if (!origin || !from || !own.includes(from)) return unavailable(403);
  const cookie = [PAGE_COOKIE, PAGE_COOKIE_SECURE]
    .flatMap((name) => {
      const value = req.cookies.get(name)?.value;
      return value ? [`${name}=${value}`] : [];
    })
    .join('; ');
  const res = (await localApi.api.page[':slug'][':inn'].telegram.$post(
    { param: { slug, inn } },
    { headers: { cookie, origin } },
  )) as Response;
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
