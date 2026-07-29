import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://buhuchet.kg'),
  title: {
    default: 'Buhuchet.kg — Национальная Платформа B2B Документов и Облачного Учета Кыргызстана',
    template: '%s | Buhuchet.kg — B2B ЭДО Кыргызстан',
  },
  description:
    'Автоматизация бухгалтерского учета ОсОО и ИП в Кыргызской Республике. Мгновенный обмен товарными накладными, актами, выгрузка в 1С (SheetJS) и надежный архив сканов в Cloudflare R2.',
  keywords: [
    'бухучет кыргызстан',
    'бухгалтерия бишкек',
    'b2b документы кр',
    'электронные накладные осoo',
    'выгрузка 1с кыргызстан',
    'первичка ип кыргызстан',
    'эдо кыргызстан',
    'инн проверка компаний кр',
    'buhuchet kg',
  ],
  authors: [{ name: 'Buhuchet.kg Team', url: 'https://buhuchet.kg' }],
  creator: 'Buhuchet.kg',
  publisher: 'Buhuchet.kg',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: 'Buhuchet.kg — Облачный B2B Учет и Первичные Документы в Кыргызстане',
    description:
      'Первая национальная B2B платформа электронных накладных, актов и сканов уставных документов ОсОО/ИП с автоматической выгрузкой в 1С.',
    url: 'https://buhuchet.kg',
    siteName: 'Buhuchet.kg',
    locale: 'ru_KG',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Buhuchet.kg — B2B ЭДО и Учет в Кыргызстане',
    description: 'Мгновенный обмен первичными документами между ОсОО и ИП в Кыргызской Республике.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#090d16',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark scroll-smooth">
      <body className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-blue-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
