import type { NextRequest } from 'next/server';
import { proxySent } from '../../../../../src/files/sent-proxy';
import { localApi } from '../../../../../src/server-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** «Отправить файл»: начать отправку — ссылки на хранилище на 2 минуты (`src/files/sent-proxy.ts`). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; inn: string }> },
) {
  return proxySent(
    req,
    params,
    async ({ slug, inn, body, headers }) =>
      (await localApi.api.page[':slug'][':inn'].sent.$post(
        { param: { slug, inn }, json: body as never },
        { headers },
      )) as Response,
  );
}
