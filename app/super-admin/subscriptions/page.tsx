'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, CheckCircle2, ShieldCheck, Zap, RefreshCw, Loader2, Building2, AlertTriangle } from 'lucide-react';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { getAllSubscriptionsAdminAction, checkExpiredSubscriptionsAdminAction } from '@/app/super-admin/actions';
import { toast } from 'sonner';

export default function SuperAdminSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingExpired, setCheckingExpired] = useState(false);

  const loadSubscriptions = async () => {
    setLoading(true);
    const res = await getAllSubscriptionsAdminAction();
    if (res.success && res.data) {
      setSubscriptions(res.data);
    } else {
      toast.error(res.error || 'Не удалось загрузить реестр подписок');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadSubscriptions();
  }, []);

  const handleCheckExpired = async () => {
    setCheckingExpired(true);
    try {
      const res = await checkExpiredSubscriptionsAdminAction();
      if (res.success) {
        toast.success(`Проверка завершена: обновлено ${res.data?.updatedCount || 0} просроченных подписок`);
        loadSubscriptions();
      } else {
        toast.error(res.error || 'Ошибка проверки просроченных тарифов');
      }
    } catch (e: any) {
      toast.error(e.message || 'Сбой выполнения проверки');
    } finally {
      setCheckingExpired(false);
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
      title="Управление подписками и лимитами"
      description="Контроль тарифных планов организаций, срока действия и фоновая проверка задолженностей"
      icon={CreditCard}
    >
      <div className="space-y-6">
        {/* Карточки планов */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card border-border p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground text-base">Базовый тариф</h3>
              <Badge variant="outline" className="border-border text-muted-foreground text-xs">Стандарт</Badge>
            </div>
            <p className="text-2xl font-bold font-mono text-amber-400">0 сом <span className="text-xs text-muted-foreground font-normal">/ мес</span></p>
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> До 50 документов в месяц</li>
              <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> 1 ГБ на облачном диске</li>
              <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> До 3 сотрудников</li>
            </ul>
          </Card>

          <Card className="bg-card border-amber-500/30 p-6 space-y-4 relative overflow-hidden shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground text-base">Бизнес тариф</h3>
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-xs">Популярный</Badge>
            </div>
            <p className="text-2xl font-bold font-mono text-amber-400">1 500 сом <span className="text-xs text-muted-foreground font-normal">/ мес</span></p>
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> Неограниченно документов</li>
              <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> 15 ГБ на облачном диске</li>
              <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> До 15 сотрудников</li>
            </ul>
          </Card>

          <Card className="bg-card border-purple-500/30 p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground text-base">Корпоративный</h3>
              <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-xs">VIP</Badge>
            </div>
            <p className="text-2xl font-bold font-mono text-purple-400">Индивидуальный</p>
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> Безлимитный облачный диск</li>
              <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> Выделенный сервер 1С</li>
              <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> Персональный консультант</li>
            </ul>
          </Card>
        </div>

        {/* Таблица Реестра Подписок Организаций */}
        <Card className="bg-card border-border p-5 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center">
                <ShieldCheck className="h-5 w-5 mr-2 text-purple-400" />
                Реестр Подписок Организаций
              </h3>
              <p className="text-xs text-muted-foreground">Мониторинг активных тарифов и контроль окончания периодов</p>
            </div>
            <div className="flex items-center space-x-3">
              <Button
                size="sm"
                variant="outline"
                disabled={checkingExpired}
                onClick={handleCheckExpired}
                className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 text-xs h-8"
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
              <Badge variant="outline" className="border-border text-muted-foreground font-mono text-xs">
                Всего: {subscriptions.length}
              </Badge>
            </div>
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
    </UnifiedWorkspaceLayout>
  );
}
