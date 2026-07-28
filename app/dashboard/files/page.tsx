'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  FileText,
  Search,
  Calendar,
  Building2,
  Loader2,
  Eye,
  FolderOpen,
  ArrowUpRight,
  ArrowDownLeft,
  Download,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getPresignedDownloadUrlAction } from './actions';
import type { DocumentFile, FileCategory, Document, Company } from '@/types/database.types';

type ExtendedDocumentFile = DocumentFile & {
  file_categories?: FileCategory | null;
  documents?: (Document & {
    sender_company?: Company | null;
    receiver_company?: Company | null;
  }) | null;
};

export default function FilesRegistryPage() {
  const [files, setFiles] = useState<ExtendedDocumentFile[]>([]);
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Фильтры
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'inbox' | 'outbox'>('all');

  const supabase = createClient();

  useEffect(() => {
    async function loadFilesData() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let myCompanyId = '';
      if (user) {
        const { data: prof } = await supabase.from('users').select('company_id').eq('id', user.id).single();
        if (prof?.company_id) {
          myCompanyId = prof.company_id;
          setCurrentCompanyId(prof.company_id);
        }
      }

      // 1. Категории
      const { data: catData } = await supabase.from('file_categories').select('*').order('name');
      if (catData) setCategories(catData as FileCategory[]);

      // 2. Файлы документов
      const { data: filesData } = await supabase
        .from('document_files')
        .select('*, file_categories(*), documents(*, sender_company:companies!sender_company_id(*), receiver_company:companies!receiver_company_id(*))')
        .order('created_at', { ascending: false });

      if (filesData) {
        setFiles(filesData as ExtendedDocumentFile[]);
      }
      setLoading(false);
    }

    loadFilesData();
  }, []);

  const handleDownloadR2File = async (fileKey?: string | null) => {
    if (!fileKey) return;
    const res = await getPresignedDownloadUrlAction(fileKey);
    if (res.success && res.data?.downloadUrl) {
      window.open(res.data.downloadUrl, '_blank');
    }
  };

  const filteredFiles = files.filter((f) => {
    const doc = f.documents;
    const isInbox = doc?.receiver_company_id === currentCompanyId;
    const isOutbox = doc?.sender_company_id === currentCompanyId;

    if (directionFilter === 'inbox' && !isInbox) return false;
    if (directionFilter === 'outbox' && !isOutbox) return false;

    if (selectedCategory !== 'all' && f.category_id !== selectedCategory) return false;

    const partnerName = isInbox ? doc?.sender_company?.name : doc?.receiver_company?.name;

    const matchesSearch =
      f.file_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (f.comment && f.comment.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (partnerName && partnerName.toLowerCase().includes(searchTerm.toLowerCase()));

    return matchesSearch;
  });

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center">
            <FolderOpen className="h-5 w-5 md:h-6 md:w-6 mr-2 text-emerald-400" />
            Реестр Файлов (Cloudflare R2)
          </h2>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Все сканы и прикрепеленные первичные файлы организации
          </p>
        </div>
      </div>

      {/* Фильтры */}
      <Card className="bg-slate-900/40 border-slate-800 p-3 md:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Поиск по файлу, описанию..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 text-xs md:text-sm"
            />
          </div>

          <div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full h-9 md:h-10 rounded-md border border-slate-800 bg-slate-950 px-3 text-xs md:text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все категории файлов</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value as any)}
              className="w-full h-9 md:h-10 rounded-md border border-slate-800 bg-slate-950 px-3 text-xs md:text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все направления</option>
              <option value="inbox">Только Входящие файлы</option>
              <option value="outbox">Только Исходящие файлы</option>
            </select>
          </div>
        </div>
      </Card>

      {/* 1. ПК ТАБЛИЦА (hidden md:block) */}
      <Card className="hidden md:block bg-slate-900/40 border-slate-800 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка файлов организации...</span>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              Файлы по выбранным фильтрам не найдены
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Направление</TableHead>
                  <TableHead>Имя файла / Категория</TableHead>
                  <TableHead>Описание *</TableHead>
                  <TableHead>Организация-партнер</TableHead>
                  <TableHead>Хранилище</TableHead>
                  <TableHead>Размер</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFiles.map((f) => {
                  const isInbox = f.documents?.receiver_company_id === currentCompanyId;
                  const partner = isInbox ? f.documents?.sender_company : f.documents?.receiver_company;

                  return (
                    <TableRow key={f.id}>
                      <TableCell>
                        {isInbox ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <ArrowDownLeft className="h-3 w-3 mr-1" />
                            Входящий
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            <ArrowUpRight className="h-3 w-3 mr-1" />
                            Исходящий
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="font-medium text-white text-sm truncate max-w-[200px]">{f.file_name}</div>
                        <Badge variant="outline" className="text-[10px] border-slate-800 text-slate-400 mt-0.5">
                          {f.file_categories?.name || 'Без категории'}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <div className="text-xs text-slate-200 font-medium max-w-[220px] truncate">{f.description}</div>
                        {f.comment && <p className="text-[11px] text-slate-500 truncate max-w-[220px]">{f.comment}</p>}
                      </TableCell>

                      <TableCell>
                        <div className="font-medium text-slate-200 text-xs flex items-center space-x-1">
                          <Building2 className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                          <span className="truncate max-w-[160px]">{partner?.name || '—'}</span>
                        </div>
                      </TableCell>

                      <TableCell>
                        {f.file_path_r2 ? (
                          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Cloudflare R2
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-slate-500">Локальный</span>
                        )}
                      </TableCell>

                      <TableCell className="font-mono text-xs text-slate-400">{f.file_size || '1.5 MB'}</TableCell>

                      <TableCell className="text-right">
                        <div className="flex items-center justify-end space-x-1">
                          {f.file_path_r2 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownloadR2File(f.file_path_r2)}
                              className="h-8 text-xs text-blue-400 hover:text-white"
                            >
                              <Download className="h-3.5 w-3.5 mr-1" />
                              Скачать
                            </Button>
                          )}

                          {f.document_id && (
                            <Link href={`/dashboard/documents/${f.document_id}`}>
                              <Button size="sm" variant="outline" className="h-8 border-slate-800 text-xs text-slate-300 hover:text-white">
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                Документ
                              </Button>
                            </Link>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 2. МОБИЛЬНЫЕ КАРТОЧКИ (block md:hidden) */}
      <div className="block md:hidden space-y-3">
        {loading ? (
          <div className="flex items-center justify-center p-8 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Загрузка...</span>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800">
            Файлы по фильтрам не найдены
          </div>
        ) : (
          filteredFiles.map((f) => {
            const isInbox = f.documents?.receiver_company_id === currentCompanyId;
            const partner = isInbox ? f.documents?.sender_company : f.documents?.receiver_company;

            return (
              <Card key={f.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-white text-xs truncate max-w-[200px]">{f.file_name}</h4>
                    <span className="text-[10px] font-mono text-slate-500">{f.file_size || '1.5 MB'}</span>
                  </div>

                  {isInbox ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <ArrowDownLeft className="h-3 w-3 mr-1" />
                      Входящий
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      <ArrowUpRight className="h-3 w-3 mr-1" />
                      Исходящий
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-200 font-medium">
                  {f.description}
                </div>

                <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/60">
                  <div className="flex items-center space-x-1 text-slate-400 text-xs truncate max-w-[180px]">
                    <Building2 className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                    <span className="truncate">{partner?.name || '—'}</span>
                  </div>

                  <div className="flex items-center space-x-2">
                    {f.file_path_r2 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownloadR2File(f.file_path_r2)}
                        className="h-8 p-1 text-xs text-blue-400"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    )}

                    {f.document_id && (
                      <Link href={`/dashboard/documents/${f.document_id}`}>
                        <Button size="sm" variant="outline" className="h-8 border-slate-800 text-xs text-slate-300">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
