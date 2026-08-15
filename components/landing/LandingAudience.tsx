'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Check, ArrowRight, Building2, Briefcase } from 'lucide-react';

interface LandingAudienceProps {
  isAuthenticated?: boolean;
}

export function LandingAudience({ isAuthenticated = false }: LandingAudienceProps) {
  return (
    <section id="audience" className="py-24 bg-background relative border-t border-border/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
            Для кого создана платформа
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground">
            Специализированные инструменты и профили для обеих сторон учетного процесса
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* КАРТОЧКА: ПРЕДПРИНИМАТЕЛЯМ */}
          <div className="bg-gradient-to-br from-blue-900/40 via-card to-card border border-blue-500/30 rounded-3xl p-8 sm:p-10 flex flex-col justify-between shadow-2xl relative overflow-hidden group">
            <div className="space-y-6">
              <div className="w-14 h-14 rounded-2xl bg-blue-500/15 border border-blue-500/30 text-blue-400 flex items-center justify-center">
                <Building2 className="w-7 h-7" />
              </div>

              <div>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-foreground mb-2">
                  Руководителям и бизнесу
                </h3>
                <p className="text-sm text-muted-foreground">
                  Полный порядок в документах без необходимости глубоко вникать в тонкости проводок
                </p>
              </div>

              <ul className="space-y-3.5 pt-2">
                {[
                  'Экономия до 75% времени на контроль и сбор накладных',
                  'Прозрачность финансового документооборота в реальном времени',
                  'Мгновенный защищенный доступ к облачному диску 24/7',
                  'Telegram-оповещения о статусах согласования и закрытия периода',
                  'Прямая передача документов партнерам в едином контуре',
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start space-x-3 text-sm text-foreground/90">
                    <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-8 mt-6 border-t border-border/80">
              <Link href={isAuthenticated ? '/uchet' : '/register'}>
                <Button className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl px-8 min-h-[48px] shadow-lg shadow-blue-600/20">
                  <span>{isAuthenticated ? 'Перейти в кабинет' : 'Попробовать для компании'}</span>
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>

          {/* КАРТОЧКА: БУХГАЛТЕРАМ */}
          <div className="bg-gradient-to-br from-indigo-900/40 via-card to-card border border-indigo-500/30 rounded-3xl p-8 sm:p-10 flex flex-col justify-between shadow-2xl relative overflow-hidden group">
            <div className="space-y-6">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
                <Briefcase className="w-7 h-7" />
              </div>

              <div>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-foreground mb-2">
                  Бухгалтерам и экспертам
                </h3>
                <p className="text-sm text-muted-foreground">
                  Эффективное ведение десятков организаций без рутины и риска потери файлов
                </p>
              </div>

              <ul className="space-y-3.5 pt-2">
                {[
                  'Удобное переключение между тенантами клиентов в одном окне',
                  'Многопользовательский режим с гибким разграничением прав сотрудников',
                  'Аппаратная защита закрытых периодов от изменений задним числом',
                  'Интеграция с Telegram для приема первички от сотрудников клиентов',
                  'Размещение профиля в каталоге экспертов платформы',
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start space-x-3 text-sm text-foreground/90">
                    <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-8 mt-6 border-t border-border/80">
              <Link href={isAuthenticated ? '/uchet' : '/register'}>
                <Button className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl px-8 min-h-[48px] shadow-lg shadow-indigo-600/20">
                  <span>{isAuthenticated ? 'Перейти в кабинет' : 'Присоединиться как эксперт'}</span>
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
