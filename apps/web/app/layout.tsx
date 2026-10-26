import '@fontsource-variable/inter';
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { L10nProvider } from '../src/l10n/provider';
import { getT, loadDictionary } from '../src/l10n/server';
import { parseTheme, THEME_COOKIE } from '../src/shell/prefs';
import './globals.css';

// Тексты страниц — из словаря базы на момент запроса, поэтому страницы не собираются заранее.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: 'Buhuchet.kg',
    description: t('app.description'),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * Тема — из cookie выбора на этом устройстве, поэтому страница сразу приходит в нужной теме, без
 * вспышки; выбора нет — тема устройства (стили theme.css). Шрифт Inter — свой, со своего сайта.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const dictionary = await loadDictionary();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang={dictionary.lang} data-theme={theme ?? undefined}>
      <body>
        <L10nProvider texts={dictionary.texts}>{children}</L10nProvider>
      </body>
    </html>
  );
}
