'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Users,
  Building2,
  BarChart3,
  Loader2,
  X,
  Send,
  Inbox,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  UserCheck,
  Globe,
  UserPlus,
  UserX,
  Clock,
  ChevronLeft,
  ChevronRight,
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
  Shield,
  Briefcase,
  Edit2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  sendPartnershipRequestAction,
  respondToPartnershipRequestAction,
  terminatePartnershipAction,
  updateCounterpartyCommentAction,
  getCounterpartyDetailsAndFilesAction,
  syncPartnershipCounterpartiesAction,
  createManualCounterpartyAction,
} from './actions';
import { INDUSTRIES } from '@/types/database.types';
import type { Counterparty, Company, Document, DocumentFile, PartnershipStatus } from '@/types/database.types';
import imageCompression from 'browser-image-compression';

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

const ITEMS_PER_PAGE = 10;

export default function CounterpartiesPage() {
  const searchParams = useSearchParams();
  const searchFromUrl = searchParams.get('search') || '';

  // 3 Главные Вкладки верхнего уровня: 'counterparties' | 'requests' | 'catalog'
  const [mainTab, setMainTab] = useState<'counterparties' | 'requests' | 'catalog'>('counterparties');

  // Вкладка «Заявки»: 5 статусов
  const [requestStatusFilter, setRequestStatusFilter] = useState<'all' | PartnershipStatus>('all');

  // Вкладка «Каталог Организаций»: Фильтр по категориям/отраслям
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');

  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [partnerships, setPartnerships] = useState<any[]>([]);
  const [catalogCompanies, setCatalogCompanies] = useState<Company[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Состояние пагинации
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState(searchFromUrl);

  // Редактирование примечания
  const [editingCounterpartyId, setEditingCounterpartyId] = useState<string | null>(null);
  const [editComment, setEditComment] = useState('');

  // 1. Модалка отчета
  const [selectedPartnerReport, setSelectedPartnerReport] = useState<PartnerReport | null>(null);

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

  const loadData = async () => {
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

    if (myCompanyId) {
      // Авто-синхронизация
      await syncPartnershipCounterpartiesAction();

      // 1. Активные контрагенты
      const { data: cData } = await supabase
        .from('counterparties')
        .select('*')
        .eq('company_id', myCompanyId)
        .order('name');

      if (cData) setCounterparties(cData as Counterparty[]);

      // 2. Заявки на партнерство
      const { data: pData } = await supabase
        .from('company_partnerships')
        .select('*, requester_company:companies!requester_company_id(*), target_company:companies!target_company_id(*)')
        .or(`requester_company_id.eq.${myCompanyId},target_company_id.eq.${myCompanyId}`)
        .order('created_at', { ascending: false });

      if (pData) setPartnerships(pData);

      // 3. Каталог всех компаний (исключая свою)
      const { data: compData } = await supabase
        .from('companies')
        .select('*')
        .neq('id', myCompanyId)
        .order('name');

      if (compData) setCatalogCompanies(compData as Company[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Сброс пагинации
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, mainTab, requestStatusFilter, selectedIndustry]);

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

      // Клиентское сжатие и загрузка файла в Cloudflare R2 при наличии прикрепления
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

        // Запрашиваем Presigned URL для R2
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
    startTransition(async () => {
      const res = await respondToPartnershipRequestAction(partnershipId, status);
      if (res.success) {
        let statusText = 'Статус заявки обновлен.';
        if (status === 'approved') statusText = 'Партнерство подтверждено! Контрагент добавлен в ваш список.';
        if (status === 'rejected') statusText = 'Заявка отменена.';
        if (status === 'recalled') statusText = 'Заявка успешно отозвана.';
        if (status === 'suspended') statusText = 'Партнерство временно приостановлено.';

        setMsg({ type: 'success', text: statusText });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка обработки заявки' });
      }
    });
  };

  const handleTerminatePartnership = (counterpartyId: string) => {
    if (!confirm('Вы действительно хотите прекратить сотрудничество с этим контрагентом?')) {
      return;
    }

    setMsg(null);
    startTransition(async () => {
      const res = await terminatePartnershipAction(counterpartyId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Сотрудничество прекращено. Статус партнерства переведен в Архив.' });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка прекращения сотрудничества' });
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
        .from('document_files')
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

  // ФИЛЬТРАЦИЯ 1: Контрагенты
  const filteredCounterparties = counterparties.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.inn.includes(searchQuery) ||
      (c.comment && c.comment.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // ФИЛЬТРАЦИЯ 2: Заявки (По 5 статусам)
  const filteredPartnerships = partnerships.filter((p) => {
    const partnerComp = p.requester_company_id === currentCompanyId ? p.target_company : p.requester_company;
    const nameMatch = partnerComp?.name?.toLowerCase().includes(searchQuery.toLowerCase()) || partnerComp?.inn?.includes(searchQuery);

    if (!nameMatch) return false;
    if (requestStatusFilter === 'all') return true;

    // Определение статусов: pending (Отправлен), recalled (Отозван), approved (Подтверждён), rejected (Отменён), suspended (Приостановлен)
    if (requestStatusFilter === 'pending') return p.status === 'pending';
    if (requestStatusFilter === 'approved') return p.status === 'approved';
    if (requestStatusFilter === 'rejected') return p.status === 'rejected';
    if (requestStatusFilter === 'recalled') return p.status === 'recalled';
    if (requestStatusFilter === 'suspended') return p.status === 'suspended';

    return true;
  });

  // ФИЛЬТРАЦИЯ 3: Каталог Организаций по Категориям/Отраслям
  const filteredCatalog = catalogCompanies.filter((c) => {
    const searchMatch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.inn.includes(searchQuery);
    const industryMatch = selectedIndustry === 'all' || c.industry === selectedIndustry;
    return searchMatch && industryMatch;
  });

  // Пагинации
  const totalPagesCounterparties = Math.ceil(filteredCounterparties.length / ITEMS_PER_PAGE) || 1;
  const paginatedCounterparties = filteredCounterparties.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const totalPagesPartnerships = Math.ceil(filteredPartnerships.length / ITEMS_PER_PAGE) || 1;
  const paginatedPartnerships = filteredPartnerships.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const totalPagesCatalog = Math.ceil(filteredCatalog.length / ITEMS_PER_PAGE) || 1;
  const paginatedCatalog = filteredCatalog.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Заголовок страницы */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center">
            <Building2 className="h-6 w-6 mr-2.5 text-amber-400" />
            Организации и Партнерство
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Управление контрагентами, статусными заявками на сотрудничество и каталогом компаний КР
          </p>
        </div>

        {/* Панель поиска */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Поиск по наименованию, ИНН..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-slate-900 border-slate-800 text-xs pl-9 min-h-[40px]"
          />
        </div>
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
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setMainTab('counterparties')}
          className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            mainTab === 'counterparties'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold shadow-lg shadow-amber-500/10'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Контрагенты ({counterparties.length})</span>
        </button>

        <button
          onClick={() => setMainTab('requests')}
          className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            mainTab === 'requests'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/40 font-bold shadow-lg shadow-purple-500/10'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <UserCheck className="h-4 w-4" />
          <span>Заявки ({partnerships.length})</span>
        </button>

        <button
          onClick={() => setMainTab('catalog')}
          className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            mainTab === 'catalog'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/40 font-bold shadow-lg shadow-indigo-500/10'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Globe className="h-4 w-4" />
          <span>Каталог Организаций</span>
        </button>
      </div>

      {/* ------------------- ВКЛАДКА 1: КОНТРАГЕНТЫ ------------------- */}
      {mainTab === 'counterparties' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-300">Реестр Активных Контрагентов</h3>
            <div className="flex items-center space-x-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSyncCounterparties}
                disabled={isPending}
                className="border-slate-800 text-slate-300 text-xs min-h-[40px]"
                title="Сверка баз данных"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isPending ? 'animate-spin' : ''}`} />
                Синхронизировать БД
              </Button>
              <Button
                size="sm"
                onClick={() => setShowCreateModal(true)}
                className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs min-h-[40px]"
              >
                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                Создать Контрагента (с прикреплением)
              </Button>
            </div>
          </div>

          {/* ПК ТАБЛИЦА */}
          <Card className="hidden md:block bg-slate-900/40 border-slate-800 overflow-hidden shadow-2xl">
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center p-12 text-slate-400">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Загрузка прикрепленных контрагентов...</span>
                </div>
              ) : paginatedCounterparties.length === 0 ? (
                <div className="p-12 text-center text-slate-500 text-xs">
                  Контрагенты не найдены. Создайте контрагента вручную или примите заявку в разделе «Заявки».
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-950/60">
                    <TableRow>
                      <TableHead>Официальное Наименование</TableHead>
                      <TableHead>ИНН КР</TableHead>
                      <TableHead>Email / Телефон</TableHead>
                      <TableHead>НДС 12%</TableHead>
                      <TableHead>Примечание</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedCounterparties.map((c) => (
                      <TableRow key={c.id} className="hover:bg-slate-800/40 transition-colors">
                        <TableCell>
                          <div className="font-semibold text-white text-sm flex items-center space-x-1.5">
                            <Building2 className="h-4 w-4 text-amber-400 flex-shrink-0" />
                            <span>{c.name}</span>
                          </div>
                        </TableCell>

                        <TableCell className="font-mono text-sm text-slate-300 font-bold">{c.inn}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-400">
                          {c.email || `contact@${c.inn}.kg`}
                          {c.phone && <p className="text-[11px] text-slate-500">{c.phone}</p>}
                        </TableCell>

                        <TableCell>
                          <Badge variant="outline" className={c.is_vat_payer ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-slate-700 text-slate-400'}>
                            {c.is_vat_payer ? 'Плательщик 12%' : 'Без НДС'}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          {editingCounterpartyId === c.id ? (
                            <div className="flex items-center space-x-2">
                              <Input
                                value={editComment}
                                onChange={(e) => setEditComment(e.target.value)}
                                placeholder="Примечание..."
                                className="h-8 text-xs bg-slate-950 border-slate-800 text-slate-100"
                              />
                              <Button
                                size="sm"
                                onClick={() => handleSaveComment(c.id)}
                                disabled={isPending}
                                className="h-8 px-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                              >
                                ОК
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingCounterpartyId(null)}
                                className="h-8 px-2 text-slate-400"
                              >
                                X
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center space-x-2 text-xs text-slate-300">
                              <span className="truncate max-w-[150px]">{c.comment || '—'}</span>
                              <button
                                onClick={() => {
                                  setEditingCounterpartyId(c.id);
                                  setEditComment(c.comment || '');
                                }}
                                className="text-slate-500 hover:text-amber-400 p-1"
                                title="Редактировать примечание"
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenProfileModal(c)}
                              disabled={profileLoading}
                              className="border-slate-700 text-slate-200 hover:bg-slate-800 text-xs min-h-[36px]"
                              title="Просмотр уставных документов R2 и данных"
                            >
                              <FolderOpen className="h-3.5 w-3.5 mr-1 text-indigo-400" />
                              Сканы R2
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenPartnerReport(c)}
                              className="border-slate-800 text-amber-400 hover:bg-amber-500/10 text-xs min-h-[36px]"
                            >
                              <BarChart3 className="h-3.5 w-3.5 mr-1" />
                              Отчет
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleTerminatePartnership(c.id)}
                              disabled={isPending}
                              className="border-red-900/40 text-xs text-red-400 hover:bg-red-500/10 min-h-[36px]"
                            >
                              <UserX className="h-3.5 w-3.5 mr-1" />
                              Удалить
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* МОБИЛЬНЫЕ КАРТОЧКИ */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {paginatedCounterparties.map((c) => (
              <Card key={c.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-white text-sm flex items-center">
                      <Building2 className="h-4 w-4 mr-1.5 text-amber-400 flex-shrink-0" />
                      {c.name}
                    </h4>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">ИНН: {c.inn}</p>
                  </div>
                  <Badge variant="outline" className={c.is_vat_payer ? 'border-emerald-500/30 text-emerald-400 text-[10px]' : 'border-slate-700 text-slate-400 text-[10px]'}>
                    {c.is_vat_payer ? 'НДС 12%' : 'Без НДС'}
                  </Badge>
                </div>

                <div className="flex items-center space-x-2 pt-2 border-t border-slate-800/80">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenProfileModal(c)}
                    disabled={profileLoading}
                    className="flex-1 border-slate-800 text-indigo-300 text-xs min-h-[44px]"
                  >
                    <FolderOpen className="h-3.5 w-3.5 mr-1 text-indigo-400" />
                    Сканы R2
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenPartnerReport(c)}
                    className="flex-1 border-slate-800 text-amber-400 text-xs min-h-[44px]"
                  >
                    <BarChart3 className="h-3.5 w-3.5 mr-1" />
                    Отчет
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTerminatePartnership(c.id)}
                    disabled={isPending}
                    className="border-red-900/40 text-xs text-red-400 min-h-[44px] px-3"
                  >
                    <UserX className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {/* Пагинация */}
          {totalPagesCounterparties > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400 font-mono">
                Страница <span className="text-white font-bold">{currentPage}</span> из <span className="text-white font-bold">{totalPagesCounterparties}</span>
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
                  onClick={() => setCurrentPage((p) => Math.min(totalPagesCounterparties, p + 1))}
                  disabled={currentPage === totalPagesCounterparties}
                  className="border-slate-800 text-slate-300 min-h-[40px] text-xs"
                >
                  Вперед
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------- ВКЛАДКА 2: ЗАЯВКИ (5 СТАТУСОВ) ------------------- */}
      {mainTab === 'requests' && (
        <div className="space-y-4">
          {/* ФИЛЬТР ПО 5 СТАТУСАМ ЗАЯВОК */}
          <div className="flex items-center space-x-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800/80 overflow-x-auto">
            <button
              onClick={() => setRequestStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                requestStatusFilter === 'all'
                  ? 'bg-slate-800 text-white font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Все ({partnerships.length})
            </button>

            <button
              onClick={() => setRequestStatusFilter('pending')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                requestStatusFilter === 'pending'
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="h-3.5 w-3.5 text-blue-400" />
              <span>Отправлен ({partnerships.filter((p) => p.status === 'pending').length})</span>
            </button>

            <button
              onClick={() => setRequestStatusFilter('approved')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                requestStatusFilter === 'approved'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Подтверждён ({partnerships.filter((p) => p.status === 'approved').length})</span>
            </button>

            <button
              onClick={() => setRequestStatusFilter('recalled')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                requestStatusFilter === 'recalled'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
              <span>Отозван ({partnerships.filter((p) => p.status === 'recalled').length})</span>
            </button>

            <button
              onClick={() => setRequestStatusFilter('rejected')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                requestStatusFilter === 'rejected'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/40 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <X className="h-3.5 w-3.5 text-red-400" />
              <span>Отменён ({partnerships.filter((p) => p.status === 'rejected').length})</span>
            </button>

            <button
              onClick={() => setRequestStatusFilter('suspended')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                requestStatusFilter === 'suspended'
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <PauseCircle className="h-3.5 w-3.5 text-purple-400" />
              <span>Приостановлен ({partnerships.filter((p) => p.status === 'suspended').length})</span>
            </button>
          </div>

          {/* СЕТКА / ТАБЛИЦА ЗАЯВОК */}
          {paginatedPartnerships.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800">
              Заявки с выбранным статусом отсутствуют.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {paginatedPartnerships.map((p) => {
                const isRequester = p.requester_company_id === currentCompanyId;
                const partnerComp = isRequester ? p.target_company : p.requester_company;

                return (
                  <Card key={p.id} className="bg-slate-900/60 border-slate-800 p-5 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <Badge
                            className={
                              p.status === 'approved'
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                : p.status === 'rejected'
                                ? 'bg-red-500/20 text-red-400 border-red-500/30'
                                : p.status === 'suspended'
                                ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                                : p.status === 'recalled'
                                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                            }
                          >
                            {p.status === 'approved' && 'Подтверждён'}
                            {p.status === 'pending' && (isRequester ? 'Отправлен' : 'Входящая')}
                            {p.status === 'rejected' && 'Отменён'}
                            {p.status === 'recalled' && 'Отозван'}
                            {p.status === 'suspended' && 'Приостановлен'}
                          </Badge>

                          <span className="text-[11px] text-slate-400 font-mono">
                            {new Date(p.created_at).toLocaleDateString('ru-RU')}
                          </span>
                        </div>

                        <h4 className="font-bold text-white text-base mt-2 flex items-center">
                          <Building2 className="h-4 w-4 mr-2 text-amber-400" />
                          {partnerComp?.name || 'Организация'}
                        </h4>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">ИНН: {partnerComp?.inn || '—'}</p>
                      </div>
                    </div>

                    {/* ДЕЙСТВИЯ ПО СТАТУСАМ */}
                    <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                      {p.status === 'pending' && isRequester && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRespondRequest(p.id, 'recalled')}
                          disabled={isPending}
                          className="border-amber-900/50 text-amber-400 hover:bg-amber-500/10 text-xs min-h-[40px]"
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          Отозвать заявку
                        </Button>
                      )}

                      {p.status === 'pending' && !isRequester && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRespondRequest(p.id, 'rejected')}
                            disabled={isPending}
                            className="border-red-900/50 text-red-400 hover:bg-red-500/10 text-xs min-h-[40px]"
                          >
                            <X className="h-3.5 w-3.5 mr-1" />
                            Отклонить
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleRespondRequest(p.id, 'approved')}
                            disabled={isPending}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs min-h-[40px]"
                          >
                            <Check className="h-3.5 w-3.5 mr-1" />
                            Принять
                          </Button>
                        </>
                      )}

                      {p.status === 'approved' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRespondRequest(p.id, 'suspended')}
                          disabled={isPending}
                          className="border-purple-900/50 text-purple-400 hover:bg-purple-500/10 text-xs min-h-[40px]"
                        >
                          <PauseCircle className="h-3.5 w-3.5 mr-1" />
                          Приостановить
                        </Button>
                      )}

                      {p.status === 'suspended' && (
                        <Button
                          size="sm"
                          onClick={() => handleRespondRequest(p.id, 'approved')}
                          disabled={isPending}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs min-h-[40px]"
                        >
                          <PlayCircle className="h-3.5 w-3.5 mr-1" />
                          Возобновить
                        </Button>
                      )}

                      {(p.status === 'rejected' || p.status === 'recalled') && partnerComp?.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSendRequest(partnerComp.id)}
                          disabled={isPending}
                          className="border-slate-800 text-amber-400 hover:bg-amber-500/10 text-xs min-h-[40px]"
                        >
                          <Send className="h-3.5 w-3.5 mr-1" />
                          Отправить повторно
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ------------------- ВКЛАДКА 3: КАТАЛОГ ОРГАНИЗАЦИЙ ------------------- */}
      {mainTab === 'catalog' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/40 p-4 rounded-2xl border border-slate-800">
            <div>
              <h3 className="text-base font-bold text-white">Каталог Зарегистрированных Организаций</h3>
              <p className="text-xs text-slate-400">Поиск партнеров по категориям и отраслям бизнеса</p>
            </div>

            {/* Фильтр по Категориям / Отраслям */}
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <select
                value={selectedIndustry}
                onChange={(e) => setSelectedIndustry(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-white text-xs rounded-xl px-3 py-2 min-h-[40px]"
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

          {/* ПК ТАБЛИЦА КАТАЛОГА */}
          <Card className="hidden md:block bg-slate-900/40 border-slate-800 overflow-hidden shadow-2xl">
            <CardContent className="p-0">
              {paginatedCatalog.length === 0 ? (
                <div className="p-12 text-center text-slate-500 text-xs">
                  Организации в данной категории не найдены.
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-950/60">
                    <TableRow>
                      <TableHead>Официальное Наименование</TableHead>
                      <TableHead>ИНН КР</TableHead>
                      <TableHead>Отрасль</TableHead>
                      <TableHead>Руководитель</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedCatalog.map((c) => {
                      const existingPartnership = partnerships.find(
                        (p) =>
                          (p.requester_company_id === currentCompanyId && p.target_company_id === c.id) ||
                          (p.requester_company_id === c.id && p.target_company_id === currentCompanyId)
                      );
                      const isAlreadyPartner = counterparties.some((cp) => cp.inn === c.inn);

                      return (
                        <TableRow key={c.id} className="hover:bg-slate-800/40 transition-colors">
                          <TableCell>
                            <div className="font-semibold text-white text-sm flex items-center space-x-1.5">
                              <Building2 className="h-4 w-4 text-amber-400 flex-shrink-0" />
                              <span>{c.name}</span>
                            </div>
                          </TableCell>

                          <TableCell className="font-mono text-sm text-slate-300 font-bold">{c.inn}</TableCell>
                          
                          <TableCell>
                            <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 text-[10px]">
                              {c.industry || 'Организация КР'}
                            </Badge>
                          </TableCell>

                          <TableCell className="text-xs text-slate-300">{c.director_name || '—'}</TableCell>

                          <TableCell className="text-right">
                            {isAlreadyPartner ? (
                              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                В Контрагентах
                              </Badge>
                            ) : existingPartnership?.status === 'pending' ? (
                              <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">
                                <Clock className="h-3.5 w-3.5 mr-1" />
                                Заявка отправлена
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => handleSendRequest(c.id)}
                                disabled={isPending}
                                className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs min-h-[36px]"
                              >
                                <Send className="h-3.5 w-3.5 mr-1.5" />
                                Запросить сотрудничество
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* МОБИЛЬНЫЕ КАРТОЧКИ КАТАЛОГА */}
          <div className="grid grid-cols-1 gap-4 md:hidden">
            {paginatedCatalog.map((c) => {
              const existingPartnership = partnerships.find(
                (p) =>
                  (p.requester_company_id === currentCompanyId && p.target_company_id === c.id) ||
                  (p.requester_company_id === c.id && p.target_company_id === currentCompanyId)
              );
              const isAlreadyPartner = counterparties.some((cp) => cp.inn === c.inn);

              return (
                <Card key={c.id} className="bg-slate-900/50 border-slate-800 p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 text-[10px]">
                      {c.industry || 'Организация КР'}
                    </Badge>
                  </div>

                  <h4 className="font-bold text-white text-base flex items-center">
                    <Building2 className="h-4 w-4 mr-2 text-amber-400 flex-shrink-0" />
                    {c.name}
                  </h4>

                  <p className="text-xs text-slate-400 font-mono">ИНН: {c.inn}</p>

                  <div className="pt-3 border-t border-slate-800">
                    {isAlreadyPartner ? (
                      <Badge className="w-full justify-center py-2 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        В списке Контрагентов
                      </Badge>
                    ) : existingPartnership?.status === 'pending' ? (
                      <Badge className="w-full justify-center py-2 bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">
                        <Clock className="h-3.5 w-3.5 mr-1" />
                        Заявка отправлена
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleSendRequest(c.id)}
                        disabled={isPending}
                        className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs min-h-[44px]"
                      >
                        <Send className="h-3.5 w-3.5 mr-1.5" />
                        Запросить сотрудничество
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ------------------- МОДАЛЬНОЕ ОКНО ПРОСМОТРА СКАНОВ R2 И РЕКВИЗИТОВ ------------------- */}
      {profileModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-2xl bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <CardHeader className="p-4 md:p-6 border-b border-slate-800 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base md:text-lg font-bold text-white flex items-center">
                  <Building2 className="h-5 w-5 mr-2 text-amber-400" />
                  {profileModal.counterparty.name}
                </CardTitle>
                <CardDescription className="text-xs text-slate-400 font-mono mt-0.5">
                  ИНН: {profileModal.counterparty.inn} • Организация
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setProfileModal(null)}
                className="h-8 w-8 p-0 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </Button>
            </CardHeader>

            <CardContent className="p-4 md:p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800 text-xs">
                <div>
                  <span className="text-slate-500 block">ФИО Руководителя:</span>
                  <span className="font-semibold text-white">
                    {profileModal.companyDetails?.director_name || '—'}
                  </span>
                </div>

                <div>
                  <span className="text-slate-500 block">Отрасль компании:</span>
                  <span className="font-semibold text-amber-400">
                    {profileModal.companyDetails?.industry || 'Услуги / Торговля'}
                  </span>
                </div>

                <div>
                  <span className="text-slate-500 block">Юридический адрес:</span>
                  <span className="font-semibold text-white">
                    {profileModal.companyDetails?.legal_address || 'Кыргызстан'}
                  </span>
                </div>

                <div>
                  <span className="text-slate-500 block">E-mail:</span>
                  <span className="font-mono text-slate-300">
                    {profileModal.companyDetails?.email || profileModal.counterparty.email || '—'}
                  </span>
                </div>
              </div>

              {/* Сканы R2 */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">
                  Приложенные Учредительные Документы (R2)
                </h4>

                {profileModal.statutoryFiles.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs bg-slate-950/40 rounded-xl border border-slate-800">
                    Учредительные файлы пока не загружены
                  </div>
                ) : (
                  <div className="space-y-2">
                    {profileModal.statutoryFiles.map((file) => (
                      <div
                        key={file.id}
                        className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center space-x-3">
                          <FileText className="h-4 w-4 text-indigo-400" />
                          <div>
                            <p className="font-semibold text-white">{file.file_name}</p>
                            <p className="text-[11px] text-slate-400">{file.description || 'Скан'} • {file.file_size}</p>
                          </div>
                        </div>

                        {file.downloadUrl && (
                          <a
                            href={file.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            download
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Скачать</span>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ------------------- МОДАЛЬНОЕ ОКНО РУЧНОГО СОЗДАНИЯ С ПРИКРЕПЛЕНИЕМ ФАЙЛА R2 ------------------- */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-1 sm:hidden opacity-80" />
            <h3 className="text-base sm:text-lg font-bold text-white flex items-center">
              <UserPlus className="h-5 w-5 mr-2 text-amber-400" />
              Создать Контрагента (с прикреплением)
            </h3>

            <form onSubmit={handleManualCreateWithFile} className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-300">Наименование организации / ИП *</Label>
                <Input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="ОсОО ВекторТрейд..."
                  required
                  className="bg-slate-950 border-slate-800 text-white min-h-[44px]"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-slate-300">ИНН КР (14 цифр) *</Label>
                <Input
                  value={createInn}
                  onChange={(e) => setCreateInn(e.target.value.replace(/\D/g, '').slice(0, 14))}
                  placeholder="01203202410145"
                  maxLength={14}
                  required
                  className="bg-slate-950 border-slate-800 text-white font-mono min-h-[44px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-300">E-mail</Label>
                  <Input
                    type="email"
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    placeholder="info@vektor.kg"
                    className="bg-slate-950 border-slate-800 text-white min-h-[44px]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-300">Телефон</Label>
                  <Input
                    value={createPhone}
                    onChange={(e) => setCreatePhone(e.target.value)}
                    placeholder="+996 550 123456"
                    className="bg-slate-950 border-slate-800 text-white font-mono min-h-[44px]"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
                <input
                  type="checkbox"
                  id="is_vat_payer"
                  checked={createIsVat}
                  onChange={(e) => setCreateIsVat(e.target.checked)}
                  className="h-5 w-5 rounded bg-slate-900 text-amber-500"
                />
                <Label htmlFor="is_vat_payer" className="text-xs text-amber-400 font-bold cursor-pointer">
                  Плательщик НДС (12%)
                </Label>
              </div>

              {/* ЗОНА ПРИКРЕПЛЕНИЯ ФАЙЛА / СКАНА В CLOUDFLARE R2 */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-300">Учредительный документ / Скан (R2)</Label>
                <div className="p-3 bg-slate-950 border border-dashed border-slate-800 rounded-xl flex items-center justify-between">
                  <div className="flex items-center space-x-2 truncate">
                    <Paperclip className="h-4 w-4 text-indigo-400 flex-shrink-0" />
                    <span className="text-xs text-slate-300 truncate">
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
                    className="text-xs border-slate-800 text-slate-300 min-h-[32px] px-3"
                  >
                    Обзор
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-slate-300">Внутреннее примечание</Label>
                <Input
                  value={createComment}
                  onChange={(e) => setCreateComment(e.target.value)}
                  placeholder="Поставщик ГСМ..."
                  className="bg-slate-950 border-slate-800 text-white min-h-[44px]"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowCreateModal(false)}
                  className="min-h-[44px]"
                >
                  Отмена
                </Button>
                <Button
                  type="submit"
                  disabled={uploadingFile || isPending}
                  className="bg-amber-600 hover:bg-amber-500 text-white font-bold min-h-[44px] px-6"
                >
                  {uploadingFile || isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО ОТЧЕТА */}
      {selectedPartnerReport && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-2xl bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <CardHeader className="p-4 md:p-6 border-b border-slate-800 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base md:text-lg font-bold text-white flex items-center">
                  <BarChart3 className="h-5 w-5 mr-2 text-amber-400" />
                  Отчет Взаиморасчетов: {selectedPartnerReport.counterparty.name}
                </CardTitle>
                <CardDescription className="text-xs text-slate-400 font-mono mt-0.5">
                  ИНН: {selectedPartnerReport.counterparty.inn}
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPartnerReport(null)}
                className="h-8 w-8 p-0 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </Button>
            </CardHeader>

            <CardContent className="p-4 md:p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                  <Inbox className="mx-auto h-4 w-4 text-emerald-400 mb-1" />
                  <span className="text-xl font-bold font-mono text-white">
                    {selectedPartnerReport.inboxDocsCount}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-0.5">Получено</p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                  <Send className="mx-auto h-4 w-4 text-blue-400 mb-1" />
                  <span className="text-xl font-bold font-mono text-white">
                    {selectedPartnerReport.outboxDocsCount}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-0.5">Отправлено</p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                  <FolderOpen className="mx-auto h-4 w-4 text-purple-400 mb-1" />
                  <span className="text-xl font-bold font-mono text-white">
                    {selectedPartnerReport.totalFilesCount}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-0.5">Всего файлов</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
