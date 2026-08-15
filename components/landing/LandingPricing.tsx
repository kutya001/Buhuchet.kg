'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Sparkles, ArrowRight } from 'lucide-react';
import type { LandingPricingPlan } from '@/types/database.types';

interface LandingPricingProps {
  isAuthenticated?: boolean;
  plans?: LandingPricingPlan[];
}

const DEFAULT_PLANS: LandingPricingPlan[] = [
  {
    id: 'start',
    name: 'Старт',
    price: '990',
    period: 'сом/мес',
    description: 'Идеально для индивидуальных предпринимателей и малого бизнеса',
    is_popular: false,
    sort_order: 1,
    features: [
      'До 100 первичных документов в месяц',
      'Облачный диск для сканов и файлов',
      'Telegram-оповещения по операциям',
      'Реестр контрагентов Кыргызстана',
      'Email-поддержка',
    ],
    button_text: 'Выбрать тариф',
  },
  {
    id: 'business',
    name: 'Бизнес',
    price: '2 490',
    period: 'сом/мес',
    description: 'Оптимальное решение для растущих компаний и торговых сетей',
    is_popular: true,
    badge_text: 'Самый популярный',
    sort_order: 2,
    features: [
      'До 500 первичных документов в месяц',
      'Неограниченное число сотрудников',
      'Аппаратное закрытие отчетных периодов',
      'Совместный доступ к файлам',
      'Telegram-бот с прямым приемом файлов',
      'Приоритетная линия технической поддержки',
    ],
    button_text: 'Начать 7 дней бесплатно',
  },
  {
    id: 'premium',
    name: 'Премиум',
    price: '4 990',
    period: 'сом/мес',
    description: 'Для крупных предприятий и профессиональных бухгалтерских агентств',
    is_popular: false,
    sort_order: 3,
    features: [
      'Неограниченный документооборот',
      'Выделенный объем дискового пространства',
      'Прямой доступ к каталогу топ-экспертов',
      'Персональный менеджер и консультации 24/7',
      'Экспорт и интеграционные механизмы',
    ],
    button_text: 'Подключить Премиум',
  },
];

export function LandingPricing({ isAuthenticated = false, plans }: LandingPricingProps) {
  const displayPlans = plans && plans.length > 0 ? plans : DEFAULT_PLANS;

  return (
    <section id="pricing" className="py-24 bg-card/40 relative border-t border-border/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
          <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 px-3 py-1 text-xs">
            Честное ценообразование в сомах (KGS)
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
            Прозрачные тарифы без скрытых платежей
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground">
            Выберите подходящий план для вашей организации. Все тарифы включают бесплатный 7-дневный пробный период.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          {displayPlans.map((plan, idx) => (
            <div
              key={plan.id || idx}
              className={`bg-card rounded-3xl p-8 flex flex-col justify-between transition-all duration-300 relative ${
                plan.is_popular
                  ? 'border-2 border-blue-500 shadow-2xl shadow-blue-500/15 lg:-translate-y-2'
                  : 'border border-border hover:border-border/80 hover:shadow-xl'
              }`}
            >
              {plan.is_popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <Badge className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold px-4 py-1 text-xs rounded-full shadow-md">
                    <Sparkles className="w-3.5 h-3.5 mr-1" />
                    {plan.badge_text || 'Самый популярный'}
                  </Badge>
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-foreground">{plan.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                </div>

                <div className="flex items-baseline space-x-2">
                  <span className="text-4xl sm:text-5xl font-extrabold font-mono text-foreground">
                    {plan.price}
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground">{plan.period}</span>
                </div>

                <ul className="space-y-3 pt-4 border-t border-border">
                  {(plan.features || []).map((feature, fIdx) => (
                    <li key={fIdx} className="flex items-start space-x-3 text-sm text-foreground/90">
                      <div className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-8 mt-6 border-t border-border">
                <Link href={isAuthenticated ? '/uchet/subscription' : '/register'}>
                  <Button
                    variant={plan.is_popular ? 'default' : 'outline'}
                    className={`w-full min-h-[48px] rounded-2xl font-bold text-sm ${
                      plan.is_popular
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/25'
                        : 'border-border text-foreground hover:bg-muted'
                    }`}
                  >
                    <span>{isAuthenticated ? 'Управление тарифом' : plan.button_text || 'Выбрать тариф'}</span>
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
