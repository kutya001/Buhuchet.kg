import type { NextRequest } from 'next/server';
import { proxySent } from '../../../../../src/files/sent-proxy';
import { localApi } from '../../../../../src/server-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * «Я оплатил» на странице контрагента: начать — ссылка на хранилище для чека на 2 минуты (доработки
 * 14.11.2026, блок 6; тот же путь под адресом страницы, что «Отправить файл», `src/files/sent-proxy.ts`).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; inn: string }> },
) {
  return proxySent(
    req,
    params,
    async ({ slug, inn, body, headers }) =>
      (await localApi.api.page[':slug'][':inn'].paid.$post(
        { param: { slug, inn }, json: body as never },
        { headers },
      )) as Response,
  );
}
