'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  ShieldCheck,
  Zap,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  Users,
  Building2,
  Clock,
  Sparkles,
} from 'lucide-react';

interface LandingHeroProps {
  isAuthenticated?: boolean;
}

export function LandingHero({ isAuthenticated = false }: LandingHeroProps) {
  return (
    <section className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden bg-gradient-to-b from-blue-950/40 via-background to-background">
      {/* ДЕКОРАТИВНЫЕ СВЕТЯЩИЕСЯ ЭЛЕМЕНТЫ */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-blue-600/15 blur-[120px] rounded-full pointer-events-none -z-10" />
      <div className="absolute top-1/3 right-10 w-[300px] h-[300px] bg-indigo-500/10 blur-[100px] rounded-full pointer-events-none -z-10" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* ЛЕВАЯ КОЛОНКА: ОФФЕР И ПРЕИМУЩЕСТВА */}
          <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>Экосистема первичного учёта Кыргызстана</span>
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-foreground leading-[1.15]">
              Бухгалтерия нового поколения для бизнеса в{' '}
              <span className="bg-gradient-to-r from-blue-500 via-indigo-400 to-sky-400 bg-clip-text text-transparent">
                Кыргызстане
              </span>
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto lg:mx-0 font-normal leading-relaxed">
              Единая цифровая среда для автоматизации первичного учёта. Прозрачный документооборот, мгновенный реестр первички, Telegram-оповещения и доступ к каталогу проверенных экспертов.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3.5 pt-2">
              {isAuthenticated ? (
                <Link href="/dashboard" className="w-full sm:w-auto">
                  <Button className="w-full sm:w-auto min-h-[50px] px-8 text-base font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl shadow-xl shadow-blue-600/25 hover:scale-[1.02] transition-all">
                    <span>Перейти в кабинет</span>
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
              ) : (
                <Link href="/register" className="w-full sm:w-auto">
                  <Button className="w-full sm:w-auto min-h-[50px] px-8 text-base font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl shadow-xl shadow-blue-600/25 hover:scale-[1.02] transition-all">
                    <span>Начать бесплатно</span>
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
              )}

              <a href="#how-it-works" className="w-full sm:w-auto">
                <Button
                  variant="outline"
                  className="w-full sm:w-auto min-h-[50px] px-7 text-base font-semibold border-border text-foreground hover:bg-muted/80 rounded-2xl"
                >
                  Узнать больше
                </Button>
              </a>
            </div>

            {/* МИНИ-ПРЕИМУЩЕСТВА ПОД КНОПКАМИ */}
            <div className="grid grid-cols-3 gap-3 pt-6 border-t border-border/60 max-w-lg mx-auto lg:mx-0">
              <div className="flex items-center space-x-2 text-xs font-medium text-muted-foreground">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>14 дней триал</span>
              </div>
              <div className="flex items-center space-x-2 text-xs font-medium text-muted-foreground">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>14-значный ИНН КР</span>
              </div>
              <div className="flex items-center space-x-2 text-xs font-medium text-muted-foreground">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>Облачный диск R2</span>
              </div>
            </div>
          </div>

          {/* ПРАВАЯ КОЛОНКА: ИНТЕРАКТИВНЫЙ MOCKUP ДАШБОРДА */}
          <div className="lg:col-span-5 relative">
            <div className="relative mx-auto max-w-md lg:max-w-none">
              {/* РАМКА ДАШБОРДА */}
              <div className="bg-card/90 backdrop-blur-xl border border-border/80 rounded-3xl p-5 sm:p-6 shadow-2xl shadow-blue-500/10 relative z-10 transition-transform duration-500 hover:scale-[1.01]">
                {/* ВЕРХНЯЯ СТРОКА С КНОПКАМИ СВЕТОФОРА */}
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
                  <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-rose-500" />
                    <span className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500" />
                  </div>
                  <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10 text-[11px] font-mono">
                    buhuchet.kg/dashboard
                  </Badge>
                </div>

                {/* КАРТОЧКИ ПОКАЗАТЕЛЕЙ */}
                <div className="space-y-3.5">
                  <div className="bg-background/80 border border-border/60 rounded-2xl p-3.5 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Документов обработано</p>
                        <p className="text-xl font-bold font-mono text-foreground">1,247 шт.</p>
                      </div>
                    </div>
                    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">
                      +28% за месяц
                    </Badge>
                  </div>

                  <div className="bg-background/80 border border-border/60 rounded-2xl p-3.5 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400">
                        <Users className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Активных экспертов</p>
                        <p className="text-xl font-bold font-mono text-foreground">89 спец.</p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">Бишкек / Ош</span>
                  </div>

                  <div className="bg-background/80 border border-border/60 rounded-2xl p-3.5 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                        <Zap className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Экономия времени</p>
                        <p className="text-xl font-bold font-mono text-emerald-400">75%</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-xs">
                      Автоматизация
                    </Badge>
                  </div>
                </div>

                {/* ЖИВАЯ ПЛАШКА TELEGRAM */}
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Telegram Bot: подключен</span>
                  </div>
                  <span className="font-mono text-[10px] text-blue-400 font-bold">@BuhUchetKgBot</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
