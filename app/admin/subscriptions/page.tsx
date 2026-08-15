'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  CreditCard,
  CheckCircle2,
  ShieldCheck,
  Zap,
  RefreshCw,
  Loader2,
  Building2,
  AlertTriangle,
  Pencil,
  Sparkles,
  SlidersHorizontal,
  FileCheck,
  Check,
  X,
  XCircle,
  Users,
  HardDrive,
  Send,
  Lock,
} from 'lucide-react';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';
import {
  getAllSubscriptionsAdminAction,
  checkExpiredSubscriptionsAdminAction,
  getLandingPricingPlansAction,
  updateLandingPricingPlanAction,
  getAdminRenewalRequestsAction,
  approveRenewalRequestAction,
  rejectRenewalRequestAction,
} from '@/app/admin/actions';
import { toast } from 'sonner';
import type { LandingPricingPlan, SubscriptionRenewalRequest } from '@/types/database.types';

export default function SuperAdminSubscriptionsPage() {
  const [activeTab, setActiveTab] = useState<'requests' | 'plans' | 'subscriptions'>('requests');
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [landingPlans, setLandingPlans] = useState<LandingPricingPlan[]>([]);
  const [renewalRequests, setRenewalRequests] = useState<SubscriptionRenewalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingExpired, setCheckingExpired] = useState(false);

  // РЕДАКТИРОВАНИЕ ТАРИФА ЛЕНДИНГА
  const [editingPlan, setEditingPlan] = useState<LandingPricingPlan | null>(null);
  const [planName, setPlanName] = useState('');
  const [planPrice, setPlanPrice] = useState('');
  const [planPeriod, setPlanPeriod] = useState('сом/мес');
  const [planDescription, setPlanDescription] = useState('');
  const [planMaxCounterparties, setPlanMaxCounterparties] = useState(10);
  const [planMaxEmployees, setPlanMaxEmployees] = useState(3);
  const [planStorageLimitGb, setPlanStorageLimitGb] = useState(1);
  const [planIsTelegramEnabled, setPlanIsTelegramEnabled] = useState(false);
  const [planIsPopular, setPlanIsPopular] = useState(false);
  const [planBadgeText, setPlanBadgeText] = useState('');
  const [planFeaturesText, setPlanFeaturesText] = useState('');
  const [planButtonText, setPlanButtonText] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  // МОДЕРАЦИЯ ЗАЯВОК НА ПРОДЛЕНИЕ
  const [approvingRequest, setApprovingRequest] = useState<SubscriptionRenewalRequest | null>(null);
  const [rejectingRequest, setRejectingRequest] = useState<SubscriptionRenewalRequest | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [processingAction, setProcessingAction] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [subRes, plansRes, reqsRes] = await Promise.all([
      getAllSubscriptionsAdminAction(),
      getLandingPricingPlansAction(),
      getAdminRenewalRequestsAction({ status: 'all', pageSize: 50 }),
    ]);

    if (subRes.success && subRes.data) {
      setSubscriptions(subRes.data);
    } else {
      toast.error(subRes.error || 'Не удалось загрузить реестр подписок');
    }

    if (plansRes.success && plansRes.data) {
      setLandingPlans(plansRes.data);
    }

    if (reqsRes.success && reqsRes.data) {
      setRenewalRequests(reqsRes.data.requests);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCheckExpired = async () => {
    setCheckingExpired(true);
    try {
      const res = await checkExpiredSubscriptionsAdminAction();
      if (res.success) {
        toast.success(`Проверка завершена: обновлено ${res.data?.updatedCount || 0} просроченных подписок`);
        loadData();
      } else {
        toast.error(res.error || 'Ошибка проверки просроченных тарифов');
      }
    } catch (e: any) {
      toast.error(e.message || 'Сбой выполнения проверки');
    } finally {
      setCheckingExpired(false);
    }
  };

  // ОТКРЫТИЕ МОДАЛКИ РЕДАКТИРОВАНИЯ ТАРИФА
  const handleStartEditPlan = (plan: LandingPricingPlan) => {
    setEditingPlan(plan);
    setPlanName(plan.name || '');
    setPlanPrice(plan.price || '');
    setPlanPeriod(plan.period || 'сом/мес');
    setPlanDescription(plan.description || '');
    setPlanMaxCounterparties(plan.max_counterparties || 10);
    setPlanMaxEmployees(plan.max_employees || 3);
    setPlanStorageLimitGb(
      plan.storage_limit_bytes ? Math.round(plan.storage_limit_bytes / (1024 * 1024 * 1024)) : 1
    );
    setPlanIsTelegramEnabled(Boolean(plan.is_telegram_enabled));
    setPlanIsPopular(Boolean(plan.is_popular));
    setPlanBadgeText(plan.badge_text || '');
    setPlanFeaturesText((plan.features || []).join('\n'));
    setPlanButtonText(plan.button_text || 'Выбрать тариф');
  };

  // СОХРАНЕНИЕ ТАРИФА
  const handleSavePlan = async () => {
    if (!editingPlan) return;
    if (!planName.trim()) {
      toast.error('Укажите название тарифа');
      return;
    }
    if (!planPrice.trim()) {
      toast.error('Укажите стоимость');
      return;
    }

    const featuresArray = planFeaturesText
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    setSavingPlan(true);
    try {
      const res = await updateLandingPricingPlanAction({
        id: editingPlan.id,
        name: planName.trim(),
        price: planPrice.trim(),
        period: planPeriod.trim() || 'сом/мес',
        description: planDescription.trim() || undefined,
        max_counterparties: Number(planMaxCounterparties) || 10,
        max_employees: Number(planMaxEmployees) || 3,
        storage_limit_gb: Number(planStorageLimitGb) || 1,
        is_telegram_enabled: planIsTelegramEnabled,
        is_popular: planIsPopular,
        badge_text: planBadgeText.trim() || undefined,
        features: featuresArray,
        button_text: planButtonText.trim() || 'Выбрать тариф',
      });

      if (res.success) {
        toast.success(`Тариф «${planName}» успешно обновлен`);
        setEditingPlan(null);
        loadData();
      } else {
        toast.error(res.error || 'Ошибка обновления тарифа');
      }
    } catch (e: any) {
      toast.error(e.message || 'Сбой обновления');
    } finally {
      setSavingPlan(false);
    }
  };

  // ОДОБРЕНИЕ ЗАЯВКИ
  const handleApproveRequest = async () => {
    if (!approvingRequest) return;
    setProcessingAction(true);
    try {
      const res = await approveRenewalRequestAction({
        requestId: approvingRequest.id,
        adminNotes: adminNotes.trim() || undefined,
      });

      if (res.success) {
        toast.success(`Заявка для организации «${approvingRequest.company?.name}» успешно одобрена! Подписка продлена.`);
        setApprovingRequest(null);
        setAdminNotes('');
        loadData();
      } else {
        toast.error(res.error || 'Ошибка одобрения заявки');
      }
    } catch (err: any) {
      toast.error(err.message || 'Сбой одобрения');
    } finally {
      setProcessingAction(false);
    }
  };

  // ОТКЛОНЕНИЕ ЗАЯВКИ
  const handleRejectRequest = async () => {
    if (!rejectingRequest) return;
    if (!adminNotes.trim()) {
      toast.error('Укажите причину отклонения заявки');
      return;
    }

    setProcessingAction(true);
    try {
      const res = await rejectRenewalRequestAction({
        requestId: rejectingRequest.id,
        adminNotes: adminNotes.trim(),
      });

      if (res.success) {
        toast.success(`Заявка для «${rejectingRequest.company?.name}» отклонена`);
        setRejectingRequest(null);
        setAdminNotes('');
        loadData();
      } else {
        toast.error(res.error || 'Ошибка отклонения заявки');
      }
    } catch (err: any) {
      toast.error(err.message || 'Сбой отклонения');
    } finally {
      setProcessingAction(false);
    }
  };

  // КОЛОНКИ ЗАЯВОК НА ПРОДЛЕНИЕ
  const requestColumns: ColumnDef<SubscriptionRenewalRequest>[] = [
    {
      key: 'company',
      label: 'Организация',
      sortable: true,
      getValue: (r) => r.company?.name || '—',
      render: (r) => (
        <div className="space-y-0.5">
          <div className="font-semibold text-foreground flex items-center">
            <Building2 className="h-3.5 w-3.5 mr-1.5 text-blue-400 flex-shrink-0" />
            <span className="truncate max-w-[200px]">{r.company?.name || '—'}</span>
          </div>
          <div className="text-[11px] font-mono text-muted-foreground">ИНН: {r.company?.inn || '—'}</div>
        </div>
      ),
    },
    {
      key: 'requested_by',
      label: 'Инициатор',
      getValue: (r) => r.requested_by_user?.full_name || '—',
      render: (r) => (
        <div className="space-y-0.5">
          <div className="text-xs font-medium text-foreground">{r.requested_by_user?.full_name || '—'}</div>
          <div className="text-[11px] font-mono text-muted-foreground">{r.requested_by_user?.email || '—'}</div>
        </div>
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
      label: 'Срок',
      sortable: true,
      getValue: (r) => `${r.billing_period_months} мес.`,
      render: (r) => <span className="font-mono text-xs text-foreground font-semibold">{r.billing_period_months} мес.</span>,
    },
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
      key: 'status',
      label: 'Статус',
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
          <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10 text-xs font-semibold">
            Ожидает решения
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      label: 'Действия',
      render: (r) => {
        if (r.status !== 'pending') {
          return <span className="text-xs text-muted-foreground font-mono">Обработано</span>;
        }

        return (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={() => {
                setApprovingRequest(r);
                setAdminNotes('');
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white h-7 px-2 text-xs"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Одобрить
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRejectingRequest(r);
                setAdminNotes('');
              }}
              className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 h-7 px-2 text-xs"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Отклонить
            </Button>
          </div>
        );
      },
    },
  ];

  // КОЛОНКИ ПОДПИСОК ОРГАНИЗАЦИЙ
  const subColumns: ColumnDef<any>[] = [
    {
      key: 'company',
      label: 'Организация',
      sortable: true,
      getValue: (s) => s.company?.name || '—',
      render: (s) => (
        <div className="space-y-0.5">
          <div className="font-semibold text-foreground flex items-center">
            <Building2 className="h-3.5 w-3.5 mr-1.5 text-purple-400 flex-shrink-0" />
            <span className="truncate max-w-[220px]">{s.company?.name || 'Без названия'}</span>
          </div>
          <div className="text-[11px] font-mono text-muted-foreground">ИНН: {s.company?.inn || '—'}</div>
        </div>
      ),
    },
    {
      key: 'plan_type',
      label: 'Тарифный план',
      sortable: true,
      getValue: (s) => s.plan_type,
      render: (s) => (
        <Badge variant="outline" className="border-purple-500/30 text-purple-300 bg-purple-500/10 font-mono text-xs capitalize">
          {s.plan_type || 'basic'}
        </Badge>
      ),
    },
    {
      key: 'status',
      label: 'Статус подписки',
      sortable: true,
      getValue: (s) => s.status,
      render: (s) => {
        const isPastDue = s.status === 'past_due' || (s.expires_at && new Date(s.expires_at) < new Date());
        if (isPastDue) {
          return (
            <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40 text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Просрочен / Заморожен
            </Badge>
          );
        }
        if (s.status === 'active') {
          return (
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Активен
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10 text-xs">
            {s.status || 'пробный'}
          </Badge>
        );
      },
    },
    {
      key: 'expires_at',
      label: 'Срок действия',
      sortable: true,
      getValue: (s) => s.expires_at,
      render: (s) => {
        if (!s.expires_at) return <span className="text-xs text-muted-foreground">Бессрочно</span>;
        const d = new Date(s.expires_at);
        const isExpired = d < new Date();
        return (
          <span className={`font-mono text-xs ${isExpired ? 'text-rose-400 font-bold' : 'text-foreground'}`}>
            {d.toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Дата подключения',
      sortable: true,
      getValue: (s) => s.created_at,
      render: (s) => (
        <span className="font-mono text-xs text-muted-foreground">
          {new Date(s.created_at).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
    },
  ];

  const pendingRequestsCount = renewalRequests.filter((r) => r.status === 'pending').length;

  return (
    <UnifiedWorkspaceLayout
      title="Управление тарифами и подписками"
      description="Модерация заявок на продление, настройка лимитов тарифных планов и мониторинг организаций"
      icon={CreditCard}
      actionButtonsSlot={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={checkingExpired}
            onClick={handleCheckExpired}
            className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 text-xs min-h-[40px]"
          >
            {checkingExpired ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Проверка...
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Проверить просроченные
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={loadData}
            className="border-border text-xs min-h-[40px]"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Обновить'}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* ВКЛАДКИ РАЗДЕЛА */}
        <div className="flex items-center gap-1.5 p-1 bg-card border border-border rounded-2xl w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('requests')}
            className={`text-xs font-semibold py-2 px-4 rounded-xl transition-all flex items-center ${
              activeTab === 'requests'
                ? 'bg-primary text-primary-foreground font-bold shadow-md'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <FileCheck className="h-4 w-4 mr-2" />
            Заявки на продление
            {pendingRequestsCount > 0 && (
              <Badge className="ml-2 bg-amber-500 text-black font-extrabold text-[10px] px-1.5 py-0 h-4">
                {pendingRequestsCount}
              </Badge>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('plans')}
            className={`text-xs font-semibold py-2 px-4 rounded-xl transition-all flex items-center ${
              activeTab === 'plans'
                ? 'bg-primary text-primary-foreground font-bold shadow-md'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4 mr-2" />
            Тарифные планы и квоты
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('subscriptions')}
            className={`text-xs font-semibold py-2 px-4 rounded-xl transition-all flex items-center ${
              activeTab === 'subscriptions'
                ? 'bg-primary text-primary-foreground font-bold shadow-md'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <ShieldCheck className="h-4 w-4 mr-2" />
            Реестр подписок ({subscriptions.length})
          </button>
        </div>

        {/* 1. ВКЛАДКА: ЗАЯВКИ НА ПРОДЛЕНИЕ */}
        {activeTab === 'requests' && (
          <div className="space-y-4">
            <Card className="bg-card border-border p-5 space-y-4 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center">
                    <FileCheck className="h-5 w-5 mr-2 text-blue-400" />
                    Заявки на продление и смену тарифных планов
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Одобряйте запросы организаций для автоматической пролонгации подписки и обновления квот
                  </p>
                </div>
                <Badge variant="outline" className="border-border text-muted-foreground font-mono text-xs">
                  Ожидают: {pendingRequestsCount}
                </Badge>
              </div>

              <UnifiedDataGrid<SubscriptionRenewalRequest>
                gridId="admin_renewal_requests_grid"
                columns={requestColumns}
                data={renewalRequests}
                keyExtractor={(r) => r.id}
                searchPlaceholder="Поиск по организации, ИНН, тарифу, инициатору..."
                emptyMessage="Заявки на продление подписок отсутствуют."
                isLoading={loading}
                defaultPageSize={25}
              />
            </Card>
          </div>
        )}

        {/* 2. ВКЛАДКА: ТАРИФНЫЕ ПЛАНЫ */}
        {activeTab === 'plans' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center">
                  <SlidersHorizontal className="h-5 w-5 mr-2 text-blue-400" />
                  Настройка параметров и квот тарифных планов
                </h3>
                <p className="text-xs text-muted-foreground">
                  Редактируйте стоимость, лимиты контрагентов, сотрудников, Облачного диска и Telegram-бота
                </p>
              </div>
              <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10 text-xs font-mono">
                Синхронизировано с лендингом
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {landingPlans.map((plan) => (
                <Card
                  key={plan.id}
                  className={`bg-card p-6 flex flex-col justify-between shadow-xl relative transition-all ${
                    plan.is_popular
                      ? 'border-2 border-blue-500 shadow-blue-500/10'
                      : 'border border-border'
                  }`}
                >
                  {plan.is_popular && (
                    <div className="absolute -top-3 left-6">
                      <Badge className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[11px] font-bold px-3 py-0.5 shadow-md">
                        <Sparkles className="h-3 w-3 mr-1" />
                        {plan.badge_text || 'Популярный'}
                      </Badge>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="flex items-center justify-between pt-1">
                      <h4 className="font-extrabold text-foreground text-lg">{plan.name}</h4>
                      <span className="text-xs font-mono text-muted-foreground">ID: {plan.id}</span>
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

                    {/* Блок настроенных лимитов */}
                    <div className="p-3 bg-muted/50 border border-border rounded-xl space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center">
                          <Building2 className="h-3.5 w-3.5 mr-1 text-amber-400" />
                          Контрагенты:
                        </span>
                        <span className="font-bold font-mono text-foreground">
                          до {plan.max_counterparties || 10}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center">
                          <Users className="h-3.5 w-3.5 mr-1 text-purple-400" />
                          Сотрудники:
                        </span>
                        <span className="font-bold font-mono text-foreground">
                          до {plan.max_employees || 3}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center">
                          <HardDrive className="h-3.5 w-3.5 mr-1 text-blue-400" />
                          Облачный диск:
                        </span>
                        <span className="font-bold font-mono text-foreground">
                          {plan.storage_limit_bytes
                            ? `${Math.round(plan.storage_limit_bytes / (1024 * 1024 * 1024))} ГБ`
                            : '1 ГБ'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center">
                          <Send className="h-3.5 w-3.5 mr-1 text-sky-400" />
                          Telegram-бот:
                        </span>
                        <span
                          className={`font-bold ${
                            plan.is_telegram_enabled ? 'text-emerald-400' : 'text-muted-foreground'
                          }`}
                        >
                          {plan.is_telegram_enabled ? 'Включен' : 'Отключен'}
                        </span>
                      </div>
                    </div>

                    <ul className="space-y-2 text-xs text-foreground/90 pt-2 border-t border-border">
                      {(plan.features || []).map((feat, fIdx) => (
                        <li key={fIdx} className="flex items-start">
                          <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400 flex-shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-6 mt-4 border-t border-border flex items-center justify-between">
                    <span className="text-[11px] font-mono text-muted-foreground">
                      Кнопка: «{plan.button_text}»
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStartEditPlan(plan)}
                      className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 text-xs h-8"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Редактировать
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* 3. ВКЛАДКА: РЕЕСТР ПОДПИСОК ОРГАНИЗАЦИЙ */}
        {activeTab === 'subscriptions' && (
          <div className="space-y-4">
            <Card className="bg-card border-border p-5 space-y-4 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center">
                    <ShieldCheck className="h-5 w-5 mr-2 text-purple-400" />
                    Реестр Подписок Организаций
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Мониторинг активных тарифов и контроль окончания периодов компаний
                  </p>
                </div>
                <Badge variant="outline" className="border-border text-muted-foreground font-mono text-xs">
                  Всего: {subscriptions.length} компаний
                </Badge>
              </div>

              <UnifiedDataGrid<any>
                gridId="superadmin_subscriptions_grid"
                columns={subColumns}
                data={subscriptions}
                keyExtractor={(s) => s.id}
                searchPlaceholder="Поиск по организации, ИНН, тарифу..."
                emptyMessage="Подписки в системе не найдены."
                isLoading={loading}
                defaultPageSize={25}
              />
            </Card>
          </div>
        )}
      </div>

      {/* МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ТАРИФА */}
      {editingPlan && (
        <UnifiedFormModal
          isOpen={!!editingPlan}
          onClose={() => setEditingPlan(null)}
          title={`Редактирование тарифа «${editingPlan.name}»`}
          subtitle="Настройка цены, квот ресурсов (контрагенты, сотрудники, память) и параметров отображения"
          mode="edit"
          submitText={savingPlan ? 'Сохранение...' : 'Сохранить параметры'}
          isSubmitting={savingPlan}
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            handleSavePlan();
          }}
        >
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Название тарифа *</Label>
                <Input
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="Старт / Бизнес / Премиум"
                  className="bg-card border-border text-sm"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold">Стоимость (сом/KGS) *</Label>
                <Input
                  value={planPrice}
                  onChange={(e) => setPlanPrice(e.target.value)}
                  placeholder="990 / 2 490"
                  className="bg-card border-border font-mono text-sm"
                  required
                />
              </div>
            </div>

            {/* СЕТКА НАСТРОЙКИ КВОТ ТАРИФА */}
            <div className="p-4 bg-muted/40 border border-border rounded-xl space-y-4">
              <span className="text-xs font-bold text-foreground block">
                Квоты и технические лимиты тарифа:
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Лимит контрагентов *</Label>
                  <Input
                    type="number"
                    min={1}
                    value={planMaxCounterparties}
                    onChange={(e) => setPlanMaxCounterparties(Number(e.target.value))}
                    className="bg-card border-border font-mono text-sm"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground">Макс. число организаций</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Лимит сотрудников *</Label>
                  <Input
                    type="number"
                    min={1}
                    value={planMaxEmployees}
                    onChange={(e) => setPlanMaxEmployees(Number(e.target.value))}
                    className="bg-card border-border font-mono text-sm"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground">Пользователей в компании</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Облачный диск (ГБ) *</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={planStorageLimitGb}
                    onChange={(e) => setPlanStorageLimitGb(Number(e.target.value))}
                    className="bg-card border-border font-mono text-sm"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground">Объем хранилища сканов</p>
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-2 border-t border-border">
                <Checkbox
                  id="is_telegram_enabled"
                  checked={planIsTelegramEnabled}
                  onCheckedChange={(checked) => setPlanIsTelegramEnabled(Boolean(checked))}
                />
                <Label htmlFor="is_telegram_enabled" className="text-xs font-semibold cursor-pointer">
                  Разрешить Telegram-уведомления и работу бота в этом тарифе
                </Label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Период оплаты</Label>
                <Input
                  value={planPeriod}
                  onChange={(e) => setPlanPeriod(e.target.value)}
                  placeholder="сом/мес"
                  className="bg-card border-border text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold">Текст на кнопке</Label>
                <Input
                  value={planButtonText}
                  onChange={(e) => setPlanButtonText(e.target.value)}
                  placeholder="Выбрать тариф"
                  className="bg-card border-border text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">Краткое описание</Label>
              <Input
                value={planDescription}
                onChange={(e) => setPlanDescription(e.target.value)}
                placeholder="Для кого предназначен данный план"
                className="bg-card border-border text-sm"
              />
            </div>

            <div className="p-3.5 bg-muted/40 border border-border rounded-xl space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="is_popular"
                  checked={planIsPopular}
                  onCheckedChange={(checked) => setPlanIsPopular(Boolean(checked))}
                />
                <Label htmlFor="is_popular" className="text-xs font-bold cursor-pointer">
                  Выделить как популярный тариф (Популярный выбор)
                </Label>
              </div>

              {planIsPopular && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-xs text-muted-foreground">Текст бейджа популярности</Label>
                  <Input
                    value={planBadgeText}
                    onChange={(e) => setPlanBadgeText(e.target.value)}
                    placeholder="Самый популярный / Хит продаж"
                    className="bg-card border-border text-xs"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Преимущества (каждое с новой строки)</Label>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {planFeaturesText.split('\n').filter((f) => f.trim().length > 0).length} пунктов
                </span>
              </div>
              <textarea
                value={planFeaturesText}
                onChange={(e) => setPlanFeaturesText(e.target.value)}
                rows={5}
                placeholder="До 500 первичных документов в месяц&#10;Неограниченное число сотрудников&#10;Telegram-оповещения"
                className="w-full bg-card border border-border rounded-xl p-3 text-xs text-foreground font-sans focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed"
              />
            </div>
          </div>
        </UnifiedFormModal>
      )}

      {/* МОДАЛЬНОЕ ОКНО ОДОБРЕНИЯ ЗАЯВКИ */}
      {approvingRequest && (
        <UnifiedFormModal
          isOpen={!!approvingRequest}
          onClose={() => setApprovingRequest(null)}
          title="Одобрение заявки на продление подписки"
          subtitle={`Организация: «${approvingRequest.company?.name}» (ИНН ${approvingRequest.company?.inn})`}
          mode="create"
          submitText={processingAction ? 'Активация...' : 'Подтвердить и активировать'}
          isSubmitting={processingAction}
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            handleApproveRequest();
          }}
        >
          <div className="space-y-4">
            <div className="p-4 bg-muted/60 border border-border rounded-xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Запрошенный тариф:</span>
                <span className="font-bold text-foreground">{approvingRequest.target_plan?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Период продления:</span>
                <span className="font-bold text-foreground font-mono">{approvingRequest.billing_period_months} мес.</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Инициатор запроса:</span>
                <span className="font-medium text-foreground">{approvingRequest.requested_by_user?.full_name} ({approvingRequest.requested_by_user?.email})</span>
              </div>
              {approvingRequest.comment && (
                <div className="pt-2 border-t border-border">
                  <span className="text-muted-foreground block mb-1">Комментарий клиента:</span>
                  <p className="text-foreground italic bg-card p-2 rounded-lg">{approvingRequest.comment}</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">Примечание администратора (необязательно)</Label>
              <textarea
                value={adminNotes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAdminNotes(e.target.value)}
                placeholder="Оплата получена по ПП №..., тариф активирован на 12 месяцев"
                className="w-full bg-card border border-border rounded-xl p-3 text-xs text-foreground font-sans focus:outline-none focus:ring-2 focus:ring-primary min-h-[70px]"
              />
            </div>
          </div>
        </UnifiedFormModal>
      )}

      {/* МОДАЛЬНОЕ ОКНО ОТКЛОНЕНИЯ ЗАЯВКИ */}
      {rejectingRequest && (
        <UnifiedFormModal
          isOpen={!!rejectingRequest}
          onClose={() => setRejectingRequest(null)}
          title="Отклонение заявки на продление"
          subtitle={`Организация: «${rejectingRequest.company?.name}» (ИНН ${rejectingRequest.company?.inn})`}
          mode="edit"
          submitText={processingAction ? 'Отклонение...' : 'Отклонить заявку'}
          isSubmitting={processingAction}
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            handleRejectRequest();
          }}
        >
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Укажите причину отклонения. Инициатор заявки увидит данное примечание в личном кабинете.
            </p>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">Причина отклонения *</Label>
              <textarea
                value={adminNotes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAdminNotes(e.target.value)}
                placeholder="Платеж не поступил / Неверно указаны реквизиты назначения платежа..."
                className="w-full bg-card border border-border rounded-xl p-3 text-xs text-foreground font-sans focus:outline-none focus:ring-2 focus:ring-primary min-h-[90px]"
                required
              />
            </div>
          </div>
        </UnifiedFormModal>
      )}
    </UnifiedWorkspaceLayout>
  );
}
