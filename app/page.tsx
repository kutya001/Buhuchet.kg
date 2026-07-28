import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  ShieldCheck,
  Zap,
  Camera,
  FolderOpen,
  Building2,
  ArrowRight,
  CheckCircle2,
  Users,
  Lock,
  Globe,
  Star,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-blue-500 selection:text-white font-sans relative overflow-x-hidden">
      {/* Dynamic Background Glow Elements */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-600/15 blur-[160px] rounded-full pointer-events-none z-0" />
      <div className="absolute top-[800px] right-0 w-[600px] h-[600px] bg-purple-600/10 blur-[180px] rounded-full pointer-events-none z-0" />

      {/* 1. STICKY HEADER */}
      <header className="sticky top-0 z-50 w-full border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-3 group">
            <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400 group-hover:scale-105 transition-transform shadow-lg shadow-blue-600/10">
              <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div>
              <span className="font-bold text-lg sm:text-xl text-white tracking-tight">Buhuchet.kg</span>
              <p className="text-[10px] text-blue-400 font-mono tracking-wider uppercase">B2B Network КР</p>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-slate-400">
            <a href="#features" className="hover:text-white transition-colors">Возможности</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">Как это работает</a>
            <a href="#security" className="hover:text-white transition-colors">Безопасность R2</a>
            <a href="#catalog" className="hover:text-white transition-colors">Каталог КР</a>
          </nav>

          {/* Auth Action Buttons */}
          <div className="flex items-center space-x-3">
            <Link href="/login">
              <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-slate-900 text-xs sm:text-sm">
                Войти
              </Button>
            </Link>
            <Link href="/register">
              <Button className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs sm:text-sm shadow-lg shadow-blue-600/25 px-4 sm:px-5">
                Регистрация
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* 2. HERO SECTION */}
      <section className="relative pt-12 sm:pt-20 pb-16 md:pb-28 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6 sm:space-y-8">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold tracking-wide">
            <Sparkles className="h-4 w-4" />
            <span>Первая национальная B2B-платформа обмена первички в Кыргызстане</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight max-w-5xl mx-auto leading-[1.15]">
            Безопасный Электронный B2B-Документооборот и Архив Первички
          </h1>

          <p className="text-sm sm:text-lg text-slate-400 max-w-3xl mx-auto font-normal leading-relaxed">
            Мгновенная передача накладных, актов и учредительных документов между верифицированными юридическими лицами КР. Нативная съёмка сканов с камеры смартфона и облачное хранилище Cloudflare R2.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Link href="/register" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-bold text-base px-8 h-13 shadow-xl shadow-blue-600/30">
                Подключить компанию бесплатно
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>

            <Link href="/login" className="w-full sm:w-auto">
              <Button size="lg" variant="outline" className="w-full sm:w-auto border-slate-800 bg-slate-900/60 text-slate-300 hover:text-white hover:bg-slate-800 text-base px-8 h-13">
                Войти по реквизитам
              </Button>
            </Link>
          </div>

          {/* Key Metrics / Highlights */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-8 max-w-4xl mx-auto border-t border-slate-800/80">
            <div className="p-3 text-center">
              <p className="text-xl sm:text-2xl font-bold text-white font-mono">100%</p>
              <p className="text-xs text-slate-400 mt-1">Верификация ИНН КР</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-xl sm:text-2xl font-bold text-emerald-400 font-mono">0.7 сек</p>
              <p className="text-xs text-slate-400 mt-1">Доставка в Cloudflare R2</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-xl sm:text-2xl font-bold text-purple-400 font-mono">Mobile-First</p>
              <p className="text-xs text-slate-400 mt-1">Нативная камера смартфона</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-xl sm:text-2xl font-bold text-amber-400 font-mono">SSL / RLS</p>
              <p className="text-xs text-slate-400 mt-1">Строгая защита Supabase</p>
            </div>
          </div>

          {/* Interactive Platform Mockup Preview */}
          <div className="pt-6 relative max-w-5xl mx-auto">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4 backdrop-blur-2xl shadow-2xl shadow-blue-500/5">
              <div className="flex items-center space-x-2 pb-3 border-b border-slate-800/80 px-2">
                <span className="w-3 h-3 rounded-full bg-red-500/80" />
                <span className="w-3 h-3 rounded-full bg-amber-500/80" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <span className="text-xs text-slate-500 font-mono ml-2">buhuchet.kg/dashboard/documents</span>
              </div>
              <div className="p-4 sm:p-6 space-y-4 text-left">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Building2 className="h-5 w-5 text-blue-400" />
                    <span className="font-bold text-white text-sm sm:text-base">ОсОО «Кумтор Голд Компани» &rarr; ОсОО «Народный Трейд»</span>
                  </div>
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 text-xs">
                    Принято получателем
                  </Badge>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs sm:text-sm">
                  <div className="flex items-center space-x-3">
                    <FileText className="h-5 w-5 text-sky-400" />
                    <div>
                      <p className="font-mono text-white font-bold">Товарная накладная № ТН-9021</p>
                      <p className="text-[11px] text-slate-500">Прикреплено 2 скана R2 • 2.4 MB</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="border-slate-800 text-xs text-slate-300">
                    Просмотр скана
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. FEATURES SECTION */}
      <section id="features" className="py-16 sm:py-24 bg-slate-900/30 border-y border-slate-800/80 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
              Функционал Платформы
            </Badge>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
              Полный Комплекс Инструментов для Главбуха и Руководителя
            </h2>
            <p className="text-sm sm:text-base text-slate-400">
              Мы убрали товарно-номенклатурную сложность, оставив чистый B2B обмен первички и сканов между организациями.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Card 1 */}
            <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-blue-500/40 transition-all hover:-translate-y-1 space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Zap className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white">B2B Документооборот</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Передача накладных, актов и счетов по ИНН организации со статусной моделью (Sent, Accepted, Processed, Cancelled).
              </p>
            </div>

            {/* Card 2 */}
            <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-emerald-500/40 transition-all hover:-translate-y-1 space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Camera className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Камера Смартфона в R2</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Съёмка накладных прямо на складе с нативной поддержкой камеры смартфона и мгновенной доставкой в Cloudflare R2.
              </p>
            </div>

            {/* Card 3 */}
            <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-purple-500/40 transition-all hover:-translate-y-1 space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <FolderOpen className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Учредительный Архив</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Хранение Устава, Свидетельства ЮЛ, Паспортов руководителей и личного архива компании без отправки сторонним лицам.
              </p>
            </div>

            {/* Card 4 */}
            <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-amber-500/40 transition-all hover:-translate-y-1 space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Модерация Суперадмином</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Каждая организация проходит обязательную проверку реквизитов Суперадмином перед предоставлением доступа к B2B платформе.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. HOW IT WORKS */}
      <section id="how-it-works" className="py-16 sm:py-24 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            <Badge variant="outline" className="border-purple-500/30 text-purple-400 bg-purple-500/10">
              Пошаговый Процесс
            </Badge>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
              Как Начать Обмен Документами за 4 Простых Шага
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative">
            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 relative space-y-3">
              <span className="text-3xl font-extrabold font-mono text-blue-500/40">01</span>
              <h4 className="text-base font-bold text-white">Регистрация & ИНН</h4>
              <p className="text-xs text-slate-400">Внесите официальные реквизиты юридического лица КР (14 цифр ИНН, Отрасль, Адрес).</p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 relative space-y-3">
              <span className="text-3xl font-extrabold font-mono text-purple-500/40">02</span>
              <h4 className="text-base font-bold text-white">Модерация</h4>
              <p className="text-xs text-slate-400">Суперадмин проверяет заявку и активирует статус организации.</p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 relative space-y-3">
              <span className="text-3xl font-extrabold font-mono text-emerald-500/40">03</span>
              <h4 className="text-base font-bold text-white">Запрос Партнерства</h4>
              <p className="text-xs text-slate-400">Найдите контрагента в Каталоге Компаний КР и запросите сотрудничество.</p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 relative space-y-3">
              <span className="text-3xl font-extrabold font-mono text-amber-500/40">04</span>
              <h4 className="text-base font-bold text-white">Обмен Сканами</h4>
              <p className="text-xs text-slate-400">Передавайте первички и сканы с камеры смартфона в реальном времени.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. CTA BANNER */}
      <section className="py-16 relative z-10 px-4">
        <div className="max-w-5xl mx-auto rounded-3xl bg-gradient-to-r from-blue-900/40 via-purple-900/30 to-slate-900 border border-blue-500/30 p-8 sm:p-12 text-center space-y-6 shadow-2xl relative overflow-hidden">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Готовы Перевести Первичку Вашей Организации в Облако?
          </h2>
          <p className="text-sm sm:text-base text-slate-300 max-w-2xl mx-auto">
            Присоединяйтесь к единой B2B-сети юридических лиц Кыргызстана прямо сейчас.
          </p>
          <div className="pt-2">
            <Link href="/register">
              <Button size="lg" className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-base px-8 h-12 shadow-lg shadow-blue-600/30">
                Зарегистрировать компанию
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* 6. FOOTER */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-12 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-slate-500">
          <div className="flex items-center space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <FileText className="h-4 w-4" />
            </div>
            <span className="font-bold text-sm text-white">Buhuchet.kg B2B Network</span>
          </div>

          <p>© 2026 Buhuchet.kg. Все права защищены. Кыргызская Республика, г. Бишкек.</p>

          <div className="flex items-center space-x-4">
            <Link href="/login" className="hover:text-slate-300 transition-colors">Вход</Link>
            <Link href="/register" className="hover:text-slate-300 transition-colors">Регистрация</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
