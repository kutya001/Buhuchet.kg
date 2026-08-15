import React from 'react';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingFeatures } from '@/components/landing/LandingFeatures';
import { LandingHowItWorks } from '@/components/landing/LandingHowItWorks';
import { LandingAudience } from '@/components/landing/LandingAudience';
import { LandingPricing } from '@/components/landing/LandingPricing';
import { LandingTestimonials } from '@/components/landing/LandingTestimonials';
import { LandingFaq } from '@/components/landing/LandingFaq';
import { LandingCta } from '@/components/landing/LandingCta';
import { LandingFooter } from '@/components/landing/LandingFooter';

export const metadata: Metadata = {
  title: 'BuhUchet.kg — Автоматизация первичного бухгалтерского учёта в Кыргызстане',
  description:
    'BuhUchet.kg — единая цифровая среда для автоматизации бухгалтерского учёта и документооборота в Кыргызстане. Прозрачный реестр первички, Telegram-оповещения, облачный диск и каталог экспертов.',
  keywords: [
    'бухучет кыргызстан',
    'электронный документооборот бишкек',
    'первичный учет кр',
    'автоматизация бухгалтерии кыргызстан',
    'бухгалтерские услуги бишкек',
    'buhuchet kg',
  ],
  openGraph: {
    title: 'BuhUchet.kg — Бухгалтерия нового поколения в Кыргызстане',
    description:
      'Единая экосистема электронного документооборота и первичного учета для бизнеса и бухгалтеров Кыргызской Республики.',
    url: 'https://www.buhuchet.kg',
    siteName: 'BuhUchet.kg',
    locale: 'ru_RU',
    type: 'website',
  },
};

export default async function HomePage() {
  // 1. Проверка сессии на этапе серверного рендеринга (RSC)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthenticated = !!user;

  return (
    <div className="min-h-screen bg-background text-foreground scroll-smooth flex flex-col antialiased selection:bg-blue-500/20 selection:text-blue-500">
      {/* 1. ФИКСИРОВАННАЯ ШАПКА */}
      <LandingHeader isAuthenticated={isAuthenticated} />

      <main className="flex-1">
        {/* 2. ГЛАВНЫЙ ЭКРАН (HERO) */}
        <LandingHero isAuthenticated={isAuthenticated} />

        {/* 3. СЕТКА ВОЗМОЖНОСТЕЙ */}
        <LandingFeatures />

        {/* 4. ПОШАГОВЫЙ ПРОЦЕСС РАБОТЫ */}
        <LandingHowItWorks />

        {/* 5. РАЗДЕЛЕНИЕ ДЛЯ БИЗНЕСА И БУХГАЛТЕРОВ */}
        <LandingAudience isAuthenticated={isAuthenticated} />

        {/* 6. ТАРИФНАЯ СЕТКА */}
        <LandingPricing isAuthenticated={isAuthenticated} />

        {/* 7. ОТЗЫВЫ КЛИЕНТОВ */}
        <LandingTestimonials />

        {/* 8. ИНТЕРАКТИВНЫЙ FAQ АККОРДЕОН */}
        <LandingFaq />

        {/* 9. ФИНАЛЬНЫЙ CTA ПРИЗЫВ */}
        <LandingCta isAuthenticated={isAuthenticated} />
      </main>

      {/* 10. ФУТЕР */}
      <LandingFooter />
    </div>
  );
}
