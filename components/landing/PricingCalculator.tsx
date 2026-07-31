'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Sparkles, Building2, Users, FileText, Calculator } from 'lucide-react';

export function PricingCalculator() {
  const [orgType, setOrgType] = useState<'ip' | 'ooo'>('ooo');
  const [docVolume, setDocVolume] = useState<number>(50);
  const [employeesCount, setEmployeesCount] = useState<number>(5);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('yearly');

  // Расчет рекомендуемого тарифного плана и стоимости
  const calculatePlan = () => {
    let baseMonthlyPrice = 1200; // Старт KGS
    let planName = 'Базовый КР';
    let storageGb = 10;

    if (docVolume > 200 || employeesCount > 15 || orgType === 'ooo') {
      baseMonthlyPrice = 2800;
      planName = 'Профессиональный';
      storageGb = 50;
    }

    if (docVolume > 800 || employeesCount > 50) {
      baseMonthlyPrice = 5900;
      planName = 'Корпоративный';
      storageGb = 200;
    }

    // Скидка 20% при оплате за год
    const discountFactor = billingPeriod === 'yearly' ? 0.8 : 1.0;
    const finalMonthlyPrice = Math.round(baseMonthlyPrice * discountFactor);
    const yearlyTotalPrice = finalMonthlyPrice * 12;

    return {
      planName,
      monthlyPrice: finalMonthlyPrice,
      yearlyTotalPrice,
      storageGb,
      isYearlyDiscount: billingPeriod === 'yearly',
    };
  };

  const planInfo = calculatePlan();

  return (
    <Card className="bg-card/90 border border-border backdrop-blur-xl shadow-2xl rounded-3xl p-6 sm:p-8 max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <Badge variant="outline" className="border-amber-500/40 text-amber-500 bg-amber-500/10 px-3 py-1 font-mono text-xs">
          <Calculator className="h-3.5 w-3.5 mr-1.5" />
          Интерактивный Калькулятор Тарифа КР
        </Badge>
        <h3 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
          Рассчитайте точную стоимость для вашей компании
        </h3>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Прозрачные условия подписки под требования ГНС КР. Без скрытых платежей.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        {/* Левая колонка: Настройки параметов */}
        <div className="space-y-6">
          {/* 1. Форма организации */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground flex items-center">
              <Building2 className="h-4 w-4 mr-2 text-blue-500" />
              Тип юридического лица:
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setOrgType('ip')}
                className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all min-h-[44px] border ${
                  orgType === 'ip'
                    ? 'bg-blue-600/20 text-blue-400 border-blue-500/50 shadow-md'
                    : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                ИП (Физическое лицо)
              </button>
              <button
                type="button"
                onClick={() => setOrgType('ooo')}
                className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all min-h-[44px] border ${
                  orgType === 'ooo'
                    ? 'bg-purple-600/20 text-purple-400 border-purple-500/50 shadow-md'
                    : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                ОсОО / ЗАО / ОАО
              </button>
            </div>
          </div>

          {/* 2. Объем документов в месяц */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="flex items-center text-foreground">
                <FileText className="h-4 w-4 mr-2 text-sky-400" />
                Документов в месяц:
              </span>
              <span className="font-mono text-sky-400 font-bold text-sm">{docVolume} шт.</span>
            </div>
            <input
              type="range"
              min="10"
              max="1500"
              step="10"
              value={docVolume}
              onChange={(e) => setDocVolume(Number(e.target.value))}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-sky-500"
            />
          </div>

          {/* 3. Количество сотрудников */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="flex items-center text-foreground">
                <Users className="h-4 w-4 mr-2 text-emerald-400" />
                Активных сотрудников:
              </span>
              <span className="font-mono text-emerald-400 font-bold text-sm">{employeesCount} чел.</span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={employeesCount}
              onChange={(e) => setEmployeesCount(Number(e.target.value))}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
          </div>

          {/* 4. Туггл периода оплаты */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/50 border border-border">
            <span className="text-xs font-medium text-foreground">Период оплаты:</span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setBillingPeriod('monthly')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  billingPeriod === 'monthly' ? 'bg-background text-foreground shadow' : 'text-muted-foreground'
                }`}
              >
                Месяц
              </button>
              <button
                type="button"
                onClick={() => setBillingPeriod('yearly')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center ${
                  billingPeriod === 'yearly' ? 'bg-emerald-600 text-white shadow-md' : 'text-muted-foreground'
                }`}
              >
                <span>Год</span>
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/30 text-white font-mono">
                  -20%
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Правая колонка: Итоговый расчет тарифа */}
        <div className="p-6 rounded-2xl bg-gradient-to-b from-blue-600/10 to-purple-600/10 border border-blue-500/30 space-y-6 flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase font-mono tracking-widest text-blue-400">Рекомендуемый тариф</span>
              <Badge className="bg-blue-600 text-white font-bold">{planInfo.planName}</Badge>
            </div>

            <div className="mt-4 space-y-1">
              <div className="flex items-baseline space-x-2">
                <span className="text-4xl font-extrabold text-foreground tracking-tight">{planInfo.monthlyPrice}</span>
                <span className="text-sm font-semibold text-muted-foreground font-mono">KGS / месяц</span>
              </div>
              {planInfo.isYearlyDiscount && (
                <p className="text-xs text-emerald-400 font-mono">
                  Итого за год: {planInfo.yearlyTotalPrice} KGS (Экономия 20%)
                </p>
              )}
            </div>

            <div className="mt-6 space-y-2.5 text-xs text-muted-foreground">
              <div className="flex items-center text-foreground">
                <Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" />
                <span>Облачный архив R2: до {planInfo.storageGb} ГБ данных</span>
              </div>
              <div className="flex items-center text-foreground">
                <Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" />
                <span>Поддержка ИНН КР и формата ГНС КР</span>
              </div>
              <div className="flex items-center text-foreground">
                <Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" />
                <span>Электронный документооборот без ограничений</span>
              </div>
              <div className="flex items-center text-foreground">
                <Check className="h-4 w-4 text-emerald-400 mr-2 flex-shrink-0" />
                <span>14 дней тестового периода бесплатно</span>
              </div>
            </div>
          </div>

          <Link
            href="/register"
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm text-center shadow-lg shadow-blue-500/25 transition-all active:scale-98 block"
          >
            Попробовать {planInfo.planName} (14 дней тест)
          </Link>
        </div>
      </div>
    </Card>
  );
}
