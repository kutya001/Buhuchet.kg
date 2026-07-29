'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
} from 'lucide-react';
import { getCompanyFilesArchiveAction } from './archive-actions';
import type { DocumentFile } from '@/types/database.types';

const ITEMS_PER_PAGE = 10;

export default function CloudFilesRegistryPage() {
  const searchParams = useSearchParams();
  const searchFromUrl = searchParams.get('search') || '';

  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [loading, setLoading] = useState(true);

  // Состояние пагинации
  const [currentPage, setCurrentPage] = useState(1);

  const loadFiles = async () => {
    setLoading(true);
    const res = await getCompanyFilesArchiveAction();
    if (res.success && res.data) {
      setFiles(res.data);
    } else {
      setFiles([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadFiles();
  }, []);

  // Сброс пагинации при поиске
  useEffect(() => {
    setCurrentPage(1);
  }, [searchFromUrl]);

  // Фильтрация по поиску из шапки
  const filteredFiles = files.filter((file) => {
    if (searchFromUrl) {
      const query = searchFromUrl.toLowerCase();
      return (
        file.file_name.toLowerCase().includes(query) ||
        file.description.toLowerCase().includes(query) ||
        (file.file_categories?.name && file.file_categories.name.toLowerCase().includes(query))
      );
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
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center">
            <FolderOpen className="h-5 w-5 md:h-6 md:w-6 mr-2 text-emerald-400" />
            Облачный Архив Сканов R2
          </h2>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Все первичные накладные, акты и уставные документы организации
          </p>
        </div>
      </div>

      {/* ПК ТАБЛИЦА (hidden md:block) */}
      <Card className="hidden md:block bg-slate-900/40 border-slate-800 overflow-hidden shadow-2xl">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка архива сканов R2...</span>
            </div>
          ) : paginatedFiles.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">
              Файлы в облачном архиве не найдены
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Наименование Файла</TableHead>
                  <TableHead>Категория</TableHead>
                  <TableHead>Размер & Тип</TableHead>
                  <TableHead>Описание / Примечание</TableHead>
                  <TableHead>Дата Загрузки</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedFiles.map((file) => (
                  <TableRow key={file.id} className="hover:bg-slate-800/40 transition-colors">
                    <TableCell>
                      <div className="font-semibold text-white font-mono text-sm flex items-center space-x-2">
                        <FileText className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                        <span className="truncate max-w-[200px]">{file.file_name}</span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge variant="outline" className="border-slate-800 text-purple-400 text-xs">
                        {file.file_categories?.name || 'Архив'}
                      </Badge>
                    </TableCell>

                    <TableCell className="font-mono text-xs text-slate-300">
                      {file.file_size || '1.2 MB'} ({file.file_type || 'image'})
                    </TableCell>

                    <TableCell className="text-xs text-slate-400 truncate max-w-[220px]">
                      {file.description || '—'}
                    </TableCell>

                    <TableCell className="font-mono text-xs text-slate-400">
                      {new Date(file.created_at).toLocaleDateString('ru-RU')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* МОБИЛЬНЫЕ КАРТОЧКИ (block md:hidden) */}
      <div className="block md:hidden space-y-3">
        {loading ? (
          <div className="flex items-center justify-center p-8 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Загрузка архива...</span>
          </div>
        ) : paginatedFiles.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800">
            Файлы не найдены
          </div>
        ) : (
          paginatedFiles.map((file) => (
            <Card key={file.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div className="font-bold text-white text-xs font-mono truncate max-w-[200px]">
                  {file.file_name}
                </div>
                <Badge variant="outline" className="border-slate-800 text-purple-400 text-[10px]">
                  {file.file_categories?.name || 'Архив'}
                </Badge>
              </div>

              <p className="text-xs text-slate-300">{file.description}</p>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[11px] font-mono text-slate-500">
                <span>{file.file_size || '1.2 MB'}</span>
                <span>{new Date(file.created_at).toLocaleDateString('ru-RU')}</span>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* ПАГИНАЦИЯ */}
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
