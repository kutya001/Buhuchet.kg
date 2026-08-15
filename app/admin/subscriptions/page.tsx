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
} from 'lucide-react';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';
import {
  getAllSubscriptionsAdminAction,
  checkExpiredSubscriptionsAdminAction,
  getLandingPricingPlansAction,
  updateLandingPricingPlanAction,
} from '@/app/admin/actions';
import { toast } from 'sonner';
import type { LandingPricingPlan } from '@/types/database.types';

export default function SuperAdminSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [landingPlans, setLandingPlans] = useState<LandingPricingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingExpired, setCheckingExpired] = useState(false);

  // РЕДАКТИРОВАНИЕ ТАРИФА ЛЕНДИНГА
  const [editingPlan, setEditingPlan] = useState<LandingPricingPlan | null>(null);
  const [planName, setPlanName] = useState('');
  const [planPrice, setPlanPrice] = useState('');
  const [planPeriod, setPlanPeriod] = useState('сом/мес');
  const [planDescription, setPlanDescription] = useState('');
  const [planIsPopular, setPlanIsPopular] = useState(false);
  const [planBadgeText, setPlanBadgeText] = useState('');
  const [planFeaturesText, setPlanFeaturesText] = useState('');
  const [planButtonText, setPlanButtonText] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [subRes, plansRes] = await Promise.all([
      getAllSubscriptionsAdminAction(),
      getLandingPricingPlansAction(),
    ]);

    if (subRes.success && subRes.data) {
      setSubscriptions(subRes.data);
    } else {
      toast.error(subRes.error || 'Не удалось загрузить реестр подписок');
    }

    if (plansRes.success && plansRes.data) {
      setLandingPlans(plansRes.data);
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
        is_popular: planIsPopular,
        badge_text: planBadgeText.trim() || undefined,
        features: featuresArray,
        button_text: planButtonText.trim() || 'Выбрать тариф',
      });

      if (res.success) {
        toast.success(`Тариф «${planName}» успешно обновлен на лендинге`);
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

  const columns: ColumnDef<any>[] = [
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
            {d.toLocaleDateString('ru-RU')}
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
          {new Date(s.created_at).toLocaleDateString('ru-RU')}
        </span>
      ),
    },
  ];

  return (
    <UnifiedWorkspaceLayout
      title="Управление тарифами и подписками"
      description="Настройка публичных тарифов лендинга и мониторинг подписок организаций"
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
      <div className="space-y-8">
        {/* СЕКЦИЯ 1: НАСТРОЙКА ПУБЛИЧНЫХ ТАРИФОВ ЛЕНДИНГА */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center">
                <SlidersHorizontal className="h-5 w-5 mr-2 text-blue-400" />
                Публичные тарифы лендинга («Прозрачные тарифы без скрытых платежей»)
              </h3>
              <p className="text-xs text-muted-foreground">
                Редактируйте стоимость, описания, преимущества и бейджи тарифов в режиме реального времени
              </p>
            </div>
            <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10 text-xs font-mono">
              Live на главной
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

                  <ul className="space-y-2 text-xs text-foreground/90 pt-3 border-t border-border">
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
                    Настроить
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* СЕКЦИЯ 2: РЕЕСТР ПОДПИСОК ОРГАНИЗАЦИЙ */}
        <Card className="bg-card border-border p-5 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center">
                <ShieldCheck className="h-5 w-5 mr-2 text-purple-400" />
                Реестр Подписок Организаций
              </h3>
              <p className="text-xs text-muted-foreground">Мониторинг активных тарифов и контроль окончания периодов компаний</p>
            </div>
            <Badge variant="outline" className="border-border text-muted-foreground font-mono text-xs">
              Всего: {subscriptions.length} компаний
            </Badge>
          </div>

          <UnifiedDataGrid<any>
            gridId="superadmin_subscriptions_grid"
            columns={columns}
            data={subscriptions}
            keyExtractor={(s) => s.id}
            searchPlaceholder="Поиск по организации, ИНН, тарифу..."
            emptyMessage="Подписки в системе не найдены."
            isLoading={loading}
            defaultPageSize={25}
          />
        </Card>
      </div>

      {/* МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ТАРИФА ЛЕНДИНГА */}
      {editingPlan && (
        <UnifiedFormModal
          isOpen={!!editingPlan}
          onClose={() => setEditingPlan(null)}
          title={`Настройка тарифа «${editingPlan.name}»`}
          subtitle="Изменение параметров отображения плана в секции «Прозрачные тарифы» на главной странице"
          mode="edit"
          submitText={savingPlan ? 'Сохранение...' : 'Сохранить тариф'}
          isSubmitting={savingPlan}
          onSubmit={(e) => {
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
                <Label className="text-xs font-semibold">Стоимость (KGS) *</Label>
                <Input
                  value={planPrice}
                  onChange={(e) => setPlanPrice(e.target.value)}
                  placeholder="990 / 2 490"
                  className="bg-card border-border font-mono text-sm"
                  required
                />
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
                  placeholder="Начать 7 дней бесплатно"
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
                  Выделить как популярный тариф (Популярный план)
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
    </UnifiedWorkspaceLayout>
  );
}
