'use client';

import React, { useState, useEffect, useMemo, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Database,
  RefreshCw,
  HardDrive,
  Building2,
  Users,
  FileText,
  ShieldAlert,
  Loader2,
  Table as TableIcon,
  Search,
} from 'lucide-react';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';
import { formatBytes } from '@/lib/utils';
import { toast } from 'sonner';
import {
  getInspectorStatsAdminAction,
  inspectTableDataAdminAction,
  updateDbRowAdminAction,
  deleteDbRowAdminAction,
} from '@/app/super-admin/actions';

const INSPECTOR_TABLES = [
  { id: 'companies', label: 'Таблица: companies (Организации)' },
  { id: 'users', label: 'Таблица: users (Пользователи)' },
  { id: 'documents', label: 'Таблица: documents (Реестр документов)' },
  { id: 'files', label: 'Таблица: files (Облачный диск)' },
  { id: 'file_owners', label: 'Таблица: file_owners (Совладельцы файлов)' },
  { id: 'file_categories', label: 'Таблица: file_categories (Категории)' },
  { id: 'counterparties', label: 'Таблица: counterparties (Контрагенты)' },
  { id: 'company_partnerships', label: 'Таблица: company_partnerships (Партнерства)' },
  { id: 'company_roles', label: 'Таблица: company_roles (Роли доступа)' },
  { id: 'company_closed_periods', label: 'Таблица: company_closed_periods (Закрытые периоды)' },
  { id: 'subscriptions', label: 'Таблица: subscriptions (Подписки)' },
  { id: 'landing_pricing_plans', label: 'Таблица: landing_pricing_plans (Тарифы лендинга)' },
  { id: 'document_logs', label: 'Таблица: document_logs (Логи документов)' },
  { id: 'audit_logs', label: 'Таблица: audit_logs (Неизменяемый аудит)' },
  { id: 'admin_audit_logs', label: 'Таблица: admin_audit_logs (Аудит суперадминистратора)' },
  { id: 'pending_file_deletions', label: 'Таблица: pending_file_deletions (Очередь удаления файлов)' },
  { id: 'telegram_connections', label: 'Таблица: telegram_connections (Связи Telegram)' },
  { id: 'telegram_notification_logs', label: 'Таблица: telegram_notification_logs (Оповещения Telegram)' },
  { id: 'telegram_logs', label: 'Таблица: telegram_logs (Логи сообщений Telegram)' },
  { id: 'telegram_verification_codes', label: 'Таблица: telegram_verification_codes (Коды подтверждения)' },
  { id: 'company_join_requests', label: 'Таблица: company_join_requests (Заявки на вступление)' },
];

