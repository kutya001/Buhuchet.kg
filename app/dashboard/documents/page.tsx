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
  Plus,
  Search,
  Calendar,
  Building2,
  Loader2,
  Eye,
  Paperclip,
  Inbox,
  Send,
  FolderOpen,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { DOCUMENT_TYPES, DOCUMENT_STATUSES } from '@/types/document.types';
import type { Document, Company, DocumentFile, DocumentType, DocumentStatus } from '@/types/database.types';

type FullB2BDoc = Document & {
  sender_company?: Company | null;
  receiver_company?: Company | null;
  document_files?: DocumentFile[];
  users?: { full_name: string } | null;
};

export default function B2BDocumentsPage() {
  const [documents, setDocuments] = useState<FullB2BDoc[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Вкладка реестра: 'inbox' | 'outbox' | 'drafts'
  const [activeTab, setActiveTab] = useState<'inbox' | 'outbox' | 'drafts'>('inbox');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const supabase = createClient();

  const loadDocuments = async () => {
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

    const { data } = await supabase
      .from('documents')
      .select('*, sender_company:companies!sender_company_id(*), receiver_company:companies!receiver_company_id(*), document_files(*), users(full_name)')
      .order('created_at', { ascending: false });

    if (data) {
      setDocuments(data as FullB2BDoc[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  // Фильтрация по вкладкам
  const tabFilteredDocs = documents.filter((doc) => {
    if (activeTab === 'inbox') {
      return doc.receiver_company_id === currentCompanyId && doc.status !== 'draft';
    }
    if (activeTab === 'outbox') {
      return doc.sender_company_id === currentCompanyId && doc.status !== 'draft';
    }
    if (activeTab === 'drafts') {
      return doc.company_id === currentCompanyId && doc.status === 'draft';
    }
    return true;
  });

  // Поисковая фильтрация
  const filteredDocuments = tabFilteredDocs.filter((doc) => {
    const partnerName =
      activeTab === 'inbox' ? doc.sender_company?.name : doc.receiver_company?.name;

    const matchesSearch =
      (doc.doc_number && doc.doc_number.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (partnerName && partnerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (doc.comment && doc.comment.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = selectedStatus === 'all' || doc.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">Реестр B2B Документов</h2>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Обмен первичными документами и сканами между организациями
          </p>
        </div>

        <Link href="/dashboard/documents/new">
          <Button className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 text-xs md:text-sm">
            <Plus className="h-4 w-4 mr-1.5" />
            Создать B2B Отправку
          </Button>
        </Link>
      </div>

      {/* Вкладки Реестра */}
      <div className="flex items-center space-x-1 sm:space-x-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('inbox')}
          className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-xs md:text-sm font-medium transition-all ${
            activeTab === 'inbox'
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Inbox className="h-4 w-4" />
          <span>Входящие</span>
        </button>

        <button
          onClick={() => setActiveTab('outbox')}
          className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-xs md:text-sm font-medium transition-all ${
            activeTab === 'outbox'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Send className="h-4 w-4" />
          <span>Исходящие</span>
        </button>

        <button
          onClick={() => setActiveTab('drafts')}
          className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-xs md:text-sm font-medium transition-all ${
            activeTab === 'drafts'
              ? 'bg-slate-800 text-slate-200 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <FolderOpen className="h-4 w-4" />
          <span>Черновики</span>
        </button>
      </div>

      {/* Фильтры */}
      <Card className="bg-slate-900/40 border-slate-800 p-3 md:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Поиск по номеру, организации..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 text-xs md:text-sm"
            />
          </div>

          <div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full h-9 md:h-10 rounded-md border border-slate-800 bg-slate-950 px-3 text-xs md:text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все статусы</option>
              <option value="sent">Отправлено</option>
              <option value="accepted">Принято</option>
              <option value="processed">Обработано</option>
              <option value="cancelled">Отменено</option>
            </select>
          </div>
        </div>
      </Card>

      {/* 1. ПК-ВЕРСИЯ ТАБЛИЦЫ (hidden md:block) */}
      <Card className="hidden md:block bg-slate-900/40 border-slate-800 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка документов...</span>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              Документы не найдены
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Дата / Номер</TableHead>
                  <TableHead>{activeTab === 'inbox' ? 'Отправитель' : 'Получатель'}</TableHead>
                  <TableHead>Тип Документа</TableHead>
                  <TableHead>Прикреплено сканов</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((doc) => {
                  const typeMeta = DOCUMENT_TYPES[doc.doc_type as DocumentType];
                  const statusMeta = DOCUMENT_STATUSES[doc.status as DocumentStatus];
                  const partnerCompany = activeTab === 'inbox' ? doc.sender_company : doc.receiver_company;

                  return (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <div className="font-mono text-white font-medium">№ {doc.doc_number || '—'}</div>
                        <div className="text-[11px] text-slate-500 font-mono flex items-center mt-0.5">
                          <Calendar className="h-3 w-3 mr-1" />
                          {doc.doc_date}
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="font-medium text-slate-200 text-sm flex items-center space-x-1.5">
                          <Building2 className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                          <span className="truncate max-w-[200px]">{partnerCompany?.name || '—'}</span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <span className={`inline-block px-2.5 py-1 rounded-md text-xs border font-medium ${typeMeta?.color || ''}`}>
                          {typeMeta?.label || doc.doc_type}
                        </span>
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center text-xs text-emerald-400 font-mono">
                          <Paperclip className="h-3.5 w-3.5 mr-1" />
                          <span>{doc.document_files?.length || 1} файлов</span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge variant={statusMeta?.variant || 'secondary'}>
                          {statusMeta?.label || doc.status}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right">
                        <Link href={`/dashboard/documents/${doc.id}`}>
                          <Button size="sm" variant="outline" className="border-slate-800 text-xs text-slate-300 hover:text-white">
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

      {/* 2. МОБИЛЬНОЕ ПРЕДСТАВЛЕНИЕ КАРТОЧЕК (block md:hidden) */}
      <div className="block md:hidden space-y-3">
        {loading ? (
          <div className="flex items-center justify-center p-8 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Загрузка...</span>
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800">
            Документы не найдены
          </div>
        ) : (
          filteredDocuments.map((doc) => {
            const typeMeta = DOCUMENT_TYPES[doc.doc_type as DocumentType];
            const statusMeta = DOCUMENT_STATUSES[doc.status as DocumentStatus];
            const partnerCompany = activeTab === 'inbox' ? doc.sender_company : doc.receiver_company;

            return (
              <Link key={doc.id} href={`/dashboard/documents/${doc.id}`} className="block">
                <Card className="bg-slate-900/60 border-slate-800 p-4 hover:border-blue-500/50 transition-all active:scale-[0.99] space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-mono font-bold text-white">№ {doc.doc_number || '—'}</span>
                      <div className="text-[10px] font-mono text-slate-500 flex items-center mt-0.5">
                        <Calendar className="h-3 w-3 mr-1" />
                        {doc.doc_date}
                      </div>
                    </div>

                    <Badge variant={statusMeta?.variant || 'secondary'} className="text-[10px]">
                      {statusMeta?.label || doc.status}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/60">
                    <div className="flex items-center space-x-1.5 truncate max-w-[220px]">
                      <Building2 className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                      <span className="font-semibold text-slate-200 truncate">{partnerCompany?.name || '—'}</span>
                    </div>

                    <div className="flex items-center text-slate-400 text-xs">
                      <ChevronRight className="h-4 w-4 text-slate-500" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-1">
                    <span className={`px-2 py-0.5 rounded text-[10px] border ${typeMeta?.color || ''}`}>
                      {typeMeta?.label || doc.doc_type}
                    </span>
                    <span className="text-emerald-400 font-mono flex items-center">
                      <Paperclip className="h-3 w-3 mr-1" />
                      {doc.document_files?.length || 1} сканов
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
