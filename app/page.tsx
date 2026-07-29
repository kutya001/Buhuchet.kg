import React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Shield,
  Zap,
  Building2,
  CheckCircle2,
  ArrowRight,
  FolderOpen,
  Globe,
  Database,
  Lock,
  Download,
  Users,
  Smartphone,
  Layers,
  Sparkles,
} from 'lucide-react';

export default function HomePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Buhuchet.kg',
    operatingSystem: 'All',
    applicationCategory: 'BusinessApplication',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'KGS',
    },
    description:
      'Первая национальная платформа B2B электронных документов и автоматизации бухгалтерского учета ОсОО и ИП в Кыргызской Республике с выгрузкой в 1С.',
    author: {
      '@type': 'Organization',
      name: 'Buhuchet.kg',
      url: 'https://buhuchet.kg',
    },
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-blue-500 selection:text-white relative overflow-x-hidden font-sans">
      {/* 0. Микроразметка Schema.org JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Декоративные фоновые парящие свечения (Glows) */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute top-1/3 right-10 w-96 h-96 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-1/3 w-[500px] h-[500px] bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* 1. ФИКСИРОВАННЫЙ НАВБАР - ПАРЯЩИЙ МАТОВЫЙ ОСТРОВОК */}
      <header className="sticky top-4 z-50 mx-4 md:mx-12 my-2 h-16 rounded-3xl bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 shadow-2xl flex items-center justify-between px-6 transition-all">
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-lg shadow-blue-500/20">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <span className="font-bold text-lg text-white tracking-tight">Buhuchet.kg</span>
            <span className="ml-2 text-[10px] uppercase font-mono tracking-widest px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400">
              B2B Network КР
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <Link
            href="/login"
            className="text-xs sm:text-sm font-medium text-slate-300 hover:text-white px-3 py-2 transition-colors"
          >
            Войти
          </Link>

          <Link
            href="/register"
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs sm:text-sm transition-all shadow-lg shadow-blue-600/25 active:scale-95"
          >
            Подключить ОсОО / ИП
          </Link>
        </div>
      </header>

      {/* 2. HERO SECTION — ПАРЯЩИЙ ГЛАВНЫЙ БЛОК */}
      <section className="px-4 md:px-12 pt-8 pb-16 max-w-7xl mx-auto space-y-12">
        <div className="text-center space-y-6 max-w-4xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 text-xs font-medium text-amber-400 backdrop-blur-md shadow-lg">
            <Sparkles className="h-4 w-4" />
            <span>Первая национальная платформа B2B документов Кыргызстана</span>
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-white tracking-tight leading-[1.15]">
            Облачный B2B Учет и <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
              Мгновенный Обмен Документами
            </span>
          </h1>

          <p className="text-sm sm:text-base md:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Автоматизируйте учет товарных накладных, актов и договоров ОсОО и ИП в Кыргызской Республике. Мгновенная выгрузка в 1С, хранение уставных сканов в Cloudflare R2 и безопасный доступ для бухгалтеров.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Link
              href="/register"
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm sm:text-base transition-all shadow-xl shadow-blue-600/30 flex items-center justify-center min-h-[52px]"
            >
              <span>Начать работу бесплатно</span>
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>

            <Link
              href="/login"
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold text-sm sm:text-base backdrop-blur-xl transition-all flex items-center justify-center min-h-[52px]"
            >
              Вход в личный кабинет
            </Link>
          </div>
        </div>

        {/* ПАРЯЩИЙ ДЕМО-ОСТРОВОК ИНТЕРФЕЙСА */}
        <div className="p-4 sm:p-6 rounded-3xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-2xl shadow-2xl relative">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-blue-400">
                <span className="text-xs font-semibold text-slate-400">ОсОО «Альфа»</span>
                <Building2 className="h-4 w-4" />
              </div>
              <p className="text-lg font-bold text-white">ИНН: 01203202610050</p>
              <div className="flex items-center text-[11px] text-emerald-400 font-mono">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Верифицировано в КР
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-purple-400">
                <span className="text-xs font-semibold text-slate-400">ОсОО «Бета»</span>
                <Building2 className="h-4 w-4" />
              </div>
              <p className="text-lg font-bold text-white">ИНН: 02509202610110</p>
              <div className="flex items-center text-[11px] text-purple-400 font-mono">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Партнер в сети
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-emerald-400">
                <span className="text-xs font-semibold text-slate-400">Выгрузка в 1С</span>
                <Download className="h-4 w-4" />
              </div>
              <p className="text-lg font-bold text-white">Экспорт SheetJS</p>
              <div className="flex items-center text-[11px] text-slate-400 font-mono">
                Клиентская генерация XLSX
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-amber-400">
                <span className="text-xs font-semibold text-slate-400">Сканы Cloudflare R2</span>
                <FolderOpen className="h-4 w-4" />
              </div>
              <p className="text-lg font-bold text-white">Безлимитный Архив</p>
              <div className="flex items-center text-[11px] text-amber-400 font-mono">
                Быстрое сжатие фото
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. КЛЮЧЕВЫЕ ПРЕИМУЩЕСТВА — ПАРЯЩИЕ ОСТРОВКИ */}
      <section className="px-4 md:px-12 py-16 max-w-7xl mx-auto space-y-12">
        <div className="text-center space-y-3">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Все инструменты для бухучета в одном месте
          </h2>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            Разработано специально для спецификаций и стандартов бизнеса Кыргызской Республики
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-xl hover:border-blue-500/40 transition-all space-y-4 shadow-xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <FileText className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-white">Прямой B2B Обмен</h3>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              Отправляйте товарные накладные, акты выполненных работ и счета-фактуры прямо вашим контрагентам. Никаких бумажных дубликатов.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-xl hover:border-emerald-500/40 transition-all space-y-4 shadow-xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <FolderOpen className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-white">Архив Сканов R2</h3>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              Снимайте сканы уставов и печатей прямо с камеры смартфона. Файлы автоматически сжимаются в браузере и надежно хранятся в R2.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-xl hover:border-purple-500/40 transition-all space-y-4 shadow-xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Database className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-white">Совместимость с 1С</h3>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              Мгновенный экспорт всех реестров документов в формате SheetJS (`xlsx`) на стороне клиента для простой загрузки в любую конфигурацию 1С.
            </p>
          </div>
        </div>
      </section>

      {/* 4. ТАРИФЫ И ПОДКЛЮЧЕНИЕ */}
      <section className="px-4 md:px-12 py-16 max-w-5xl mx-auto space-y-8 text-center">
        <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-slate-900/80 to-slate-950/90 border border-slate-800 backdrop-blur-2xl shadow-2xl space-y-6">
          <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 px-3 py-1">
            Бесплатный период 14 дней
          </Badge>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white">
            Готовы ускорить бухгалтерский учет вашей компании?
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto">
            Подключение занимает менее 2 минут. Зарегистрируйте ваше ОсОО или ИП по ИНН и получите полный доступ к B2B сети.
          </p>

          <div className="pt-2">
            <Link
              href="/register"
              className="inline-flex items-center justify-center px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm sm:text-base transition-all shadow-xl shadow-blue-600/30 active:scale-95"
            >
              Зарегистрировать Компанию в Buhuchet.kg
            </Link>
          </div>
        </div>
      </section>

      {/* 5. FOOTER */}
      <footer className="border-t border-slate-900 py-8 px-4 text-center text-xs text-slate-600 font-mono">
        © 2026 Buhuchet.kg — Национальная система B2B документов Кыргызской Республики. Все права защищены.
      </footer>
    </div>
  );
}
