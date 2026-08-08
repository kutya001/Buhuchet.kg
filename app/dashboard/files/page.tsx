'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FolderOpen,
  FileText,
  Building2,
  Calendar,
  Loader2,
  Download,
  Filter,
  HardDrive,
  PieChart,
  FileCheck,
  ExternalLink,
  ShieldCheck,
  Image as ImageIcon,
} from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import {
  getComprehensiveFileRegistryAction,
  uploadFileToArchiveAction,
  getFileCategoriesAction,
  type EnrichedFileItem,
  type FileRegistryStats,
} from './archive-actions';
import { getPresignedDownloadUrlAction } from './actions';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { MultiFileDropzone, type FileItemState } from '@/components/documents/MultiFileDropzone';
import type { FileCategory } from '@/types/database.types';

export default function CloudFilesRegistryPage() {
  const searchParams = useSearchParams();
  const searchFromUrl = searchParams.get('search') || '';

  const [files, setFiles] = useState<EnrichedFileItem[]>([]);
  const [stats, setStats] = useState<FileRegistryStats | null>(null);
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [batchFiles, setBatchFiles] = useState<FileItemState[]>([]);
  const [savingBatch, setSavingBatch] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);

  // ФИЛЬТРЫ
  const [onlyMyCompany, setOnlyMyCompany] = useState(false);
  const [sourceTypeFilter, setSourceTypeFilter] = useState<'all' | 'document' | 'company' | 'counterparty' | 'manual'>('all');
  const [fileFormatFilter, setFileFormatFilter] = useState<'all' | 'pdf' | 'image' | 'other'>('all');

  // Скачивание
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadFiles = async () => {
    setLoading(true);
    const [res, catsRes] = await Promise.all([
      getComprehensiveFileRegistryAction(),
      getFileCategoriesAction(),
    ]);

    if (res.success && res.data) {
      setFiles(res.data.files);
      setStats(res.data.stats);
    } else {
      setFiles([]);
      setStats(null);
    }

    if (catsRes?.success && catsRes?.data) {
      setCategories(catsRes.data);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const handleSaveBatchFiles = async () => {
    const readyFiles = batchFiles.filter((f) => f.file_path_r2 && !f.uploading && !f.error);
    if (readyFiles.length === 0) return;

    setSavingBatch(true);
    for (const f of readyFiles) {
      await uploadFileToArchiveAction({
        category_id: f.category_id,
        file_name: f.file_name,
        file_size: f.size_bytes,
        file_type: f.file_type,
        file_path_r2: f.file_path_r2!,
        description: f.description,
        comment: f.comment,
      });
    }

    setSavingBatch(false);
    setBatchFiles([]);
    setShowBatchModal(false);
    loadFiles();
  };

  const handleDownloadR2 = async (fileKey: string, fileId: string) => {
    if (!fileKey) return;
    setDownloadingId(fileId);
    try {
      const res = await getPresignedDownloadUrlAction(fileKey);
      if (res.success && res.data?.downloadUrl) {
        window.open(res.data.downloadUrl, '_blank');
      } else {
        alert(res.error || 'Не удалось сгенерировать ссылку для скачивания файла');
      }
    } catch (e: any) {
      alert(`Ошибка при загрузке: ${e?.message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  // ФИЛЬТРАЦИЯ
  const filteredFiles = files.filter((file) => {
    if (onlyMyCompany && !file.isMyCompanyFile) return false;
    if (sourceTypeFilter !== 'all' && file.sourceType !== sourceTypeFilter) return false;

    if (fileFormatFilter !== 'all') {
      const ext = (file.file_name || '').toLowerCase();
      const isPdf = ext.endsWith('.pdf') || file.file_type === 'pdf';
      const isImg = ext.match(/\.(png|jpg|jpeg|webp|heic)$/) || file.file_type === 'image';

      if (fileFormatFilter === 'pdf' && !isPdf) return false;
      if (fileFormatFilter === 'image' && !isImg) return false;
      if (fileFormatFilter === 'other' && (isPdf || isImg)) return false;
    }

    return true;
  });

  // ОПРЕДЕЛЕНИЕ СТОЛБЦОВ
  const columns: ColumnDef<EnrichedFileItem>[] = [
    {
      key: 'file_name',
      label: 'Наименование Файла',
      sortable: true,
      getValue: (f) => f.file_name,
      render: (file) => (
        <div className="font-semibold text-foreground text-xs sm:text-sm flex items-center space-x-2">
          {file.file_name.endsWith('.pdf') ? (
            <FileText className="h-4 w-4 text-purple-400 flex-shrink-0" />
          ) : (
            <ImageIcon className="h-4 w-4 text-emerald-400 flex-shrink-0" />
          )}
          <span className="truncate max-w-[220px] font-mono">{file.file_name}</span>
        </div>
      ),
    },
    {
      key: 'ownership',
      label: 'Статус доступа',
      sortable: true,
      getValue: (f) => (f.isCoWShared ? 'shared' : 'single'),
      render: (file) =>
        file.isCoWShared ? (
          <Badge
            className="bg-indigo-500/20 text-indigo-300 border-indigo-500/40 text-[11px] font-medium"
            title={`Файл используют ${file.ownersCount} организаций`}
          >
            <ShieldCheck className="h-3 w-3 mr-1 text-indigo-400" />
            Общий доступ ({file.ownersCount} организации)
          </Badge>
        ) : (
          <Badge variant="outline" className="border-slate-800 text-slate-400 text-[11px]">
            Личный
          </Badge>
        ),
    },
    {
      key: 'sourceType',
      label: 'Вид Источника',
      sortable: true,
      getValue: (f) => f.sourceType,
      render: (file) => (
        <Badge
          variant="outline"
          className={
            file.sourceType === 'document'
              ? 'border-blue-500/40 text-blue-400 bg-blue-500/10'
              : file.sourceType === 'company'
              ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
              : file.sourceType === 'counterparty'
              ? 'border-indigo-500/40 text-indigo-400 bg-indigo-500/10'
              : 'border-slate-700 text-slate-400'
          }
        >
          {file.sourceType === 'document' && '📝 Из документов'}
          {file.sourceType === 'company' && '🏛️ Моя Организация'}
          {file.sourceType === 'counterparty' && '🤝 Контрагент'}
          {file.sourceType === 'manual' && '📂 Вручную'}
        </Badge>
      ),
    },
    {
      key: 'sourceTitle',
      label: 'Источник (Переход)',
      sortable: true,
      getValue: (f) => f.sourceTitle,
      render: (file) => (
        <Link
          href={file.sourceUrl}
          className="inline-flex items-center space-x-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300 hover:underline"
        >
          <span className="truncate max-w-[200px]">{file.sourceTitle}</span>
          <ExternalLink className="h-3 w-3 ml-0.5" />
        </Link>
      ),
    },
    {
      key: 'size_bytes',
      label: 'Размер файла',
      sortable: true,
      getValue: (f) => f.bytesSize,
      render: (file) => (
        <span className="font-mono text-xs text-slate-300">
          {formatBytes(file.size_bytes)}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: 'Дата Загрузки',
      sortable: true,
      getValue: (f) => f.created_at,
      render: (file) => (
        <span className="font-mono text-xs text-muted-foreground">
          {new Date(file.created_at).toLocaleDateString('ru-RU')}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Скачивание',
      sortable: false,
      render: (file) =>
        file.file_path_r2 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleDownloadR2(file.file_path_r2!, file.id)}
            disabled={downloadingId === file.id}
            className="border-border text-foreground hover:bg-muted text-xs min-h-[36px]"
          >
            {downloadingId === file.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1 text-emerald-400" />
            )}
            Скачать файл
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
  ];

  // РЕНДЕР МОБИЛЬНОЙ КАРТОЧКИ
  const renderFileCard = (file: EnrichedFileItem) => (
    <Card className="bg-card border-border p-4 space-y-3 shadow-lg">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-bold text-foreground text-sm font-mono flex items-center">
            <FileText className="h-4 w-4 mr-1.5 text-emerald-400" />
            {file.file_name}
          </h4>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{formatBytes(file.size_bytes)}</p>
        </div>

        <Badge
          variant="outline"
          className={
            file.sourceType === 'document'
              ? 'border-blue-500/40 text-blue-400 text-[10px]'
              : file.sourceType === 'company'
              ? 'border-amber-500/40 text-amber-400 text-[10px]'
              : file.sourceType === 'counterparty'
              ? 'border-indigo-500/40 text-indigo-400 text-[10px]'
              : 'border-border text-muted-foreground text-[10px]'
          }
        >
          {file.sourceType === 'document' && '📝 Из документов'}
          {file.sourceType === 'company' && '🏛️ Уставной'}
          {file.sourceType === 'counterparty' && '🤝 Контрагент'}
          {file.sourceType === 'manual' && '📂 Вручную'}
        </Badge>
      </div>

      <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
        <Link href={file.sourceUrl} className="inline-flex items-center space-x-1 text-emerald-400 font-semibold">
          <span className="truncate max-w-[180px]">{file.sourceTitle}</span>
          <ExternalLink className="h-3 w-3" />
        </Link>

        {file.file_path_r2 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleDownloadR2(file.file_path_r2!, file.id)}
            disabled={downloadingId === file.id}
            className="border-border text-xs text-foreground min-h-[40px] px-3 hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5 mr-1 text-emerald-400" />
            Скачать
          </Button>
        )}
      </div>
    </Card>
  );

  return (
    <div className="space-y-6 pb-12">
      {/* 1. ЗАГОЛОВОК СТРАНИЦЫ И КНОПКА ЗАГРУЗКИ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight flex items-center">
            <FolderOpen className="h-6 w-6 mr-2.5 text-emerald-400" />
            Облачный диск
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Подробный учёт всех сканов, накладных и уставных документов
          </p>
        </div>

        <Button
          onClick={() => setShowBatchModal(!showBatchModal)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold min-h-[44px] shadow-lg shadow-emerald-600/20"
        >
          <FolderOpen className="h-4 w-4 mr-2" />
          {showBatchModal ? 'Скрыть панель загрузки' : '📤 Пакетная Загрузка (Drag & Drop)'}
        </Button>
      </div>

      {/* 1.1 ИНТЕРАКТИВНЫЙ DRAG & DROP БЛОК ЗАГРУЗКИ */}
      {showBatchModal && (
        <Card className="bg-card border-border p-5 space-y-4 shadow-xl border-emerald-500/30">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground flex items-center">
              <FileCheck className="h-4 w-4 mr-2 text-emerald-400" />
              Пакетная Загрузка Файлов на Облачный Диск (Drag & Drop)
            </h3>
            <span className="text-xs text-emerald-400 font-mono">Авто-сжатие до 200 КБ</span>
          </div>

          <MultiFileDropzone
            categories={categories}
            files={batchFiles}
            onFilesChange={setBatchFiles}
            disabled={savingBatch}
          />

          {batchFiles.length > 0 && (
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSaveBatchFiles}
                disabled={savingBatch || batchFiles.some((f) => f.uploading)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs min-h-[40px] font-semibold"
              >
                {savingBatch ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Сохранение на диск...
                  </>
                ) : (
                  <>Сохранить Все Загруженные Сканы ({batchFiles.filter((f) => f.file_path_r2).length})</>
                )}
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* 2. БЛОК СТАТИСТИКИ И ПОДСЧЕТА ОБЪЕМА */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border p-4 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Всего на диске</span>
              <span className="text-2xl font-bold font-mono text-foreground mt-1 block">
                {stats?.totalCount || 0} <span className="text-xs text-muted-foreground font-normal">файлов</span>
              </span>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <HardDrive className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border flex items-center justify-between text-xs font-mono text-emerald-400">
            <span>Общий объем:</span>
            <span className="font-bold">{stats?.formattedTotalSize || '0 MB'} / 10 GB</span>
          </div>
        </Card>

        <Card className="bg-card border-border p-4 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Из документов</span>
              <span className="text-2xl font-bold font-mono text-foreground mt-1 block">
                {stats?.bySource.document || 0} <span className="text-xs text-muted-foreground font-normal">сканов</span>
              </span>
            </div>
            <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 text-blue-400">
              <FileCheck className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Накладные и акты:</span>
            <span className="font-mono text-blue-400 font-bold">100% соединены</span>
          </div>
        </Card>

        <Card className="bg-card border-border p-4 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Виды форматов</span>
              <span className="text-base font-bold font-mono text-foreground mt-1 block">
                {stats?.byType.pdf || 0} <span className="text-xs text-muted-foreground">PDF</span> • {stats?.byType.image || 0} <span className="text-xs text-muted-foreground">IMG</span>
              </span>
            </div>
            <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20 text-purple-400">
              <PieChart className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Прочее:</span>
            <span className="font-mono text-purple-400 font-bold">{stats?.byType.other || 0} шт.</span>
          </div>
        </Card>
      </div>

      {/* 3. ДОПОЛНИТЕЛЬНЫЕ ТУМБЛЕРЫ ФИЛЬТРАЦИИ */}
      <div className="flex flex-wrap items-center gap-3 bg-card p-4 rounded-2xl border border-border shadow-md">
        <button
          onClick={() => setOnlyMyCompany(!onlyMyCompany)}
          className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all min-h-[40px] border ${
            onlyMyCompany
              ? 'bg-amber-500/20 text-amber-500 border-amber-500/40 shadow-lg shadow-amber-500/10'
              : 'bg-background text-muted-foreground border-border hover:text-foreground hover:bg-muted'
          }`}
        >
          <ShieldCheck className="h-4 w-4 text-amber-500" />
          <span>Только файлы моей организации</span>
        </button>

        <div className="flex items-center space-x-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={sourceTypeFilter}
            onChange={(e) => setSourceTypeFilter(e.target.value as any)}
            className="bg-background border border-border text-foreground text-xs rounded-xl px-3 py-2 min-h-[40px] focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">Все Виды Источников</option>
            <option value="document">📝 Из документов</option>
            <option value="company">🏛️ Уставные Моей Организации</option>
            <option value="counterparty">🤝 Файлы Контрагентов</option>
            <option value="manual">📂 Загружен Вручную</option>
          </select>
        </div>

        <select
          value={fileFormatFilter}
          onChange={(e) => setFileFormatFilter(e.target.value as any)}
          className="bg-background border border-border text-foreground text-xs rounded-xl px-3 py-2 min-h-[40px] focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">Все Форматы</option>
          <option value="pdf">📄 PDF Документы</option>
          <option value="image">🖼️ Изображения (PNG/JPG)</option>
          <option value="other">📦 Прочее</option>
        </select>
      </div>

      {/* 4. ЕДИНООБРАЗНАЯ СИСТЕМА UnifiedDataGrid С ПАГИНАЦИЕЙ (25-50-100-ВСЕ) И СТИЛЕМ */}
      <UnifiedDataGrid<EnrichedFileItem>
        gridId="files_archive"
        columns={columns}
        data={filteredFiles}
        keyExtractor={(f) => f.id}
        onRowClick={(f) => f.file_path_r2 && handleDownloadR2(f.file_path_r2, f.id)}
        renderCard={renderFileCard}
        searchPlaceholder="Поиск по имени файла, описанию, источнику..."
        emptyMessage="Файлы в облачном архиве по выбранным условиям не найдены."
        isLoading={loading}
        defaultPageSize={25}
      />
    </div>
  );
}
