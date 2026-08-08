'use client';

import React, { useState, useEffect, useTransition, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Users,
  Building2,
  BarChart3,
  Loader2,
  X,
  Send,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  UserCheck,
  Globe,
  UserPlus,
  UserX,
  Plus,
  Clock,
  FileText,
  Download,
  RefreshCw,
  Search,
  Filter,
  Paperclip,
  RotateCcw,
  PauseCircle,
  PlayCircle,
  Check,
  Edit2,
  Phone,
  MessageCircle,
} from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import {
  sendPartnershipRequestAction,
  respondToPartnershipRequestAction,
  terminatePartnershipAction,
  updateCounterpartyCommentAction,
  getCounterpartyDetailsAndFilesAction,
  syncPartnershipCounterpartiesAction,
  createManualCounterpartyAction,
  getOrganizationsModuleDataAction,
} from './actions';
import { INDUSTRIES } from '@/types/database.types';
import type { Counterparty, Company, Document, DocumentFile, PartnershipStatus, UserProfile } from '@/types/database.types';
import imageCompression from 'browser-image-compression';
import { UnifiedDataGrid, ColumnDef, RowAction } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';
import { ActionRowGroup } from '@/components/ui/unified/ActionIcons';
import { MobileFAB } from '@/components/ui/MobileFAB';
import { hasPermission } from '@/lib/auth/permissions';

type PartnerReport = {
  counterparty: Counterparty;
  inboxDocsCount: number;
  outboxDocsCount: number;
  totalFilesCount: number;
  documents: Document[];
};

type CounterpartyProfileModal = {
  counterparty: Counterparty;
  companyDetails?: Company | null;
  statutoryFiles: Array<DocumentFile & { downloadUrl?: string }>;
};

