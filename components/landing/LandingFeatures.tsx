'use client';

import React from 'react';
import {
  FileText,
  Zap,
  MessageSquare,
  Users,
  HardDrive,
  ShieldCheck,
  Building2,
  Lock,
} from 'lucide-react';

const FEATURES = [
  {
    icon: FileText,
    title: 'Прозрачный документооборот',
    description:
      'Все накладные, акты и счета в едином структурированном реестре. Отслеживайте статусы согласования, историю изменений и получайте прозрачную отчетность.',
    gradient: 'from-blue-500/20 to-indigo-500/20',
    iconColor: 'text-blue-400',
    borderColor: 'border-blue-500/30',
  },
  {
    icon: Zap,
    title: 'Мгновенный учёт первички',
    description:
      'Загружайте сканы и фото накладных — система автоматически архивирует их на облачном диске, связывает со сторонами сделки и готовит к экспорту.',
    gradient: 'from-emerald-500/20 to-teal-500/20',
    iconColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/30',
  },
  {
    icon: MessageSquare,
    title: 'Telegram-оповещения',
    description:
      'Мгновенные уведомления о новых входящих документах, заявках кандидатов и закрытии отчетных периодов прямо в ваш рабочий чат Telegram.',
    gradient: 'from-sky-500/20 to-blue-500/20',
    iconColor: 'text-sky-400',
    borderColor: 'border-sky-500/30',
  },
  {
    icon: Users,
    title: 'Каталог проверенных экспертов',
    description:
      'Доступ к базе квалифицированных бухгалтеров и аудиторов Кыргызстана. Выбирайте специалистов по подтвержденному опыту и отзывам клиентов.',
    gradient: 'from-purple-500/20 to-pink-500/20',
    iconColor: 'text-purple-400',
    borderColor: 'border-purple-500/30',
  },
];

export function LandingFeatures() {
  return (
    <section id="features" className="py-24 bg-background relative border-t border-border/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
            Всё для автоматизации первичного учёта
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground">
            Полный набор современных инструментов для эффективного взаимодействия бизнеса, бухгалтеров и контрагентов
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURES.map((feature, idx) => {
            const IconComp = feature.icon;
            return (
              <div
                key={idx}
                className="bg-card/70 backdrop-blur-md border border-border rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:border-border/80 flex flex-col justify-between group"
              >
                <div>
                  <div
                    className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.gradient} border ${feature.borderColor} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}
                  >
                    <IconComp className={`w-7 h-7 ${feature.iconColor}`} />
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-3">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed font-normal">
                    {feature.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