export default function SuperAdminInspectorPage() {
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Состояние выбранной таблицы
  const [selectedDbTable, setSelectedDbTable] = useState<string>('companies');
  const [dbData, setDbData] = useState<{ columns: string[]; rows: any[] }>({ columns: [], rows: [] });
  const [dbLoading, setDbLoading] = useState(false);

  // Модальные окна редактирования и удаления строк таблицы
  const [editingDbRow, setEditingDbRow] = useState<any | null>(null);
  const [editDbRowForm, setEditDbRowForm] = useState<Record<string, any>>({});
  const [deletingDbRow, setDeletingDbRow] = useState<any | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadStats = async () => {
    setLoadingStats(true);
    const res = await getInspectorStatsAdminAction({});
    if (res.success && res.data) {
      setStats(res.data);
    } else {
      toast.error(res.error || 'Не удалось загрузить данные метрик БД');
    }
    setLoadingStats(false);
  };

  const loadTableData = async (tbl: string) => {
    setDbLoading(true);
    const res = await inspectTableDataAdminAction(tbl, 200);
    if (res.success && res.data) {
      setDbData(res.data);
    } else {
      setDbData({ columns: [], rows: [] });
      toast.error(res.error || 'Ошибка загрузки записей таблицы');
    }
    setDbLoading(false);
  };

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    loadTableData(selectedDbTable);
  }, [selectedDbTable]);

  // ДИНАМИЧЕСКИЕ КОЛОНКИ С НАСТРОЙКОЙ ВИДИМОСТИ ДЛЯ UNIFIED DATA GRID
  const dbColumns: ColumnDef<Record<string, any>>[] = useMemo(() => {
    return dbData.columns.map((col) => ({
      key: col,
      label: col,
      sortable: true,
      getValue: (row) => (typeof row[col] === 'object' ? JSON.stringify(row[col]) : row[col]),
      render: (row) => (
        <span
          className="font-mono text-xs truncate max-w-[240px] block"
          title={typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}
        >
          {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? 'null')}
        </span>
      ),
    }));
  }, [dbData.columns]);

  const handleSaveDbRow = () => {
    if (!editingDbRow) return;
    const pkField = editingDbRow.id !== undefined ? 'id' : Object.keys(editingDbRow)[0];
    const pkValue = editingDbRow[pkField];

    const updates: Record<string, any> = {};
    for (const key of Object.keys(editDbRowForm)) {
      if (key === pkField) continue;
      let val = editDbRowForm[key];
      const origVal = editingDbRow[key];

      if (typeof origVal === 'object' && origVal !== null && typeof val === 'string') {
        try {
          val = JSON.parse(val);
        } catch {
          // Сохраняем как исходный текст, если не валидный JSON
        }
      }

      updates[key] = val;
    }

    startTransition(async () => {
      const res = await updateDbRowAdminAction(selectedDbTable, pkField, pkValue, updates);
      if (res.success) {
        toast.success(`Запись [${pkField}=${pkValue}] в таблице "${selectedDbTable}" успешно обновлена`);
        setEditingDbRow(null);
        await loadTableData(selectedDbTable);
        await loadStats();
      } else {
        toast.error(res.error || 'Ошибка при обновлении записи в БД');
      }
    });
  };

  const handleDeleteDbRow = () => {
    if (!deletingDbRow) return;
    const pkField = deletingDbRow.id !== undefined ? 'id' : Object.keys(deletingDbRow)[0];
    const pkValue = deletingDbRow[pkField];

    startTransition(async () => {
      const res = await deleteDbRowAdminAction(selectedDbTable, pkField, pkValue);
      if (res.success) {
        toast.success(`Запись [${pkField}=${pkValue}] удалена из таблицы "${selectedDbTable}"`);
        setDeletingDbRow(null);
        await loadTableData(selectedDbTable);
        await loadStats();
      } else {
        toast.error(res.error || 'Ошибка удаления записи из БД');
      }
    });
  };

  return (
    <UnifiedWorkspaceLayout
      title="Инспектор базы данных и ресурсов"
      description="Мониторинг таблиц PostgreSQL, объема хранилища, структуры данных и параметров видимости столбцов"
      icon={Database}
      actionButtonsSlot={
        <Button
          onClick={() => {
            loadStats();
            loadTableData(selectedDbTable);
          }}
          disabled={loadingStats || dbLoading}
          variant="outline"
          className="border-border text-xs min-h-[40px]"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loadingStats || dbLoading ? 'animate-spin' : ''}`} />
          Обновить метрики
        </Button>
      }
    >
      {/* 1. СТАТИСТИЧЕСКИЕ КАРТОЧКИ СВОДКИ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Таблица «companies»</span>
              <span className="text-2xl font-bold font-mono text-amber-400 mt-1 block">
                {stats?.totalCompanies || 0}
              </span>
            </div>
            <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400">
              <Building2 className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            Записи юридических лиц и ИП
          </div>
        </Card>

        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Таблица «users»</span>
              <span className="text-2xl font-bold font-mono text-indigo-400 mt-1 block">
                {stats?.totalUsers || 0}
              </span>
            </div>
            <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
              <Users className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            Профили и связи ролей
          </div>
        </Card>

        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Таблица «documents»</span>
              <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                {stats?.totalDocuments || 0}
              </span>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400">
              <FileText className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            Первичные документы ЭДО
          </div>
        </Card>

        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Облачный диск</span>
              <span className="text-2xl font-bold font-mono text-purple-400 mt-1 block">
                {formatBytes(stats?.totalFilesSize || 0)}
              </span>
            </div>
            <div className="p-3 bg-purple-500/10 rounded-xl text-purple-400">
              <HardDrive className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            {stats?.totalFiles || 0} файлов в архиве
          </div>
        </Card>
      </div>

      {/* 2. БЛОК СЕЛЕКТОРА ТАБЛИЦЫ И УПРАВЛЕНИЯ */}
      <Card className="bg-card border-border p-4 mt-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm md:text-base font-bold text-foreground flex items-center">
              <Database className="h-5 w-5 mr-2 text-rose-400" />
              Инспектор Таблиц PostgreSQL (Полный Доступ)
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Прямой просмотр, поиск, настройка видимости колонок, редактирование и удаление записей PostgreSQL с правами SuperAdmin
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Таблица БД:</Label>
            <select
              value={selectedDbTable}
              onChange={(e) => setSelectedDbTable(e.target.value)}
              className="bg-background border border-border text-foreground text-xs rounded-xl px-3 py-2 min-h-[40px] font-mono focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
            >
              {INSPECTOR_TABLES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* 3. ДИНАМИЧЕСКИЙ РЕЕСТР UNIFIED DATA GRID С НАСТРОЙКОЙ ВИДИМОСТИ СТОЛБЦОВ */}
      <div className="mt-4">
        <UnifiedDataGrid<Record<string, any>>
          key={`inspector_grid_${selectedDbTable}`}
          gridId={`admin_db_inspector_${selectedDbTable}`}
          forceView="table"
          columns={dbColumns}
          data={dbData.rows}
          keyExtractor={(r) => (r.id ? String(r.id) : JSON.stringify(r))}
          getRowActions={(row) => [
            {
              label: '✏️ Редактировать запись',
              action: () => {
                setEditingDbRow(row);
                setEditDbRowForm({ ...row });
              },
            },
            {
              label: '🗑️ Удалить запись из БД',
              danger: true,
              separatorBefore: true,
              action: () => setDeletingDbRow(row),
            },
          ]}
          searchPlaceholder={`Поиск по сырым данным таблицы «${selectedDbTable}»...`}
          emptyMessage={`Записи в таблице «${selectedDbTable}» отсутствуют`}
          isLoading={dbLoading}
          defaultPageSize={25}
        />
      </div>

      {/* 4. БЛОК СТАТУСА БЕЗОПАСНОСТИ */}
      <Card className="bg-card border-border p-5 mt-6 space-y-3">
        <h3 className="text-xs md:text-sm font-bold text-foreground flex items-center">
          <ShieldAlert className="h-4 w-4 mr-2 text-purple-400" />
          Состояние безопасности и целостности данных
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-background border border-border flex items-center justify-between">
            <span className="text-muted-foreground">Изоляция организаций (RLS):</span>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-[11px]">Активна</Badge>
          </div>
          <div className="p-3 rounded-xl bg-background border border-border flex items-center justify-between">
            <span className="text-muted-foreground">Защита закрытых периодов:</span>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-[11px]">Включена</Badge>
          </div>
          <div className="p-3 rounded-xl bg-background border border-border flex items-center justify-between">
            <span className="text-muted-foreground">Неизменяемый журнал аудита:</span>
            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/40 text-[11px]">Защищен</Badge>
          </div>
        </div>
      </Card>

      {/* 5. МОДАЛЬНОЕ ОКНО: РЕДАКТИРОВАНИЕ ЗАПИСИ ИНСПЕКТОРА */}
      {editingDbRow && (
        <UnifiedFormModal
          isOpen={!!editingDbRow}
          onClose={() => setEditingDbRow(null)}
          title={`Редактирование записи: ${selectedDbTable}`}
          subtitle={`Первичный ключ: ${editingDbRow?.id ? `id = ${editingDbRow.id}` : Object.keys(editingDbRow || {})[0]}`}
          mode="edit"
          onSubmit={(e) => {
            e.preventDefault();
            handleSaveDbRow();
          }}
          isSubmitting={isPending}
          submitText="Сохранить Изменения"
        >
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {Object.keys(editingDbRow).map((key) => {
              const val = editDbRowForm[key];
              const isPk = key === 'id' || key === Object.keys(editingDbRow)[0];
              const isObj = typeof editingDbRow[key] === 'object' && editingDbRow[key] !== null;

              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-mono text-foreground">
                      {key} {isPk && <span className="text-amber-400 font-bold ml-1">(PRIMARY KEY)</span>}
                    </Label>
                    {isObj && <span className="text-[10px] text-purple-400 font-mono">JSON / Object</span>}
                  </div>
                  {isObj ? (
                    <textarea
                      value={typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? '')}
                      onChange={(e) => setEditDbRowForm((prev) => ({ ...prev, [key]: e.target.value }))}
                      rows={4}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
                    />
                  ) : (
                    <Input
                      value={String(val ?? '')}
                      disabled={isPk}
                      onChange={(e) => setEditDbRowForm((prev) => ({ ...prev, [key]: e.target.value }))}
                      className={`bg-background border-border text-foreground font-mono text-xs min-h-[40px] ${
                        isPk ? 'opacity-60 cursor-not-allowed bg-muted' : ''
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </UnifiedFormModal>
      )}

      {/* 6. МОДАЛЬНОЕ ОКНО: УДАЛЕНИЕ ЗАПИСИ ИНСПЕКТОРА */}
      {deletingDbRow && (
        <UnifiedFormModal
          isOpen={!!deletingDbRow}
          onClose={() => setDeletingDbRow(null)}
          title={`Удаление записи из таблицы «${selectedDbTable}»`}
          subtitle="Внимание: Операция напрямую удаляет выбранную строку из базы данных PostgreSQL!"
          mode="edit"
          onSubmit={(e) => {
            e.preventDefault();
            handleDeleteDbRow();
          }}
          isSubmitting={isPending}
          submitText="Удалить Запись Навсегда"
        >
          <div className="space-y-3">
            <p className="text-xs md:text-sm text-foreground">
              Вы действительно хотите удалить эту запись из таблицы <span className="font-mono text-amber-400 font-bold">{selectedDbTable}</span>?
            </p>
            <div className="p-3 rounded-xl bg-background border border-border font-mono text-xs text-rose-400 overflow-x-auto max-h-48">
              {JSON.stringify(deletingDbRow, null, 2)}
            </div>
          </div>
        </UnifiedFormModal>
      )}
    </UnifiedWorkspaceLayout>
  );
}
