'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, ShieldCheck } from 'lucide-react';

interface LandingCtaProps {
  isAuthenticated?: boolean;
}

export function LandingCta({ isAuthenticated = false }: LandingCtaProps) {
  return (
    <section className="py-24 bg-gradient-to-b from-background via-blue-950/40 to-background relative overflow-hidden border-t border-border/40">
      {/* СВЕТЯЩИЙСЯ АКЦЕНТ */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-blue-600/20 blur-[140px] rounded-full pointer-events-none -z-10" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-8">
        <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Быстрый старт за 2 минуты</span>
        </div>

        <h2 className="text-3xl sm:text-5xl font-extrabold text-foreground tracking-tight max-w-3xl mx-auto leading-tight">
          Готовы автоматизировать первичный учёт вашей компании?
        </h2>

        <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
          Присоединяйтесь к единой экосистеме документооборота Кыргызстана. Начните бесплатный 7-дневный пробный период прямо сейчас.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
          {isAuthenticated ? (
            <Link href="/uchet" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto min-h-[52px] px-10 text-base font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl shadow-xl shadow-blue-600/30 hover:scale-105 transition-all">
                <span>В панель управления</span>
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
          ) : (
            <Link href="/register" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto min-h-[52px] px-10 text-base font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl shadow-xl shadow-blue-600/30 hover:scale-105 transition-all">
                <span>Начать бесплатно</span>
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
          )}

          <a href="#pricing" className="w-full sm:w-auto">
            <Button
              variant="outline"
              className="w-full sm:w-auto min-h-[52px] px-8 text-base font-semibold border-border text-foreground hover:bg-muted/80 rounded-2xl"
            >
              Посмотреть тарифы
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}
