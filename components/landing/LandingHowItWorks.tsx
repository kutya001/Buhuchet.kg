'use client';

import React from 'react';
import { UserPlus, UploadCloud, Cpu, CheckCircle } from 'lucide-react';

const STEPS = [
  {
    number: '01',
    icon: UserPlus,
    title: 'Быстрая регистрация',
    description:
      'Создайте аккаунт за 2 минуты. Укажите 14-значный ИНН вашей компании или ИП в Кыргызстане и выберите тариф.',
  },
  {
    number: '02',
    icon: UploadCloud,
    title: 'Загрузка документов',
    description:
      'Загружайте первичные документы через удобный веб-интерфейс или отправляйте фото накладных в Telegram-бот.',
  },
  {
    number: '03',
    icon: Cpu,
    title: 'Автоматическая систематизация',
    description:
      'Система сохраняет файлы на защищенном облачном диске, связывает контрагентов и подготавливает реестр.',
  },
  {
    number: '04',
    icon: CheckCircle,
    title: 'Контроль и закрытие периода',
    description:
      'Контролируйте статусы проведения первички, закрывайте отчетные месяцы с аппаратной защитой и формируйте выгрузки.',
  },
];

export function LandingHowItWorks() {
  return (
    <section id="how-it-works" className="py-24 bg-card/40 relative border-t border-border/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
            Как это работает
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground">
            Простой и прозрачный процесс: от регистрации компании до полного порядка в первичке
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 relative">
          {STEPS.map((step, idx) => {
            const IconComp = step.icon;
            return (
              <div key={idx} className="relative text-center space-y-4 flex flex-col items-center">
                {/* НОМЕР ШАГА */}
                <div className="relative">
                  <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center font-mono font-extrabold text-2xl shadow-xl shadow-blue-500/20 border border-blue-400/30">
                    {step.number}
                  </div>
                  <div className="absolute -bottom-2 -right-2 p-1.5 rounded-xl bg-card border border-border text-blue-400">
                    <IconComp className="w-4 h-4" />
                  </div>
                </div>

                <h3 className="text-xl font-bold text-foreground">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed font-normal">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
