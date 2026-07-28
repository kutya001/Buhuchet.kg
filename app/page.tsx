import React from 'react';
import Link from 'next/link';
import {
  FileText,
  Shield,
  Upload,
  UserCheck,
  Building2,
  ArrowRight,
  CheckCircle2,
  Lock,
  Zap,
  FolderOpen,
  Camera,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col overflow-x-hidden selection:bg-blue-600 selection:text-white">
      {/* 1. STICKY HEADER */}
      <header className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" prefetch={true} className="flex items-center space-x-3 group">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 group-hover:scale-105 transition-transform">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <span className="font-bold text-lg text-white tracking-tight">Buhuchet.kg</span>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">B2B Network</p>
            </div>
          </Link>

          <nav className="hidden md:flex items-center space-x-8 text-sm text-slate-300 font-medium">
            <a href="#features" className="hover:text-blue-400 transition-colors">Возможности</a>
            <a href="#how-it-works" className="hover:text-blue-400 transition-colors">Как это работает</a>
            <a href="#security" className="hover:text-blue-400 transition-colors">Безопасность R2</a>
          </nav>

          <div className="flex items-center space-x-2 sm:space-x-4">
            <Link href="/login" prefetch={true}>
              <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-slate-800/60 min-h-[44px] px-3 sm:px-4 text-xs sm:text-sm">
                Войти
              </Button>
            </Link>

            <Link href="/register" prefetch={true}>
              <Button className="bg-blue-600 hover:bg-blue-500 text-white font-medium min-h-[44px] px-3 sm:px-4 text-xs sm:text-sm shadow-lg shadow-blue-600/20">
                Регистрация
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* 2. HERO SECTION */}
      <section className="relative pt-12 pb-16 md:pt-24 md:pb-32 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[350px] sm:w-[600px] h-[350px] sm:h-[600px] bg-blue-600/10 blur-[140px] rounded-full pointer-events-none" />

        <div className="text-center space-y-6 max-w-4xl mx-auto relative z-10">
          <Badge variant="outline" className="px-3 py-1 border-blue-500/30 bg-blue-500/10 text-blue-400 text-xs font-semibold rounded-full inline-flex items-center space-x-1.5">
            <Zap className="h-3.5 w-3.5" />
            <span>Цифровой B2B-Документооборот Кыргызстана</span>
          </Badge>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight leading-[1.15]">
            Безопасный Электронный <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-blue-400 via-sky-300 to-purple-400 bg-clip-text text-transparent">
              B2B-Обмен и Архив Первички
            </span>
          </h1>

          <p className="text-sm sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Платформа для мгновенного обмена товарными накладными, актами и учредительными сканами между организациями КР с облачным R2-хранилищем и встроенной камерой смартфона.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4 w-full max-w-md sm:max-w-none mx-auto">
            <Link href="/register" prefetch={true} className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto min-h-[50px] px-8 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm sm:text-base shadow-xl shadow-blue-600/25">
                Зарегистрировать Организацию
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>

            <Link href="/login" prefetch={true} className="w-full sm:w-auto">
              <Button variant="outline" className="w-full sm:w-auto min-h-[50px] px-6 border-slate-800 text-slate-300 hover:bg-slate-900 font-medium text-sm sm:text-base">
                Демо-вход в систему
              </Button>
            </Link>
          </div>

          <div className="pt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400">
            <div className="flex items-center space-x-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Проверка ИНН 14 цифр</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Облако Cloudflare R2</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Экспорт в 1С (XLSX)</span>
            </div>
          </div>
        </div>

        {/* INTERACTIVE B2B DEMO MOCKUP (ОсОО «Альфа» и ОсОО «Бета») */}
        <div className="mt-12 md:mt-16 max-w-5xl mx-auto relative z-10">
          <div className="rounded-2xl sm:rounded-3xl border border-slate-800/80 bg-slate-900/60 backdrop-blur-2xl p-3 sm:p-6 shadow-2xl shadow-blue-950/40">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-4">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
                <span className="text-xs text-slate-400 font-mono ml-2 hidden sm:inline">buhuchet.kg/dashboard/documents</span>
              </div>
              <Badge variant="outline" className="text-[11px] border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                ● Прямое B2B соединение
              </Badge>
            </div>

            {/* ИНТЕРАКТИВНЫЙ ПРИМЕР С ОсОО «Альфа» И ОсОО «Бета» */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs text-blue-400 font-semibold block">Организация-Отправитель</span>
                    <h4 className="font-bold text-white text-base">ОсОО «Альфа»</h4>
                    <p className="text-[11px] font-mono text-slate-500">ИНН: 01203199810123</p>
                  </div>
                  <Badge variant="success" className="text-[10px]">Подтверждено</Badge>
                </div>
                <div className="p-3 rounded-lg bg-slate-900/80 text-xs space-y-1.5 border border-slate-800/60">
                  <div className="flex justify-between text-slate-300">
                    <span>Товарная накладная № ТН-402</span>
                    <span className="font-mono text-emerald-400">145 000 KGS</span>
                  </div>
                  <div className="flex justify-between text-slate-500 text-[11px]">
                    <span>Файл скана: nakladnaya_alfa.pdf</span>
                    <span>1.4 MB (Cloudflare R2)</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs text-purple-400 font-semibold block">Организация-Получатель</span>
                    <h4 className="font-bold text-white text-base">ОсОО «Бета»</h4>
                    <p className="text-[11px] font-mono text-slate-500">ИНН: 01502201010456</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-400">Партнеры B2B</Badge>
                </div>
                <div className="p-3 rounded-lg bg-slate-900/80 text-xs space-y-1.5 border border-slate-800/60">
                  <div className="flex justify-between text-slate-300">
                    <span>Статус документа</span>
                    <span className="text-emerald-400 font-semibold flex items-center">
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Получен и проведен
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-500 text-[11px]">
                    <span>Экспорт в 1С</span>
                    <span>Доступен XLSX</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. FEATURES SECTION */}
      <section id="features" className="py-16 md:py-24 bg-slate-900/40 border-y border-slate-800/80 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center space-y-3 max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white">Все для учета и обмена первичкой</h2>
            <p className="text-slate-400 text-sm sm:text-base">Единая экосистема для руководителей и главных бухгалтеров Кыргызстана</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card className="bg-slate-950/60 border-slate-800 p-6 space-y-4 hover:border-blue-500/40 transition-colors">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                <FileText className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white">B2B Документооборот</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Мгновенная отправка товарных накладных и актов между юридическими лицами КР.
              </p>
            </Card>

            <Card className="bg-slate-950/60 border-slate-800 p-6 space-y-4 hover:border-emerald-500/40 transition-colors">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30">
                <Camera className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Камера Смартфона в R2</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Съёмка бумажной первички с нативной камеры телефона с автоматической компрессией до 200 КБ.
              </p>
            </Card>

            <Card className="bg-slate-950/60 border-slate-800 p-6 space-y-4 hover:border-purple-500/40 transition-colors">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/30">
                <FolderOpen className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Учредительный Архив</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Безопасное хранение Устава, Свидетельства ЮЛ и Паспортов руководства в зашифрованном облаке.
              </p>
            </Card>

            <Card className="bg-slate-950/60 border-slate-800 p-6 space-y-4 hover:border-amber-500/40 transition-colors">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-600/20 text-amber-400 border border-amber-500/30">
                <Shield className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Модерация ИНН КР</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Обязательная проверка реквизитов компаний Суперадмином перед открытием доступа к B2B сети.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* 4. FOOTER */}
      <footer className="py-12 bg-slate-950 border-t border-slate-800/80 px-4 sm:px-6 lg:px-8 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center space-x-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <span className="font-bold text-white text-base">Buhuchet.kg</span>
              <p className="text-[11px] text-slate-500">© 2026 B2B Платформа Документооборота КР</p>
            </div>
          </div>

          <div className="flex items-center space-x-6 text-xs text-slate-400">
            <Link href="/login" prefetch={true} className="hover:text-white transition-colors">Вход</Link>
            <Link href="/register" prefetch={true} className="hover:text-white transition-colors">Регистрация</Link>
            <a href="#features" className="hover:text-white transition-colors">Возможности</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
