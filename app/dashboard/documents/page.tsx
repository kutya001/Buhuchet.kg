'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Plus,
  Building2,
  Calendar,
  Eye,
  CheckCircle2,
  Clock,
  XCircle,
  Inbox,
  Send,
  FileCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getB2BDocumentsAction } from './actions';
import { DOCUMENT_TYPES, DOCUMENT_STATUSES } from '@/types/document.types';
import type { Document, Company, DocumentStatus } from '@/types/database.types';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';

type FullB2BDocument = Document & {
  sender_company?: Company | null;
  receiver_company?: Company | null;
  users?: { full_name: string } | null;
};

export default function B2BDocumentsRegistryPage() {
  const searchParams = useSearchParams();
  const searchFromUrl = searchParams.get('search') || '';

  const [documents, setDocuments] = useState<FullB2BDocument[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'all' | 'inbox' | 'outbox' | 'drafts'>('all');
  const [loading, setLoading] = useState(true);

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

    const res = await getB2BDocumentsAction(1, 200);
    if (res.success && res.data) {
      setDocuments((res.data.docs || []) as FullB2BDocument[]);
    } else {
      setDocuments([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  // Фильтрация по вкладкам
  const filteredDocuments = documents.filter((doc) => {
    if (activeTab === 'inbox' && (doc.receiver_company_id !== currentCompanyId || doc.status === 'draft')) return false;
    if (activeTab === 'outbox' && doc.sender_company_id !== currentCompanyId) return false;
    if (activeTab === 'drafts' && doc.status !== 'draft') return false;
    return true;
  });

  // ОПРЕДЕЛЕНИЕ СТОЛБЦОВ ТАБЛИЦЫ С УНИФИЦИРОВАННЫМИ ВОЗМОЖНОСТЯМИ (D&D, Меню ▼, Сортировка)
  const columns: ColumnDef<FullB2BDocument>[] = [
    {
      key: 'doc_number',
      label: '№ и Тип Документа',
      sortable: true,
      getValue: (d) => d.doc_number || d.id,
      render: (doc) => (
        <div className="font-semibold text-white font-mono text-xs md:text-sm flex items-center space-x-2">
          <FileText className="h-4 w-4 text-blue-400 flex-shrink-0" />
          <div>
            <span>{doc.doc_number ? `№ ${doc.doc_number}` : 'Черновик'}</span>
            <p className="text-[11px] text-slate-400 font-normal">{DOCUMENT_TYPES[doc.doc_type]?.label || doc.doc_type}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'direction',
      label: 'Вид',
      sortable: true,
      getValue: (d) => (d.receiver_company_id === currentCompanyId ? 'Входящий' : 'Исходящий'),
      render: (doc) => {
        const isInbox = doc.receiver_company_id === currentCompanyId;
        return (
          <Badge
            variant="outline"
            className={
              isInbox
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-semibold text-xs py-1 px-2.5 flex items-center w-fit'
                : 'border-blue-500/40 bg-blue-500/10 text-blue-400 font-semibold text-xs py-1 px-2.5 flex items-center w-fit'
            }
          >
            {isInbox ? <Inbox className="h-3.5 w-3.5 mr-1 flex-shrink-0" /> : <Send className="h-3.5 w-3.5 mr-1 flex-shrink-0" />}
            {isInbox ? 'Входящий' : 'Исходящий'}
          </Badge>
        );
      },
    },
    {
      key: 'status',
      label: 'Статус',
      sortable: true,
      getValue: (d) => d.status,
      render: (doc) => {
        const statusConfig = DOCUMENT_STATUSES[doc.status] || { label: doc.status, variant: 'secondary' as const };

        return (
          <Badge variant={statusConfig.variant} className="font-semibold text-xs px-2.5 py-1">
            {statusConfig.label}
          </Badge>
        );
      },
    },
    {
      key: 'counterparty',
      label: 'Контрагент',
      sortable: true,
      getValue: (d) => (d.sender_company_id === currentCompanyId ? d.receiver_company?.name : d.sender_company?.name),
      render: (doc) => {
        const isInbox = doc.receiver_company_id === currentCompanyId;
        const partyName = isInbox
          ? doc.sender_company?.name || '—'
          : doc.receiver_company?.name || '—';
        const partyInn = isInbox ? doc.sender_company?.inn : doc.receiver_company?.inn;

        return (
          <div className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
            <Building2 className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
            <div>
              <p className="truncate max-w-[180px]">{partyName}</p>
              {partyInn && <p className="text-[10px] text-slate-400 font-mono">ИНН: {partyInn}</p>}
            </div>
          </div>
        );
      },
    },
    {
      key: 'total_amount',
      label: 'Сумма (сом)',
      sortable: true,
      getValue: (d) => d.total_amount,
      render: (doc) => (
        <span className="font-mono font-bold text-emerald-400 text-xs sm:text-sm">
          {Number(doc.total_amount || 0).toLocaleString('ru-RU')} c.
        </span>
      ),
    },
    {
      key: 'doc_date',
      label: 'Дата Документа',
      sortable: true,
      getValue: (d) => d.doc_date,
      render: (doc) => (
        <span className="font-mono text-xs text-slate-400 flex items-center">
          <Calendar className="h-3 w-3 mr-1 text-slate-500" />
          {new Date(doc.doc_date).toLocaleDateString('ru-RU')}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Действие',
      sortable: false,
      render: (doc) => (
        <Link href={`/dashboard/documents/${doc.id}`} prefetch={true}>
          <Button size="sm" variant="outline" className="border-slate-800 text-blue-400 hover:bg-blue-500/10 text-xs min-h-[36px]">
            <Eye className="h-3.5 w-3.5 mr-1" />
            Открыть
          </Button>
        </Link>
      ),
    },
  ];

  // РЕНДЕР МОБИЛЬНОЙ КАРТОЧКИ
  const renderDocumentCard = (doc: FullB2BDocument) => {
    const isInbox = doc.receiver_company_id === currentCompanyId;
    const partyName = isInbox ? doc.sender_company?.name || '—' : doc.receiver_company?.name || '—';
    const statusConfig = DOCUMENT_STATUSES[doc.status] || { label: doc.status, variant: 'secondary' as const };

    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[10px] text-slate-400 font-mono block">
              {DOCUMENT_TYPES[doc.doc_type]?.label || doc.doc_type}
            </span>
            <h4 className="font-bold text-white text-sm font-mono flex items-center">
              <FileText className="h-4 w-4 mr-1.5 text-blue-400" />
              {doc.doc_number ? `№ ${doc.doc_number}` : 'Черновик'}
            </h4>
          </div>
          <Badge variant={statusConfig.variant} className="font-semibold text-[10px]">
            {statusConfig.label}
          </Badge>
        </div>

        <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/80">
          <span className="text-slate-400 flex items-center">
            <Building2 className="h-3.5 w-3.5 mr-1 text-amber-400" />
            {partyName}
          </span>
          <span className="font-mono font-bold text-emerald-400">
            {Number(doc.total_amount || 0).toLocaleString('ru-RU')} c.
          </span>
        </div>

        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
          <span className="text-[11px] text-slate-400 font-mono">
            {new Date(doc.doc_date).toLocaleDateString('ru-RU')}
          </span>
          <Link href={`/dashboard/documents/${doc.id}`} prefetch={true}>
            <Button size="sm" variant="outline" className="border-slate-800 text-blue-400 text-xs min-h-[36px]">
              <Eye className="h-3.5 w-3.5 mr-1" />
              Открыть
            </Button>
          </Link>
        </div>
      </div>
    );
  };

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
          <span>Входящие ({documents.filter((d) => d.receiver_company_id === currentCompanyId).length})</span>
        </button>

        <button
          onClick={() => setActiveTab('outbox')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'outbox'
              ? 'bg-amber-600/20 text-amber-400 border border-amber-500/40 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Send className="h-4 w-4" />
          <span>Исходящие ({documents.filter((d) => d.sender_company_id === currentCompanyId).length})</span>
        </button>

        <button
          onClick={() => setActiveTab('drafts')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'drafts'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/40 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Clock className="h-4 w-4" />
          <span>Черновики ({documents.filter((d) => d.status === 'draft').length})</span>
        </button>
      </div>

      {/* ЕДИНООБРАЗНЫЙ УНИВЕРСАЛЬНЫЙ ТАБЛИЧНО-КАРТОЧНЫЙ РЕЕСТР С Drag&Drop, СОРТИРОВКОЙ, МЕНЮ ▼ И ПАГИНАЦИЕЙ (25-50-100-Все) */}
      <UnifiedDataGrid<FullB2BDocument>
        columns={columns}
        data={filteredDocuments}
        keyExtractor={(d) => d.id}
        renderCard={renderDocumentCard}
        searchPlaceholder="Поиск по № документа, контрагенту, сумме..."
        emptyMessage="Документы не найдены. Создайте первый B2B документ."
        isLoading={loading}
        defaultPageSize={25}
      />
    </div>
  );
}
