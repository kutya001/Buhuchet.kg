import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { L10nProvider } from '../src/l10n/provider';
import { getT, loadDictionary } from '../src/l10n/server';
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
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const dictionary = await loadDictionary();
  return (
    <html lang={dictionary.lang}>
      <body>
        <L10nProvider texts={dictionary.texts}>{children}</L10nProvider>
      </body>
    </html>
  );
}
