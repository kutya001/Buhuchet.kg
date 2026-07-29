'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
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
  FileText,
  Plus,
  Building2,
  Calendar,
  Eye,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  Inbox,
  Send,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getB2BDocumentsAction } from './actions';
import { DOCUMENT_TYPES, DOCUMENT_STATUSES } from '@/types/document.types';
import type { Document, Company, DocumentStatus } from '@/types/database.types';

type FullB2BDocument = Document & {
  sender_company?: Company | null;
  receiver_company?: Company | null;
  users?: { full_name: string } | null;
};

const ITEMS_PER_PAGE = 10;

export default function B2BDocumentsRegistryPage() {
  const searchParams = useSearchParams();
  const searchFromUrl = searchParams.get('search') || '';

  const [documents, setDocuments] = useState<FullB2BDocument[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'all' | 'inbox' | 'outbox' | 'drafts'>('all');
  const [loading, setLoading] = useState(true);

  // Состояние пагинации
  const [currentPage, setCurrentPage] = useState(1);

  const supabase = createClient();

  const loadDocuments = async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: prof } = await supabase.from('users').select('company_id').eq('id', user.id).single();
      if (prof?.company_id) setCurrentCompanyId(prof.company_id);
    }

    const res = await getB2BDocumentsAction();
    if (res.success && res.data) {
      setDocuments(res.data as FullB2BDocument[]);
    } else {
      setDocuments([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  // Сброс на 1-ю страницу при смене поиска или вкладки
  useEffect(() => {
    setCurrentPage(1);
  }, [searchFromUrl, activeTab]);

  // Фильтрация по вкладкам и глобальному поиску из шапки
  const filteredDocuments = documents.filter((doc) => {
    if (activeTab === 'inbox' && doc.receiver_company_id !== currentCompanyId) return false;
    if (activeTab === 'outbox' && doc.sender_company_id !== currentCompanyId) return false;
    if (activeTab === 'drafts' && doc.status !== 'draft') return false;

    if (searchFromUrl) {
      const query = searchFromUrl.toLowerCase();
      const numMatch = doc.doc_number?.toLowerCase().includes(query);
      const senderMatch = doc.sender_company?.name.toLowerCase().includes(query);
      const receiverMatch = doc.receiver_company?.name.toLowerCase().includes(query);
      const commentMatch = doc.comment?.toLowerCase().includes(query);
      return numMatch || senderMatch || receiverMatch || commentMatch;
    }

    return true;
  });

  // Расчет пагинации
  const totalPages = Math.ceil(filteredDocuments.length / ITEMS_PER_PAGE) || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedDocuments = filteredDocuments.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Шапка реестра */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center">
            <FileText className="h-5 w-5 md:h-6 md:w-6 mr-2 text-blue-400" />
            Реестр Документооборота
          </h2>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Товарные накладные, акты выполненных работ и счета-фактуры КР
          </p>
        </div>

        {/* На мобильных смартфонах скрыта (< md), так как есть снизу плавающая кнопка (+) */}
        <Link href="/dashboard/documents/new" prefetch={true} className="hidden md:block">
          <Button className="bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs md:text-sm shadow-lg shadow-blue-600/20 min-h-[44px]">
            <Plus className="h-4 w-4 mr-1.5" />
            Создать документ
          </Button>
        </Link>
      </div>

      {/* Вкладки Реестра */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('all')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'all'
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Все Документы ({documents.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('inbox')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'inbox'
              ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Inbox className="h-4 w-4" />
          <span>
            Входящие ({documents.filter((d) => d.receiver_company_id === currentCompanyId).length})
          </span>
        </button>

        <button
          onClick={() => setActiveTab('outbox')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'outbox'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/40 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Send className="h-4 w-4" />
          <span>
            Исходящие ({documents.filter((d) => d.sender_company_id === currentCompanyId).length})
          </span>
        </button>

        <button
          onClick={() => setActiveTab('drafts')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'drafts'
              ? 'bg-slate-800 text-slate-200 border border-slate-700 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Clock className="h-4 w-4" />
          <span>
            Черновики ({documents.filter((d) => d.status === 'draft').length})
          </span>
        </button>
      </div>

      {/* 1. ПК ТАБЛИЦА (hidden md:block) */}
      <Card className="hidden md:block bg-slate-900/40 border-slate-800 overflow-hidden shadow-2xl">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка документооборота...</span>
            </div>
          ) : paginatedDocuments.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">
              Документы не найдены
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Номер & Тип</TableHead>
                  <TableHead>Отправитель</TableHead>
                  <TableHead>Получатель</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Просмотр</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedDocuments.map((doc) => {
                  const statusMeta = DOCUMENT_STATUSES[doc.status as DocumentStatus];
                  const typeMeta = DOCUMENT_TYPES[doc.doc_type];

                  return (
                    <TableRow key={doc.id} className="hover:bg-slate-800/40 transition-colors">
                      <TableCell>
                        <div className="font-semibold text-white font-mono text-sm">
                          № {doc.doc_number || doc.id.slice(0, 8)}
                        </div>
                        <div className="text-[11px] text-slate-400 font-medium">
                          {typeMeta?.label || doc.doc_type}
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="font-medium text-slate-200 text-xs flex items-center space-x-1">
                          <Building2 className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                          <span className="truncate max-w-[150px]">
                            {doc.sender_company?.name || '—'}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="font-medium text-slate-200 text-xs flex items-center space-x-1">
                          <Building2 className="h-3.5 w-3.5 text-purple-400 flex-shrink-0" />
                          <span className="truncate max-w-[150px]">
                            {doc.receiver_company?.name || '—'}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell className="font-mono text-xs text-slate-400">
                        {doc.doc_date}
                      </TableCell>

                      <TableCell>
                        <Badge variant={statusMeta?.variant}>{statusMeta?.label}</Badge>
                      </TableCell>

                      <TableCell className="text-right">
                        <Link href={`/dashboard/documents/${doc.id}`}>
                          <Button size="sm" variant="outline" className="border-slate-800 text-xs text-slate-300 hover:text-white min-h-[36px]">
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Открыть
                          </Button>
                        </Link>
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
        ) : paginatedDocuments.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800">
            Документы не найдены
          </div>
        ) : (
          paginatedDocuments.map((doc) => {
            const statusMeta = DOCUMENT_STATUSES[doc.status as DocumentStatus];
            const typeMeta = DOCUMENT_TYPES[doc.doc_type];

            return (
              <Card key={doc.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold text-white text-sm font-mono">
                      № {doc.doc_number || doc.id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-slate-400">{typeMeta?.label}</div>
                  </div>
                  <Badge variant={statusMeta?.variant}>{statusMeta?.label}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/60 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Отправитель</span>
                    <span className="font-semibold text-slate-200 truncate block">
                      {doc.sender_company?.name || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Получатель</span>
                    <span className="font-semibold text-slate-200 truncate block">
                      {doc.receiver_company?.name || '—'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                  <span className="text-[11px] font-mono text-slate-500">Дата: {doc.doc_date}</span>
                  <Link href={`/dashboard/documents/${doc.id}`}>
                    <Button size="sm" variant="outline" className="border-slate-800 text-xs text-blue-400 min-h-[44px]">
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      Открыть документ
                    </Button>
                  </Link>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* ПАГИНАЦИЯ (ПЕРЕКЛЮЧЕНИЕ СТРАНИЦ) */}
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
