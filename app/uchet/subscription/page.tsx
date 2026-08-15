'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import {
  CreditCard,
  Building2,
  Calendar,
  HardDrive,
  CheckCircle2,
  Clock,
  Sparkles,
  Zap,
  ShieldCheck,
  Loader2,
  AlertCircle,
  Users,
  Send,
  Lock,
  ArrowRight,
  FileCheck,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import {
  getCompanySubscriptionDetailsAction,
  createRenewalRequestAction,
  processMockPaymentAction,
  type CompanySubscriptionDetails,
} from './actions';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';
import { toast } from 'sonner';
import type { LandingPricingPlan, SubscriptionRenewalRequest } from '@/types/database.types';

export default function SubscriptionPage() {
  const [data, setData] = useState<CompanySubscriptionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Модальное окно подачи заявки на продление
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('business');
  const [selectedPeriod, setSelectedPeriod] = useState<1 | 3 | 6 | 12>(1);
  const [requestComment, setRequestComment] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const res = await getCompanySubscriptionDetailsAction();
    if (res.success && res.data) {
      setData(res.data);
      if (res.data.limits.planId) {
        setSelectedPlanId(res.data.limits.planId);
      }
    } else {
      toast.error(res.error || 'Не удалось загрузить данные о подписке');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenRequestModal = (planId: string) => {
    setSelectedPlanId(planId);
    setSelectedPeriod(1);
    setRequestComment('');
    setIsModalOpen(true);
  };

  const handleSubmitRenewalRequest = async () => {
    if (!selectedPlanId) {
      toast.error('Выберите тарифный план');
      return;
    }

    setSubmittingRequest(true);
    try {
      const res = await createRenewalRequestAction({
        target_plan_id: selectedPlanId,
        billing_period_months: selectedPeriod,
        comment: requestComment.trim() || undefined,
      });

      if (res.success) {
        toast.success('Заявка на продление подписки успешно отправлена администратору');
        setIsModalOpen(false);
        loadData();
      } else {
        toast.error(res.error || 'Ошибка отправки заявки');
      }
    } catch (err: any) {
      toast.error(err.message || 'Сбой отправки заявки');
    } finally {
      setSubmittingRequest(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mr-2 text-primary" />
        <span>Загрузка данных о тарифах и лимитах...</span>
      </div>
    );
  }

  const limits = data?.limits;
  const plans = data?.plans || [];
  const renewalRequests = data?.renewalRequests || [];

  const selectedPlanObj = plans.find((p) => p.id === selectedPlanId) || plans[0];

  // Расчет примерной стоимости со скидкой
  const parsePrice = (priceStr?: string) => {
    if (!priceStr) return 0;
    return parseInt(priceStr.replace(/\D/g, ''), 10) || 0;
  };
  const basePrice = parsePrice(selectedPlanObj?.price);
  let discountPercent = 0;
  if (selectedPeriod === 3) discountPercent = 10;
  if (selectedPeriod === 6) discountPercent = 15;
  if (selectedPeriod === 12) discountPercent = 20;
  const totalCalculated = Math.round(basePrice * selectedPeriod * (1 - discountPercent / 100));

  const requestColumns: ColumnDef<SubscriptionRenewalRequest>[] = [
    {
      key: 'created_at',
      label: 'Дата подачи',
      sortable: true,
      getValue: (r) => r.created_at,
      render: (r) => (
        <span className="font-mono text-xs text-foreground">
          {new Date(r.created_at).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
    },
    {
      key: 'target_plan',
      label: 'Запрошенный тариф',
      sortable: true,
      getValue: (r) => r.target_plan?.name || r.target_plan_id,
      render: (r) => (
        <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10 font-bold text-xs">
          {r.target_plan?.name || r.target_plan_id}
        </Badge>
      ),
    },
    {
      key: 'billing_period_months',
      label: 'Период',
      sortable: true,
      getValue: (r) => `${r.billing_period_months} мес.`,
      render: (r) => <span className="font-mono text-xs text-foreground">{r.billing_period_months} мес.</span>,
    },
    {
      key: 'status',
      label: 'Статус заявки',
      sortable: true,
      getValue: (r) => r.status,
      render: (r) => {
        if (r.status === 'approved') {
          return (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Одобрено
            </Badge>
          );
        }
        if (r.status === 'rejected') {
          return (
            <Badge variant="destructive" className="bg-rose-500/20 text-rose-300 border-rose-500/30 text-xs">
              <XCircle className="h-3 w-3 mr-1" />
              Отклонено
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10 text-xs">
            <Clock className="h-3 w-3 mr-1" />
            На рассмотрении
          </Badge>
        );
      },
    },
    {
      key: 'comment',
      label: 'Комментарий / Примечание',
      getValue: (r) => r.admin_notes || r.comment || '—',
      render: (r) => (
        <div className="space-y-0.5 max-w-[280px]">
          {r.comment && <div className="text-xs text-foreground truncate">Заявка: {r.comment}</div>}
          {r.admin_notes && (
            <div className="text-[11px] text-amber-400 font-medium">Ответ: {r.admin_notes}</div>
          )}
          {!r.comment && !r.admin_notes && <span className="text-xs text-muted-foreground">—</span>}
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* ЗАГОЛОВОК СТРАНИЦЫ */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight flex items-center">
            <CreditCard className="h-6 w-6 mr-2.5 text-blue-500" />
            Подписка и Тарифные Квоты
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Управление тарифом, контроль лимитов ресурсов и подача заявок на продление для{' '}
            <span className="text-foreground font-semibold">{limits?.companyName}</span>
          </p>
        </div>

        <Button
          onClick={() => handleOpenRequestModal(limits?.planId || 'business')}
          className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/25 min-h-[42px] px-4"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Подать заявку на продление
        </Button>
      </div>

      {/* КАРТОЧКА ТЕКУЩЕГО СТАТУСА ПОДПИСКИ */}
      <Card className="bg-card border-border shadow-xl relative overflow-hidden">
        <div
          className={`absolute top-0 left-0 right-0 h-1 ${
            limits?.isExpired
              ? 'bg-rose-500'
              : limits?.isExpiringSoon
              ? 'bg-amber-500'
              : 'bg-emerald-500'
          }`}
        />

        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
            {/* ТАРИФ */}
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-mono">
                Текущий тарифный план
              </span>
              <div className="flex items-center space-x-2">
                <span className="text-2xl font-extrabold text-foreground">{limits?.planName}</span>
                <Badge
                  variant={
                    limits?.subscriptionStatus === 'active'
                      ? 'success'
                      : limits?.subscriptionStatus === 'trial'
                      ? 'warning'
                      : 'destructive'
                  }
                  className={
                    limits?.subscriptionStatus === 'active'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : limits?.subscriptionStatus === 'trial'
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                  }
                >
                  {limits?.subscriptionStatus === 'active'
                    ? 'Активен'
                    : limits?.subscriptionStatus === 'trial'
                    ? 'Пробный 7 дней'
                    : 'Срок истек'}
                </Badge>
              </div>
            </div>

            {/* СРОК ДЕЙСТВИЯ */}
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-mono">
                Осталось дней
              </span>
              <div className="flex items-center space-x-2">
                <Calendar className={`h-5 w-5 ${limits?.isExpired ? 'text-rose-400' : 'text-blue-400'}`} />
                <span
                  className={`text-2xl font-bold font-mono ${
                    limits?.isExpired
                      ? 'text-rose-400'
                      : limits?.isExpiringSoon
                      ? 'text-amber-400'
                      : 'text-foreground'
                  }`}
                >
                  {limits?.isExpired ? '0 дней' : `${limits?.daysRemaining} дн.`}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {limits?.expiresAt
                  ? `Действует до ${new Date(limits.expiresAt).toLocaleDateString('ru-RU')}`
                  : 'Срок не установлен'}
              </p>
            </div>

            {/* ДИСКОВОЕ ПРОСТРАНСТВО */}
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-mono">
                Облачный диск
              </span>
              <div className="flex items-center space-x-2">
                <HardDrive className="h-5 w-5 text-purple-400" />
                <span className="text-2xl font-bold font-mono text-foreground">
                  {limits?.storageLimitGb} ГБ
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Занято: {limits?.storageUsedMb} МБ ({limits?.storageUsagePercent}%)
              </p>
            </div>

            {/* ДЕЙСТВИЕ */}
            <div className="flex justify-start md:justify-end">
              <Button
                onClick={() => handleOpenRequestModal(limits?.planId || 'business')}
                variant="outline"
                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 min-h-[40px]"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Продлить подписку
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* СЕТКА ИСПОЛЬЗОВАНИЯ КВОТ (4 КАРТОЧКИ) */}
      <div>
        <h3 className="text-base font-bold text-foreground mb-4 flex items-center">
          <Zap className="h-5 w-5 mr-2 text-amber-400" />
          Использование ресурсов и квоты тарифа
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. КОНТРАГЕНТЫ */}
          <Card className="bg-card border-border p-5 space-y-3 shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Контрагенты</span>
              <Building2 className="h-4 w-4 text-amber-400" />
            </div>

            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-extrabold font-mono text-foreground">
                {limits?.counterpartiesCount}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                из {limits?.maxCounterparties} лимит
              </span>
            </div>

            {/* Прогресс-бар */}
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  (limits?.counterpartiesUsagePercent || 0) >= 90
                    ? 'bg-rose-500'
                    : (limits?.counterpartiesUsagePercent || 0) >= 70
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${limits?.counterpartiesUsagePercent}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">Активные реестры и связи</p>
          </Card>

          {/* 2. СОТРУДНИКИ */}
          <Card className="bg-card border-border p-5 space-y-3 shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Сотрудники</span>
              <Users className="h-4 w-4 text-purple-400" />
            </div>

            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-extrabold font-mono text-foreground">
                {limits?.employeesCount}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                из {limits?.maxEmployees} мест
              </span>
            </div>

            {/* Прогресс-бар */}
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  (limits?.employeesUsagePercent || 0) >= 90
                    ? 'bg-rose-500'
                    : (limits?.employeesUsagePercent || 0) >= 70
                    ? 'bg-amber-500'
                    : 'bg-purple-500'
                }`}
                style={{ width: `${limits?.employeesUsagePercent}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">Пользователи с доступом</p>
          </Card>

          {/* 3. ОБЛАЧНЫЙ ДИСК */}
          <Card className="bg-card border-border p-5 space-y-3 shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Облачный диск</span>
              <HardDrive className="h-4 w-4 text-blue-400" />
            </div>

            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-extrabold font-mono text-foreground">
                {limits?.storageUsedMb} МБ
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                из {limits?.storageLimitGb} ГБ
              </span>
            </div>

            {/* Прогресс-бар */}
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  (limits?.storageUsagePercent || 0) >= 90
                    ? 'bg-rose-500'
                    : (limits?.storageUsagePercent || 0) >= 70
                    ? 'bg-amber-500'
                    : 'bg-blue-500'
                }`}
                style={{ width: `${limits?.storageUsagePercent}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">Сканы и прикрепленные файлы</p>
          </Card>

          {/* 4. TELEGRAM-УВЕДОМЛЕНИЯ */}
          <Card className="bg-card border-border p-5 space-y-3 shadow-md flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Уведомления Telegram</span>
              <Send className="h-4 w-4 text-sky-400" />
            </div>

            <div className="space-y-1">
              <Badge
                variant="outline"
                className={
                  limits?.isTelegramEnabled
                    ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 font-bold text-xs'
                    : 'border-muted-foreground/30 text-muted-foreground bg-muted/40 text-xs'
                }
              >
                {limits?.isTelegramEnabled ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-400" />
                    Включено в тариф
                  </>
                ) : (
                  <>
                    <Lock className="h-3 w-3 mr-1 text-muted-foreground" />
                    Недоступно
                  </>
                )}
              </Badge>
            </div>

            <p className="text-[11px] text-muted-foreground">Оповещения и прием документов</p>
          </Card>
        </div>
      </div>

      {/* КАТАЛОГ ТАРИФНЫХ ПЛАНОВ */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center">
              <Sparkles className="h-5 w-5 mr-2 text-blue-500" />
              Доступные тарифные планы
            </h3>
            <p className="text-xs text-muted-foreground">
              Выберите оптимальный объем лимитов для масштабирования вашей организации
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const isCurrent = limits?.planId === plan.id;
            return (
              <Card
                key={plan.id}
                className={`bg-card p-6 flex flex-col justify-between shadow-xl relative transition-all ${
                  isCurrent
                    ? 'border-2 border-blue-500 ring-1 ring-blue-500/30 shadow-blue-500/10'
                    : plan.is_popular
                    ? 'border-2 border-amber-500/50 shadow-amber-500/10'
                    : 'border border-border'
                }`}
              >
                {plan.is_popular && (
                  <div className="absolute -top-3 left-6">
                    <Badge className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[11px] font-bold px-3 py-0.5 shadow-md">
                      <Sparkles className="h-3 w-3 mr-1" />
                      {plan.badge_text || 'Популярный выбор'}
                    </Badge>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="flex items-center justify-between pt-1">
                    <h4 className="font-extrabold text-foreground text-lg">{plan.name}</h4>
                    {isCurrent && (
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                        Текущий план
                      </Badge>
                    )}
                  </div>

                  <div>
                    <p className="text-3xl font-extrabold font-mono text-foreground">
                      {plan.price}{' '}
                      <span className="text-xs text-muted-foreground font-normal">{plan.period}</span>
                    </p>
                    {plan.description && (
                      <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                    )}
                  </div>

                  {/* Квоты тарифа */}
                  <div className="p-3 bg-muted/40 border border-border rounded-xl space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Контрагенты:</span>
                      <span className="font-bold text-foreground font-mono">
                        до {plan.max_counterparties || 10}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Сотрудники:</span>
                      <span className="font-bold text-foreground font-mono">
                        до {plan.max_employees || 3}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Облачный диск:</span>
                      <span className="font-bold text-foreground font-mono">
                        {plan.storage_limit_bytes
                          ? `${Math.round(plan.storage_limit_bytes / (1024 * 1024 * 1024))} ГБ`
                          : '1 ГБ'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Telegram-бот:</span>
                      <span
                        className={`font-bold ${
                          plan.is_telegram_enabled ? 'text-emerald-400' : 'text-muted-foreground'
                        }`}
                      >
                        {plan.is_telegram_enabled ? 'Включен' : 'Недоступен'}
                      </span>
                    </div>
                  </div>

                  {/* Преимущества */}
                  <ul className="space-y-2 text-xs text-foreground/90 pt-2 border-t border-border">
                    {(plan.features || []).map((feat, fIdx) => (
                      <li key={fIdx} className="flex items-start">
                        <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-6 mt-4 border-t border-border">
                  <Button
                    className={`w-full ${
                      isCurrent
                        ? 'bg-muted border border-border text-foreground hover:bg-muted/80'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20'
                    }`}
                    onClick={() => handleOpenRequestModal(plan.id)}
                  >
                    {isCurrent ? 'Продлить текущий план' : `Выбрать «${plan.name}»`}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ТАБЛИЦА ИСТОРИИ ЗАЯВОК НА ПРОДЛЕНИЕ */}
      <Card className="bg-card border-border p-5 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center">
              <FileCheck className="h-5 w-5 mr-2 text-purple-400" />
              История поданных заявок на продление
            </h3>
            <p className="text-xs text-muted-foreground">
              Статусы обработки запросов суперадминистратором Buhuchet.kg
            </p>
          </div>
          <Badge variant="outline" className="border-border text-muted-foreground font-mono text-xs">
            Всего заявок: {renewalRequests.length}
          </Badge>
        </div>

        <UnifiedDataGrid<SubscriptionRenewalRequest>
          gridId="company_renewal_requests_grid"
          columns={requestColumns}
          data={renewalRequests}
          keyExtractor={(r) => r.id}
          searchPlaceholder="Поиск по тарифу, статусу, комментарию..."
          emptyMessage="Вы еще не подавали заявок на продление тарифа."
          isLoading={false}
          defaultPageSize={25}
        />
      </Card>

      {/* МОДАЛЬНОЕ ОКНО ПОДАЧИ ЗАЯВКИ НА ПРОДЛЕНИЕ */}
      {isModalOpen && (
        <UnifiedFormModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={`Подача заявки на тариф «${selectedPlanObj?.name || 'Бизнес'}»`}
          subtitle="Заявка будет моментально направлена суперадминистратору для активации периода"
          mode="create"
          submitText={submittingRequest ? 'Отправка заявки...' : 'Отправить заявку'}
          isSubmitting={submittingRequest}
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            handleSubmitRenewalRequest();
          }}
        >
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            {/* ВЫБОР ТАРИФА */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Выберите тарифный план *</Label>
              <div className="grid grid-cols-3 gap-2">
                {plans.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlanId(p.id)}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      selectedPlanId === p.id
                        ? 'bg-blue-600/20 border-blue-500 text-white font-bold'
                        : 'bg-muted/40 border-border text-muted-foreground hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs truncate">{p.name}</div>
                    <div className="text-[11px] font-mono text-foreground font-semibold mt-0.5">
                      {p.price} сом
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ВЫБОР ПЕРИОДА ОПЛАТЫ */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Срок действия подписки:</Label>
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
                        ? 'bg-blue-600/20 border-blue-500 text-white font-bold'
                        : 'bg-muted/40 border-border text-muted-foreground hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs">{item.label}</div>
                    {item.discount !== '0%' && (
                      <div className="text-[10px] text-emerald-400 font-mono">{item.discount}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* ИТОГОВАЯ СУММА К ОПЛАТЕ */}
            <div className="p-4 bg-muted/60 border border-border rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Ориентировочная сумма к оплате:</span>
                <span className="text-xs text-muted-foreground">
                  (с учетом скидки за период {selectedPeriod} мес.)
                </span>
              </div>
              <div className="text-right">
                <span className="text-xl font-extrabold font-mono text-foreground">
                  {totalCalculated.toLocaleString('ru-RU')} сом
                </span>
              </div>
            </div>

            {/* КОММЕНТАРИЙ */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Комментарий или пожелание к заявке (необязательно)</Label>
              <textarea
                value={requestComment}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRequestComment(e.target.value)}
                placeholder="Укажите номер платежного поручения, реквизиты или пожелания к расширению квот..."
                className="w-full bg-card border border-border rounded-xl p-3 text-xs text-foreground font-sans focus:outline-none focus:ring-2 focus:ring-primary min-h-[80px]"
                maxLength={1000}
              />
            </div>
          </div>
        </UnifiedFormModal>
      )}
    </div>
  );
}
