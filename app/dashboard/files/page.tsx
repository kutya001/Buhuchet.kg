'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  FolderOpen,
  FileText,
  Building2,
  Calendar,
  Eye,
  Loader2,
  Download,
  UploadCloud,
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  HardDrive,
  PieChart,
  FileCode,
  FileCheck,
  ExternalLink,
  ShieldCheck,
  Briefcase,
  Users,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Image as ImageIcon,
} from 'lucide-react';
import { getComprehensiveFileRegistryAction } from './archive-actions';
import { getPresignedDownloadUrlAction } from './actions';
import type { EnrichedFileItem, FileRegistryStats } from './archive-actions';

const ITEMS_PER_PAGE = 10;

export default function CloudFilesRegistryPage() {
  const searchParams = useSearchParams();
  const searchFromUrl = searchParams.get('search') || '';

  const [files, setFiles] = useState<EnrichedFileItem[]>([]);
  const [stats, setStats] = useState<FileRegistryStats | null>(null);
  const [loading, setLoading] = useState(true);

  // ФИЛЬТРЫ
  const [searchQuery, setSearchQuery] = useState(searchFromUrl);
  const [onlyMyCompany, setOnlyMyCompany] = useState(false);
  const [sourceTypeFilter, setSourceTypeFilter] = useState<'all' | 'document' | 'company' | 'counterparty' | 'manual'>('all');
  const [fileFormatFilter, setFileFormatFilter] = useState<'all' | 'pdf' | 'image' | 'other'>('all');

  // Скачивание
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Состояние пагинации
  const [currentPage, setCurrentPage] = useState(1);

  const loadFiles = async () => {
    setLoading(true);
    const res = await getComprehensiveFileRegistryAction();
    if (res.success && res.data) {
      setFiles(res.data.files);
      setStats(res.data.stats);
    } else {
      setFiles([]);
      setStats(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadFiles();
  }, []);

  // Сброс пагинации при изменении фильтров
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, onlyMyCompany, sourceTypeFilter, fileFormatFilter]);

  const handleDownloadR2 = async (fileKey: string, fileId: string) => {
    if (!fileKey) return;
    setDownloadingId(fileId);
    try {
      const res = await getPresignedDownloadUrlAction(fileKey);
      if (res.success && res.data?.downloadUrl) {
        window.open(res.data.downloadUrl, '_blank');
      } else {
        alert(res.error || 'Не удалось сгенерировать ссылку для скачивания R2');
      }
    } catch (e: any) {
      alert(`Ошибка R2: ${e?.message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  // ФИЛЬТРАЦИЯ
  const filteredFiles = files.filter((file) => {
    // 1. Фильтр "Только файлы моей организации"
    if (onlyMyCompany && !file.isMyCompanyFile) return false;

    // 2. Фильтр по виду источника
    if (sourceTypeFilter !== 'all' && file.sourceType !== sourceTypeFilter) return false;

    // 3. Фильтр по формату
    if (fileFormatFilter !== 'all') {
      const ext = (file.file_name || '').toLowerCase();
      const isPdf = ext.endsWith('.pdf') || file.file_type === 'pdf';
      const isImg = ext.match(/\.(png|jpg|jpeg|webp|heic)$/) || file.file_type === 'image';

      if (fileFormatFilter === 'pdf' && !isPdf) return false;
      if (fileFormatFilter === 'image' && !isImg) return false;
      if (fileFormatFilter === 'other' && (isPdf || isImg)) return false;
    }

    // 4. Текстовый поиск по имени, описанию и источнику
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = file.file_name.toLowerCase().includes(q);
      const matchDesc = (file.description || '').toLowerCase().includes(q);
      const matchSource = file.sourceTitle.toLowerCase().includes(q);
      return matchName || matchDesc || matchSource;
    }

    return true;
  });

  // Расчет пагинации
  const totalPages = Math.ceil(filteredFiles.length / ITEMS_PER_PAGE) || 1;
  const paginatedFiles = filteredFiles.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  return (
    <div className="space-y-6 pb-12">
      {/* 1. ЗАГОЛОВОК СТРАНИЦЫ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center">
            <FolderOpen className="h-6 w-6 mr-2.5 text-emerald-400" />
            Реестр Облачных Файлов R2
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Подробный учёт всех сканов, B2B накладных и уставных документов с контролем источников
          </p>
        </div>

        {/* Панель поиска */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Поиск файла, источника..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-slate-900 border-slate-800 text-xs pl-9 min-h-[40px]"
          />
        </div>
      </div>

      {/* 2. БЛОК АНАЛИТИЧЕСКОЙ СТАТИСТИКИ И ПОДСЧЕТА ОБЪЕМА */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Карточка 1: Всего файлов и Общий вес */}
        <Card className="bg-slate-900/60 border-slate-800 p-4 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block">Всего в реестре</span>
              <span className="text-2xl font-bold font-mono text-white mt-1 block">
                {stats?.totalCount || 0} <span className="text-xs text-slate-400 font-normal">файлов</span>
              </span>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <HardDrive className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono text-emerald-400">
            <span>Общий объем:</span>
            <span className="font-bold">{stats?.formattedTotalSize || '0 MB'} / 10 GB</span>
          </div>
        </Card>

        {/* Карточка 2: Файлы моей организации */}
        <Card className="bg-slate-900/60 border-slate-800 p-4 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block">Моя Организация</span>
              <span className="text-2xl font-bold font-mono text-white mt-1 block">
                {stats?.myCompanyFilesCount || 0} <span className="text-xs text-slate-400 font-normal">собственных</span>
              </span>
            </div>
            <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400">
              <Building2 className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Уставные и локальные:</span>
            <span className="font-mono text-white">{stats?.bySource.company || 0} шт.</span>
          </div>
        </Card>

        {/* Карточка 3: Файлы из Документов */}
        <Card className="bg-slate-900/60 border-slate-800 p-4 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block">Из B2B Документов</span>
              <span className="text-2xl font-bold font-mono text-white mt-1 block">
                {stats?.bySource.document || 0} <span className="text-xs text-slate-400 font-normal">сканов</span>
              </span>
            </div>
            <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 text-blue-400">
              <FileCheck className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Накладные и акты:</span>
            <span className="font-mono text-blue-400 font-bold">100% соединены</span>
          </div>
        </Card>

        {/* Карточка 4: Форматы файлов */}
        <Card className="bg-slate-900/60 border-slate-800 p-4 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block">Виды форматов</span>
              <span className="text-base font-bold font-mono text-white mt-1 block">
                {stats?.byType.pdf || 0} <span className="text-xs text-slate-400">PDF</span> • {stats?.byType.image || 0} <span className="text-xs text-slate-400">IMG</span>
              </span>
            </div>
            <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20 text-purple-400">
              <PieChart className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Прочее (Zip/Excel):</span>
            <span className="font-mono text-purple-400 font-bold">{stats?.byType.other || 0} шт.</span>
          </div>
        </Card>
      </div>

      {/* 3. ПАНЕЛЬ УПРАВЛЕНИЯ И ФИЛЬТРОВ */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/40 p-4 rounded-2xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          {/* ТУМБЛЕР КОНТРОЛЯ ВЛАДЕНИЯ */}
          <button
            onClick={() => setOnlyMyCompany(!onlyMyCompany)}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all min-h-[40px] border ${
              onlyMyCompany
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-lg shadow-amber-500/10'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            <span>Только файлы моей организации</span>
          </button>

          {/* ФИЛЬТР ВИДОВ ИСТОЧНИКОВ */}
          <div className="flex items-center space-x-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={sourceTypeFilter}
              onChange={(e) => setSourceTypeFilter(e.target.value as any)}
              className="bg-slate-950 border border-slate-800 text-white text-xs rounded-xl px-3 py-2 min-h-[40px]"
            >
              <option value="all">Все Виды Источников</option>
              <option value="document">📝 Из B2B Документов</option>
              <option value="company">🏛️ Уставные Моей Организации</option>
              <option value="counterparty">🤝 Файлы Контрагентов</option>
              <option value="manual">📂 Загружен Вручную</option>
            </select>
          </div>

          {/* ФИЛЬТР ПО ТИПАМ ФОРМАТОВ */}
          <select
            value={fileFormatFilter}
            onChange={(e) => setFileFormatFilter(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 text-white text-xs rounded-xl px-3 py-2 min-h-[40px]"
          >
            <option value="all">Все Форматы</option>
            <option value="pdf">📄 PDF Документы</option>
            <option value="image">🖼️ Изображения (PNG/JPG)</option>
            <option value="other">📦 Прочее</option>
          </select>
        </div>

        <div className="text-xs font-mono text-slate-400">
          Найдено: <span className="text-white font-bold">{filteredFiles.length}</span> из <span className="text-white font-bold">{files.length}</span> файлов
        </div>
      </div>

      {/* 4. ПК ТАБЛИЦА С ССЫЛКАМИ НА ИСТОЧНИКИ (hidden md:block) */}
      <Card className="hidden md:block bg-slate-900/40 border-slate-800 overflow-hidden shadow-2xl">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Формирование реестра сканов R2 со статистикой...</span>
            </div>
          ) : paginatedFiles.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">
              Файлы по выбранным критериям не найдены.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Имя Файла</TableHead>
                  <TableHead>Вид Источника</TableHead>
                  <TableHead>Источник (Переход / Ссылка)</TableHead>
                  <TableHead>Размер & Формат</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead className="text-right">Действие</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedFiles.map((file) => (
                  <TableRow key={file.id} className="hover:bg-slate-800/40 transition-colors">
                    <TableCell>
                      <div className="font-semibold text-white text-sm flex items-center space-x-2">
                        {file.file_name.endsWith('.pdf') ? (
                          <FileText className="h-4 w-4 text-purple-400 flex-shrink-0" />
                        ) : (
                          <ImageIcon className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                        )}
                        <span className="truncate max-w-[220px] font-mono">{file.file_name}</span>
                      </div>
                    </TableCell>

                    {/* АТРИБУТ ВИД ИСТОЧНИКА */}
                    <TableCell>
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
                        {file.sourceType === 'document' && '📝 Документ B2B'}
                        {file.sourceType === 'company' && '🏛️ Моя Организация'}
                        {file.sourceType === 'counterparty' && '🤝 Контрагент'}
                        {file.sourceType === 'manual' && '📂 Вручную'}
                      </Badge>
                    </TableCell>

                    {/* АТРИБУТ ИСТОЧНИК СО ССЫЛКОЙ НА ПЕРВОИСТОЧНИК */}
                    <TableCell>
                      <Link
                        href={file.sourceUrl}
                        className="inline-flex items-center space-x-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300 hover:underline"
                      >
                        <span className="truncate max-w-[200px]">{file.sourceTitle}</span>
                        <ExternalLink className="h-3 w-3 ml-0.5" />
                      </Link>
                    </TableCell>

                    <TableCell className="font-mono text-xs text-slate-300">
                      {file.file_size || '1.2 MB'}
                    </TableCell>

                    <TableCell className="font-mono text-xs text-slate-400">
                      {new Date(file.created_at).toLocaleDateString('ru-RU')}
                    </TableCell>

                    <TableCell className="text-right">
                      {file.file_path_r2 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownloadR2(file.file_path_r2!, file.id)}
                          disabled={downloadingId === file.id}
                          className="border-slate-800 text-slate-200 hover:bg-slate-800 text-xs min-h-[36px]"
                        >
                          {downloadingId === file.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          ) : (
                            <Download className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                          )}
                          R2 Ссылка
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 5. МОБИЛЬНЫЕ КАРТОЧКИ ФАЙЛОВ (md:hidden) */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
        {paginatedFiles.map((file) => (
          <Card key={file.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-bold text-white text-sm font-mono flex items-center">
                  <FileText className="h-4 w-4 mr-1.5 text-emerald-400 flex-shrink-0" />
                  {file.file_name}
                </h4>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{file.file_size || '1.5 MB'}</p>
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
                    : 'border-slate-700 text-slate-400 text-[10px]'
                }
              >
                {file.sourceType === 'document' && '📝 Документ'}
                {file.sourceType === 'company' && '🏛️ Уставной'}
                {file.sourceType === 'counterparty' && '🤝 Контрагент'}
                {file.sourceType === 'manual' && '📂 Вручную'}
              </Badge>
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <Link
                href={file.sourceUrl}
                className="inline-flex items-center space-x-1 text-emerald-400 font-semibold"
              >
                <span className="truncate max-w-[180px]">{file.sourceTitle}</span>
                <ExternalLink className="h-3 w-3" />
              </Link>

              {file.file_path_r2 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownloadR2(file.file_path_r2!, file.id)}
                  disabled={downloadingId === file.id}
                  className="border-slate-800 text-xs text-slate-200 min-h-[40px] px-3"
                >
                  <Download className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                  R2
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* 6. ПАГИНАЦИЯ */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-slate-400 font-mono">
            Страница <span className="text-white font-bold">{currentPage}</span> из <span className="text-white font-bold">{totalPages}</span>
          </p>
          <div className="flex items-center space-x-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="border-slate-800 text-slate-300 min-h-[40px] text-xs"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Назад
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="border-slate-800 text-slate-300 min-h-[40px] text-xs"
            >
              Вперед
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
