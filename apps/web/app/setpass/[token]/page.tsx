import { isSetupKeyShape } from '@buhuchet/domain';
import type { Metadata } from 'next';
import { getT } from '../../../src/l10n/server';
import { SetPasswordScreen } from '../../../src/telegram/setpass-screen';

// Ключ ссылки — в адресе: страница не кешируется и собирается на каждый запрос.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t('setpass.meta_title')} · Buhuchet.kg`,
    robots: { index: false, follow: false },
    // Ключ ссылки в адресе не уходит на другие сайты в заголовке Referer.
    referrer: 'no-referrer',
  };
}

/**
 * «Задать пароль» по ссылке из Telegram (доработки 14.11.2026, блок 1, пункт 3; прототип v113): без
 * входа. Ключ неправильного вида — сразу «Ссылка устарела»: он не уходит в запрос к API. Чья ссылка,
 * страница спрашивает из браузера — так попытки считаются по адресу человека, а не сервера.
 */
export default async function SetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SetPasswordScreen token={isSetupKeyShape(token) ? token : null} />;
}
