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
      'Первая национальная платформа B2B электронного документооборота и облачного архива первичной документации ОсОО и ИП в Кыргызской Республике.',
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

      {/* Декоративные фоновые свечения (Glows) */}
      <div className="absolute top-0 left-1/4 w-72 sm:w-96 h-72 sm:h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute top-1/3 right-4 sm:right-10 w-72 sm:w-96 h-72 sm:h-96 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-1/3 w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* 1. ФИКСИРОВАННЫЙ НАВБАР - АДАПТИВНЫЙ ПАРЯЩИЙ ОСТРОВОК */}
      <header className="sticky top-3 sm:top-4 z-50 mx-2 sm:mx-6 md:mx-12 my-2 h-14 sm:h-16 rounded-2xl sm:rounded-3xl bg-slate-900/70 backdrop-blur-xl border border-slate-800/80 shadow-2xl flex items-center justify-between px-3 sm:px-6 transition-all">
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          <div className="flex h-8 sm:h-10 w-8 sm:w-10 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-lg shadow-blue-500/20 flex-shrink-0">
            <FileText className="h-4 sm:h-5 w-4 sm:w-5" />
          </div>
          <div className="min-w-0 truncate">
            <span className="font-bold text-sm sm:text-lg text-white tracking-tight truncate">Buhuchet.kg</span>
            <span className="hidden sm:inline-block ml-2 text-[10px] uppercase font-mono tracking-widest px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400">
              B2B Network КР
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 sm:space-x-3 flex-shrink-0">
          <Link
            href="/login"
            className="text-xs sm:text-sm font-medium text-slate-300 hover:text-white px-2.5 sm:px-3 py-1.5 sm:py-2 transition-colors"
          >
            Войти
          </Link>

          <Link
            href="/register"
            className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs sm:text-sm transition-all shadow-lg shadow-blue-600/25 active:scale-95 whitespace-nowrap"
          >
            <span className="hidden xs:inline">Подключить</span>
            <span className="xs:hidden">Старт</span>
          </Link>
        </div>
      </header>

      {/* 2. HERO SECTION */}
      <section className="px-3 sm:px-6 md:px-12 pt-6 sm:pt-10 pb-12 sm:pb-16 max-w-7xl mx-auto space-y-8 sm:space-y-12">
        <div className="text-center space-y-4 sm:space-y-6 max-w-4xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 sm:px-4 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 text-[11px] sm:text-xs font-medium text-amber-400 backdrop-blur-md shadow-lg max-w-full truncate">
            <Sparkles className="h-3.5 sm:h-4 w-3.5 sm:w-4 flex-shrink-0" />
            <span className="truncate">Первая национальная платформа B2B документооборота КР</span>
          </div>

          <h1 className="text-2xl sm:text-5xl md:text-6xl font-black text-white tracking-tight leading-[1.15] break-words">
            Электронный Документооборот и <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
              Облачный Архив Первички
            </span>
          </h1>

          <p className="text-xs sm:text-base md:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed break-words px-2">
            Мгновенный обход бумажной волокиты для ОсОО и ИП в Кыргызской Республике. Отправляйте акты, накладные и счета контрагентам по ИНН за 3 секунды.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              href="/register"
              className="w-full sm:w-auto px-6 sm:px-8 py-3.5 sm:py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm sm:text-base transition-all shadow-xl shadow-blue-600/30 flex items-center justify-center min-h-[48px] active:scale-95"
            >
              <span>Зарегистрировать Организацию</span>
              <ArrowRight className="ml-2 h-4 sm:h-5 w-4 sm:w-5" />
            </Link>

            <Link
              href="/login"
              className="w-full sm:w-auto px-6 sm:px-8 py-3.5 sm:py-4 rounded-2xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-800 font-semibold text-sm sm:text-base transition-all flex items-center justify-center min-h-[48px]"
            >
              Вход в Личный Кабинет
            </Link>
          </div>
        </div>

        {/* Интерактивная карточка метрик системы */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 pt-4">
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-xl space-y-1">
            <span className="text-[10px] sm:text-xs font-mono uppercase text-blue-400 font-semibold">Скорость отправки</span>
            <p className="text-xl sm:text-3xl font-black text-white">3 Секунды</p>
            <p className="text-[10px] sm:text-xs text-slate-400">Мгновенный B2B обмен по ИНН</p>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-xl space-y-1">
            <span className="text-[10px] sm:text-xs font-mono uppercase text-purple-400 font-semibold">Сжатие сканов</span>
            <p className="text-xl sm:text-3xl font-black text-purple-400">До 200 КБ</p>
            <p className="text-[10px] sm:text-xs text-slate-400">Автосжатие фото на клиенте</p>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-xl space-y-1">
            <span className="text-[10px] sm:text-xs font-mono uppercase text-emerald-400 font-semibold">Доступность</span>
            <p className="text-xl sm:text-3xl font-black text-emerald-400">99.9%</p>
            <p className="text-[10px] sm:text-xs text-slate-400">Облачный архив R2</p>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-xl space-y-1">
            <span className="text-[10px] sm:text-xs font-mono uppercase text-amber-400 font-semibold">Защита доступов</span>
            <p className="text-xl sm:text-3xl font-black text-amber-400">RBAC ACL</p>
            <p className="text-[10px] sm:text-xs text-slate-400">Точечные роли сотрудников</p>
          </div>
        </div>
      </section>

      {/* 3. ВОЗМОЖНОСТИ ПЛАТФОРМЫ (FEATURES) */}
      <section className="px-3 sm:px-6 md:px-12 py-12 sm:py-20 max-w-7xl mx-auto space-y-10 sm:space-y-16">
        <div className="text-center space-y-3 max-w-3xl mx-auto px-2">
          <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
            Возможности Системы
          </Badge>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight break-words">
            Всё необходимый функционал для современного бизнеса в КР
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Оптимизирован для руководителей, главных бухгалтеров и сотрудников коммерческих отделов.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* 1. Электронный документооборот */}
          <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/40 border border-slate-800 hover:border-blue-500/40 transition-all space-y-4 backdrop-blur-xl shadow-xl flex flex-col justify-between">
            <div className="space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center">
                <Send className="h-6 w-6" />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white">Электронный документооборот</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Обменивайтесь актами выполненных работ, накладными и договорами с партнерами по ИНН. Отслеживайте статусы на рассмотрении, принято и отклонено в реальном времени.
              </p>
            </div>
            <div className="pt-2 flex items-center text-xs font-semibold text-blue-400">
              <CheckCircle2 className="h-4 w-4 mr-1.5 text-blue-400" />
              <span>Подтверждение в 1 клик</span>
            </div>
          </div>

          {/* 2. Облачный архив */}
          <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/40 border border-slate-800 hover:border-emerald-500/40 transition-all space-y-4 backdrop-blur-xl shadow-xl flex flex-col justify-between">
            <div className="space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <FolderOpen className="h-6 w-6" />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white">Облачный архив</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Хранение сканов уставных документов и первички. Фотографируйте накладные с телефона — система автоматически сожмет изображение до 200 КБ перед загрузкой.
              </p>
            </div>
            <div className="pt-2 flex items-center text-xs font-semibold text-emerald-400">
              <CheckCircle2 className="h-4 w-4 mr-1.5 text-emerald-400" />
              <span>Автосжатие в браузере</span>
            </div>
          </div>

          {/* 3. Управление сотрудниками & RBAC */}
          <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/40 border border-slate-800 hover:border-purple-500/40 transition-all space-y-4 backdrop-blur-xl shadow-xl flex flex-col justify-between">
            <div className="space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center">
                <Users className="h-6 w-6" />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white">Гибкая ролевая модель</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Создавайте аккаунты для бухгалтеров и менеджеров. Настраивайте точную матрицу разрешений на просмотр, создание, отправку или удаление данных.
              </p>
            </div>
            <div className="pt-2 flex items-center text-xs font-semibold text-purple-400">
              <CheckCircle2 className="h-4 w-4 mr-1.5 text-purple-400" />
              <span>Разграничение прав RBAC</span>
            </div>
          </div>

          {/* 4. Безопасность и Модерация */}
          <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/40 border border-slate-800 hover:border-amber-500/40 transition-all space-y-4 backdrop-blur-xl shadow-xl flex flex-col justify-between">
            <div className="space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white">Модерация Контрагентов</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Все компании проходят обязательную верификацию суперадминистратором по ИНН. При обнаружении нарушений недобросовестный партнер подсвечивается красным бейджем "Заблокирован".
              </p>
            </div>
            <div className="pt-2 flex items-center text-xs font-semibold text-amber-400">
              <CheckCircle2 className="h-4 w-4 mr-1.5 text-amber-400" />
              <span>Защита от недобросовестных лиц</span>
            </div>
          </div>

          {/* 5. Telegram-Уведомления */}
          <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/40 border border-slate-800 hover:border-sky-500/40 transition-all space-y-4 backdrop-blur-xl shadow-xl flex flex-col justify-between">
            <div className="space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center">
                <BellRing className="h-6 w-6" />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white">Telegram Уведомления</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Мгновенные алерты в мессенджер при получении нового входящего документа или изменении статуса отправки от ваших контрагентов.
              </p>
            </div>
            <div className="pt-2 flex items-center text-xs font-semibold text-sky-400">
              <CheckCircle2 className="h-4 w-4 mr-1.5 text-sky-400" />
              <span>Асинхронные Webhooks</span>
            </div>
          </div>

          {/* 6. Мобильная адаптивность */}
          <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/40 border border-slate-800 hover:border-indigo-500/40 transition-all space-y-4 backdrop-blur-xl shadow-xl flex flex-col justify-between">
            <div className="space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <Smartphone className="h-6 w-6" />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white">100% Mobile Ready</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Специальный интерфейс с плавающими навигационными элементами (Floating Bottom Nav) адаптирован под смартфоны с любым разрешением экрана.
              </p>
            </div>
            <div className="pt-2 flex items-center text-xs font-semibold text-indigo-400">
              <CheckCircle2 className="h-4 w-4 mr-1.5 text-indigo-400" />
              <span>Удобная работа с телефона</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. СРАВНЕНИЕ: БУМАЖНЫЙ УЧЕТ VS BUHUCHET.KG */}
      <section className="px-3 sm:px-6 md:px-12 py-12 max-w-7xl mx-auto">
        <div className="p-6 sm:p-10 rounded-3xl bg-slate-900/60 border border-slate-800 backdrop-blur-2xl space-y-8 shadow-2xl">
          <div className="text-center space-y-3 max-w-2xl mx-auto">
            <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10">
              Эффективность
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight break-words">
              Сравнение процессов работы
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Традиционный бумажный обмен */}
            <div className="p-5 sm:p-6 rounded-2xl bg-red-500/5 border border-red-500/20 space-y-4">
              <h4 className="text-sm sm:text-base font-bold text-red-400 uppercase tracking-wider flex items-center">
                Традиционная Бумажная Документация
              </h4>
              <ul className="space-y-3 text-xs sm:text-sm text-slate-400">
                <li className="flex items-start">
                  <span className="text-red-400 mr-2 font-bold">✕</span>
                  <span>Распечатка документов и расходы на курьеров или такси</span>
                </li>
                <li className="flex items-start">
                  <span className="text-red-400 mr-2 font-bold">✕</span>
                  <span>Ожидание подписи партнеров от 3 до 14 дней</span>
                </li>
                <li className="flex items-start">
                  <span className="text-red-400 mr-2 font-bold">✕</span>
                  <span>Риск утери первичных актов и накладных при пересылке</span>
                </li>
              </ul>
            </div>

            {/* Внедрение Buhuchet.kg */}
            <div className="p-5 sm:p-6 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 space-y-4">
              <h4 className="text-sm sm:text-base font-bold text-emerald-400 uppercase tracking-wider flex items-center">
                Buhuchet.kg — Электронный Документооборот
              </h4>
              <ul className="space-y-3 text-xs sm:text-sm text-slate-300">
                <li className="flex items-start">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0 mt-0.5" />
                  <span>Мгновенная доставка контрагентам по ИНН за 3 секунды</span>
                </li>
                <li className="flex items-start">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0 mt-0.5" />
                  <span>Подтверждение документа в 1 клик с мобильного устройства</span>
                </li>
                <li className="flex items-start">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0 mt-0.5" />
                  <span>Безопасный Облачный архив первички с круглосуточным доступом</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 5. БЛОК FAQ */}
      <section className="px-3 sm:px-6 md:px-12 py-12 max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-3">
          <Badge variant="outline" className="border-purple-500/30 text-purple-400 bg-purple-500/10">
            Вопросы и Ответы
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight break-words">
            Часто задаваемые вопросы
          </h2>
        </div>

        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-2">
            <h4 className="font-bold text-white text-sm sm:text-base flex items-center">
              <HelpCircle className="h-4 w-4 mr-2 text-blue-400 flex-shrink-0" />
              Как зарегистрировать организацию (ОсОО или ИП)?
            </h4>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed pl-6">
              Нажмите кнопку "Подключить" в шапке сайта, укажите названия, ИНН и данные руководителя. После отправки заявка поступает модератору для проверки.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-2">
            <h4 className="font-bold text-white text-sm sm:text-base flex items-center">
              <HelpCircle className="h-4 w-4 mr-2 text-purple-400 flex-shrink-0" />
              Как работает автосжатие файлов перед загрузкой?
            </h4>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed pl-6">
              При загрузке скана или фотографии документа библиотека в вашем браузере автоматически уменьшает разрешение и сопоставляет оптимальное качество, снижая размер файла до ~200 КБ без потери читаемости текста.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-2">
            <h4 className="font-bold text-white text-sm sm:text-base flex items-center">
              <HelpCircle className="h-4 w-4 mr-2 text-emerald-400 flex-shrink-0" />
              Можно ли ограничить доступ отдельным сотрудникам?
            </h4>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed pl-6">
              Да! В разделе "Сотрудники и доступы" руководитель компании может создать роли с точной настройкой прав на просмотр, удаление, отправку или принятие документов.
            </p>
          </div>
        </div>
      </section>

      {/* 6. ФУТЕР ПЛАТФОРМЫ */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-10 px-4 md:px-12 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
          <div className="flex items-center space-x-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <span className="font-bold text-base text-white tracking-tight">Buhuchet.kg</span>
              <p className="text-xs text-slate-400">Национальная платформа B2B документов КР</p>
            </div>
          </div>

          <div className="text-xs text-slate-400 space-y-1">
            <p>© {new Date().getFullYear()} Buhuchet.kg. Все права защищены.</p>
            <p>Кыргызская Республика, г. Бишкек</p>
          </div>

          <div className="flex items-center space-x-4 text-xs text-slate-400">
            <Link href="/login" className="hover:text-white transition-colors">Войти</Link>
            <Link href="/register" className="hover:text-white transition-colors">Регистрация</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
