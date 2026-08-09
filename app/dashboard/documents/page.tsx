'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getB2BDocumentsAction, getB2BDocumentDetailsAction } from './actions';
import { toast } from 'sonner';
import { DOCUMENT_TYPES, DOCUMENT_STATUSES } from '@/types/document.types';
import type { Document, Company, DocumentStatus, UserProfile } from '@/types/database.types';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedViewModal, ViewSection } from '@/components/ui/unified/UnifiedViewModal';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { hasPermission } from '@/lib/auth/permissions';

type FullB2BDocument = Document & {
  sender_company?: Company | null;
  receiver_company?: Company | null;
  users?: { full_name: string } | null;
};

export default function B2BDocumentsRegistryPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const searchFromUrl = searchParams.get('search') || '';

  const [documents, setDocuments] = useState<FullB2BDocument[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'all' | 'inbox' | 'outbox' | 'drafts'>('all');
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const [serverErrorMsg, setServerErrorMsg] = useState<string | null>(null);

  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null);

  // ФОРМА ПРОСМОТРА КАРТОЧКИ (UnifiedViewModal)
  const [viewingDocDetails, setViewingDocDetails] = useState<any | null>(null);
  const [loadingDocDetails, setLoadingDocDetails] = useState(false);

  const handleOpenDocViewModal = async (docId?: string) => {
    if (!docId || typeof docId !== 'string' || docId.trim() === '') {
      toast.error('Ошибка: выбран некорректный документ');
      return;
    }

    setLoadingDocDetails(true);
    setViewingDocDetails({ id: docId, doc_number: 'Загрузка...' });

    const res = await getB2BDocumentDetailsAction({ docId });
    if (res.success && res.data) {
      setViewingDocDetails(res.data);
    } else {
      setViewingDocDetails(null);
      toast.error(res.error || 'Не удалось загрузить подробности документа');
    }
    setLoadingDocDetails(false);
  };

  const loadDocuments = async () => {
    setLoading(true);
    setServerErrorMsg(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: prof } = await supabase
        .from('users')
        .select('*, companies(*), company_roles(*)')
        .eq('id', user.id)
        .single();
      if (prof) setCurrentProfile(prof as UserProfile);
    }

    const res = await getB2BDocumentsAction(1, 200);
    if (res.success && res.data) {
      setDocuments((res.data.docs || []) as FullB2BDocument[]);
      if (res.data.currentCompanyId) {
        setCurrentCompanyId(res.data.currentCompanyId);
      }
    } else {
      setDocuments([]);
      if (res.error) setServerErrorMsg(res.error);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  // Фильтрация по вкладкам и разрешённым статусам
  const filteredDocuments = documents.filter((doc) => {
    if (activeTab === 'inbox' && (doc.receiver_company_id !== currentCompanyId || doc.status === 'draft')) return false;
    if (activeTab === 'outbox' && doc.sender_company_id !== currentCompanyId) return false;
    if (activeTab === 'drafts' && doc.status !== 'draft') return false;

    // Гранулярная проверка разрешений по статусам
    if (currentProfile && !currentProfile.is_super_admin && currentProfile.role !== 'owner' && !currentProfile.company_roles?.is_system) {
      const canAll = hasPermission(currentProfile, 'documents', 'view_all_statuses');
      if (!canAll) {
        const canDraft = hasPermission(currentProfile, 'documents', 'view_draft_only');
        const canSent = hasPermission(currentProfile, 'documents', 'view_sent_only');
        const canAccepted = hasPermission(currentProfile, 'documents', 'view_accepted_only');

        if (doc.status === 'draft' && !canDraft) return false;
        if ((doc.status === 'sent' || doc.status === 'recalled') && !canSent) return false;
        if ((doc.status === 'accepted' || doc.status === 'processed') && !canAccepted) return false;
      }
    }

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
        <div className="font-semibold text-foreground font-mono text-xs md:text-sm flex items-center space-x-2">
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
          <div className="text-xs font-semibold text-foreground flex items-center space-x-1.5">
            <Building2 className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            <div>
              <p className="truncate max-w-[180px]">{partyName}</p>
              {partyInn && <p className="text-[10px] text-muted-foreground font-mono">ИНН: {partyInn}</p>}
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
  ];

  // РЕНДЕР МОБИЛЬНОЙ КАРТОЧКИ
  const renderDocumentCard = (doc: FullB2BDocument) => {
    const isInbox = doc.receiver_company_id === currentCompanyId;
    const partyName = isInbox ? doc.sender_company?.name || '—' : doc.receiver_company?.name || '—';
    const statusConfig = DOCUMENT_STATUSES[doc.status] || { label: doc.status, variant: 'secondary' as const };

    return (
      <div className="bg-muted/50 border border-border rounded-2xl p-4 space-y-3 shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[10px] text-slate-400 font-mono block">
              {DOCUMENT_TYPES[doc.doc_type]?.label || doc.doc_type}
            </span>
            <h4 className="font-bold text-foreground text-sm font-mono flex items-center">
              <FileText className="h-4 w-4 mr-1.5 text-blue-400" />
              {doc.doc_number ? `№ ${doc.doc_number}` : 'Черновик'}
            </h4>
          </div>
          <Badge variant={statusConfig.variant} className="font-semibold text-[10px]">
            {statusConfig.label}
          </Badge>
        </div>

        <div className="flex items-center justify-between text-xs pt-2 border-t border-border">
          <span className="text-slate-400 flex items-center">
            <Building2 className="h-3.5 w-3.5 mr-1 text-amber-400" />
            {partyName}
          </span>
          <span className="font-mono font-bold text-emerald-400">
            {Number(doc.total_amount || 0).toLocaleString('ru-RU')} c.
          </span>
        </div>

        <div className="pt-2 border-t border-border flex items-center justify-between">
          <span className="text-[11px] text-slate-400 font-mono">
            {new Date(doc.doc_date).toLocaleDateString('ru-RU')}
          </span>
          <Link href={`/dashboard/documents/${doc.id}`} prefetch={true}>
            <Button size="sm" variant="outline" className="border-border text-blue-400 hover:bg-blue-500/10 hover:text-blue-500 text-xs min-h-[36px]">
              <Eye className="h-3.5 w-3.5 mr-1" />
              Открыть
            </Button>
          </Link>
        </div>
      </div>
    );
  };

  return (
    <UnifiedWorkspaceLayout
      title="Реестр документооборота"
      description="Товарные накладные, акты выполненных работ и счета-фактуры КР"
      icon={FileText}
      tabs={[
        { key: 'all', label: 'Все документы', count: documents.length, icon: FileText },
        { key: 'inbox', label: 'Входящие', count: documents.filter((d) => d.receiver_company_id === currentCompanyId).length, icon: Inbox },
        { key: 'outbox', label: 'Исходящие', count: documents.filter((d) => d.sender_company_id === currentCompanyId).length, icon: Send },
        { key: 'drafts', label: 'Черновики', count: documents.filter((d) => d.status === 'draft').length, icon: Clock },
      ]}
      activeTab={activeTab}
      onTabChange={(tabKey) => setActiveTab(tabKey)}
      actionButtonsSlot={
        <Link href="/dashboard/documents/new" prefetch={true}>
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs md:text-sm shadow-md min-h-[44px]">
            <Plus className="h-4 w-4 mr-1.5" />
            Создать документ
          </Button>
        </Link>
      }
    >
      {serverErrorMsg && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-500 mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{serverErrorMsg}</AlertDescription>
        </Alert>
      )}

      {/* ЕДИНООБРАЗНЫЙ УНИВЕРСАЛЬНЫЙ ТАБЛИЧНО-КАРТОЧНЫЙ РЕЕСТР С Drag&Drop, СОРТИРОВКОЙ, МЕНЮ ▼ И ПАГИНАЦИЕЙ (25-50-100-Все) */}
      <UnifiedDataGrid<FullB2BDocument>
        gridId="documents_registry"
        columns={columns}
        data={filteredDocuments}
        keyExtractor={(d) => d.id}
        onRowClick={(doc) => {
          if (doc && doc.id) {
            handleOpenDocViewModal(doc.id);
          } else {
            toast.error('Запрошенный документ не найден');
          }
        }}
        renderCard={renderDocumentCard}
        searchPlaceholder="Поиск по № документа, контрагенту, сумме..."
        emptyMessage="Документы не найдены. Создайте первый документ."
        isLoading={loading}
        defaultPageSize={25}
      />

      {/* УНИВЕРСАЛЬНАЯ ФОРМА ПРОСМОТРА КАРТОЧКИ ДОКУМЕНТА (UnifiedViewModal) */}
      {viewingDocDetails && (
        <UnifiedViewModal
          isOpen={!!viewingDocDetails}
          onClose={() => setViewingDocDetails(null)}
          title={`Документ № ${viewingDocDetails.doc_number || viewingDocDetails.id?.substring(0, 8)}`}
          subtitle={`Составлен ${viewingDocDetails.doc_date || '—'}`}
          isLoading={loadingDocDetails}
          badge={
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-[10px]">
              {DOCUMENT_STATUSES[viewingDocDetails.status as DocumentStatus]?.label || viewingDocDetails.status || 'Черновик'}
            </Badge>
          }
          sections={[
            {
              title: 'Реквизиты первичного документа',
              fields: [
                { label: 'Номер документа', value: viewingDocDetails.doc_number || '—', icon: FileText },
                {
                  label: 'Вид документа',
                  value: DOCUMENT_TYPES[viewingDocDetails.doc_type as keyof typeof DOCUMENT_TYPES]?.label || viewingDocDetails.doc_type,
                },
                { label: 'Дата составления', value: viewingDocDetails.doc_date || '—', icon: Calendar },
                {
                  label: 'Сумма сделки',
                  value: `${Number(viewingDocDetails.total_amount || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} сом`,
                },
              ],
            },
            {
              title: 'Стороны сделки',
              fields: [
                {
                  label: 'Отправитель',
                  value: viewingDocDetails.sender_company
                    ? `${viewingDocDetails.sender_company.name} (ИНН: ${viewingDocDetails.sender_company.inn})`
                    : '—',
                  icon: Building2,
                  colSpan: 2,
                },
                {
                  label: 'Получатель',
                  value: viewingDocDetails.receiver_company
                    ? `${viewingDocDetails.receiver_company.name} (ИНН: ${viewingDocDetails.receiver_company.inn})`
                    : viewingDocDetails.counterparties
                    ? `${viewingDocDetails.counterparties.name} (ИНН: ${viewingDocDetails.counterparties.inn})`
                    : '—',
                  icon: Building2,
                  colSpan: 2,
                },
              ],
            },
            {
              title: 'Прикрепленные сканы и примечания',
              fields: [
                {
                  label: 'Прикрепленные файлы',
                  value: viewingDocDetails.files?.length
                    ? `${viewingDocDetails.files.length} файл(ов) на облачном диске`
                    : 'Файлы не прикреплены',
                  colSpan: 2,
                },
                { label: 'Комментарий', value: viewingDocDetails.comment || '—', colSpan: 2 },
              ],
            },
          ]}
          actions={[
            {
              label: '👁️ Перейти к документу',
              onClick: () => {
                const id = viewingDocDetails.id;
                setViewingDocDetails(null);
                if (id) router.push(`/dashboard/documents/${id}`);
              },
            },
            {
              label: '✏️ Редактировать',
              onClick: () => {
                const id = viewingDocDetails.id;
                setViewingDocDetails(null);
                if (id) router.push(`/dashboard/documents/${id}`);
              },
            },
          ]}
        />
      )}
    </UnifiedWorkspaceLayout>
  );
}
