import { landingDicts, siteInfo } from '@buhuchet/api/web';
import { bishkekDate } from '@buhuchet/domain';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIES } from '../src/auth/return-to';
import { Landing } from '../src/landing/landing';
import { demoScreens, LANDING_VERSION } from '../src/landing/landing-data';
import { getT } from '../src/l10n/server';
import { canEnter } from '../src/shell/modules';
import { loadMe, requestNow } from '../src/shell/server';

/** Картинка превью ссылки в мессенджерах (ТЗ «Лендинг» → «Техника»: 1 200 × 630 px). */
const OG_IMAGE = { url: '/og.jpg', width: 1200, height: 630 };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const { env, baseUrl } = siteInfo();
  // Поисковики индексируют только лендинг рабочего сайта; стенд и локальный сайт — нет.
  const index = env === 'production';
  return {
    metadataBase: new URL(baseUrl),
    title: t('land.title'),
    description: t('land.hero.sub'),
    robots: { index, follow: index },
    openGraph: {
      type: 'website',
      locale: 'ru_RU',
      siteName: 'Buhuchet.kg',
      title: t('land.title'),
      description: t('land.hero.sub'),
      url: '/',
      images: [OG_IMAGE],
    },
    twitter: { card: 'summary_large_image', images: [OG_IMAGE.url] },
  };
}

/**
 * buhuchet.kg/ (задача #165, ТЗ «Лендинг» → «Кто что видит по адресу»): вошедший сразу попадает на свою
 * рабочую страницу (Главная организации, у администратора платформы — Админка); кто вошёл с временным
 * паролем — на смену пароля; гость видит лендинг. Цифры полосы, коды стран формы и видео лендинга — из
 * действующих справочников платформы, как в прототипе; картинки — экраны демо-организации, собранные из spec/.
 */
export default async function HomePage() {
  const store = await cookies();
  if (SESSION_COOKIES.some((name) => store.has(name))) {
    const me = await loadMe();
    if (me?.user.mustChangePassword) redirect('/login');
    if (canEnter(me)) redirect('/app');
  }
  const today = bishkekDate(new Date(requestNow()));
  const { numbers, codes, videos } = await landingDicts();
  return (
    <Landing
      screens={demoScreens(today)}
      numbers={numbers}
      codes={codes}
      videos={videos}
      today={today}
      stand={siteInfo().env === 'staging'}
      version={LANDING_VERSION}
    />
  );
}