export default function CounterpartiesPage() {
  const searchParams = useSearchParams();
  const searchFromUrl = searchParams.get('search') || '';

  // 3 Главные Вкладки верхнего уровня: 'counterparties' | 'requests' | 'catalog'
  const [mainTab, setMainTab] = useState<'counterparties' | 'requests' | 'catalog'>('counterparties');

  // Направление партнерских заявок: 'incoming' (Входящие) | 'outgoing' (Исходящие)
  const [requestDirection, setRequestDirection] = useState<'incoming' | 'outgoing'>('incoming');

  // Вкладка «Заявки»: статус-фильтр
  const [requestStatusFilter, setRequestStatusFilter] = useState<'all' | PartnershipStatus>('all');

  // Вкладка «Каталог Организаций»: Фильтр по категориям/отраслям
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');

  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [partnerships, setPartnerships] = useState<any[]>([]);
  const [catalogCompanies, setCatalogCompanies] = useState<Company[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Редактирование примечания
  const [editingCounterpartyId, setEditingCounterpartyId] = useState<string | null>(null);
  const [editComment, setEditComment] = useState('');

  // 1. Модалка отчета
  const [selectedPartnerReport, setSelectedPartnerReport] = useState<PartnerReport | null>(null);

  // 2. Модалка прекращения сотрудничества
  const [terminateModalCompany, setTerminateModalCompany] = useState<{ id: string; name: string } | null>(null);

  // 2. Модалка просмотра ВСЕХ ДАННЫХ И УЧРЕДИТЕЛЬНЫХ ФАЙЛОВ контрагента
  const [profileModal, setProfileModal] = useState<CounterpartyProfileModal | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // 3. Модалка ручного создания контрагента (с прикреплением файла в R2)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createInn, setCreateInn] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createIsVat, setCreateIsVat] = useState(true);
  const [createComment, setCreateComment] = useState('');
  
  // Файл скана для R2 при создании контрагента
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null);

  const loadData = async () => {
    setLoading(true);
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

    const res = await getOrganizationsModuleDataAction();
    if (res.success && res.data) {
      setCurrentCompanyId(res.data.currentCompanyId);
      setCounterparties(res.data.counterparties);
      setPartnerships(res.data.partnerships);
      setCatalogCompanies(res.data.catalogCompanies);
    } else {
      setMsg({ type: 'error', text: res.error || 'Не удалось загрузить данные модуля' });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSyncCounterparties = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await syncPartnershipCounterpartiesAction();
      if (res.success) {
        setMsg({ type: 'success', text: 'Синхронизация БД выполнена! Все записи контрагентов сверены.' });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка синхронизации' });
      }
    });
  };

  const handleManualCreateWithFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName || !createInn || createInn.length !== 14) {
      alert('Укажите наименование и ИНН КР (14 цифр)!');
      return;
    }

    setMsg(null);
    setUploadingFile(true);

    try {
      let r2Path = '';
      let r2FileName = '';

      if (selectedFile) {
        let fileToUpload = selectedFile;
        if (selectedFile.type.startsWith('image/')) {
          fileToUpload = await imageCompression(selectedFile, {
            maxSizeMB: 0.2,
            maxWidthOrHeight: 1000,
            useWebWorker: true,
          });
        }

        const ext = fileToUpload.name.split('.').pop() || 'png';
        const fileKey = `legal-docs/${currentCompanyId}_${Date.now()}.${ext}`;

        const resUrl = await fetch(`/api/r2/presigned-url?key=${encodeURIComponent(fileKey)}&contentType=${encodeURIComponent(fileToUpload.type)}`);
        const { uploadUrl } = await resUrl.json();

        if (uploadUrl) {
          const putRes = await fetch(uploadUrl, {
            method: 'PUT',
            body: fileToUpload,
            headers: { 'Content-Type': fileToUpload.type },
          });

          if (putRes.ok) {
            r2Path = fileKey;
            r2FileName = selectedFile.name;
          }
        }
      }

      startTransition(async () => {
        const res = await createManualCounterpartyAction({
          name: createName,
          inn: createInn,
          email: createEmail,
          phone: createPhone,
          is_vat_payer: createIsVat,
          comment: createComment,
          file_path_r2: r2Path || undefined,
          file_name: r2FileName || undefined,
        });

        if (res.success) {
          setMsg({ type: 'success', text: `Организация "${createName}" успешно создана в реестре` });
          setShowCreateModal(false);
          setCreateName('');
          setCreateInn('');
          setCreateEmail('');
          setCreatePhone('');
          setCreateComment('');
          setSelectedFile(null);
          loadData();
        } else {
          setMsg({ type: 'error', text: res.error || 'Ошибка добавления организации' });
        }
      });
    } catch (err: any) {
      setMsg({ type: 'error', text: `Сбой при загрузке скана: ${err?.message}` });
    } finally {
      setUploadingFile(false);
    }
  };

  const handleSendRequest = (targetCompanyId: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await sendPartnershipRequestAction(targetCompanyId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Заявка на сотрудничество успешно отправлена' });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка отправки заявки' });
      }
    });
  };

  const handleRespondRequest = (partnershipId: string, status: PartnershipStatus) => {
    setMsg(null);

    // Оптимистичное локальное обновление
    setPartnerships((prev) =>
      prev.map((p) => (p.id === partnershipId ? { ...p, status, updated_at: new Date().toISOString() } : p))
    );

    let statusText = 'Статус заявки обновлен.';
    if (status === 'approved') statusText = 'Партнерство подтверждено! Контрагент добавлен в ваш список.';
    if (status === 'rejected') statusText = 'Заявка отменена.';
    if (status === 'recalled') statusText = 'Заявка успешно отозвана.';
    if (status === 'suspended') statusText = 'Партнерство временно приостановлено.';

    setMsg({ type: 'success', text: statusText });

    startTransition(async () => {
      const res = await respondToPartnershipRequestAction(partnershipId, status);
      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка обработки заявки' });
        loadData();
      }
    });
  };

  const handleTerminatePartnership = (counterpartyId: string) => {
    if (!confirm('Вы действительно хотите прекратить сотрудничество с этим контрагентом?')) {
      return;
    }

    setMsg(null);
    // Оптимистичное удаление из локального состояния
    setCounterparties((prev) => prev.filter((c) => c.id !== counterpartyId));
    setMsg({ type: 'success', text: 'Сотрудничество прекращено.' });

    startTransition(async () => {
      const res = await terminatePartnershipAction(counterpartyId);
      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка прекращения сотрудничества' });
        loadData();
      }
    });
  };

  const handleSaveComment = (counterpartyId: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await updateCounterpartyCommentAction(counterpartyId, editComment);
      if (res.success) {
        setMsg({ type: 'success', text: 'Примечание успешно обновлено' });
        setEditingCounterpartyId(null);
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка обновления примечания' });
      }
    });
  };

  const handleOpenPartnerReport = async (counterparty: Counterparty) => {
    setMsg(null);
    if (!currentCompanyId) return;

    const { data: docs } = await supabase
      .from('documents')
      .select('*')
      .or(`and(sender_company_id.eq.${currentCompanyId},receiver_company_id.eq.${counterparty.target_company_id || ''}),and(sender_company_id.eq.${counterparty.target_company_id || ''},receiver_company_id.eq.${currentCompanyId})`);

    const partnerDocs = (docs || []) as Document[];

    let inboxCount = 0;
    let outboxCount = 0;

    partnerDocs.forEach((d) => {
      if (d.sender_company_id === currentCompanyId) {
        outboxCount++;
      } else {
        inboxCount++;
      }
    });

    const docIds = partnerDocs.map((d) => d.id);
    let filesCount = 0;
    if (docIds.length > 0) {
      const { count } = await supabase
        .from('files')
        .select('*', { count: 'exact', head: true })
        .in('document_id', docIds);
      filesCount = count || 0;
    }

    setSelectedPartnerReport({
      counterparty,
      inboxDocsCount: inboxCount,
      outboxDocsCount: outboxCount,
      totalFilesCount: filesCount,
      documents: partnerDocs,
    });
  };

  const handleOpenProfileModal = async (counterparty: Counterparty) => {
    setMsg(null);
    setProfileLoading(true);

    let targetId = counterparty.target_company_id;

    if (!targetId) {
      const { data: comp } = await supabase
        .from('companies')
        .select('id')
        .eq('inn', counterparty.inn)
        .maybeSingle();

      if (comp?.id) targetId = comp.id;
    }

    if (!targetId) {
      setMsg({ type: 'error', text: 'Учредительные данные контрагента не привязаны к зарегистрированной организации.' });
      setProfileLoading(false);
      return;
    }

    const res = await getCounterpartyDetailsAndFilesAction(targetId);
    if (res.success && res.data) {
      setProfileModal({
        counterparty,
        companyDetails: res.data.company,
        statutoryFiles: res.data.statutoryFiles,
      });
    } else {
      setMsg({ type: 'error', text: res.error || 'Не удалось получить уставные данные контрагента' });
    }

    setProfileLoading(false);
  };

  const handleOpenProfileById = async (targetCompanyId: string) => {
    setMsg(null);
    setProfileLoading(true);
    const res = await getCounterpartyDetailsAndFilesAction(targetCompanyId);
    if (res.success && res.data) {
      setProfileModal({
        counterparty: {
          id: res.data.company.id,
          company_id: currentCompanyId || '',
          target_company_id: res.data.company.id,
          name: res.data.company.name,
          inn: res.data.company.inn,
          email: res.data.company.email || '',
          phone: res.data.company.phone || '',
          is_vat_payer: true,
          created_at: res.data.company.created_at || '',
          updated_at: res.data.company.updated_at || '',
        },
        companyDetails: res.data.company,
        statutoryFiles: res.data.statutoryFiles,
      });
    } else {
      setMsg({ type: 'error', text: res.error || 'Не удалось получить уставные данные организации' });
    }
    setProfileLoading(false);
  };

  // ---------------- ДВИЖОК ДЕЙСТВИЙ ДЛЯ ПОПОВЕРА И КОНТЕКСТНОГО МЕНЮ (getRowActions) ----------------
  const getCounterpartyRowActions = (c: Counterparty): RowAction<Counterparty>[] => {
    return [
      {
        label: 'Просмотреть реквизиты и уставные сканы R2',
        icon: <FileText className="h-4 w-4 text-indigo-400" />,
        action: () => handleOpenProfileModal(c),
      },
      {
        label: 'Выгрузить Акт Сверки Взаиморасчетов',
        icon: <Download className="h-4 w-4 text-emerald-400" />,
        action: () => handleOpenPartnerReport(c),
      },
      {
        label: 'Редактировать примечание',
        icon: <Edit2 className="h-4 w-4 text-amber-400" />,
        action: () => {
          setEditingCounterpartyId(c.id);
          setEditComment(c.comment || '');
        },
      },
      {
        label: 'Прекратить сотрудничество',
        icon: <UserX className="h-4 w-4 text-rose-400" />,
        danger: true,
        separatorBefore: true,
        action: () => setTerminateModalCompany({ id: c.target_company_id || c.id, name: c.name }),
      },
    ];
  };

  const getPartnershipRowActions = (p: any): RowAction<any>[] => {
    const isRequester = p.requester_company_id === currentCompanyId;
    const partnerComp = isRequester ? p.target_company : p.requester_company;
    const actions: RowAction<any>[] = [];

    if (partnerComp?.id) {
      actions.push({
        label: 'Просмотреть профиль организации',
        icon: <FileText className="h-4 w-4 text-indigo-400" />,
        action: () => handleOpenProfileById(partnerComp.id),
      });
    }

    if (p.status === 'pending') {
      if (isRequester) {
        actions.push({
          label: 'Отменить исходящую заявку',
          icon: <RotateCcw className="h-4 w-4 text-amber-400" />,
          action: () => handleRespondRequest(p.id, 'cancelled'),
        });
      } else {
        actions.push(
          {
            label: 'Принять в сеть партнеров',
            icon: <Check className="h-4 w-4 text-emerald-400" />,
            action: () => handleRespondRequest(p.id, 'approved'),
          },
          {
            label: 'Отклонить заявку',
            icon: <X className="h-4 w-4 text-rose-400" />,
            danger: true,
            action: () => handleRespondRequest(p.id, 'rejected'),
          }
        );
      }
    } else if (p.status === 'approved' || p.status === 'accepted') {
      actions.push({
        label: 'Прекратить партнерство',
        icon: <UserX className="h-4 w-4 text-rose-400" />,
        danger: true,
        separatorBefore: true,
        action: () => setTerminateModalCompany({ id: partnerComp?.id || p.id, name: partnerComp?.name || 'Партнер' }),
      });
    } else if ((p.status === 'rejected' || p.status === 'recalled' || p.status === 'cancelled') && partnerComp?.id) {
      actions.push({
        label: 'Повторить запрос на партнерство',
        icon: <Send className="h-4 w-4 text-purple-400" />,
        action: () => handleSendRequest(partnerComp.id),
      });
    }

    return actions;
  };

  const getCatalogRowActions = (c: Company): RowAction<Company>[] => {
    const existingP = partnerships.find(
      (p) =>
        (p.requester_company_id === currentCompanyId && p.target_company_id === c.id) ||
        (p.target_company_id === currentCompanyId && p.requester_company_id === c.id)
    );

    const actions: RowAction<Company>[] = [
      {
        label: 'Просмотреть данные и уставные сканы R2',
        icon: <FileText className="h-4 w-4 text-indigo-400" />,
        action: () => handleOpenProfileById(c.id),
      },
    ];

    if (existingP?.status === 'approved' || existingP?.status === 'accepted') {
      actions.push({
        label: 'Прекратить сотрудничество',
        icon: <UserX className="h-4 w-4 text-rose-400" />,
        danger: true,
        separatorBefore: true,
        action: () => setTerminateModalCompany({ id: c.id, name: c.name }),
      });
    } else if (existingP?.status === 'pending') {
      const isOutgoing = existingP.requester_company_id === currentCompanyId;
      if (isOutgoing) {
        actions.push({
          label: 'Отменить исходящую заявку',
          icon: <RotateCcw className="h-4 w-4 text-amber-400" />,
          action: () => handleRespondRequest(existingP.id, 'cancelled'),
        });
      } else {
        actions.push(
          {
            label: 'Принять предложение в сеть',
            icon: <Check className="h-4 w-4 text-emerald-400" />,
            action: () => handleRespondRequest(existingP.id, 'approved'),
          },
          {
            label: 'Отклонить предложение',
            icon: <X className="h-4 w-4 text-rose-400" />,
            danger: true,
            action: () => handleRespondRequest(existingP.id, 'rejected'),
          }
        );
      }
    } else if (
      existingP?.status === 'rejected' ||
      existingP?.status === 'terminated' ||
      existingP?.status === 'cancelled'
    ) {
      actions.push({
        label: 'Повторить запрос на партнерство',
        icon: <Send className="h-4 w-4 text-purple-400" />,
        action: () => handleSendRequest(c.id),
      });
    } else {
      actions.push({
        label: 'Запросить сотрудничество (B2B)',
        icon: <Send className="h-4 w-4 text-purple-400" />,
        action: () => handleSendRequest(c.id),
      });
    }

    return actions;
  };

  // ---------------- CONFIG FOR TAB 1: COUNTERPARTIES ----------------
  const counterpartiesColumns: ColumnDef<Counterparty>[] = [
    {
      key: 'name',
      label: 'Официальное Наименование',
      sortable: true,
      getValue: (c) => c.name,
      render: (c) => {
        const isBlocked = (c as any).target_company?.status === 'blocked';
        return (
          <div className="font-semibold text-foreground text-sm flex items-center space-x-1.5 flex-wrap gap-y-1">
            <Building2 className="h-4 w-4 text-amber-500 flex-shrink-0" />
            <span>{c.name}</span>
            {isBlocked && (
              <Badge className="bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[10px] animate-pulse flex items-center">
                <AlertCircle className="h-3 w-3 mr-1" />
                Заблокирован
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: 'inn',
      label: 'ИНН КР',
      sortable: true,
      getValue: (c) => c.inn,
      render: (c) => <span className="font-mono text-sm text-slate-300 font-bold">{c.inn}</span>,
    },
    {
      key: 'email',
      label: 'Email / Телефон',
      sortable: true,
      getValue: (c) => c.email || c.phone,
      render: (c) => (
        <div className="font-mono text-xs text-slate-400">
          {c.email || `contact@${c.inn}.kg`}
          {c.phone && <p className="text-[11px] text-slate-500">{c.phone}</p>}
        </div>
      ),
    },
    {
      key: 'is_vat_payer',
      label: 'НДС 12%',
      sortable: true,
      getValue: (c) => c.is_vat_payer,
      render: (c) => (
        <Badge variant="outline" className={c.is_vat_payer ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-slate-700 text-slate-400'}>
          {c.is_vat_payer ? 'Плательщик 12%' : 'Без НДС'}
        </Badge>
      ),
    },
    {
      key: 'comment',
      label: 'Примечание',
      sortable: true,
      getValue: (c) => c.comment,
      render: (c) =>
        editingCounterpartyId === c.id ? (
          <div className="flex items-center space-x-2">
            <Input
              value={editComment}
              onChange={(e) => setEditComment(e.target.value)}
              placeholder="Примечание..."
              className="h-8 text-xs bg-background border-border text-foreground"
            />
            <Button size="sm" onClick={() => handleSaveComment(c.id)} disabled={isPending} className="h-8 px-2 bg-emerald-600 hover:bg-emerald-500 text-foreground">
              ОК
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingCounterpartyId(null)} className="h-8 px-2 text-muted-foreground">
              X
            </Button>
          </div>
        ) : (
          <div className="flex items-center space-x-2 text-xs text-muted-foreground">
            <span className="truncate max-w-[150px]">{c.comment || '—'}</span>
            <button
              onClick={() => {
                setEditingCounterpartyId(c.id);
                setEditComment(c.comment || '');
              }}
              className="text-muted-foreground hover:text-amber-400 p-1"
              title="Редактировать примечание"
            >
              <Edit2 className="h-3 w-3" />
            </button>
          </div>
        ),
    },
  ];

  // ---------------- CONFIG FOR TAB 2: PARTNERSHIP REQUESTS ----------------
  const incomingPartnerships = useMemo(() => {
    return partnerships.filter((p) => p.target_company_id === currentCompanyId);
  }, [partnerships, currentCompanyId]);

  const outgoingPartnerships = useMemo(() => {
    return partnerships.filter((p) => p.requester_company_id === currentCompanyId);
  }, [partnerships, currentCompanyId]);

  const activePartnershipsList = requestDirection === 'incoming' ? incomingPartnerships : outgoingPartnerships;

  const filteredPartnerships = useMemo(() => {
    return activePartnershipsList.filter((p) => {
      if (requestStatusFilter === 'all') return true;
      return p.status === requestStatusFilter;
    });
  }, [activePartnershipsList, requestStatusFilter]);

  const partnershipsColumns: ColumnDef<any>[] = [
    {
      key: 'partner',
      label: requestDirection === 'incoming' ? 'Отправитель Заявки' : 'Адресат Заявки',
      sortable: true,
      getValue: (p) => (p.requester_company_id === currentCompanyId ? p.target_company?.name : p.requester_company?.name),
      render: (p) => {
        const isRequester = p.requester_company_id === currentCompanyId;
        const partnerComp = isRequester ? p.target_company : p.requester_company;

        return (
          <div className="font-bold text-foreground text-sm flex items-center space-x-2">
            <Building2 className="h-4 w-4 text-sky-400 flex-shrink-0" />
            <div>
              <span>{partnerComp?.name || 'Организация'}</span>
              <p className="text-xs text-muted-foreground font-mono">ИНН: {partnerComp?.inn || '—'}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Статус Заявки',
      sortable: true,
      getValue: (p) => p.status,
      render: (p) => {
        const isRequester = p.requester_company_id === currentCompanyId;
        return (
          <Badge
            className={
              p.status === 'approved'
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : p.status === 'rejected'
                ? 'bg-destructive/20 text-destructive border-destructive/30'
                : p.status === 'suspended'
                ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                : p.status === 'recalled'
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
            }
          >
            {p.status === 'approved' && 'Партнерство Подтверждено'}
            {p.status === 'pending' && (isRequester ? 'Отправлен (Ожидает решения)' : 'Входящая (Ожидает вашего ответа)')}
            {p.status === 'rejected' && (isRequester ? 'Отклонен партнером' : 'Отклонен вами')}
            {p.status === 'recalled' && 'Отозван'}
            {p.status === 'suspended' && 'Приостановлен'}
          </Badge>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Дата Заявки',
      sortable: true,
      getValue: (p) => p.created_at,
      render: (p) => <span className="font-mono text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString('ru-RU')}</span>,
    },
    {
      key: 'actions',
      label: 'Действия',
      sortable: false,
      render: (p) => {
        const isRequester = p.requester_company_id === currentCompanyId;
        const partnerComp = isRequester ? p.target_company : p.requester_company;

        return (
          <div className="flex items-center justify-end space-x-2">
            {p.status === 'pending' && isRequester && (
              <Button size="sm" variant="outline" onClick={() => handleRespondRequest(p.id, 'recalled')} disabled={isPending} className="border-border text-muted-foreground hover:bg-muted text-xs min-h-[36px]">
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Отозвать заявку
              </Button>
            )}

            {p.status === 'pending' && !isRequester && (
              <>
                <Button size="sm" variant="outline" onClick={() => handleRespondRequest(p.id, 'rejected')} disabled={isPending} className="border-destructive/50 text-destructive hover:bg-destructive/10 text-xs min-h-[36px]">
                  <X className="h-3.5 w-3.5 mr-1" />
                  Отклонить
                </Button>
                <Button size="sm" onClick={() => handleRespondRequest(p.id, 'approved')} disabled={isPending} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs min-h-[36px]">
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Принять в сеть
                </Button>
              </>
            )}

            {p.status === 'approved' && (
              <Button size="sm" variant="outline" onClick={() => handleRespondRequest(p.id, 'suspended')} disabled={isPending} className="border-purple-900/50 text-purple-400 hover:bg-purple-500/10 text-xs min-h-[36px]">
                <PauseCircle className="h-3.5 w-3.5 mr-1" />
                Приостановить
              </Button>
            )}

            {p.status === 'suspended' && (
              <Button size="sm" onClick={() => handleRespondRequest(p.id, 'approved')} disabled={isPending} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs min-h-[36px]">
                <PlayCircle className="h-3.5 w-3.5 mr-1" />
                Возобновить
              </Button>
            )}

            {(p.status === 'rejected' || p.status === 'recalled') && partnerComp?.id && (
              <Button size="sm" variant="outline" onClick={() => handleSendRequest(partnerComp.id)} disabled={isPending} className="border-border text-amber-400 hover:bg-amber-500/10 text-xs min-h-[36px]">
                <Send className="h-3.5 w-3.5 mr-1" />
                Повторить запрос
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  // ---------------- CONFIG FOR TAB 3: ORGANIZATIONS CATALOG ----------------
  const filteredCatalog = useMemo(() => {
    return catalogCompanies.filter((c) => {
      return selectedIndustry === 'all' || c.industry === selectedIndustry;
    });
  }, [catalogCompanies, selectedIndustry]);

  const catalogColumns: ColumnDef<Company>[] = [
    {
      key: 'name',
      label: 'Официальное Наименование',
      sortable: true,
      getValue: (c) => c.name,
      render: (c) => (
        <div className="font-bold text-foreground text-sm flex items-center space-x-2">
          <Building2 className="h-4 w-4 text-indigo-400 flex-shrink-0" />
          <span>{c.name}</span>
        </div>
      ),
    },
    {
      key: 'inn',
      label: 'ИНН КР',
      sortable: true,
      getValue: (c) => c.inn,
      render: (c) => <span className="font-mono text-sm text-foreground font-bold">{c.inn}</span>,
    },
    {
      key: 'industry',
      label: 'Отрасль Деятельности',
      sortable: true,
      getValue: (c) => c.industry,
      render: (c) => (
        <Badge variant="outline" className="text-xs border-border bg-muted/30">
          {c.industry || 'Общий консалтинг'}
        </Badge>
      ),
    },
    {
      key: 'director_name',
      label: 'Руководитель',
      sortable: true,
      getValue: (c) => c.director_name,
      render: (c) => <span className="text-xs text-muted-foreground">{c.director_name || '—'}</span>,
    },
    {
      key: 'actions',
      label: 'Статус и Сотрудничество',
      sortable: false,
      render: (c) => {
        const existingP = partnerships.find(
          (p) =>
            (p.requester_company_id === currentCompanyId && p.target_company_id === c.id) ||
            (p.target_company_id === currentCompanyId && p.requester_company_id === c.id)
        );

        // 1. Активное партнерство (Сотрудничаем)
        if (existingP?.status === 'approved' || existingP?.status === 'accepted') {
          return (
            <div className="flex items-center space-x-2">
              <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs py-1.5 px-3">
                <Check className="h-3.5 w-3.5 mr-1" />
                Партнер (Сотрудничаем)
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTerminateModalCompany({ id: c.id, name: c.name })}
                disabled={isPending}
                className="h-8 text-xs border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 font-medium rounded-xl px-3"
                title="Прекратить сотрудничество с этой организацией"
              >
                <UserX className="h-3.5 w-3.5 mr-1" />
                Прекратить сотрудничество
              </Button>
            </div>
          );
        }

        // 2. Ожидание ответа (Заявка отправлена или получена)
        if (existingP?.status === 'pending') {
          const isOutgoing = existingP.requester_company_id === currentCompanyId;
          return (
            <div className="flex items-center space-x-2">
              {isOutgoing ? (
                <>
                  <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs py-1.5 px-3">
                    <Clock className="h-3.5 w-3.5 mr-1 animate-pulse" />
                    Заявка отправлена
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRespondRequest(existingP.id, 'cancelled')}
                    disabled={isPending}
                    className="h-8 text-xs border-slate-700 text-slate-300 hover:bg-slate-800 rounded-xl px-3"
                    title="Отменить исходящее предложение"
                  >
                    Отменить заявку
                  </Button>
                </>
              ) : (
                <>
                  <Badge className="bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs py-1.5 px-3">
                    <Clock className="h-3.5 w-3.5 mr-1 animate-pulse" />
                    Входящая заявка
                  </Badge>
                  <Button
                    size="sm"
                    onClick={() => handleRespondRequest(existingP.id, 'approved')}
                    disabled={isPending}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs h-8 rounded-xl px-3"
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Принять
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRespondRequest(existingP.id, 'rejected')}
                    disabled={isPending}
                    className="h-8 text-xs border-rose-500/40 text-rose-400 hover:bg-rose-500/10 rounded-xl px-3"
                  >
                    Отклонить
                  </Button>
                </>
              )}
            </div>
          );
        }

        // 3. Прекращено / Отклонено / Отменено (Архив)
        if (
          existingP?.status === 'rejected' ||
          existingP?.status === 'terminated' ||
          existingP?.status === 'cancelled'
        ) {
          return (
            <div className="flex items-center space-x-2">
              <Badge className="bg-slate-500/20 text-slate-400 border border-slate-500/30 text-xs py-1.5 px-3">
                В архиве / Прекращено
              </Badge>
              <Button
                size="sm"
                onClick={() => handleSendRequest(c.id)}
                disabled={isPending}
                className="bg-purple-600/80 hover:bg-purple-600 text-white font-bold text-xs h-8 rounded-xl px-3 shadow-md"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Повторить запрос
              </Button>
            </div>
          );
        }

        // 4. Нет связи (Первичный запрос)
        return (
          <Button
            size="sm"
            onClick={() => handleSendRequest(c.id)}
            disabled={isPending}
            className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs min-h-[36px] rounded-xl px-4 shadow-md"
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            Запросить сотрудничество
          </Button>
        );
      },
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка модуля Организации и Контрагенты...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Шапка модуля */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center">
            <Building2 className="h-6 w-6 mr-2 text-amber-400" />
            Справочник Контрагентов & Сеть Партнеров B2B
          </h2>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            Реестр связанных организаций Кыргызстана, входящие и исходящие заявки и публичный каталог
          </p>
        </div>

        {hasPermission(currentProfile, 'counterparties', 'create') && (
          <Button
            onClick={() => setShowCreateModal(true)}
            className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl min-h-[44px] px-5 gap-2 shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>Создать Контрагента</span>
          </Button>
        )}
      </div>

      {msg && (
        <Alert
          variant={msg.type === 'success' ? 'success' : 'destructive'}
          className={
            msg.type === 'success'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/50 bg-red-500/10 text-red-400'
          }
        >
          {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      )}

      {/* 3 ФУНДАМЕНТАЛЬНЫЕ ГЛАВНЫЕ ВКЛАДКИ МНОГОФУНКЦИОНАЛЬНОГО МОДУЛЯ */}
      <div className="flex items-center space-x-2 border-b border-border pb-2 overflow-x-auto">
        <button
          onClick={() => setMainTab('counterparties')}
          className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            mainTab === 'counterparties'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold shadow-lg shadow-amber-500/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-background'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Мои Контрагенты ({counterparties.length})</span>
        </button>

        <button
          onClick={() => setMainTab('requests')}
          className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            mainTab === 'requests'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/40 font-bold shadow-lg shadow-purple-500/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-background'
          }`}
        >
          <UserCheck className="h-4 w-4" />
          <span>Заявки на партнерство ({partnerships.length})</span>
        </button>

        <button
          onClick={() => setMainTab('catalog')}
          className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            mainTab === 'catalog'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/40 font-bold shadow-lg shadow-indigo-500/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-background'
          }`}
        >
          <Globe className="h-4 w-4" />
          <span>Каталог Организаций КР</span>
        </button>
      </div>

      {/* ------------------- ВКЛАДКА 1: КОНТРАГЕНТЫ ------------------- */}
      {mainTab === 'counterparties' && (
        <UnifiedDataGrid<Counterparty>
          gridId="counterparties_registry"
          columns={counterpartiesColumns}
          data={counterparties}
          keyExtractor={(c) => c.id}
          onRowClick={(c) => handleOpenProfileModal(c)}
          getRowActions={getCounterpartyRowActions}
          searchPlaceholder="Поиск по наименованию, ИНН, примечанию..."
          emptyMessage="Контрагенты не найдены. Создайте контрагента вручную или примите заявку в разделе «Заявки»."
          isLoading={loading}
          defaultPageSize={25}
          actionButton={
            <div className="flex items-center space-x-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSyncCounterparties}
                disabled={isPending}
                className="border-border text-muted-foreground hover:text-foreground text-xs min-h-[40px]"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isPending ? 'animate-spin' : ''}`} />
                Синхронизировать
              </Button>
              <Button
                size="sm"
                onClick={() => setShowCreateModal(true)}
                className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs min-h-[40px]"
              >
                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                + Создать Контрагента
              </Button>
            </div>
          }
        />
      )}

      {/* ------------------- ВКЛАДКА 2: ЗАЯВКИ (ВХОДЯЩИЕ И ИСХОДЯЩИЕ) ------------------- */}
      {mainTab === 'requests' && (
        <div className="space-y-4">
          {/* ПЕРЕКЛЮЧАТЕЛЬ 1 УРОВНЯ: ВХОДЯЩИЕ vs ИСХОДЯЩИЕ */}
          <div className="flex items-center space-x-2 p-1 bg-muted/60 border border-border rounded-xl w-fit">
            <button
              onClick={() => {
                setRequestDirection('incoming');
                setRequestStatusFilter('all');
              }}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all min-h-[38px] ${
                requestDirection === 'incoming'
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Download className="h-4 w-4 text-emerald-400" />
              <span>Входящие заявки ({incomingPartnerships.length})</span>
            </button>

            <button
              onClick={() => {
                setRequestDirection('outgoing');
                setRequestStatusFilter('all');
              }}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all min-h-[38px] ${
                requestDirection === 'outgoing'
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Send className="h-4 w-4 text-blue-400" />
              <span>Исходящие заявки ({outgoingPartnerships.length})</span>
            </button>
          </div>

          {/* ПЕРЕКЛЮЧАТЕЛЬ 2 УРОВНЯ: ФИЛЬТРЫ СТАТУСОВ */}
          <div className="flex items-center space-x-2 bg-background p-1.5 rounded-xl border border-border/80 overflow-x-auto">
            <button
              onClick={() => setRequestStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                requestStatusFilter === 'all' ? 'bg-muted text-foreground font-bold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Все ({activePartnershipsList.length})
            </button>

            {requestDirection === 'incoming' ? (
              <>
                <button
                  onClick={() => setRequestStatusFilter('pending')}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                    requestStatusFilter === 'pending' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40 font-bold' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Clock className="h-3.5 w-3.5 text-blue-400" />
                  <span>Ожидают вашего ответа ({incomingPartnerships.filter((p) => p.status === 'pending').length})</span>
                </button>

                <button
                  onClick={() => setRequestStatusFilter('approved')}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                    requestStatusFilter === 'approved' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Принятые вами ({incomingPartnerships.filter((p) => p.status === 'approved').length})</span>
                </button>

                <button
                  onClick={() => setRequestStatusFilter('rejected')}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                    requestStatusFilter === 'rejected' ? 'bg-red-500/20 text-red-400 border border-red-500/40 font-bold' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <X className="h-3.5 w-3.5 text-red-400" />
                  <span>Отклоненные вами ({incomingPartnerships.filter((p) => p.status === 'rejected').length})</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setRequestStatusFilter('pending')}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                    requestStatusFilter === 'pending' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40 font-bold' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Clock className="h-3.5 w-3.5 text-blue-400" />
                  <span>На рассмотрении у партнера ({outgoingPartnerships.filter((p) => p.status === 'pending').length})</span>
                </button>

                <button
                  onClick={() => setRequestStatusFilter('approved')}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                    requestStatusFilter === 'approved' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Подтверждены партнером ({outgoingPartnerships.filter((p) => p.status === 'approved').length})</span>
                </button>

                <button
                  onClick={() => setRequestStatusFilter('recalled')}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                    requestStatusFilter === 'recalled' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
                  <span>Отозваны вами ({outgoingPartnerships.filter((p) => p.status === 'recalled').length})</span>
                </button>

                <button
                  onClick={() => setRequestStatusFilter('rejected')}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                    requestStatusFilter === 'rejected' ? 'bg-red-500/20 text-red-400 border border-red-500/40 font-bold' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <X className="h-3.5 w-3.5 text-red-400" />
                  <span>Отклонены партнером ({outgoingPartnerships.filter((p) => p.status === 'rejected').length})</span>
                </button>
              </>
            )}
          </div>

          <UnifiedDataGrid<any>
            gridId="partnerships_registry"
            columns={partnershipsColumns}
            data={filteredPartnerships}
            keyExtractor={(p) => p.id}
            getRowActions={getPartnershipRowActions}
            searchPlaceholder="Поиск по организации, статусу..."
            emptyMessage="Заявки с выбранным статусом отсутствуют."
            isLoading={loading}
            defaultPageSize={25}
          />
        </div>
      )}

      {/* ------------------- ВКЛАДКА 3: КАТАЛОГ ОРГАНИЗАЦИЙ ------------------- */}
      {mainTab === 'catalog' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-background/40 p-4 rounded-2xl border border-border">
            <div>
              <h3 className="text-base font-bold text-foreground">Каталог Зарегистрированных Организаций</h3>
              <p className="text-xs text-muted-foreground">Поиск партнеров по категориям и отраслям бизнеса</p>
            </div>

            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={selectedIndustry}
                onChange={(e) => setSelectedIndustry(e.target.value)}
                className="bg-background border border-border text-foreground text-xs rounded-xl px-3 py-2 min-h-[40px]"
              >
                <option value="all">Все Отрасли ({catalogCompanies.length})</option>
                {INDUSTRIES.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <UnifiedDataGrid<Company>
            gridId="catalog_registry"
            columns={catalogColumns}
            data={filteredCatalog}
            keyExtractor={(c) => c.id}
            onRowClick={(c) => handleOpenProfileById(c.id)}
            getRowActions={getCatalogRowActions}
            searchPlaceholder="Поиск по названию организации, ИНН, руководителю..."
            emptyMessage="Организации в выбранной категории не найдены."
            isLoading={loading}
            defaultPageSize={25}
          />
        </div>
      )}

      {/* ------------------- ЕДИНООБРАЗНОЕ МОДАЛЬНОЕ ОКНО ПРОСМОТРА УСТАВНЫХ СКАНОВ R2 (UnifiedFormModal) ------------------- */}
      <UnifiedFormModal
        isOpen={!!profileModal}
        onClose={() => setProfileModal(null)}
        title={profileModal?.counterparty.name || 'Организация'}
        subtitle={`ИНН: ${profileModal?.counterparty.inn || '—'} • Официальные данные`}
        mode="view"
      >
        {profileModal && (() => {
          const privacy = profileModal.companyDetails?.privacy_settings || { show_phone: true, show_email: true, show_address: true };
          const rawPhone = profileModal.companyDetails?.phone || profileModal.counterparty.phone;
          const cleanPhone = rawPhone?.replace(/[^0-9]/g, '');
          const rawEmail = profileModal.companyDetails?.email || profileModal.counterparty.email;
          const rawAddress = profileModal.companyDetails?.legal_address || profileModal.companyDetails?.address;

          return (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-background/60 p-4 rounded-xl border border-border text-xs">
                <div>
                  <span className="text-muted-foreground block">ФИО Руководителя:</span>
                  <span className="font-semibold text-foreground">{profileModal.companyDetails?.director_name || '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Отрасль компании:</span>
                  <span className="font-semibold text-amber-400">{profileModal.companyDetails?.industry || 'Услуги / Торговля'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Телефон:</span>
                  {privacy.show_phone && rawPhone ? (
                    <span className="font-mono font-semibold text-foreground">{rawPhone}</span>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">Информация скрыта</Badge>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground block">E-mail:</span>
                  {privacy.show_email && rawEmail ? (
                    <span className="font-mono text-muted-foreground">{rawEmail}</span>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">Информация скрыта</Badge>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground block">Юридический адрес:</span>
                  {privacy.show_address && rawAddress ? (
                    <span className="font-semibold text-foreground">{rawAddress}</span>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">Информация скрыта</Badge>
                  )}
                </div>
              </div>

              {/* Быстрые действия вызова WhatsApp / Позвонить */}
              {privacy.show_phone && cleanPhone && (
                <div className="grid grid-cols-2 gap-3">
                  <a href={`https://wa.me/${cleanPhone}`} target="_blank" rel="noreferrer" className="w-full">
                    <Button variant="outline" className="w-full border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-xs font-semibold gap-2 min-h-[38px]">
                      <MessageCircle className="w-4 h-4" />
                      <span>WhatsApp</span>
                    </Button>
                  </a>
                  <a href={`tel:${rawPhone}`} className="w-full">
                    <Button variant="outline" className="w-full border-blue-500/30 text-blue-400 hover:bg-blue-500/10 text-xs font-semibold gap-2 min-h-[38px]">
                      <Phone className="w-4 h-4" />
                      <span>Позвонить</span>
                    </Button>
                  </a>
                </div>
              )}

            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
                Приложенные Учредительные Документы (R2)
              </h4>

              {profileModal.statutoryFiles.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-xs bg-background/40 rounded-xl border border-border">
                  Учредительные файлы пока не загружены
                </div>
              ) : (
                <div className="space-y-2">
                  {profileModal.statutoryFiles.map((file) => (
                    <div key={file.id} className="p-3 bg-background/60 rounded-xl border border-border flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-3">
                        <FileText className="h-4 w-4 text-indigo-400" />
                        <div>
                          <p className="font-semibold text-foreground">{file.file_name}</p>
                          <p className="text-[11px] text-muted-foreground">{file.description || 'Скан'} • {formatBytes(file.size_bytes)}</p>
                        </div>
                      </div>

                      {file.downloadUrl && (
                        <a href={file.downloadUrl} target="_blank" rel="noopener noreferrer" download className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs">
                          <Download className="h-3.5 w-3.5" />
                          <span>Скачать</span>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
      </UnifiedFormModal>

      {/* МОДАЛЬНОЕ ОКНО РУЧНОГО СОЗДАНИЯ (UnifiedFormModal) */}
      <UnifiedFormModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Создать Контрагента (с прикреплением)"
        subtitle="Заполнение реквизитов и прикрепление скана R2"
        mode="create"
        onSubmit={handleManualCreateWithFile}
        isSubmitting={uploadingFile || isPending}
        submitText="Сохранить"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Наименование организации / ИП *</Label>
            <Input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="ОсОО ВекторТрейд..."
              required
              className="bg-background border-border text-foreground min-h-[44px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">ИНН КР (14 цифр) *</Label>
            <Input
              value={createInn}
              onChange={(e) => setCreateInn(e.target.value.replace(/\D/g, '').slice(0, 14))}
              placeholder="01203202410145"
              maxLength={14}
              required
              className="bg-background border-border text-foreground font-mono min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">E-mail</Label>
              <Input
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="info@vektor.kg"
                className="bg-background border-border text-foreground min-h-[44px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Телефон</Label>
              <Input
                value={createPhone}
                onChange={(e) => setCreatePhone(e.target.value)}
                placeholder="+996 550 123456"
                className="bg-background border-border text-foreground font-mono min-h-[44px]"
              />
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3 rounded-xl bg-background border border-border">
            <input
              type="checkbox"
              id="is_vat_payer"
              checked={createIsVat}
              onChange={(e) => setCreateIsVat(e.target.checked)}
              className="h-5 w-5 rounded bg-background text-amber-500"
            />
            <Label htmlFor="is_vat_payer" className="text-xs text-amber-500 font-bold cursor-pointer">
              Плательщик НДС (12%)
            </Label>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Учредительный документ / Скан (R2)</Label>
            <div className="p-3 bg-background border border-dashed border-border rounded-xl flex items-center justify-between">
              <div className="flex items-center space-x-2 truncate">
                <Paperclip className="h-4 w-4 text-indigo-400 flex-shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {selectedFile ? selectedFile.name : 'Выберите файл (PDF / PNG)...'}
                </span>
              </div>
              <input
                type="file"
                id="counterparty_file"
                accept="image/*,application/pdf"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => document.getElementById('counterparty_file')?.click()}
                className="text-xs border-border text-muted-foreground min-h-[32px] px-3 hover:text-foreground"
              >
                Обзор
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Внутреннее примечание</Label>
            <Input
              value={createComment}
              onChange={(e) => setCreateComment(e.target.value)}
              placeholder="Поставщик ГСМ..."
              className="bg-background border-border text-foreground min-h-[44px]"
            />
          </div>
        </div>
      </UnifiedFormModal>

      {/* МОДАЛЬНОЕ ОКНО ПОДТВЕРЖДЕНИЯ ПРЕКРАЩЕНИЯ СОТРУДНИЧЕСТВА */}
      {terminateModalCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-400">
              <AlertCircle className="h-6 w-6" />
              <h3 className="text-lg font-bold text-foreground">Прекращение сотрудничества</h3>
            </div>
            <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
              Вы уверены, что хотите прекратить сотрудничество с <strong className="text-foreground">ОсОО «{terminateModalCompany.name}»</strong>? 
              Это разровет партнерскую связь и ограничит совместный доступ к первичным документам.
            </p>
            <div className="flex items-center justify-end space-x-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setTerminateModalCompany(null)}
                className="rounded-xl text-xs min-h-[40px]"
              >
                Отмена
              </Button>
              <Button
                onClick={() => {
                  const targetId = terminateModalCompany.id;
                  setTerminateModalCompany(null);
                  handleTerminatePartnership(targetId);
                }}
                disabled={isPending}
                className="bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs min-h-[40px] shadow-lg shadow-rose-600/20"
              >
                Да, прекратить сотрудничество
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
