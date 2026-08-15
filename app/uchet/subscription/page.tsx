'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CreditCard,
  Building2,
  Calendar,
  HardDrive,
  CheckCircle2,
  QrCode,
  Clock,
  Sparkles,
  Zap,
  ShieldCheck,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { processMockPaymentAction } from './actions';
import { PLAN_PRICES } from '@/types/subscription.types';
import type { Company, Subscription, SubscriptionPlan } from '@/types/database.types';

export default function SubscriptionPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Состояние модального окна оплаты
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>('basic');
  const [selectedPeriod, setSelectedPeriod] = useState<1 | 3 | 6 | 12>(1);
  const [selectedBank, setSelectedBank] = useState<'qr_mbank' | 'qr_optima'>('qr_mbank');

  // Таймер 30 секунд
  const [timeLeft, setTimeLeft] = useState(30);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const loadSubscriptionData = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: userProfile } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (userProfile?.company_id) {
        const { data: comp } = await supabase
          .from('companies')
          .select('*, subscriptions(*)')
          .eq('id', userProfile.company_id)
          .single();

        if (comp) {
          setCompany(comp as any);
          setSubscription(comp.subscriptions as any);
        }
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadSubscriptionData();
  }, []);

  // Управление таймером модалки
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isModalOpen && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isModalOpen, timeLeft]);

  const handleOpenPaymentModal = (plan: SubscriptionPlan) => {
    setSelectedPlan(plan);
    setTimeLeft(30);
    setIsModalOpen(true);
  };

  const handleMockPay = () => {
    setMsg(null);
    const formData = new FormData();
    formData.append('planType', selectedPlan);
    formData.append('periodMonths', selectedPeriod.toString());
    formData.append('paymentMethod', selectedBank);

    startTransition(async () => {
      const res = await processMockPaymentAction(formData);
      if (res.success) {
        setMsg({
          type: 'success',
          text: 'Оплата успешно проведенена! Статус подписки компании обновлен.',
        });
        setIsModalOpen(false);
        loadSubscriptionData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при проведении оплаты' });
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка данных о подписке...</span>
      </div>
    );
  }

  // Расчет оставшихся дней подписки
  const expiresAt = subscription?.expires_at ? new Date(subscription.expires_at) : new Date();
  const now = new Date();
  const diffTime = expiresAt.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

  // Расчет цены для модального окна
  const baseMonthlyPrice = PLAN_PRICES[selectedPlan].pricePerMonth;
  let discountPercent = 0;
  if (selectedPeriod === 3) discountPercent = 10;
  if (selectedPeriod === 6) discountPercent = 15;
  if (selectedPeriod === 12) discountPercent = 20;

  const totalCalculated = Math.round(baseMonthlyPrice * selectedPeriod * (1 - discountPercent / 100));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Подписка и Тарифы</h2>
          <p className="text-sm text-slate-400 mt-1">
            Управление тарифным планом компании <span className="text-white font-medium">{company?.name}</span>
          </p>
        </div>
      </div>

      {msg && (
        <Alert
          variant={msg.type === 'success' ? 'success' : 'destructive'}
          className={
            msg.type === 'success'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/50 bg-red-500/10 text-red-400'
          }
        >
          {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      )}

      {/* Карточка текущего статуса подписки */}
      <Card className="bg-slate-900/60 border-slate-800 backdrop-blur-xl">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
            <div className="space-y-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-mono">Текущий тариф</span>
              <div className="flex items-center space-x-2">
                <span className="text-2xl font-bold text-white uppercase">
                  {PLAN_PRICES[subscription?.plan_type || 'basic'].title}
                </span>
                <Badge
                  variant={
                    subscription?.status === 'active'
                      ? 'success'
                      : subscription?.status === 'trial'
                      ? 'warning'
                      : 'destructive'
                  }
                >
                  {subscription?.status === 'active'
                    ? 'Активна'
                    : subscription?.status === 'trial'
                    ? 'Демо-период'
                    : 'Истекла'}
                </Badge>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-mono">Осталось дней</span>
              <div className="flex items-center space-x-2">
                <Calendar className="h-5 w-5 text-blue-400" />
                <span className="text-2xl font-bold text-white">{daysRemaining} дней</span>
              </div>
              <p className="text-[11px] text-slate-500">До {expiresAt.toLocaleDateString('ru-RU')}</p>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-mono">Облачный диск</span>
              <div className="flex items-center space-x-2">
                <HardDrive className="h-5 w-5 text-purple-400" />
                <span className="text-2xl font-bold text-white">{company?.storage_limit_gb || 10} ГБ</span>
              </div>
              <p className="text-[11px] text-slate-500">Выделено для сканов</p>
            </div>

            <div className="flex justify-start md:justify-end">
              <Button
                onClick={() => handleOpenPaymentModal(subscription?.plan_type || 'basic')}
                className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/25"
              >
                <QrCode className="mr-2 h-4 w-4" />
                Продлить по QR
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Карточки тарифных планов */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Выбор тарифного плана</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Базовый */}
          <Card className={`bg-slate-900/40 border-slate-800 flex flex-col justify-between ${subscription?.plan_type === 'basic' ? 'border-blue-500/50 ring-1 ring-blue-500/30' : ''}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Базовый</CardTitle>
                <Zap className="h-5 w-5 text-blue-400" />
              </div>
              <CardDescription>Для небольших торговых точек и малого бизнеса</CardDescription>
              <div className="pt-4">
                <span className="text-3xl font-bold text-white">3 000 сом</span>
                <span className="text-xs text-slate-500"> / месяц</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> До 500 документов в месяц</div>
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> 10 ГБ лимита сканов</div>
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> До 3 сотрудников</div>
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> Выгрузка в 1С (Excel)</div>
            </CardContent>
            <CardFooter>
              <Button
                variant={subscription?.plan_type === 'basic' ? 'outline' : 'default'}
                className="w-full"
                onClick={() => handleOpenPaymentModal('basic')}
              >
                {subscription?.plan_type === 'basic' ? 'Текущий план' : 'Выбрать Базовый'}
              </Button>
            </CardFooter>
          </Card>

          {/* Стандарт */}
          <Card className={`bg-slate-900/40 border-slate-800 flex flex-col justify-between relative overflow-hidden ${subscription?.plan_type === 'standard' ? 'border-blue-500/50 ring-1 ring-blue-500/30' : ''}`}>
            <div className="absolute top-0 right-0 bg-blue-600 text-white text-[10px] uppercase font-bold px-3 py-1 rounded-bl-lg">
              Популярный
            </div>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Стандарт</CardTitle>
                <Sparkles className="h-5 w-5 text-amber-400" />
              </div>
              <CardDescription>Оптимально для дистрибьюторов средних объемов</CardDescription>
              <div className="pt-4">
                <span className="text-3xl font-bold text-white">7 000 сом</span>
                <span className="text-xs text-slate-500"> / месяц</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> До 3 000 документов в месяц</div>
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> 25 ГБ лимита сканов</div>
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> До 10 сотрудников</div>
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> Сверка с Салык (ЭСФ)</div>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full bg-blue-600 hover:bg-blue-500"
                onClick={() => handleOpenPaymentModal('standard')}
              >
                {subscription?.plan_type === 'standard' ? 'Продлить Стандарт' : 'Выбрать Стандарт'}
              </Button>
            </CardFooter>
          </Card>

          {/* Профи */}
          <Card className={`bg-slate-900/40 border-slate-800 flex flex-col justify-between ${subscription?.plan_type === 'pro' ? 'border-blue-500/50 ring-1 ring-blue-500/30' : ''}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Профи</CardTitle>
                <ShieldCheck className="h-5 w-5 text-purple-400" />
              </div>
              <CardDescription>Для крупных торговых сетей и оптовых складов</CardDescription>
              <div className="pt-4">
                <span className="text-3xl font-bold text-white">15 000 сом</span>
                <span className="text-xs text-slate-500"> / месяц</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> Неограниченно документов</div>
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> 100 ГБ лимита сканов</div>
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> Безлимит сотрудников</div>
              <div className="flex items-center"><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> Персональный менеджер</div>
            </CardContent>
            <CardFooter>
              <Button
                variant={subscription?.plan_type === 'pro' ? 'outline' : 'default'}
                className="w-full"
                onClick={() => handleOpenPaymentModal('pro')}
              >
                {subscription?.plan_type === 'pro' ? 'Текущий план' : 'Выбрать Профи'}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>

      {/* Модальное окно имитации QR-оплаты */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
          <Card className="w-full max-w-lg bg-slate-900 border-slate-800 shadow-2xl overflow-hidden">
            <CardHeader className="bg-slate-950/60 pb-4 border-b border-slate-800">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center">
                  <QrCode className="h-5 w-5 mr-2 text-blue-400" />
                  Оплата подписки по QR-коду
                </CardTitle>
                <div className="flex items-center text-xs font-mono text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                  <Clock className="h-3.5 w-3.5 mr-1" />
                  {timeLeft} сек
                </div>
              </div>
              <CardDescription>
                Сканируйте QR-код через приложение любого мобильного банка Кыргызстана
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-4">
              {/* Выбор банка */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={selectedBank === 'qr_mbank' ? 'default' : 'outline'}
                  onClick={() => setSelectedBank('qr_mbank')}
                  className="text-xs h-9 justify-center border-slate-800"
                >
                  MBank (Кыргызстан)
                </Button>
                <Button
                  type="button"
                  variant={selectedBank === 'qr_optima' ? 'default' : 'outline'}
                  onClick={() => setSelectedBank('qr_optima')}
                  className="text-xs h-9 justify-center border-slate-800"
                >
                  Оптима24 / Элсом
                </Button>
              </div>

              {/* Выбор периода */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Выберите период оплаты:</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { period: 1, label: '1 мес', discount: '0%' },
                    { period: 3, label: '3 мес', discount: '-10%' },
                    { period: 6, label: '6 мес', discount: '-15%' },
                    { period: 12, label: '12 мес', discount: '-20%' },
                  ].map((item) => (
                    <button
                      key={item.period}
                      type="button"
                      onClick={() => setSelectedPeriod(item.period as any)}
                      className={`p-2 rounded-lg border text-center transition-all ${
                        selectedPeriod === item.period
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-bold">{item.label}</div>
                      {item.discount !== '0%' && (
                        <div className="text-[10px] text-emerald-400 font-mono">{item.discount}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Визуализация QR-кода */}
              <div className="flex flex-col items-center justify-center p-4 bg-white rounded-xl shadow-inner my-2">
                {/* Динамический SVG Имитационный QR-код */}
                <svg className="w-44 h-44" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="100" height="100" fill="white" />
                  <path d="M10 10H40V40H10V10ZM15 15V35H35V15H15Z" fill="#000" />
                  <rect x="20" y="20" width="10" height="10" fill="#000" />
                  <path d="M60 10H90V40H60V10ZM65 15V35H85V15H65Z" fill="#000" />
                  <rect x="70" y="20" width="10" height="10" fill="#000" />
                  <path d="M10 60H40V90H10V60ZM15 65V85H35V65H15Z" fill="#000" />
                  <rect x="20" y="70" width="10" height="10" fill="#000" />
                  {/* Рандомная сетка QR псевдо-данных */}
                  <rect x="50" y="50" width="10" height="10" fill="#0284c7" />
                  <rect x="70" y="50" width="10" height="10" fill="#000" />
                  <rect x="50" y="70" width="10" height="20" fill="#000" />
                  <rect x="80" y="70" width="10" height="10" fill="#0284c7" />
                  <rect x="60" y="80" width="20" height="10" fill="#000" />
                  <rect x="80" y="60" width="10" height="10" fill="#000" />
                </svg>
                <p className="text-[11px] text-slate-800 font-mono mt-2 font-semibold">
                  Сумма к оплате: {totalCalculated.toLocaleString('ru-RU')} сом
                </p>
              </div>

              <div className="text-center text-xs text-slate-400">
                Получатель: <span className="text-slate-200 font-medium">ОсОО «Бухучет КР»</span> (ИНН 20101202310050)
              </div>
            </CardContent>

            <CardFooter className="pt-2 pb-6 border-t border-slate-800 flex justify-between space-x-3">
              <Button
                variant="outline"
                onClick={() => setIsModalOpen(false)}
                className="border-slate-800 text-slate-400"
              >
                Отмена
              </Button>

              <Button
                onClick={handleMockPay}
                disabled={isPending}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-lg shadow-emerald-600/20"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Проведение платежа...
                  </>
                ) : (
                  'Имитировать успешную оплату'
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
