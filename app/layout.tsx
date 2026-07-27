import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Buhuchet.kg — Автоматизация первичной документации',
  description: 'Сервис автоматизации первичных документов, сверки ЭСФ и выгрузки в 1С для бизнеса в Кыргызстане',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
