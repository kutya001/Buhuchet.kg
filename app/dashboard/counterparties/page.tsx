'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  Lock,
  Edit2,
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
  ExternalLink,
  Shield,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  sendPartnershipRequestAction,
  respondToPartnershipRequestAction,
  terminatePartnershipAction,
  updateCounterpartyCommentAction,
  getCounterpartyDetailsAndFilesAction,
} from './actions';
import type { Counterparty, Company, Document, DocumentFile } from '@/types/database.types';

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

  // Активная вкладка единого модуля: 'counterparties' | 'requests' | 'catalog'
  const [activeTab, setActiveTab] = useState<'counterparties' | 'requests' | 'catalog'>('counterparties');

  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [partnerships, setPartnerships] = useState<any[]>([]);
  const [catalogCompanies, setCatalogCompanies] = useState<Company[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Состояние пагинации
  const [currentPage, setCurrentPage] = useState(1);

  // Редактирование примечания
  const [editingCounterpartyId, setEditingCounterpartyId] = useState<string | null>(null);
  const [editComment, setEditComment] = useState('');

  // 1. Модалка отчета
  const [selectedPartnerReport, setSelectedPartnerReport] = useState<PartnerReport | null>(null);

  // 2. Модалка просмотра ВСЕХ ДАННЫХ И УЧРЕДИТЕЛЬНЫХ ФАЙЛОВ контрагента
  const [profileModal, setProfileModal] = useState<CounterpartyProfileModal | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

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

      // 3. Каталог всех компаний КР (исключая свою)
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
  }, [searchFromUrl, activeTab]);

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

  const handleRespondRequest = (partnershipId: string, status: 'approved' | 'rejected') => {
    setMsg(null);
    startTransition(async () => {
      const res = await respondToPartnershipRequestAction(partnershipId, status);
      if (res.success) {
        setMsg({
          type: 'success',
          text: status === 'approved' ? 'Партнерство подтверждено! Компания добавлена в список контрагентов.' : 'Заявка отклонена.',
        });
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
        setMsg({ type: 'success', text: 'Сотрудничество прекращено.' });
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
        setMsg({ type: 'success', text: 'Примечание контрагента обновлено' });
        setEditingCounterpartyId(null);
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при обновлении примечания' });
      }
    });
  };

  // ОТКРЫТИЕ ДАННЫХ И УЧРЕДИТЕЛЬНЫХ ФАЙЛОВ КОНТРАГЕНТА
  const handleOpenProfileModal = async (counterparty: Counterparty) => {
    setProfileLoading(true);

    let targetId = counterparty.target_company_id;

    // Если target_company_id равен null, ищем компанию по ИНН
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

  // Фильтрация по поиску
  const filteredCounterparties = counterparties.filter(
    (c) =>
      c.name.toLowerCase().includes(searchFromUrl.toLowerCase()) ||
      c.inn.includes(searchFromUrl) ||
      (c.comment && c.comment.toLowerCase().includes(searchFromUrl.toLowerCase()))
  );

  const filteredCatalog = catalogCompanies.filter(
    (c) => c.name.toLowerCase().includes(searchFromUrl.toLowerCase())
  );

  // Пагинация Моих Контрагентов
  const totalPagesCounterparties = Math.ceil(filteredCounterparties.length / ITEMS_PER_PAGE) || 1;
  const paginatedCounterparties = filteredCounterparties.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Пагинация Каталога
  const totalPagesCatalog = Math.ceil(filteredCatalog.length / ITEMS_PER_PAGE) || 1;
  const paginatedCatalog = filteredCatalog.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Отчет по контрагенту
  const handleOpenReport = async (counterparty: Counterparty) => {
    const { data: docs } = await supabase
      .from('documents')
      .select('*, document_files(*)')
      .or(`and(sender_company_id.eq.${currentCompanyId},receiver_company_id.eq.${counterparty.company_id}),and(sender_company_id.eq.${counterparty.company_id},receiver_company_id.eq.${currentCompanyId})`)
      .order('created_at', { ascending: false });

    const docList = (docs as (Document & { document_files?: DocumentFile[] })[]) || [];

    const inboxCount = docList.filter((d) => d.sender_company_id === counterparty.company_id).length;
    const outboxCount = docList.filter((d) => d.receiver_company_id === counterparty.company_id).length;
    const filesCount = docList.reduce((sum, d) => sum + (d.document_files?.length || 1), 0);

    setSelectedPartnerReport({
      counterparty,
      inboxDocsCount: inboxCount,
      outboxDocsCount: outboxCount,
      totalFilesCount: filesCount,
      documents: docList,
    });
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center">
            <Users className="h-5 w-5 md:h-6 md:w-6 mr-2 text-amber-400" />
            Контрагенты
          </h2>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Управление активными партнерами, уставными сканами R2 и поиском организаций
          </p>
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

      {/* Вкладки Единого Модуля Контрагентов */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('counterparties')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'counterparties'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Мои Контрагенты ({counterparties.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('requests')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'requests'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/40 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <UserCheck className="h-4 w-4" />
          <span>Заявки Сети ({partnerships.filter((p) => p.status === 'pending').length})</span>
        </button>

        <button
          onClick={() => setActiveTab('catalog')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'catalog'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/40 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Globe className="h-4 w-4" />
          <span>Каталог Компаний КР</span>
        </button>
      </div>

      {/* ------------------- ВКЛАДКА 1: МОИ КОНТРАГЕНТЫ ------------------- */}
      {activeTab === 'counterparties' && (
        <>
          <Card className="hidden md:block bg-slate-900/40 border-slate-800 overflow-hidden shadow-2xl">
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center p-12 text-slate-400">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Загрузка списка контрагентов...</span>
                </div>
              ) : paginatedCounterparties.length === 0 ? (
                <div className="p-12 text-center text-slate-500 text-xs">
                  У вашей компании пока нет активных контрагентов. Отправьте заявку из «Каталога Компаний КР».
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-950/60">
                    <TableRow>
                      <TableHead>Официальное Наименование</TableHead>
                      <TableHead>ИНН КР</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Внутреннее Примечание</TableHead>
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
                        <TableCell className="font-mono text-xs text-slate-400">{c.email || `contact@${c.inn}.kg`}</TableCell>

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
                                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500"
                              >
                                Сохранить
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center space-x-2 text-xs text-slate-300">
                              <span>{c.comment || '—'}</span>
                              <button
                                onClick={() => {
                                  setEditingCounterpartyId(c.id);
                                  setEditComment(c.comment || '');
                                }}
                                className="text-slate-500 hover:text-blue-400 p-1"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="text-right space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenProfileModal(c)}
                            disabled={profileLoading}
                            className="border-slate-800 text-xs text-emerald-400 hover:bg-emerald-500/10 min-h-[40px] font-bold"
                          >
                            <FolderOpen className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                            Данные & Уставные Сканы
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenReport(c)}
                            className="border-slate-800 text-xs text-purple-400 hover:bg-purple-500/10 min-h-[40px]"
                          >
                            <BarChart3 className="h-3.5 w-3.5 mr-1" />
                            Отчет
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTerminatePartnership(c.id)}
                            disabled={isPending}
                            className="border-red-900/40 text-xs text-red-400 hover:bg-red-500/10 min-h-[40px]"
                            title="Прекратить сотрудничество"
                          >
                            <UserX className="h-3.5 w-3.5 mr-1" />
                            Прекратить
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Мобильные Карточки */}
          <div className="block md:hidden space-y-3">
            {paginatedCounterparties.map((c) => (
              <Card key={c.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3 shadow-xl">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-white text-sm flex items-center">
                      <Building2 className="h-4 w-4 text-amber-400 mr-1.5 flex-shrink-0" />
                      <span>{c.name}</span>
                    </h4>
                    <p className="text-[11px] font-mono font-bold text-amber-400 mt-0.5">ИНН: {c.inn}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/60">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenProfileModal(c)}
                    disabled={profileLoading}
                    className="col-span-2 border-slate-800 text-xs text-emerald-400 hover:bg-emerald-500/10 min-h-[44px] font-bold"
                  >
                    <FolderOpen className="h-4 w-4 mr-1.5 text-emerald-400" />
                    Данные & Уставные Сканы
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenReport(c)}
                    className="border-slate-800 text-xs text-purple-400 hover:bg-purple-500/10 min-h-[44px]"
                  >
                    <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
                    Отчет
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTerminatePartnership(c.id)}
                    disabled={isPending}
                    className="border-red-900/40 text-xs text-red-400 hover:bg-red-500/10 min-h-[44px]"
                  >
                    <UserX className="h-3.5 w-3.5 mr-1" />
                    Прекратить
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {/* Пагинация Вкладки 1 */}
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
        </>
      )}

      {/* ------------------- ВКЛАДКА 2: ЗАЯВКИ СЕТИ ------------------- */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {partnerships.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800">
                Заявки на сотрудничество отсутствуют
              </div>
            ) : (
              partnerships.map((p) => {
                const isRequester = p.requester_company_id === currentCompanyId;
                const partnerComp = isRequester ? p.target_company : p.requester_company;

                return (
                  <Card key={p.id} className="bg-slate-900/60 border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <Building2 className="h-4 w-4 text-purple-400" />
                        <h4 className="font-bold text-white text-base">{partnerComp?.name || 'Организация'}</h4>
                        <Badge
                          variant={
                            p.status === 'approved' ? 'success' : p.status === 'pending' ? 'secondary' : 'destructive'
                          }
                          className="text-[10px]"
                        >
                          {p.status === 'approved' ? 'Подтверждено' : p.status === 'pending' ? 'На рассмотрении' : 'Отклонено'}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400">
                        {isRequester ? 'Ваша отправленная заявка' : 'Входящий запрос на сотрудничество'}
                      </p>
                    </div>

                    {!isRequester && p.status === 'pending' && (
                      <div className="flex items-center space-x-2 w-full sm:w-auto">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleRespondRequest(p.id, 'rejected')}
                          disabled={isPending}
                          className="flex-1 sm:flex-none text-xs min-h-[44px]"
                        >
                          Отклонить
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleRespondRequest(p.id, 'approved')}
                          disabled={isPending}
                          className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-500 text-white text-xs min-h-[44px] font-bold"
                        >
                          Принять заявку
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ------------------- ВКЛАДКА 3: КАТАЛОГ КОМПАНИЙ КР ------------------- */}
      {activeTab === 'catalog' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedCatalog.length === 0 ? (
              <div className="col-span-full p-12 text-center text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800">
                Компании не найдены
              </div>
            ) : (
              paginatedCatalog.map((comp) => {
                const existingPartnership = partnerships.find(
                  (p) =>
                    (p.requester_company_id === currentCompanyId && p.target_company_id === comp.id) ||
                    (p.target_company_id === currentCompanyId && p.requester_company_id === comp.id)
                );

                return (
                  <Card key={comp.id} className="bg-slate-900/60 border-slate-800 p-5 flex flex-col justify-between space-y-4 hover:border-indigo-500/40 transition-all shadow-xl">
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                          <Building2 className="h-5 w-5" />
                        </div>
                        <h4 className="font-bold text-white text-base truncate">{comp.name}</h4>
                      </div>
                      <p className="text-xs text-slate-400 font-mono">Верифицированная организация КР</p>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80">
                      {existingPartnership?.status === 'approved' ? (
                        <Badge variant="outline" className="w-full justify-center border-emerald-500/30 text-emerald-400 bg-emerald-500/10 py-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          Уже в контрагентах
                        </Badge>
                      ) : existingPartnership?.status === 'pending' ? (
                        <Badge variant="outline" className="w-full justify-center border-amber-500/30 text-amber-400 bg-amber-500/10 py-1.5">
                          <Clock className="h-3.5 w-3.5 mr-1" />
                          Заявка на рассмотрении
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleSendRequest(comp.id)}
                          disabled={isPending}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs min-h-[44px]"
                        >
                          <UserPlus className="h-4 w-4 mr-1.5" />
                          Предложить сотрудничество
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })
            )}
          </div>

          {/* Пагинация Каталога */}
          {totalPagesCatalog > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400 font-mono">
                Страница <span className="text-white font-bold">{currentPage}</span> из <span className="text-white font-bold">{totalPagesCatalog}</span>
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
                  onClick={() => setCurrentPage((p) => Math.min(totalPagesCatalog, p + 1))}
                  disabled={currentPage === totalPagesCatalog}
                  className="border-slate-800 text-slate-300 min-h-[40px] text-xs"
                >
                  Вперед
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* МОДАЛЬНОЕ ОКНО 1: ПРОСМОТР ВСЕХ ДАННЫХ И УЧРЕДИТЕЛЬНЫХ ФАЙЛОВ КОНТРАГЕНТА */}
      {profileModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <Card className="w-full max-w-3xl bg-slate-900 border-t sm:border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh] rounded-t-3xl sm:rounded-2xl animate-in slide-in-from-bottom duration-300">
            <div className="sm:hidden w-12 h-1 bg-slate-700 rounded-full mx-auto mt-3 mb-1 opacity-80" />

            <CardHeader className="border-b border-slate-800 flex flex-row items-center justify-between pb-3 pt-3 sm:pt-6">
              <div>
                <CardTitle className="text-base md:text-lg text-white flex items-center">
                  <Building2 className="h-5 w-5 mr-2 text-amber-400" />
                  {profileModal.companyDetails?.name || profileModal.counterparty.name}
                </CardTitle>
                <CardDescription className="text-xs text-slate-400 font-mono">
                  ИНН КР: {profileModal.companyDetails?.inn || profileModal.counterparty.inn}
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setProfileModal(null)}
                className="h-9 w-9 p-0 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </Button>
            </CardHeader>

            <CardContent className="p-4 md:p-6 space-y-6 overflow-y-auto">
              {/* 1. Реквизиты организации */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono flex items-center">
                  <Shield className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
                  Юридические Реквизиты Контрагента
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-slate-500 font-mono text-[10px] uppercase">Директор / Руководитель</span>
                    <p className="font-bold text-white text-sm">{profileModal.companyDetails?.director_name || 'Не указан'}</p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-slate-500 font-mono text-[10px] uppercase">Отрасль деятельности</span>
                    <p className="font-bold text-slate-200">{profileModal.companyDetails?.industry || 'Общий учёт и B2B'}</p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-slate-500 font-mono text-[10px] uppercase">Юридический адрес</span>
                    <p className="font-bold text-slate-200">{profileModal.companyDetails?.legal_address || 'Бишкек, Кыргызстан'}</p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-slate-500 font-mono text-[10px] uppercase">Контактные данные</span>
                    <p className="font-mono text-slate-200">
                      {profileModal.companyDetails?.phone || '—'} • {profileModal.companyDetails?.email || profileModal.counterparty.email}
                    </p>
                  </div>
                </div>
              </div>

              {/* 2. Учредительные файлы и сканы первички в R2 */}
              <div className="space-y-3 pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono flex items-center">
                    <FolderOpen className="h-3.5 w-3.5 mr-1.5 text-emerald-400" />
                    Учредительные & Юридические Сканы R2 ({profileModal.statutoryFiles.length})
                  </h4>
                </div>

                {profileModal.statutoryFiles.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs bg-slate-950/40 rounded-xl border border-slate-800">
                    Учредительные сканы не загружены в личный архив этой компании
                  </div>
                ) : (
                  <div className="space-y-2">
                    {profileModal.statutoryFiles.map((file) => (
                      <div
                        key={file.id}
                        className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-3 hover:border-emerald-500/40 transition-all"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-white text-xs truncate">{file.file_name}</div>
                          <p className="text-[11px] text-slate-400 mt-0.5">{file.description}</p>
                          <Badge variant="outline" className="text-[9px] border-slate-800 text-emerald-400 mt-1">
                            {file.file_categories?.name || 'Уставной скан'}
                          </Badge>
                        </div>

                        {file.downloadUrl ? (
                          <a
                            href={file.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-shrink-0"
                          >
                            <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 text-xs min-h-[40px]">
                              <Download className="h-3.5 w-3.5 mr-1" />
                              Скачать R2
                            </Button>
                          </a>
                        ) : (
                          <Button size="sm" disabled variant="outline" className="border-slate-800 text-slate-500 text-xs min-h-[40px]">
                            Недоступен
                          </Button>
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

      {/* МОДАЛЬНОЕ ОКНО 2: ОТЧЕТ ПО КОНТРАГЕНТУ */}
      {selectedPartnerReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-2xl bg-slate-900 border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <CardHeader className="border-b border-slate-800 flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-base md:text-lg text-white flex items-center">
                  <BarChart3 className="h-5 w-5 mr-2 text-purple-400" />
                  Аналитика B2B: {selectedPartnerReport.counterparty.name}
                </CardTitle>
                <CardDescription>
                  ИНН: <span className="font-mono text-slate-300">{selectedPartnerReport.counterparty.inn}</span>
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

              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">
                  История обмена документами
                </h4>
                {selectedPartnerReport.documents.length === 0 ? (
                  <div className="text-center p-6 text-slate-500 text-xs bg-slate-950/40 rounded-lg">
                    История документооборота пока отсутствует
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {selectedPartnerReport.documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-semibold text-white font-mono">
                            № {doc.doc_number || '—'} ({doc.doc_type})
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {doc.sender_company_id === currentCompanyId ? 'Исходящий' : 'Входящий'} • Дата: {doc.doc_date}
                          </p>
                        </div>
                        <Badge variant="outline" className="border-slate-800 text-slate-300">
                          {doc.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
