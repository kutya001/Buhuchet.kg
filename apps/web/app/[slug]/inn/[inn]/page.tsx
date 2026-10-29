import { isPageAddress, PAGE_COOKIE, PAGE_COOKIE_SECURE } from '@buhuchet/domain';
import { PublicPage } from '@buhuchet/shared';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
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
 * процессе по cookie этой ссылки. Адрес неправильного вида — сразу «Страница недоступна»: части адреса
 * не попадают в запрос к API. Из cookie браузера передаётся только cookie страницы (сеанс программы —
 * нет), браузер — как есть: каждое открытие сервер пишет в историю контрагента с устройством. Разделы
 * открытой страницы — задача 2.43.
 */
export default async function ContractorPublicPage({
  params,
}: {
  params: Promise<{ slug: string; inn: string }>;
}) {
  const { slug, inn } = await params;
  if (!isPageAddress(slug, inn)) {
    return <PublicPageScreen slug={slug} inn={inn} state={{ state: 'unavailable' }} />;
  }
  const jar = await cookies();
  const cookie = [PAGE_COOKIE, PAGE_COOKIE_SECURE]
    .flatMap((name) => {
      const value = jar.get(name)?.value;
      return value ? [`${name}=${value}`] : [];
    })
    .join('; ');
  const res = await localApi.api.page[':slug'][':inn'].$get(
    { param: { slug, inn } },
    { headers: { cookie, 'user-agent': (await headers()).get('user-agent') ?? '' } },
  );
  if (res.status !== 200) throw new Error(`GET /api/page: ${(res as Response).status}`);
  const state = PublicPage.parse(await res.json());
  return <PublicPageScreen slug={slug} inn={inn} state={state} />;
}
