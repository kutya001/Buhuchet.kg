'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FolderOpen,
  FileText,
  Building2,
  HardDrive,
  ShieldCheck,
  Download,
  Layers,
  Sparkles,
  ChevronLeft,
  Loader2,
  ExternalLink,
  Users,
  Image as ImageIcon,
} from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import { getSuperAdminFilesMonitoringAction } from '@/app/super-admin/actions';
import { getPresignedDownloadUrlAction } from '@/app/dashboard/files/actions';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';

export default function SuperAdminFilesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    const res = await getSuperAdminFilesMonitoringAction();
    if (res.success && res.data) {
      setData(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDownloadR2 = async (fileKey: string, fileId: string) => {
    if (!fileKey) return;
    setDownloadingId(fileId);
    try {
      const res = await getPresignedDownloadUrlAction(fileKey);
      if (res.success && res.data?.downloadUrl) {
        window.open(res.data.downloadUrl, '_blank');
      } else {
        alert(res.error || 'Ошибка вызова преподписанной ссылки R2');
      }
    } catch (e: any) {
      alert(`Ошибка R2: ${e?.message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const columns: ColumnDef<any>[] = [
    {
      key: 'file_name',
      label: 'Имя Файла R2',
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
      label: 'Тенанты-Владельцы (file_owners)',
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
      label: 'Статус CoW',
      sortable: true,
      getValue: (f) => (f.isCoWShared ? 'shared' : 'single'),
      render: (f) =>
        f.isCoWShared ? (
          <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/40 text-xs font-semibold">
            <Sparkles className="h-3 w-3 mr-1 text-indigo-400" />
            Совместный ({f.ownersCount} тенанта)
          </Badge>
        ) : (
          <Badge variant="outline" className="border-slate-800 text-slate-400 text-xs">
            Единоличное
          </Badge>
        ),
    },
    {
      key: 'size_bytes',
      label: 'Размер в R2',
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
      label: 'Создан',
      sortable: true,
      getValue: (f) => f.created_at,
      render: (f) => (
        <span className="font-mono text-xs text-slate-400">
          {new Date(f.created_at).toLocaleDateString('ru-RU')}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Действие',
      sortable: false,
      render: (f) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleDownloadR2(f.file_path_r2, f.id)}
          disabled={downloadingId === f.id}
          className="border-slate-800 text-xs text-blue-400 hover:bg-blue-500/10 min-h-[34px]"
        >
          <Download className="h-3.5 w-3.5 mr-1" />
          R2 Скачать
        </Button>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Навигация */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
        <div className="flex items-center space-x-3">
          <Link
            href="/super-admin"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center">
              <HardDrive className="h-6 w-6 mr-2.5 text-purple-400" />
              Мониторинг Хранилища R2 и Copy-on-Write (CoW)
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
              Инспекция физических файлов R2, виртуальных связей тенантов и метрик дедупликации
            </p>
          </div>
        </div>

        <Button
          onClick={loadData}
          disabled={loading}
          variant="outline"
          className="border-slate-800 text-xs text-slate-300 hover:bg-slate-900 min-h-[40px]"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Обновить Метрики'}
        </Button>
      </div>

      {/* КАРТОЧКИ МЕТРИК ДЕДУПЛИКАЦИИ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-slate-900/90 border-slate-800 p-4 relative overflow-hidden shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block">Физические файлы R2</span>
              <span className="text-2xl font-bold font-mono text-white mt-1 block">
                {data?.stats?.totalPhysicalFilesCount || 0}
              </span>
            </div>
            <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20 text-purple-400">
              <HardDrive className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 text-xs font-mono text-purple-400">
            Объем: {formatBytes(data?.stats?.totalPhysicalStorageBytes || 0)}
          </div>
        </Card>

        <Card className="bg-slate-900/90 border-slate-800 p-4 relative overflow-hidden shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block">Виртуальные связи (owners)</span>
              <span className="text-2xl font-bold font-mono text-indigo-400 mt-1 block">
                {data?.stats?.totalVirtualOwnersCount || 0}
              </span>
            </div>
            <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
              <Layers className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 text-xs font-mono text-indigo-400">
            Виртуальные тенанты
          </div>
        </Card>

        <Card className="bg-slate-900/90 border-slate-800 p-4 relative overflow-hidden shadow-xl border-emerald-500/30">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block">Сэкономлено благодаря CoW</span>
              <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                {data?.stats?.savedStorageFormatted || '0 B'}
              </span>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <Sparkles className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 text-xs font-mono text-emerald-400">
            Экономия: {data?.stats?.deduplicationSavingsPercent || '0'}% места
          </div>
        </Card>

        <Card className="bg-slate-900/90 border-slate-800 p-4 relative overflow-hidden shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block">Топ-Тенант Хранилища</span>
              <span className="text-sm font-bold font-mono text-amber-300 mt-1 block truncate max-w-[140px]">
                {data?.stats?.topCompanies[0]?.name || '—'}
              </span>
            </div>
            <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400">
              <Building2 className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 text-xs font-mono text-amber-400">
            {data?.stats?.topCompanies[0]?.formattedSize || '0 B'}
          </div>
        </Card>
      </div>

      {/* ТАБЛИЦА РЕЕСТРА ИНСПЕКЦИИ ФАЙЛОВ С УКАЗАНИЕМ ВСЕХ ВЛАДЕЛЬЦЕВ */}
      <Card className="bg-slate-900/90 border-slate-800 p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white flex items-center">
            <ShieldCheck className="h-5 w-5 mr-2 text-emerald-400" />
            Реестр Физических Файлов R2 (Owner Inspector)
          </h3>
          <Badge variant="outline" className="border-slate-800 text-slate-400 font-mono text-xs">
            Всего: {data?.files?.length || 0} файлов
          </Badge>
        </div>

        <UnifiedDataGrid<any>
          gridId="superadmin_files_cow"
          columns={columns}
          data={data?.files || []}
          keyExtractor={(f) => f.id}
          searchPlaceholder="Поиск по названию файла, R2 ключу, тенантам..."
          emptyMessage="Файлы в системе не найдены."
          isLoading={loading}
          defaultPageSize={25}
        />
      </Card>
    </div>
  );
}
