import { PublicPage } from '@buhuchet/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { PublicPageScreen } from '../../../../src/contractor-page/public-page';
import { getT } from '../../../../src/l10n/server';
import { localApi } from '../../../../src/server-api';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t('pub.meta_title')} · Buhuchet.kg`,
    robots: { index: false, follow: false },
    // В адресе страницы — ИНН контрагента: он не уходит на другие сайты в заголовке Referer.
    referrer: 'no-referrer',
  };
}

/**
 * Страница контрагента по ссылке без входа (задача 2.42; ТЗ «Страница контрагента по ссылке»): что
 * показать — «Страница недоступна», ввод кода, перерыв или саму страницу — решает API в том же
 * процессе по cookie этой ссылки. Каждое открытие сервер пишет в историю контрагента с устройством —
 * поэтому браузер передаётся как есть. Разделы открытой страницы — задача 2.43.
 */
export default async function ContractorPublicPage({
  params,
}: {
  params: Promise<{ slug: string; inn: string }>;
}) {
  const { slug, inn } = await params;
  const request = await headers();
  const res = await localApi.api.page[':slug'][':inn'].$get(
    { param: { slug, inn } },
    {
      headers: {
        cookie: request.get('cookie') ?? '',
        'user-agent': request.get('user-agent') ?? '',
      },
    },
  );
  if (res.status !== 200) throw new Error(`GET /api/page: ${(res as Response).status}`);
  const state = PublicPage.parse(await res.json());
  return <PublicPageScreen slug={slug} inn={inn} state={state} />;
}
