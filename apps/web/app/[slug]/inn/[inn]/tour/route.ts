import type { NextRequest } from 'next/server';
import { proxySent } from '../../../../../src/files/sent-proxy';
import { localApi } from '../../../../../src/server-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Конец обзора страницы контрагента — строка в историю (доработки 15.11.2026; прототип v120
 * `cphTourEnd`). Тот же путь под адресом страницы, что «Отправить файл» (`src/files/sent-proxy.ts`):
 * только сюда браузер отправляет cookie этой ссылки.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; inn: string }> },
) {
  return proxySent(
    req,
    params,
    async ({ slug, inn, body, headers }) =>
      (await localApi.api.page[':slug'][':inn'].tour.$post(
        { param: { slug, inn }, json: body as never },
        { headers },
      )) as Response,
  );
}
