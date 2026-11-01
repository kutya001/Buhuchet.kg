import { isPageAddress, PAGE_COOKIE, PAGE_COOKIE_SECURE } from '@buhuchet/domain';
import { NextResponse, type NextRequest } from 'next/server';
import { localApi } from '../../../../../../src/server-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Номер файла — UUID; другой вид не уходит в API. */
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Файл отчёта со страницы контрагента (задача 2.43; ТЗ «файлы, приложенные при сдаче, открываются для
 * просмотра и скачивания»). Адрес — под адресом страницы: только сюда браузер отправляет cookie этой
 * ссылки (путь /<адрес организации>/inn/<ИНН>). Можно ли отдать файл, решает API в том же процессе по
 * этой cookie; можно — переход на подписанную ссылку хранилища на 15 минут, нельзя (код не введён,
 * раздел скрыт, файла нет) — обратно на страницу: она сама покажет ввод кода или «Страница недоступна».
 * Файл — только при «Файлах в карточках» и только загруженный (docs/deviations.md п. Е-4).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Е-4
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; inn: string; id: string }> },
) {
  const { slug, inn, id } = await params;
  // Адрес неправильного вида — сразу «не найдено»: части адреса не попадают ни в запрос к API, ни в
  // переход (иначе «//чужой.сайт» в адресе увёл бы на другой сайт).
  if (!isPageAddress(slug, inn) || !FILE_ID.test(id)) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const back = () => {
    const res = NextResponse.redirect(new URL(`/${slug}/inn/${inn}`, req.nextUrl.origin), 303);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  };
  const cookie = [PAGE_COOKIE, PAGE_COOKIE_SECURE]
    .flatMap((name) => {
      const value = req.cookies.get(name)?.value;
      return value ? [`${name}=${value}`] : [];
    })
    .join('; ');
  const res = (await localApi.api.page[':slug'][':inn'].files[':id'].$get(
    { param: { slug, inn, id } },
    { headers: { cookie } },
  )) as Response;
  const location = res.status === 302 ? res.headers.get('location') : null;
  if (!location) return back();
  const out = NextResponse.redirect(location, 302);
  out.headers.set('Cache-Control', 'no-store');
  out.headers.set('Referrer-Policy', 'no-referrer');
  return out;
}
