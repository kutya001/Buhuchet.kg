'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FolderOpen,
  FileText,
  Building2,
  HardDrive,
  ShieldCheck,
  Download,
  Layers,
  Sparkles,
  Loader2,
  ExternalLink,
  Users,
  Eye,
  Pencil,
  Trash2,
  AlertTriangle,
  Image as ImageIcon,
} from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import {
  getSuperAdminFilesMonitoringAction,
  getSuperAdminFileDetailsAction,
  processStorageCleanupQueueAction,
  updateFileSuperAdminAction,
  deleteFileSuperAdminAction,
} from '@/app/super-admin/actions';
import {
  getFileViewUrlAction,
  getFileDownloadUrlAction,
  getFileCategoriesAction,
} from '@/app/dashboard/files/archive-actions';
import { UnifiedDataGrid, ColumnDef, RowAction } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedViewModal } from '@/components/ui/unified/UnifiedViewModal';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { toast } from 'sonner';
import type { FileCategory } from '@/types/database.types';

export default function SuperAdminFilesPage() {
  const [data, setData] = useState<any>(null);
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [cleaningQueue, setCleaningQueue] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // ПРОСМОТР ДЕТАЛЕЙ ДЛЯ СУПЕРАДМИНА (UnifiedViewModal)
  const [viewingAdminFileDetails, setViewingAdminFileDetails] = useState<any | null>(null);
  const [loadingAdminFileDetails, setLoadingAdminFileDetails] = useState(false);

  // РЕДАКТИРОВАНИЕ ФАЙЛА
  const [editingFile, setEditingFile] = useState<any | null>(null);
  const [editFileName, setEditFileName] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editComment, setEditComment] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // УДАЛЕНИЕ ФАЙЛА
  const [deletingFile, setDeletingFile] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [res, catsRes] = await Promise.all([
      getSuperAdminFilesMonitoringAction(),
      getFileCategoriesAction(),
    ]);

    if (res.success && res.data) {
      setData(res.data);
    }
    if (catsRes.success && catsRes.data) {
      setCategories(catsRes.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenAdminFileDetails = async (fileId?: string) => {
    if (!fileId || typeof fileId !== 'string' || fileId.trim() === '') {
      toast.error('Ошибка: выбран некорректный объект');
      return;
    }
    setLoadingAdminFileDetails(true);
    setViewingAdminFileDetails({});
    const res = await getSuperAdminFileDetailsAction({ fileId });
    if (res.success && res.data) {
      setViewingAdminFileDetails(res.data);
    } else {
      toast.error(res.error || 'Не удалось загрузить служебную карточку файла');
      setViewingAdminFileDetails(null);
    }
    setLoadingAdminFileDetails(false);
  };

  // 1. 👁️ ПРОСМОТР ОНЛАЙН
  const handleViewOnline = async (file: any) => {
    if (!file?.file_path_r2) {
      toast.error('Путь к файлу на диске не найден');
      return;
    }
    try {
      const res = await getFileViewUrlAction(file.file_path_r2, file.file_name);
      if (res.success && res.data?.viewUrl) {
        window.open(res.data.viewUrl, '_blank', 'noopener,noreferrer');
      } else {
        toast.error(res.error || 'Не удалось сформировать ссылку для онлайн-просмотра');
      }
    } catch (e: any) {
      toast.error(`Ошибка открытия: ${e.message}`);
    }
  };

  // 2. 📥 СКАЧАТЬ ФАЙЛ
  const handleDownloadFile = async (file: any) => {
    if (!file?.file_path_r2) {
      toast.error('Путь к файлу на диске не найден');
      return;
    }
    setDownloadingId(file.id);
    try {
      const res = await getFileDownloadUrlAction(file.file_path_r2, file.file_name);
      if (res.success && res.data?.downloadUrl) {
        const link = document.createElement('a');
        link.href = res.data.downloadUrl;
        link.download = file.file_name || 'file';
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        toast.error(res.error || 'Ошибка формирования ссылки на скачивание');
      }
    } catch (e: any) {
      toast.error(`Ошибка скачивания: ${e.message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  // 3. ✏️ НАЧАТЬ РЕДАКТИРОВАНИЕ
  const handleStartEdit = (file: any) => {
    setEditingFile(file);
    setEditFileName(file.file_name || '');
    setEditCategoryId(file.category_id || file.file_categories?.id || '');
    setEditDescription(file.description || '');
    setEditComment(file.comment || '');
  };

  // СОХРАНИТЬ РЕДАКТИРОВАНИЕ
  const handleSaveEdit = async () => {
    if (!editingFile) return;
    if (!editFileName.trim()) {
      toast.error('Укажите наименование файла');
      return;
    }

    setSavingEdit(true);
    try {
      const res = await updateFileSuperAdminAction({
        fileId: editingFile.id,
        fileName: editFileName.trim(),
        categoryId: editCategoryId || null,
        description: editDescription.trim() || undefined,
        comment: editComment.trim() || undefined,
      });

      if (res.success) {
        toast.success('Параметры файла успешно обновлены');
        setEditingFile(null);
        if (viewingAdminFileDetails?.id === editingFile.id) {
          handleOpenAdminFileDetails(editingFile.id);
        }
        loadData();
      } else {
        toast.error(res.error || 'Ошибка обновления файла');
      }
    } catch (e: any) {
      toast.error(e.message || 'Сбой обновления');
    } finally {
      setSavingEdit(false);
    }
  };

  // 4. 🗑️ УДАЛЕНИЕ ФАЙЛА
  const handleConfirmDelete = async () => {
    if (!deletingFile) return;
    setIsDeleting(true);
    try {
      const res = await deleteFileSuperAdminAction({ fileId: deletingFile.id });
      if (res.success) {
        toast.success(`Файл «${deletingFile.file_name}» успешно удален и поставлен в очередь R2`);
        setDeletingFile(null);
        if (viewingAdminFileDetails?.id === deletingFile.id) {
          setViewingAdminFileDetails(null);
        }
        loadData();
      } else {
        toast.error(res.error || 'Ошибка удаления файла');
      }
    } catch (e: any) {
      toast.error(e.message || 'Сбой удаления');
    } finally {
      setIsDeleting(false);
    }
  };

  // ОЧИСТКА ОЧЕРЕДИ R2
  const handleCleanStorageQueue = async () => {
    setCleaningQueue(true);
    try {
      const res = await processStorageCleanupQueueAction(200);
      if (res.success) {
        toast.success(`Очередь R2 очищена: удалено ${res.data?.processed || 0} физических объектов`);
        loadData();
      } else {
        toast.error(res.error || 'Ошибка очистки очереди R2');
      }
    } catch (e: any) {
      toast.error(e.message || 'Сбой выполнения очистки');
    } finally {
      setCleaningQueue(false);
    }
  };

  // ОПРЕДЕЛЕНИЕ СТОЛБЦОВ
  const columns: ColumnDef<any>[] = [
    {
      key: 'file_name',
      label: 'Имя Файла',
      sortable: true,
      getValue: (f) => f.file_name,
      render: (f) => (
        <div className="font-semibold text-white text-xs sm:text-sm flex items-center space-x-2">
          {f.file_name?.endsWith('.pdf') ? (
            <FileText className="h-4 w-4 text-purple-400 flex-shrink-0" />
          ) : (
            <ImageIcon className="h-4 w-4 text-emerald-400 flex-shrink-0" />
          )}
          <span className="truncate max-w-[200px] font-mono">{f.file_name}</span>
        </div>
      ),
    },
    {
      key: 'owners',
      label: 'Организации-Владельцы',
      sortable: true,
      getValue: (f) => f.ownersCount,
      render: (f) => (
        <div className="flex flex-wrap gap-1">
          {f.owners && f.owners.length > 0 ? (
            f.owners.map((o: any, idx: number) => (
              <Badge
                key={idx}
                variant="outline"
                className={
                  o.is_original_creator
                    ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10 text-[10px]'
                    : 'border-indigo-500/40 text-indigo-300 bg-indigo-500/10 text-[10px]'
                }
              >
                <Building2 className="h-2.5 w-2.5 mr-1" />
                {o.name || 'Компания'} {o.is_original_creator && '(Создатель)'}
              </Badge>
            ))
          ) : (
            <Badge variant="outline" className="border-slate-800 text-slate-500 text-[10px]">
              {f.companies?.name || 'Системный'}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'ownership_status',
      label: 'Режим доступа',
      sortable: true,
      getValue: (f) => (f.isCoWShared ? 'shared' : 'single'),
      render: (f) =>
        f.isCoWShared ? (
          <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/40 text-xs font-semibold">
            <Sparkles className="h-3 w-3 mr-1 text-indigo-400" />
            Общий доступ ({f.ownersCount} орг.)
          </Badge>
        ) : (
          <Badge variant="outline" className="border-slate-800 text-slate-400 text-xs">
            Индивидуальный
          </Badge>
        ),
    },
    {
      key: 'size_bytes',
      label: 'Размер на диске',
      sortable: true,
      getValue: (f) => f.size_bytes,
      render: (f) => (
        <span className="font-mono text-xs text-amber-300 font-bold">
          {formatBytes(f.size_bytes || 0)}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: 'Дата загрузки',
      sortable: true,
      getValue: (f) => f.created_at,
      render: (f) => (
        <span className="font-mono text-xs text-slate-400">
          {new Date(f.created_at).toLocaleDateString('ru-RU')}
        </span>
      ),
    },
  ];

  // ДЕЙСТВИЯ СТРОКИ ДЛЯ ВЫПАДАЮЩЕГО МЕНЮ И ТАБЛИЦЫ
  const getRowActions = (f: any): RowAction<any>[] => [
    {
      label: '👁️ Просмотр онлайн',
      action: () => handleViewOnline(f),
    },
    {
      label: '📥 Скачать файл',
      action: () => handleDownloadFile(f),
    },
    {
      label: '✏️ Редактировать',
      action: () => handleStartEdit(f),
    },
    {
      label: '🗑️ Удалить',
      danger: true,
      action: () => setDeletingFile(f),
    },
  ];

  return (
    <UnifiedWorkspaceLayout
      title="Служебный реестр файлов"
      description="Мониторинг облачного диска, связей совладельцев и управление объектами хранилища"
      icon={HardDrive}
      actionButtonsSlot={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={cleaningQueue}
            onClick={handleCleanStorageQueue}
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs min-h-[40px]"
          >
            {cleaningQueue ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Очистка очереди...
              </>
            ) : (
              'Очистить очередь файлов'
            )}
          </Button>
          <Button
            onClick={loadData}
            disabled={loading}
            variant="outline"
            className="border-border text-xs text-foreground hover:bg-accent min-h-[40px]"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Обновить'}
          </Button>
        </div>
      }
    >
      {/* КАРТОЧКИ МЕТРИК ДЕДУПЛИКАЦИИ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border p-4 relative overflow-hidden shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Файлы на облачном диске</span>
              <span className="text-2xl font-bold font-mono text-foreground mt-1 block">
                {data?.stats?.totalPhysicalFilesCount || 0}
              </span>
            </div>
            <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20 text-purple-400">
              <HardDrive className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs font-mono text-purple-400">
            Объем: {formatBytes(data?.stats?.totalPhysicalStorageBytes || 0)}
          </div>
        </Card>

        <Card className="bg-card border-border p-4 relative overflow-hidden shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Совместный доступ к файлам</span>
              <span className="text-2xl font-bold font-mono text-indigo-400 mt-1 block">
                {data?.stats?.totalVirtualOwnersCount || 0}
              </span>
            </div>
            <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
              <Layers className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs font-mono text-indigo-400">
            Виртуальные тенанты
          </div>
        </Card>

        <Card className="bg-card border-border p-4 relative overflow-hidden shadow-xl border-emerald-500/30">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Сэкономлено оптимизацией</span>
              <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                {data?.stats?.savedStorageFormatted || '0 B'}
              </span>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <Sparkles className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs font-mono text-emerald-400">
            Экономия: {data?.stats?.deduplicationSavingsPercent || '0'}% места
          </div>
        </Card>

        <Card className="bg-card border-border p-4 relative overflow-hidden shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Топ-Организация Хранилища</span>
              <span className="text-sm font-bold font-mono text-amber-400 mt-1 block truncate max-w-[140px]">
                {data?.stats?.topCompanies[0]?.name || '—'}
              </span>
            </div>
            <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400">
              <Building2 className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs font-mono text-amber-400">
            {data?.stats?.topCompanies[0]?.formattedSize || '0 B'}
          </div>
        </Card>
      </div>

      {/* ТАБЛИЦА РЕЕСТРА ИНСПЕКЦИИ ФАЙЛОВ */}
      <Card className="bg-card border-border p-5 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-foreground flex items-center">
            <ShieldCheck className="h-5 w-5 mr-2 text-emerald-400" />
            Служебный реестр файлов
          </h3>
          <Badge variant="outline" className="border-border text-muted-foreground font-mono text-xs">
            Всего: {data?.files?.length || 0} файлов
          </Badge>
        </div>

        <UnifiedDataGrid<any>
          gridId="superadmin_files_cow"
          columns={columns}
          getRowActions={getRowActions}
          data={data?.files || []}
          keyExtractor={(f) => f.id}
          onRowClick={(f) => handleOpenAdminFileDetails(f.id)}
          searchPlaceholder="Поиск по названию файла, ключу диска, организациям..."
          emptyMessage="Файлы в системе не найдены."
          isLoading={loading}
          defaultPageSize={25}
        />
      </Card>

      {/* СИСТЕМНАЯ КАРТОЧКА ФАЙЛА (UnifiedViewModal ДЛЯ СУПЕРАДМИНА) */}
      {viewingAdminFileDetails && (
        <UnifiedViewModal
          isOpen={!!viewingAdminFileDetails}
          onClose={() => setViewingAdminFileDetails(null)}
          title={viewingAdminFileDetails.file_name || 'Системный файл'}
          subtitle={`Системный ID: ${viewingAdminFileDetails.id || '—'}`}
          isLoading={loadingAdminFileDetails}
          badge={
            viewingAdminFileDetails.isCoWShared ? (
              <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/40 text-[10px]">
                Дедупликация CoW ({viewingAdminFileDetails.ownersCount} орг.)
              </Badge>
            ) : (
              <Badge variant="outline" className="border-slate-700 text-slate-400 text-[10px]">
                Одиночный файл
              </Badge>
            )
          }
          sections={[
            {
              title: 'Системная информация хранилища',
              fields: [
                { label: 'Наименование файла', value: viewingAdminFileDetails.file_name, icon: FileText, colSpan: 2 },
                { label: 'Размер объекта', value: formatBytes(viewingAdminFileDetails.size_bytes), icon: HardDrive },
                { label: 'Категория', value: viewingAdminFileDetails.file_categories?.name || 'Прочее' },
                { label: 'Ключ на облачном диске', value: viewingAdminFileDetails.file_path_r2, icon: FolderOpen, colSpan: 3 },
                { label: 'Описание', value: viewingAdminFileDetails.description || '—', colSpan: 3 },
              ],
            },
            {
              title: 'Организации-Совладельцы (file_owners)',
              fields: [
                {
                  label: 'Список компаний',
                  value: viewingAdminFileDetails.owners?.length ? (
                    <div className="space-y-1.5 mt-1">
                      {viewingAdminFileDetails.owners.map((o: any, idx: number) => (
                        <div key={idx} className="p-2 rounded-lg bg-background border border-border flex items-center justify-between text-xs">
                          <span className="font-semibold">{o.companies?.name || 'Компания'}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">ИНН: {o.companies?.inn}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    'Владельцы не найдены'
                  ),
                  colSpan: 3,
                },
              ],
            },
          ]}
          actions={[
            {
              label: '👁️ Просмотр онлайн',
              onClick: () => handleViewOnline(viewingAdminFileDetails),
            },
            {
              label: '📥 Скачать файл',
              onClick: () => handleDownloadFile(viewingAdminFileDetails),
            },
            {
              label: '✏️ Редактировать',
              onClick: () => {
                const target = viewingAdminFileDetails;
                setViewingAdminFileDetails(null);
                handleStartEdit(target);
              },
            },
            {
              label: '🗑️ Удалить',
              variant: 'destructive',
              onClick: () => {
                const target = viewingAdminFileDetails;
                setViewingAdminFileDetails(null);
                setDeletingFile(target);
              },
            },
          ]}
        />
      )}

      {/* МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ФАЙЛА */}
      {editingFile && (
        <UnifiedFormModal
          isOpen={!!editingFile}
          onClose={() => setEditingFile(null)}
          title="Редактирование файла"
          subtitle="Изменение названия, категории и служебных заметок объекта"
          mode="edit"
          submitText={savingEdit ? 'Сохранение...' : 'Сохранить изменения'}
          isSubmitting={savingEdit}
          onSubmit={(e) => {
            e.preventDefault();
            handleSaveEdit();
          }}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Имя файла *</Label>
              <Input
                value={editFileName}
                onChange={(e) => setEditFileName(e.target.value)}
                placeholder="document.pdf"
                className="bg-card border-border font-mono text-sm"
                required
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">Категория / Папка</Label>
              <select
                value={editCategoryId}
                onChange={(e) => setEditCategoryId(e.target.value)}
                className="w-full bg-card border border-border rounded-xl p-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Без категории</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">Описание</Label>
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Служебное примечание к файлу"
                className="bg-card border-border text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">Комментарий</Label>
              <Input
                value={editComment}
                onChange={(e) => setEditComment(e.target.value)}
                placeholder="Внутренний комментарий"
                className="bg-card border-border text-sm"
              />
            </div>
          </div>
        </UnifiedFormModal>
      )}

      {/* МОДАЛЬНОЕ ОКНО ПОДТВЕРЖДЕНИЯ УДАЛЕНИЯ */}
      {deletingFile && (
        <UnifiedFormModal
          isOpen={!!deletingFile}
          onClose={() => setDeletingFile(null)}
          title="Удаление файла"
          subtitle="Подтвердите безвозвратное удаление файла из системы"
          mode="edit"
          submitText={isDeleting ? 'Удаление...' : 'Да, удалить файл'}
          isSubmitting={isDeleting}
          onSubmit={(e) => {
            e.preventDefault();
            handleConfirmDelete();
          }}
        >
          <div className="space-y-3">
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-start space-x-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Внимание: Действие необратимо!</p>
                <p className="mt-1">
                  Файл <strong>{deletingFile.file_name}</strong> будет удален из базы данных, а его физический объект на диске R2 будет очищен через фоновую очередь.
                </p>
              </div>
            </div>
          </div>
        </UnifiedFormModal>
      )}
    </UnifiedWorkspaceLayout>
  );
}
