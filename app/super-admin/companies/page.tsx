'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Building2, Search, Eye, CheckCircle2, Clock, Ban, AlertCircle, Plus, Loader2 } from 'lucide-react';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedViewModal } from '@/components/ui/unified/UnifiedViewModal';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';
import { toast } from 'sonner';
import {
  getCompaniesAdminAction,
  getSuperAdminCompanyDetailsSafeAction,
  approveCompanyAction,
  blockCompanyAction,
  requestCompanyChangesAction,
  createCompanyAdminAction,
} from '@/app/super-admin/actions';
import type { Company } from '@/types/database.types';

export default function SuperAdminCompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

  // Модалка деталей (UnifiedViewModal)
  const [viewingCompanyDetails, setViewingCompanyDetails] = useState<any | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Модалка создания организации
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCompName, setNewCompName] = useState('');
  const [newCompInn, setNewCompInn] = useState('');

  const loadCompanies = async () => {
    setLoading(true);
    const res = await getCompaniesAdminAction({});
    if (res.success && res.data) {
      setCompanies(res.data);
    } else {
      toast.error(res.error || 'Не удалось загрузить реестр организаций');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const handleOpenCompanyDetails = async (companyId?: string) => {
    if (!companyId || typeof companyId !== 'string' || companyId.trim() === '') {
      toast.error('Ошибка: выбрана некорректная организация');
      return;
    }
    setLoadingDetails(true);
    setViewingCompanyDetails({});
    const res = await getSuperAdminCompanyDetailsSafeAction({ companyId });
    if (res.success && res.data) {
      setViewingCompanyDetails(res.data);
    } else {
      toast.error(res.error || 'Не удалось загрузить данные организации');
      setViewingCompanyDetails(null);
    }
    setLoadingDetails(false);
  };

  const handleApprove = (companyId: string, companyName: string) => {
    setViewingCompanyDetails(null);
    startTransition(async () => {
      const res = await approveCompanyAction(companyId);
      if (res.success) {
        toast.success(`Организация "${companyName}" успешно одобрена`);
        loadCompanies();
      } else {
        toast.error(res.error || 'Ошибка при верификации');
      }
    });
  };

  const handleBlock = (companyId: string, companyName: string) => {
    setViewingCompanyDetails(null);
    startTransition(async () => {
      const res = await blockCompanyAction(companyId, 'Блокировка администратором');
      if (res.success) {
        toast.success(`Организация "${companyName}" заблокирована`);
        loadCompanies();
      } else {
        toast.error(res.error || 'Ошибка при блокировке');
      }
    });
  };

  const handleCreateCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompName || newCompInn.length !== 14) {
      toast.error('Укажите название и корректный ИНН (14 цифр)');
      return;
    }
    const res = await createCompanyAdminAction({ name: newCompName, inn: newCompInn });
    if (res.success) {
      toast.success(`Организация "${newCompName}" добавлена`);
      setShowCreateModal(false);
      setNewCompName('');
      setNewCompInn('');
      loadCompanies();
    } else {
      toast.error(res.error || 'Ошибка создания организации');
    }
  };

  const columns: ColumnDef<Company>[] = [
    {
      key: 'name',
      label: 'Наименование организации',
      sortable: true,
      getValue: (c) => c.name,
      render: (c) => (
        <div className="font-semibold text-foreground text-xs sm:text-sm flex items-center space-x-2">
          <Building2 className="h-4 w-4 text-amber-400 flex-shrink-0" />
          <span className="truncate">{c.name}</span>
        </div>
      ),
    },
    {
      key: 'inn',
      label: 'ИНН КР (14 цифр)',
      sortable: true,
      getValue: (c) => c.inn,
      render: (c) => <span className="font-mono text-xs text-amber-300 font-bold">{c.inn}</span>,
    },
    {
      key: 'status',
      label: 'Статус доступа',
      sortable: true,
      getValue: (c) => c.status,
      render: (c) => {
        if (c.status === 'active') {
          return (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-[11px]">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Активна
            </Badge>
          );
        }
        if (c.status === 'pending_approval') {
          return (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-[11px]">
              <Clock className="h-3 w-3 mr-1" /> Ожидает проверки
            </Badge>
          );
        }
        return (
          <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/40 text-[11px]">
            <Ban className="h-3 w-3 mr-1" /> Заблокирована
          </Badge>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Дата регистрации',
      sortable: true,
      getValue: (c) => c.created_at,
      render: (c) => (
        <span className="font-mono text-xs text-muted-foreground">
          {new Date(c.created_at).toLocaleDateString('ru-RU')}
        </span>
      ),
    },
  ];

  return (
    <UnifiedWorkspaceLayout
      title="Реестр организаций и модерация"
      description="Управление зарегистрированными ОсОО и ИП, проверка уставных документов и верификация"
      icon={Building2}
      actionButtonsSlot={
        <Button
          onClick={() => setShowCreateModal(true)}
          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs md:text-sm min-h-[40px]"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Добавить организацию
        </Button>
      }
    >
      <UnifiedDataGrid<Company>
        gridId="superadmin_companies_grid"
        columns={columns}
        data={companies}
        keyExtractor={(c) => c.id}
        onRowClick={(c) => handleOpenCompanyDetails(c.id)}
        searchPlaceholder="Поиск по названию, ИНН организации..."
        emptyMessage="Организации не найдены."
        isLoading={loading}
        defaultPageSize={25}
      />

      {/* МОДАЛКА ПРОСМОТРА ОРГАНИЗАЦИИ (UnifiedViewModal) */}
      {viewingCompanyDetails && (
        <UnifiedViewModal
          isOpen={!!viewingCompanyDetails}
          onClose={() => setViewingCompanyDetails(null)}
          title={viewingCompanyDetails.company?.name || 'Организация'}
          subtitle={`ИНН КР: ${viewingCompanyDetails.company?.inn || '—'}`}
          isLoading={loadingDetails}
          badge={
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-[10px]">
              {viewingCompanyDetails.company?.status || 'активна'}
            </Badge>
          }
          sections={[
            {
              title: 'Реквизиты организации',
              fields: [
                { label: 'Наименование', value: viewingCompanyDetails.company?.name, icon: Building2, colSpan: 2 },
                { label: 'ИНН КР', value: viewingCompanyDetails.company?.inn },
                { label: 'Статус НДС', value: viewingCompanyDetails.company?.is_vat_payer ? 'Плательщик НДС (12%)' : 'Без НДС' },
              ],
            },
            {
              title: 'Владелец аккаунта и сотрудники',
              fields: [
                {
                  label: 'Владелец',
                  value: viewingCompanyDetails.owner
                    ? `${viewingCompanyDetails.owner.full_name || 'Не указан'} (${viewingCompanyDetails.owner.email})`
                    : '—',
                  colSpan: 2,
                },
                {
                  label: 'Штат сотрудников',
                  value: `${viewingCompanyDetails.employees?.length || 0} зарегистрированных специалистов`,
                },
              ],
            },
            {
              title: 'Ресурсы и Облачный диск',
              fields: [
                {
                  label: 'Занятый объем',
                  value: `${viewingCompanyDetails.stats?.totalStorageFormatted || '0 B'} на облачном диске`,
                  colSpan: 2,
                },
                {
                  label: 'Всего документов',
                  value: `${viewingCompanyDetails.stats?.totalDocumentsCount || 0} первичных документов`,
                },
              ],
            },
          ]}
          actions={[
            {
              label: '✅ Одобрить организацию',
              onClick: () =>
                handleApprove(viewingCompanyDetails.company.id, viewingCompanyDetails.company.name),
            },
            {
              label: '🚫 Заблокировать доступ',
              variant: 'destructive',
              onClick: () =>
                handleBlock(viewingCompanyDetails.company.id, viewingCompanyDetails.company.name),
            },
          ]}
        />
      )}

      {/* МОДАЛКА СОЗДАНИЯ ОРГАНИЗАЦИИ */}
      {showCreateModal && (
        <UnifiedFormModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Регистрация новой организации"
          subtitle="Внесите реквизиты юридического лица или ИП"
          mode="create"
          onSubmit={handleCreateCompanySubmit}
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                Наименование ОсОО / ИП
              </label>
              <Input
                value={newCompName}
                onChange={(e) => setNewCompName(e.target.value)}
                placeholder="ОсОО «Торговый Комплекс»"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                ИНН КР (14 цифр)
              </label>
              <Input
                value={newCompInn}
                onChange={(e) => setNewCompInn(e.target.value.replace(/\D/g, '').slice(0, 14))}
                placeholder="20101202310050"
                maxLength={14}
                required
              />
            </div>
          </div>
        </UnifiedFormModal>
      )}
    </UnifiedWorkspaceLayout>
  );
}
