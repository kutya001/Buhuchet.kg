import { siteInfo } from '@buhuchet/api/web';
import type { MetadataRoute } from 'next';

// Поисковики индексируют только лендинг (ТЗ «Лендинг» → «Техника»): программа, вход, демо-версия и
// страницы контрагентов закрыты. Открыты ещё картинка превью ссылки, значок вкладки (его поисковик
// показывает в выдаче рядом с адресом) и стили и скрипты страницы — без них поисковик не увидит страницу
// так, как её видит человек. Тестовый стенд не индексируется целиком.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  if (siteInfo().env !== 'production') return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: ['/$', '/og.jpg', '/icon.svg', '/_next/static/'],
      disallow: '/',
    },
  };
}
