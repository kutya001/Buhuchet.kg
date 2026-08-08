'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  FileText,
  Shield,
  Zap,
  Building2,
  CheckCircle2,
  ArrowRight,
  FolderOpen,
  Globe,
  Lock,
  Users,
  Smartphone,
  Layers,
  Sparkles,
  ShieldCheck,
  Send,
  BellRing,
  HelpCircle,
  Clock,
  TrendingUp,
  Star,
  ChevronDown,
  ChevronUp,
  Sliders,
  Check,
  UserCheck,
  Briefcase,
  Play,
  RotateCcw,
  Plus,
  BarChart3,
  Search,
  Filter,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

export default function HomePage() {
  // 1. Состояние Переключателя B2B Экосистемы (Предприниматель vs Аутсорсинг)
  const [ecosystemRole, setEcosystemRole] = useState<'business' | 'accountant'>('business');

  // 2. Состояние Каталога Аутсорсинга (Фильтр по отрасли)
  const [catalogIndustry, setCatalogIndustry] = useState<string>('all');

  // 3. Состояние Интерактивного Симулятора Telegram
  const [simulatedPush, setSimulatedPush] = useState<boolean>(false);
  const [pushStatus, setPushStatus] = useState<string>('Проведено');

  // 4. Состояние Конструктора Доступов RBAC
  const [rbacRole, setRbacRole] = useState<'owner' | 'head_acc' | 'acc' | 'manager'>('head_acc');

  // 5. Состояние Калькулятора Тарифов
  const [calcCompanies, setCalcCompanies] = useState<number>(2);
  const [calcStorage, setCalcStorage] = useState<number>(20); // ГБ
  const [calcEmployees, setCalcEmployees] = useState<number>(3);

  // 6. Состояние Открытых Аккордеонов FAQ
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  // Расчет примерной стоимости в Сомах/месяц
  const calculateMonthlyPrice = () => {
    let base = 0;
    if (calcCompanies > 1) base += (calcCompanies - 1) * 490;
    if (calcStorage > 10) base += Math.ceil((calcStorage - 10) / 10) * 150;
    if (calcEmployees > 2) base += (calcEmployees - 2) * 200;
    return base === 0 ? 'Бесплатно' : `${base.toLocaleString('ru-RU')} сом / мес`;
  };

  // Демо-карточки компаний аутсорсинга
  const sampleOutsourcingCompanies = [
    {
      id: '1',
      name: 'ОсОО «Бишкек Аудит & Консалтинг»',
      rating: 4.9,
      reviewsCount: 28,
      industry: 'trade',
      industryLabel: 'Торговля & Ритейл',
      clientsCount: 42,
      description: 'Комплексное ведение бухгалтерского и налогового учета торговых сетей, розницы и импортеров КР.',
      services: ['Первичный учет', 'Налоговая отчетность', '1С синхронизация'],
    },
    {
      id: '2',
      name: 'Агентство «Азия Профи Учет»',
      rating: 5.0,
      reviewsCount: 35,
      industry: 'services',
      industryLabel: 'Услуги & IT',
      clientsCount: 58,
      description: 'Экспертный аутсорсинг для компаний сферы услуг, консалтинга и IT-сектора. Сопровождение ПВТ.',
      services: ['Кадровый учет', 'Оптимизация налогов', 'ЭДО автопилот'],
    },
    {
      id: '3',
      name: 'Консалтинг «Ош Пром Финанс»',
      rating: 4.8,
      reviewsCount: 19,
      industry: 'production',
      industryLabel: 'Производство',
      clientsCount: 24,
      description: 'Учет себестоимости продукции, списание сырья, калькуляция материалов и складов в производстве.',
      services: ['Складской учет', 'Калькуляция затрат', 'Формы ГНС'],
    },
    {
      id: '4',
      name: 'ОсОО «HoReCa Бухгалтерия»',
      rating: 4.9,
      reviewsCount: 22,
      industry: 'food',
      industryLabel: 'Общепит & Рестораны',
      clientsCount: 31,
      description: 'Специализированный учет ресторанов, кафе, точек общепита и заведений доставки по всему Бишкеку.',
      services: ['Техкарты & Калькуляция', 'Экспресс-сверки', 'Реестры первички'],
    },
  ];

  const filteredOutsourcing = sampleOutsourcingCompanies.filter((c) =>
    catalogIndustry === 'all' ? true : c.industry === catalogIndustry
  );

  // JSON-LD для SEO
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
      'Цифровая экосистема автоматизации бухгалтерского учета КР. Прозрачный документооборот, каталог аутсорсинга и контроля первички.',
    author: {
      '@type': 'Organization',
      name: 'Buhuchet.kg',
      url: 'https://buhuchet.kg',
    },
  };

  const handleSimulatePush = (status: string) => {
    setPushStatus(status);
    setSimulatedPush(true);
    setTimeout(() => {
      setSimulatedPush(false);
    }, 4000);
  };

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-blue-600 selection:text-white relative overflow-x-hidden font-sans">
      {/* 0. Микроразметка Schema.org JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Фоновые стильные свечения (Glow Effects) */}
      <div className="absolute top-0 left-1/4 w-80 sm:w-[600px] h-80 sm:h-[600px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none animate-pulse" />
      <div className="absolute top-1/3 right-4 sm:right-10 w-80 sm:w-[500px] h-80 sm:h-[500px] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-10 left-1/3 w-[300px] sm:w-[600px] h-[300px] sm:h-[600px] bg-teal-600/10 rounded-full blur-[150px] pointer-events-none" />

      {/* 1. ФИКСИРОВАННЫЙ НАВБАР - ПАРЯЩИЙ ОСТРОВОК */}
      <header className="sticky top-3 sm:top-4 z-50 mx-2 sm:mx-6 md:mx-12 my-2 h-14 sm:h-16 rounded-2xl sm:rounded-3xl bg-card/85 backdrop-blur-xl border border-border shadow-2xl flex items-center justify-between px-3 sm:px-6 transition-all">
        <Link href="/" className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          <div className="flex h-8 sm:h-10 w-8 sm:w-10 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-lg shadow-blue-500/20 shrink-0">
            <FileText className="h-4 sm:h-5 w-4 sm:w-5" />
          </div>
          <div className="min-w-0 truncate">
            <span className="font-bold text-base sm:text-xl text-foreground tracking-tight truncate">
              Buhuchet.kg
            </span>
            <span className="hidden sm:inline-block ml-2 text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-semibold">
              Экосистема Бухучета КР
            </span>
          </div>
        </Link>

        {/* Навигационные ссылки */}
        <nav className="hidden lg:flex items-center space-x-6 text-xs font-medium text-muted-foreground">
          <a href="#ecosystem" className="hover:text-foreground transition-colors">
            Экосистема
          </a>
          <a href="#catalog" className="hover:text-foreground transition-colors">
            Каталог Аутсорсинга
          </a>
          <a href="#telegram" className="hover:text-foreground transition-colors">
            Уведомления
          </a>
          <a href="#roadmap" className="hover:text-foreground transition-colors">
            Модули учета
          </a>
          <a href="#rbac" className="hover:text-foreground transition-colors">
            Права доступов
          </a>
          <a href="#pricing" className="hover:text-foreground transition-colors">
            Тарифы
          </a>
          <a href="#faq" className="hover:text-foreground transition-colors">
            FAQ
          </a>
        </nav>

        <div className="flex items-center space-x-1.5 sm:space-x-3 shrink-0">
          <ThemeToggle />

          <Link
            href="/login"
            className="text-xs sm:text-sm font-medium text-muted-foreground hover:text-foreground px-2.5 sm:px-3 py-1.5 sm:py-2 transition-colors"
          >
            Войти
          </Link>

          <Link
            href="/register"
            className="px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs sm:text-sm transition-all shadow-lg shadow-blue-600/20 active:scale-95 whitespace-nowrap"
          >
            <span>Подключить компанию</span>
          </Link>
        </div>
      </header>

      {/* 2. HERO SECTION */}
      <section className="px-3 sm:px-6 md:px-12 pt-8 sm:pt-12 pb-16 sm:pb-24 max-w-7xl mx-auto space-y-10 sm:space-y-16">
        <div className="text-center space-y-5 sm:space-y-7 max-w-4xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 sm:px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-[11px] sm:text-xs font-bold text-blue-400 backdrop-blur-md shadow-sm">
            <Sparkles className="h-3.5 sm:h-4 w-3.5 sm:w-4 shrink-0 text-blue-400 animate-pulse" />
            <span>Комплексная цифровая система автоматизации бухгалтерского учета КР</span>
          </div>

          <h1 className="text-2xl sm:text-5xl md:text-6xl font-black text-foreground tracking-tight leading-[1.12] break-words">
            Не просто документооборот. <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-blue-500 via-indigo-400 to-teal-400 bg-clip-text text-transparent">
              Полноценная Автоматизация Бухучета
            </span>{' '}
            для Вашего Бизнеса
          </h1>

          <p className="text-xs sm:text-base md:text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed break-words px-2 font-normal">
            Единая цифровая среда, связывающая предпринимателей и аутсорсинговые бухгалтерские компании. Прозрачный документооборот, мгновенный учет первички, Telegram-оповещения и каталог проверенных экспертов.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
            <Link
              href="/register"
              className="w-full sm:w-auto px-7 sm:px-9 py-4 sm:py-4.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-sm sm:text-base transition-all shadow-xl shadow-blue-600/30 flex items-center justify-center min-h-[52px] active:scale-95"
            >
              <span>Зарегистрировать компанию</span>
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>

            <a
              href="#catalog"
              className="w-full sm:w-auto px-7 sm:px-9 py-4 sm:py-4.5 rounded-2xl bg-card hover:bg-muted text-foreground border border-border font-bold text-sm sm:text-base transition-all flex items-center justify-center min-h-[52px] shadow-sm"
            >
              <Search className="mr-2 h-4 w-4 text-purple-400" />
              <span>Каталог аутсорсинга</span>
            </a>
          </div>
        </div>

        {/* Метрики системы */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
          <div className="p-5 rounded-2xl bg-card border border-border backdrop-blur-xl space-y-1 shadow-sm">
            <span className="text-[10px] sm:text-xs font-mono uppercase text-blue-400 font-bold">Скорость обмена</span>
            <p className="text-xl sm:text-3xl font-black text-foreground">3 Секунды</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground">Мгновенный отправка первички по ИНН</p>
          </div>

          <div className="p-5 rounded-2xl bg-card border border-border backdrop-blur-xl space-y-1 shadow-sm">
            <span className="text-[10px] sm:text-xs font-mono uppercase text-purple-400 font-bold">Сжатие сканов</span>
            <p className="text-xl sm:text-3xl font-black text-purple-400">До 200 КБ</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground">Автосжатие фото накладных и актов</p>
          </div>

          <div className="p-5 rounded-2xl bg-card border border-border backdrop-blur-xl space-y-1 shadow-sm">
            <span className="text-[10px] sm:text-xs font-mono uppercase text-teal-400 font-bold">Экономия времени</span>
            <p className="text-xl sm:text-3xl font-black text-teal-400">До 80%</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground">Автоматизация проведения первички</p>
          </div>

          <div className="p-5 rounded-2xl bg-card border border-border backdrop-blur-xl space-y-1 shadow-sm">
            <span className="text-[10px] sm:text-xs font-mono uppercase text-amber-400 font-bold">Сохранность архива</span>
            <p className="text-xl sm:text-3xl font-black text-amber-400">100% Защита</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground">Щедрые лимиты хранения документов</p>
          </div>
        </div>

        {/* ИНТЕРАКТИВНЫЙ МАКЕТ ДАШБОРДА ПЛАТФОРМЫ */}
        <div className="relative rounded-3xl bg-slate-900 border border-slate-800 p-3 sm:p-6 shadow-2xl overflow-hidden backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-rose-500/80" />
              <div className="w-3 h-3 rounded-full bg-amber-500/80" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
              <span className="text-xs font-mono text-slate-400 ml-2 hidden sm:inline">app.buhuchet.kg / dashboard</span>
            </div>
            <div className="flex items-center space-x-2">
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                ● Система в сети
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Виджет первички */}
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center">
                  <FileText className="w-4 h-4 mr-1.5 text-blue-400" />
                  Последняя первичка
                </span>
                <span className="text-[10px] text-slate-400">Сегодня</span>
              </div>

              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-white">Акт выполненных работ №104</p>
                    <p className="text-[10px] text-slate-400 font-mono">ОсОО «Бишкек Трейд»</p>
                  </div>
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                    Проведено
                  </Badge>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-white">Товарная накладная №88</p>
                    <p className="text-[10px] text-slate-400 font-mono">ИП «Асанов А.»</p>
                  </div>
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">
                    На подписи
                  </Badge>
                </div>
              </div>
            </div>

            {/* Виджет Telegram-оповещений */}
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center">
                  <BellRing className="w-4 h-4 mr-1.5 text-sky-400" />
                  Telegram Уведомления
                </span>
                <span className="text-[10px] text-sky-400 font-mono">Онлайн</span>
              </div>

              <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-500/30 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sky-300">📬 Buhuchet Bot</span>
                  <span className="text-[10px] text-slate-400">13:45</span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Поступил новый документ от контрагента <strong>ОсОО «Азия Софт»</strong>. Статус: <i>В обработке</i>.
                </p>
              </div>
            </div>

            {/* Виджет финансовых показателей */}
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center">
                  <BarChart3 className="w-4 h-4 mr-1.5 text-purple-400" />
                  Учет документов компании
                </span>
                <span className="text-[10px] text-purple-400 font-mono">+24% этот месяц</span>
              </div>

              <div className="flex items-end justify-between h-20 pt-2 px-2">
                <div className="w-6 bg-blue-600/40 hover:bg-blue-600 h-10 rounded-t-md transition-all" title="Янв" />
                <div className="w-6 bg-blue-600/40 hover:bg-blue-600 h-14 rounded-t-md transition-all" title="Фев" />
                <div className="w-6 bg-blue-600/40 hover:bg-blue-600 h-12 rounded-t-md transition-all" title="Мар" />
                <div className="w-6 bg-purple-600/60 hover:bg-purple-600 h-16 rounded-t-md transition-all" title="Апр" />
                <div className="w-6 bg-teal-500 hover:bg-teal-400 h-20 rounded-t-md transition-all" title="Май" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. БЛОК 2: ДВУСТОРОННЯЯ B2B ЭКОСИСТЕМА (ИНТЕРАКТИВНЫЙ ПЕРЕКЛЮЧАТЕЛЬ РОЛЕЙ) */}
      <section id="ecosystem" className="px-3 sm:px-6 md:px-12 py-12 sm:py-20 max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 bg-indigo-500/10">
            Двусторонняя B2B-Экосистема
          </Badge>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-foreground tracking-tight">
            Единая цифровая платформа для двух ключевых участников рынка
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Buhuchet.kg объединяет коммерческие компании и профессиональных бухгалтеров в прозрачном рабочем пространстве.
          </p>
        </div>

        {/* Переключатель ролей */}
        <div className="flex justify-center">
          <div className="inline-flex p-1.5 bg-card border border-border rounded-2xl shadow-lg">
            <button
              onClick={() => setEcosystemRole('business')}
              className={`flex items-center space-x-2 px-6 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                ecosystemRole === 'business'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>Я — Предприниматель / Бизнес</span>
            </button>

            <button
              onClick={() => setEcosystemRole('accountant')}
              className={`flex items-center space-x-2 px-6 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                ecosystemRole === 'accountant'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Briefcase className="w-4 h-4" />
              <span>Я — Бухгалтер / Аутсорсинг</span>
            </button>
          </div>
        </div>

        {/* Динамическая карточка роли */}
        {ecosystemRole === 'business' ? (
          <div className="p-6 sm:p-10 rounded-3xl bg-card border border-blue-500/30 space-y-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                  Для ОсОО и ИП
                </Badge>
                <h3 className="text-xl sm:text-3xl font-extrabold text-foreground">
                  Полный контроль бухгалтерии без потери первичных документов
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
                  Передавайте документы вашему бухгалтеру или аутсорсинговой компании в 1 клик. Больше никаких потерянных чеков, задержек с подписью актов и хаоса в папках.
                </p>
              </div>

              <Link
                href="/register"
                className="shrink-0 px-6 py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs sm:text-sm shadow-md"
              >
                Подключить свой бизнес ➔
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-border">
              <div className="space-y-1.5">
                <p className="font-bold text-foreground text-sm flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-1.5 text-blue-400" />
                  Поиск проверенного бухгалтера
                </p>
                <p className="text-xs text-muted-foreground">
                  Выбирайте лучших специалистов из открытого реестра аутсорсинговых компаний с реальным рейтингом.
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="font-bold text-foreground text-sm flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-1.5 text-blue-400" />
                  Прозрачность статусов 24/7
                </p>
                <p className="text-xs text-muted-foreground">
                  Отслеживайте проведение первички, статусы выгрузки в 1С и налоговую отчетность прямо с телефона.
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="font-bold text-foreground text-sm flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-1.5 text-blue-400" />
                  Защита от рисков
                </p>
                <p className="text-xs text-muted-foreground">
                  Ваш архив первички надежно сохранен с мгновенным доступом к любому документу за прошлые годы.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 sm:p-10 rounded-3xl bg-card border border-purple-500/30 space-y-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
                  Для Аутсорсинговых Компаний и Бухгалтеров
                </Badge>
                <h3 className="text-xl sm:text-3xl font-extrabold text-foreground">
                  Привлечение новых клиентов и централизованное ведение учета
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
                  Опубликуйте вашу компанию в каталоге Buhuchet.kg, получайте заявки от предпринимателей и ведите учет десятков клиентов в одном удобном кабинете.
                </p>
              </div>

              <Link
                href="/register"
                className="shrink-0 px-6 py-3.5 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs sm:text-sm shadow-md"
              >
                Внести компанию в каталог ➔
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-border">
              <div className="space-y-1.5">
                <p className="font-bold text-foreground text-sm flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-1.5 text-purple-400" />
                  Поток клиентских заявок
                </p>
                <p className="text-xs text-muted-foreground">
                  Публичный профиль в едином каталоге привлечения предпринимателей Бишкека и регионов КР.
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="font-bold text-foreground text-sm flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-1.5 text-purple-400" />
                  Единый кабинет бухгалтера
                </p>
                <p className="text-xs text-muted-foreground">
                  Управляйте десятками клиентов в одной системе без путаницы и переключения учетных записей.
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="font-bold text-foreground text-sm flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-1.5 text-purple-400" />
                  Мгновенная 1С выгрузка
                </p>
                <p className="text-xs text-muted-foreground">
                  Формируйте готовые реестры первички для автоматической выгрузки в 1С прямо на стороне клиента.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 4. БЛОК 3: ИНТЕРАКТИВНЫЙ КАТАЛОГ АУТСОРСИНГА */}
      <section id="catalog" className="px-3 sm:px-6 md:px-12 py-12 sm:py-20 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline" className="border-purple-500/30 text-purple-400 bg-purple-500/10">
              Каталог Аутсорсинга КР
            </Badge>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-foreground tracking-tight">
              Найдите проверенного бухгалтера или аутсорсинговую компанию
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Выберите эксперта под специфику вашего бизнеса или опубликуйте свою организацию в общем реестре.
            </p>
          </div>

          {/* Фильтры отраслей */}
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-2 shrink-0">
            {[
              { id: 'all', label: 'Все отрасли' },
              { id: 'trade', label: 'Торговля & Ритейл' },
              { id: 'services', label: 'Услуги & IT' },
              { id: 'production', label: 'Производство' },
              { id: 'food', label: 'Общепит' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCatalogIndustry(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  catalogIndustry === tab.id
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-card border border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Сетка карточек компании */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredOutsourcing.map((company) => (
            <div
              key={company.id}
              className="p-6 rounded-3xl bg-card border border-border hover:border-purple-500/40 transition-all space-y-4 shadow-md flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-3">
                    <div className="p-3 rounded-2xl bg-purple-600/10 text-purple-400 border border-purple-500/20 font-bold shrink-0">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-foreground text-base leading-tight">{company.name}</h4>
                      <p className="text-xs text-muted-foreground">{company.industryLabel}</p>
                    </div>
                  </div>

                  <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs shrink-0 flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span>{company.rating}</span>
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">{company.description}</p>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {company.services.map((srv) => (
                    <Badge key={srv} variant="outline" className="text-[10px] border-border bg-muted/40 text-foreground">
                      {srv}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-border flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-mono">
                  Обслуживает: <strong className="text-foreground font-bold">{company.clientsCount} компаний</strong>
                </span>

                <Link
                  href="/register"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md transition-all"
                >
                  Запросить сотрудничество ➔
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 5. БЛОК 4: ПРОЗРАЧНЫЙ ДОКУМЕНТООБОРОТ & TELEGRAM-УВЕДОМЛЕНИЯ */}
      <section id="telegram" className="px-3 sm:px-6 md:px-12 py-12 sm:py-20 max-w-7xl mx-auto space-y-8">
        <div className="p-6 sm:p-10 rounded-3xl bg-card border border-sky-500/30 space-y-8 shadow-2xl relative overflow-hidden">
          <div className="text-center space-y-3 max-w-3xl mx-auto">
            <Badge variant="outline" className="border-sky-500/30 text-sky-400 bg-sky-500/10">
              Мгновенная Коммуникация
            </Badge>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-foreground tracking-tight">
              Каждый документ под контролем. Telegram-уведомления без утерь
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Получайте немедленные push-сообщения в мессенджер при загрузке документа партнером или изменении статуса бухгалтером.
            </p>
          </div>

          {/* Интерактивный симулятор отправки и Telegram Push */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center pt-2">
            {/* Левый блок: Действие отправки на ПК */}
            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 text-center">
              <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">Рабочее место (ПК)</p>
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-left">
                <p className="text-xs font-bold text-white">Отправка первички контрагенту</p>
                <p className="text-[11px] text-slate-400">Документ: Акт выполненных работ №204</p>
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  onClick={() => handleSimulatePush('Проведено')}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs h-9 rounded-xl"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  Провести документ
                </Button>

                <Button
                  onClick={() => handleSimulatePush('В обработке')}
                  className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs h-9 rounded-xl"
                >
                  <Clock className="w-3.5 h-3.5 mr-1" />
                  В обработку
                </Button>
              </div>
            </div>

            {/* Правый блок: Мобильный макет с живым Push */}
            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 text-center relative">
              <p className="text-xs font-bold text-sky-400 uppercase tracking-wider">Смартфон Руководителя (Telegram Bot)</p>

              <div className="w-full max-w-xs mx-auto p-4 rounded-2xl bg-slate-900 border border-sky-500/40 shadow-xl space-y-2 text-left relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-xs text-sky-400 flex items-center">
                    <BellRing className="w-3.5 h-3.5 mr-1" />
                    Buhuchet Notification Bot
                  </span>
                  <span className="text-[10px] text-slate-400">Только что</span>
                </div>

                {simulatedPush ? (
                  <div className="space-y-1.5 animate-bounce">
                    <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/40 text-[10px]">
                      Уведомление в мессенджер
                    </Badge>
                    <p className="text-xs text-slate-100 font-medium">
                      🔔 <strong>Статус документа изменен!</strong> <br />
                      Акт №204 переведен в статус: <span className="text-emerald-400 font-bold">«{pushStatus}»</span>.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    Нажмите «Провести документ» слева для проверки эффекта всплывающего оповещения...
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. БЛОК 5: ОТРАСЛЕВАЯ МАСШТАБИРУЕМОСТЬ & ROADMAP */}
      <section id="roadmap" className="px-3 sm:px-6 md:px-12 py-12 sm:py-20 max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <Badge variant="outline" className="border-teal-500/30 text-teal-400 bg-teal-500/10">
            Отраслевая Масштабируемость
          </Badge>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-foreground tracking-tight">
            Адаптивный учет для любой сферы бизнеса в КР
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Пошаговое расширение функционала от первичного документооборота до полного товарного учета и отраслевых спецмодулей.
          </p>
        </div>

        {/* Дорожная карта (Roadmap) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
          <div className="p-6 rounded-3xl bg-card border border-teal-500/40 space-y-4 shadow-lg relative">
            <Badge className="bg-teal-500/20 text-teal-400 border-teal-500/30 text-xs">
              Этап 1 — Доступен Сейчас
            </Badge>
            <h3 className="text-lg font-bold text-foreground">Первичный документооборот</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Прием, обработка, подписание и сохранение актов, накладных и счетов. Бесшовный B2B-обмен первички по ИНН.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-card border border-border space-y-4 shadow-sm relative opacity-90">
            <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-xs">
              Этап 2 — Ближайший релиз
            </Badge>
            <h3 className="text-lg font-bold text-foreground">Товарный и складской учет ТМЦ</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Управление остатками на складах, инвентаризация, приход и списание товаров, контроль движения материалов.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-card border border-border space-y-4 shadow-sm relative opacity-80">
            <Badge variant="outline" className="border-purple-500/30 text-purple-400 bg-purple-500/10 text-xs">
              Этап 3 — Перспектива
            </Badge>
            <h3 className="text-lg font-bold text-foreground">Отраслевые спецмодули</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Специализированный учет для Торговли (маркетплейсы), Услуг, Общепита (техкарты) и Производства (себестоимость).
            </p>
          </div>
        </div>
      </section>

      {/* 7. БЛОК 6: КОНСТРУКТОР ДОСТУПОВ (RBAC) */}
      <section id="rbac" className="px-3 sm:px-6 md:px-12 py-12 sm:py-20 max-w-7xl mx-auto space-y-8">
        <div className="p-6 sm:p-10 rounded-3xl bg-card border border-purple-500/30 space-y-8 shadow-2xl">
          <div className="text-center space-y-3 max-w-3xl mx-auto">
            <Badge variant="outline" className="border-purple-500/30 text-purple-400 bg-purple-500/10">
              Безопасность и Настройка Прав (RBAC)
            </Badge>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-foreground tracking-tight">
              Гибкая настройка прав доступа для каждого сотрудника
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Каждый специалист вашей компании видит только те разделы и документы, которые положены ему по должности.
            </p>
          </div>

          {/* Интерактивный переключатель роли в конструкторе */}
          <div className="flex justify-center">
            <div className="inline-flex p-1.5 bg-background border border-border rounded-2xl">
              {[
                { id: 'owner', label: 'Владелец / Директор' },
                { id: 'head_acc', label: 'Главный Бухгалтер' },
                { id: 'acc', label: 'Бухгалтер по Первичке' },
                { id: 'manager', label: 'Менеджер по Продажам' },
              ].map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRbacRole(r.id as any)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    rbacRole === r.id
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Таблица прав для выбранной роли */}
          <div className="max-w-2xl mx-auto p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 font-bold text-slate-300">
              <span>Модуль системы</span>
              <span>Разрешенные действия</span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-900">
              <span className="text-slate-200">Первичные документы</span>
              <Badge className={rbacRole === 'manager' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}>
                {rbacRole === 'manager' ? 'Только свои документы' : 'Полный доступ (Создание/Проведение)'}
              </Badge>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-900">
              <span className="text-slate-200">Управление сотрудниками</span>
              <Badge className={rbacRole === 'owner' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}>
                {rbacRole === 'owner' ? 'Полный контроль ролей' : 'Доступ закрыт'}
              </Badge>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-slate-200">Закрытие отчетного периода</span>
              <Badge className={rbacRole === 'owner' || rbacRole === 'head_acc' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}>
                {rbacRole === 'owner' || rbacRole === 'head_acc' ? 'Разрешено' : 'Доступ закрыт'}
              </Badge>
            </div>
          </div>
        </div>
      </section>

      {/* 8. БЛОК 7: ИНТЕРАКТИВНЫЙ КАЛЬКУЛЯТОР И ТАРИФЫ */}
      <section id="pricing" className="px-3 sm:px-6 md:px-12 py-12 sm:py-20 max-w-7xl mx-auto space-y-10">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
            Прозрачные Тарифы
          </Badge>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-foreground tracking-tight">
            Рассчитайте стоимость для вашей компании
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Прозрачные условия без скрытых платежей. Оплата только за реальный объем дискового пространства и число юридических лиц.
          </p>
        </div>

        {/* Интерактивный Калькулятор */}
        <div className="p-6 sm:p-8 rounded-3xl bg-card border border-blue-500/30 max-w-3xl mx-auto space-y-6 shadow-xl">
          <h3 className="text-base font-bold text-foreground flex items-center">
            <Sliders className="w-5 h-5 mr-2 text-blue-400" />
            Интерактивный Калькулятор Стоимости
          </h3>

          <div className="space-y-5">
            {/* Ползунок Компаний */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span>Количество Организаций:</span>
                <span className="text-blue-400 font-bold">{calcCompanies} юр. лиц</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={calcCompanies}
                onChange={(e) => setCalcCompanies(Number(e.target.value))}
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>

            {/* Ползунок Хранилища */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span>Объем Хранилища Документов:</span>
                <span className="text-purple-400 font-bold">{calcStorage} ГБ</span>
              </div>
              <input
                type="range"
                min="10"
                max="200"
                step="10"
                value={calcStorage}
                onChange={(e) => setCalcStorage(Number(e.target.value))}
                className="w-full accent-purple-600 cursor-pointer"
              />
            </div>

            {/* Ползунок Сотрудников */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span>Количество Сотрудников:</span>
                <span className="text-teal-400 font-bold">{calcEmployees} человек</span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                value={calcEmployees}
                onChange={(e) => setCalcEmployees(Number(e.target.value))}
                className="w-full accent-teal-500 cursor-pointer"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-border flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Ориентировочная стоимость:</p>
              <p className="text-2xl font-black text-blue-400">{calculateMonthlyPrice()}</p>
            </div>

            <Link
              href="/register"
              className="px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md"
            >
              Подключить тариф ➔
            </Link>
          </div>
        </div>

        {/* Сетка основных тарифных планов */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
          <div className="p-6 rounded-3xl bg-card border border-border space-y-4 shadow-sm flex flex-col justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="border-border text-muted-foreground text-xs">
                Бесплатный Старт
              </Badge>
              <h4 className="text-xl font-bold text-foreground">Стартовый</h4>
              <p className="text-2xl font-black text-foreground">0 сом / мес</p>
              <p className="text-xs text-muted-foreground">Идеально для ознакомления и небольших ИП.</p>

              <ul className="space-y-2 pt-2 text-xs text-muted-foreground">
                <li className="flex items-center">
                  <Check className="w-4 h-4 mr-2 text-emerald-400" />
                  <span>1 Организация</span>
                </li>
                <li className="flex items-center">
                  <Check className="w-4 h-4 mr-2 text-emerald-400" />
                  <span>5 ГБ хранилища</span>
                </li>
                <li className="flex items-center">
                  <Check className="w-4 h-4 mr-2 text-emerald-400" />
                  <span>До 2 пользователей</span>
                </li>
              </ul>
            </div>

            <Link
              href="/register"
              className="w-full py-3 rounded-xl bg-card border border-border hover:bg-muted text-foreground font-bold text-xs text-center transition-colors"
            >
              Начать бесплатно
            </Link>
          </div>

          <div className="p-6 rounded-3xl bg-card border border-blue-500/40 space-y-4 shadow-xl flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-blue-600 text-white text-[10px] font-extrabold px-3 py-1 rounded-bl-xl uppercase tracking-wider">
              Популярный
            </div>

            <div className="space-y-3">
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                Для Бизнеса
              </Badge>
              <h4 className="text-xl font-bold text-foreground">Коммерческий</h4>
              <p className="text-2xl font-black text-blue-400">1 490 сом / мес</p>
              <p className="text-xs text-muted-foreground">Для развивающихся ОсОО с регулярным документооборотом.</p>

              <ul className="space-y-2 pt-2 text-xs text-muted-foreground">
                <li className="flex items-center">
                  <Check className="w-4 h-4 mr-2 text-blue-400" />
                  <span>До 3 Организаций</span>
                </li>
                <li className="flex items-center">
                  <Check className="w-4 h-4 mr-2 text-blue-400" />
                  <span>50 ГБ хранилища первички</span>
                </li>
                <li className="flex items-center">
                  <Check className="w-4 h-4 mr-2 text-blue-400" />
                  <span>До 5 сотрудников с ролями</span>
                </li>
                <li className="flex items-center">
                  <Check className="w-4 h-4 mr-2 text-blue-400" />
                  <span>Telegram-бот оповещения</span>
                </li>
              </ul>
            </div>

            <Link
              href="/register"
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs text-center shadow-md transition-colors"
            >
              Выбрать Бизнес
            </Link>
          </div>

          <div className="p-6 rounded-3xl bg-card border border-purple-500/40 space-y-4 shadow-lg flex flex-col justify-between">
            <div className="space-y-3">
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
                Для Аутсорсинга
              </Badge>
              <h4 className="text-xl font-bold text-foreground">Аутсорсинг Pro</h4>
              <p className="text-2xl font-black text-purple-400">3 990 сом / мес</p>
              <p className="text-xs text-muted-foreground">Для бухгалтерских компаний и агентств с набором клиентов.</p>

              <ul className="space-y-2 pt-2 text-xs text-muted-foreground">
                <li className="flex items-center">
                  <Check className="w-4 h-4 mr-2 text-purple-400" />
                  <span>Неограниченное число клиентов</span>
                </li>
                <li className="flex items-center">
                  <Check className="w-4 h-4 mr-2 text-purple-400" />
                  <span>Публикация в каталоге КР</span>
                </li>
                <li className="flex items-center">
                  <Check className="w-4 h-4 mr-2 text-purple-400" />
                  <span>200 ГБ хранилища первички</span>
                </li>
                <li className="flex items-center">
                  <Check className="w-4 h-4 mr-2 text-purple-400" />
                  <span>Выгрузка в 1С в 1 клик</span>
                </li>
              </ul>
            </div>

            <Link
              href="/register"
              className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs text-center shadow-md transition-colors"
            >
              Подключить Аутсорсинг
            </Link>
          </div>
        </div>
      </section>

      {/* 9. БЛОК FAQ (ВОПРОСЫ И ОТВЕТЫ) */}
      <section id="faq" className="px-3 sm:px-6 md:px-12 py-12 sm:py-20 max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-3">
          <Badge variant="outline" className="border-purple-500/30 text-purple-400 bg-purple-500/10">
            Вопросы и Ответы
          </Badge>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-foreground tracking-tight">
            Ответы на популярные вопросы
          </h2>
        </div>

        <div className="space-y-3">
          {[
            {
              q: 'Чем Buhuchet.kg отличается от обычных утилит для отправки файлов?',
              a: 'Buhuchet.kg — это комплексная цифровая экосистема, которая связывает коммерческие компании и бухгалтеров. Она обеспечивает прозрачный статус учета ("Проведено", "В обработке"), мгновенные Telegram-уведомления, каталог проверенных аутсорсинговых компаний и экспорт в 1С.',
            },
            {
              q: 'Как работает защита и сохранение архива документов?',
              a: 'Все сканы и акты сохраняются в надежном дисковом пространстве с постоянным доступом 24/7 с любого ПК или смартфона. Документы систематизируются по контрагентам и датам без риска утери.',
            },
            {
              q: 'Как зарегистрировать свою аутсорсинговую компанию в каталоге?',
              a: 'При регистрации выберите тип учетной записи "Я Владелец / Аутсорсинг". После заполнения реквизитов вы сможете выставить параметры ваших услуг и попасть в публичный каталог для привлечения новых клиентов.',
            },
            {
              q: 'Как настроить права доступа разным сотрудникам?',
              a: 'В модуле "Сотрудники" руководитель может назначить роли с точной настройкой прав: Менеджер видит только свои счета, Бухгалтер ведет первичку, а Руководитель контролирует все процессы.',
            },
            {
              q: 'Как работают Telegram-уведомления?',
              a: 'Вы подключаете персонального Telegram-бота в 1 клик. Каждое изменение статуса первички или поступление нового документа от контрагента мгновенно присылает push-сообщение.',
            },
          ].map((item, idx) => (
            <div key={idx} className="p-5 rounded-2xl bg-card border border-border space-y-2">
              <button
                onClick={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                className="w-full flex items-center justify-between text-left font-bold text-foreground text-sm sm:text-base focus:outline-none"
              >
                <span>{item.q}</span>
                {openFaqIndex === idx ? (
                  <ChevronUp className="w-4 h-4 text-purple-400 shrink-0 ml-2" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
                )}
              </button>

              {openFaqIndex === idx && (
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed pt-2 border-t border-border/60">
                  {item.a}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 10. ФИНАЛЬНАЯ КОНВЕРСИОННАЯ КАРТОЧКА */}
      <section className="px-3 sm:px-6 md:px-12 py-12 max-w-7xl mx-auto">
        <div className="p-8 sm:p-14 rounded-3xl bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 border border-blue-500/40 text-center space-y-6 shadow-2xl relative overflow-hidden">
          <div className="space-y-3 max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
              Готовы автоматизировать бухгалтерский учет вашего бизнеса?
            </h2>
            <p className="text-xs sm:text-base text-slate-300 leading-relaxed">
              Присоединяйтесь к единой цифровой экосистеме Кыргызской Республики уже сегодня. Бесплатная регистрация за 1 минуту.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              href="/register"
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-sm sm:text-base shadow-xl shadow-blue-600/30 transition-all active:scale-95"
            >
              Подключить компанию бесплатно ➔
            </Link>
          </div>
        </div>
      </section>

      {/* 11. ФУТЕР ПЛАТФОРМЫ */}
      <footer className="border-t border-border bg-card py-12 px-4 md:px-12 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <span className="font-bold text-base text-foreground tracking-tight">Buhuchet.kg</span>
              <p className="text-xs text-muted-foreground">Цифровая Экосистема Автоматизации Бухучета КР</p>
            </div>
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>© {new Date().getFullYear()} Buhuchet.kg. Все права защищены.</p>
            <p>Кыргызская Республика, г. Бишкек</p>
          </div>

          <div className="flex items-center space-x-5 text-xs font-semibold text-muted-foreground">
            <Link href="/login" className="hover:text-foreground transition-colors">
              Войти
            </Link>
            <Link href="/register" className="hover:text-foreground transition-colors">
              Регистрация
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
