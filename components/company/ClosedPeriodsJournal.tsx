'use client';

import React, { useState, useEffect, useTransition, useMemo } from 'react';
import {
  Clock,
  Lock,
  Unlock,
  ShieldAlert,
  Calendar,
  FileText,
  FolderArchive,
  Plus,
  Edit2,
  Trash2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  getAllClosedPeriodsAction,
  saveClosedPeriodAction,
  reopenFullPeriodAction,
  toggleModuleLockAction,
} from '@/app/uchet/company/actions';
import type { ClosedPeriod } from '@/types/company.types';
import { UnifiedDataGrid, type ColumnDef, type RowAction } from '@/components/ui/unified/UnifiedDataGrid';
import { ClosedPeriodModal } from './ClosedPeriodModal';

interface ClosedPeriodsJournalProps {
  canEdit: boolean;
}

export function ClosedPeriodsJournal({ canEdit }: ClosedPeriodsJournalProps) {
  const [periods, setPeriods] = useState<ClosedPeriod[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Состояние модального окна
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<ClosedPeriod | null>(null);

  const loadData = async () => {
    setLoading(true);
    const res = await getAllClosedPeriodsAction();
    if (res.success && res.data) {
      setPeriods(res.data);
    } else if (res.error) {
      setMsg({ type: 'error', text: res.error });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenCreateModal = () => {
    setEditingPeriod(null);
    setModalOpen(true);
  };

  const handleOpenEditModal = (item: ClosedPeriod) => {
    setEditingPeriod(item);
    setModalOpen(true);
  };

  const handleSavePeriod = async (params: {
    year: number;
    month: number;
    lockDocuments: boolean;
    lockFiles: boolean;
    reason?: string;
  }) => {
    setMsg(null);
    startTransition(async () => {
      const res = await saveClosedPeriodAction(params);
      if (res.success) {
        setMsg({
          type: 'success',
          text: `Параметры закрытия периода за ${params.month}/${params.year} г. успешно сохранены.`,
        });
        setModalOpen(false);
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при сохранении периода' });
      }
    });
  };

  const handleReopenPeriod = (item: ClosedPeriod) => {
    if (!canEdit) return;
    if (!confirm(`Вы уверены, что хотите полностью открыть период за ${item.monthName} ${item.year} г.?`)) {
      return;
    }

    setMsg(null);
    startTransition(async () => {
      const res = await reopenFullPeriodAction({
        year: item.year,
        month: item.month,
      });

      if (res.success) {
        setMsg({
          type: 'success',
          text: `Период за ${item.monthName} ${item.year} г. полностью РАЗБЛОКИРОВАН.`,
        });
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при открытии периода' });
      }
    });
  };

  const handleToggleModule = (item: ClosedPeriod, moduleKey: 'documents' | 'files') => {
    if (!canEdit) return;
    const currentState = moduleKey === 'documents' ? item.lock_documents : item.lock_files;
    const nextState = !currentState;

    setMsg(null);
    startTransition(async () => {
      const res = await toggleModuleLockAction({
        year: item.year,
        month: item.month,
        moduleKey,
        isLocked: nextState,
      });

      if (res.success) {
        setMsg({
          type: 'success',
          text: `Блокировка раздела "${moduleKey === 'documents' ? 'Документооборот' : 'Реестр файлов'}" за ${item.monthName} ${item.year} г. ${nextState ? 'ВКЛЮЧЕНА' : 'ОТКЛЮЧЕНА'}.`,
        });
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка переключения блокировки' });
      }
    });
  };

  // Определение колонок для UnifiedDataGrid
  const columns = useMemo<ColumnDef<ClosedPeriod>[]>(() => {
    return [
      {
        key: 'period',
        label: 'Отчетный период',
        type: 'text',
        sortable: true,
        render: (item) => (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
              <Calendar className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <div className="font-bold text-xs text-foreground">
                {item.monthName} {item.year} г.
              </div>
              <div className="text-[10px] text-muted-foreground">
                {String(item.month).padStart(2, '0')}.{item.year}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: 'status',
        label: 'Статус периода',
        type: 'text',
        sortable: true,
        render: (item) => {
          if (item.status === 'closed') {
            return (
              <Badge variant="outline" className="border-rose-500/40 text-rose-400 bg-rose-500/10 text-xs font-bold gap-1 px-2.5 py-1">
                <Lock className="w-3 h-3" />
                Полностью закрыт
              </Badge>
            );
          }
          if (item.status === 'partial') {
            return (
              <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10 text-xs font-bold gap-1 px-2.5 py-1">
                <ShieldAlert className="w-3 h-3" />
                Частично закрыт
              </Badge>
            );
          }
          return (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 text-xs font-bold gap-1 px-2.5 py-1">
              <Unlock className="w-3 h-3" />
              Открыт
            </Badge>
          );
        },
      },
      {
        key: 'lock_documents',
        label: 'Документооборот',
        type: 'text',
        render: (item) => (
          <button
            type="button"
            disabled={!canEdit || isPending}
            onClick={() => handleToggleModule(item, 'documents')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
              item.lock_documents
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
            } ${!canEdit ? 'cursor-default opacity-80' : 'cursor-pointer'}`}
            title={canEdit ? 'Нажмите для переключения блокировки документов' : undefined}
          >
            {item.lock_documents ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            <span>{item.lock_documents ? 'Заблокирован' : 'Открыт'}</span>
          </button>
        ),
      },
      {
        key: 'lock_files',
        label: 'Реестр файлов',
        type: 'text',
        render: (item) => (
          <button
            type="button"
            disabled={!canEdit || isPending}
            onClick={() => handleToggleModule(item, 'files')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
              item.lock_files
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
            } ${!canEdit ? 'cursor-default opacity-80' : 'cursor-pointer'}`}
            title={canEdit ? 'Нажмите для переключения блокировки файлов' : undefined}
          >
            {item.lock_files ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            <span>{item.lock_files ? 'Заблокирован' : 'Открыт'}</span>
          </button>
        ),
      },
      {
        key: 'reason',
        label: 'Основание / Причина',
        type: 'text',
        render: (item) => (
          <span className="text-xs text-muted-foreground max-w-[250px] truncate block">
            {item.reason || item.comment || '—'}
          </span>
        ),
      },
      {
        key: 'closed_by_user',
        label: 'Кто закрыл',
        type: 'text',
        render: (item) => (
          <div className="text-xs">
            <span className="text-foreground font-medium block">
              {item.closed_by_user || '—'}
            </span>
            {item.updated_at && (
              <span className="text-[10px] text-muted-foreground block">
                {new Date(item.updated_at).toLocaleDateString('ru-RU')}
              </span>
            )}
          </div>
        ),
      },
    ];
  }, [canEdit, isPending]);

  // Контекстные действия строк
  const getRowActions = (item: ClosedPeriod): RowAction<ClosedPeriod>[] => {
    if (!canEdit) return [];
    return [
      {
        label: 'Настроить доступ / Изменить',
        action: () => handleOpenEditModal(item),
        icon: <Edit2 className="w-3.5 h-3.5" />,
      },
      {
        label: 'Полностью открыть период',
        action: () => handleReopenPeriod(item),
        icon: <Unlock className="w-3.5 h-3.5 text-emerald-400" />,
      },
    ];
  };

  return (
    <div className="space-y-4">
      {/* Сообщения об успехе или ошибке */}
      {msg && (
        <Alert
          variant={msg.type === 'error' ? 'destructive' : 'default'}
          className={
            msg.type === 'success'
              ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10 rounded-2xl'
              : 'rounded-2xl'
          }
        >
          {msg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 mr-2" />
          ) : (
            <AlertCircle className="w-4 h-4 mr-2" />
          )}
          <AlertDescription className="text-xs">{msg.text}</AlertDescription>
        </Alert>
      )}

      {/* Единая таблица UnifiedDataGrid */}
      <UnifiedDataGrid<ClosedPeriod>
        gridId="company_closed_periods_grid"
        title="Журнал закрытия отчетных периодов"
        subtitle="Финансовый замок документов и файлов по отчетным месяцам"
        searchPlaceholder="Поиск по периоду, причине или ответственному..."
        columns={columns}
        data={periods}
        keyExtractor={(item) => item.id || `${item.year}-${item.month}`}
        getRowActions={canEdit ? getRowActions : undefined}
        isLoading={loading}
        emptyMessage="Нет закрытых периодов. По умолчанию все отчетные месяцы открыты для создания документов и загрузки файлов."
        actionButton={
          canEdit ? (
            <Button
              onClick={handleOpenCreateModal}
              className="h-9 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-md gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Закрыть период</span>
            </Button>
          ) : undefined
        }
      />

      {/* Модальное окно создания / редактирования */}
      <ClosedPeriodModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSavePeriod}
        initialData={editingPeriod}
        isSaving={isPending}
      />
    </div>
  );
}
