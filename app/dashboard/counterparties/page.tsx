'use client';

import React, { useState, useEffect, useTransition } from 'react';
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
  Search,
  Building2,
  Mail,
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
  ShieldAlert,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  sendPartnershipRequestAction,
  respondToPartnershipRequestAction,
  terminatePartnershipAction,
  updateCounterpartyCommentAction,
} from './actions';
import type { Counterparty, Company, Document, DocumentFile, CompanyPartnership } from '@/types/database.types';

type PartnerReport = {
  counterparty: Counterparty;
  inboxDocsCount: number;
  outboxDocsCount: number;
  totalFilesCount: number;
  documents: Document[];
};

export default function CounterpartiesPage() {
  // Активная вкладка единого модуля: 'counterparties' | 'requests' | 'catalog'
  const [activeTab, setActiveTab] = useState<'counterparties' | 'requests' | 'catalog'>('counterparties');

  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [partnerships, setPartnerships] = useState<any[]>([]);
  const [catalogCompanies, setCatalogCompanies] = useState<Company[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isPending, startTransition] = useTransition();

  // Редактирование примечания
  const [editingCounterpartyId, setEditingCounterpartyId] = useState<string | null>(null);
  const [editComment, setEditComment] = useState('');

  // Отчет по контрагенту (Модалка)
  const [selectedPartnerReport, setSelectedPartnerReport] = useState<PartnerReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
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
          text: status === 'approved' ? 'Партнерство подтверждено! Компания добавлена в контрагенты.' : 'Заявка отклонена.',
        });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка обработки заявки' });
      }
    });
  };

  const handleTerminatePartnership = (counterpartyId: string) => {
    if (!confirm('Вы действительно хотите прекратить сотрудничество с этим контрагентом? Он перестанет отображаться в списке контрагентов.')) {
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await terminatePartnershipAction(counterpartyId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Сотрудничество прекращено. Контрагент деактивирован.' });
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

  // Фильтрация
  const filteredCounterparties = counterparties.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.inn.includes(searchTerm) ||
      (c.comment && c.comment.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredCatalog = catalogCompanies.filter(
    (c) => c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Формирование отчета по контрагенту
  const handleOpenReport = async (counterparty: Counterparty) => {
    setReportLoading(true);

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

    setReportLoading(false);
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
            Управление активными партнерами, заявками сети и поиском организаций
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

      {/* Поиск */}
      <Card className="bg-slate-900/40 border-slate-800 p-3 md:p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            placeholder={
              activeTab === 'catalog'
                ? 'Поиск компании по наименованию...'
                : 'Поиск по наименованию или ИНН...'
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 text-xs md:text-sm min-h-[44px]"
          />
        </div>
      </Card>

      {/* ------------------- ВКЛАДКА 1: МОИ КОНТРАГЕНТЫ ------------------- */}
      {activeTab === 'counterparties' && (
        <>
          <Card className="hidden md:block bg-slate-900/40 border-slate-800 overflow-hidden">
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center p-12 text-slate-400">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Загрузка списка контрагентов...</span>
                </div>
              ) : filteredCounterparties.length === 0 ? (
                <div className="p-12 text-center text-slate-500 text-xs">
                  У вашей компании пока нет активных контрагентов. Отправьте заявку из вкладки «Каталог Компаний КР».
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-950/60">
                    <TableRow>
                      <TableHead>Официальное Наименование</TableHead>
                      <TableHead>ИНН КР (Защищен)</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Внутреннее Примечание</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCounterparties.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="font-semibold text-white text-sm flex items-center space-x-1.5">
                            <Building2 className="h-4 w-4 text-amber-400 flex-shrink-0" />
                            <span>{c.name}</span>
                            <Lock className="h-3 w-3 text-slate-500 ml-1" />
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
            {filteredCounterparties.map((c) => (
              <Card key={c.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-white text-sm flex items-center">
                      <Building2 className="h-4 w-4 text-amber-400 mr-1.5 flex-shrink-0" />
                      <span>{c.name}</span>
                    </h4>
                    <p className="text-[11px] font-mono font-bold text-amber-400 mt-0.5">ИНН: {c.inn}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/60">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenReport(c)}
                    className="flex-1 border-slate-800 text-xs text-purple-400 hover:bg-purple-500/10 min-h-[44px]"
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
                  <Card key={p.id} className="bg-slate-900/60 border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
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
                          className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-500 text-white text-xs min-h-[44px]"
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

      {/* ------------------- ВКЛАДКА 3: КАТАЛОГ КОМПАНИЙ КР (БЕЗ ИНН) ------------------- */}
      {activeTab === 'catalog' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCatalog.length === 0 ? (
            <div className="col-span-full p-12 text-center text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800">
              Компании не найдены
            </div>
          ) : (
            filteredCatalog.map((comp) => {
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
      )}

      {/* Модалка Отчета по контрагенту */}
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
