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
  Phone,
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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { updateCounterpartyCommentAction } from '../partnerships/actions';
import type { Counterparty, Company, Document, DocumentFile } from '@/types/database.types';

type PartnerReport = {
  counterparty: Counterparty;
  inboxDocsCount: number;
  outboxDocsCount: number;
  totalFilesCount: number;
  documents: Document[];
};

export default function CounterpartiesPage() {
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
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

  const loadCounterparties = async () => {
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
      const { data } = await supabase
        .from('counterparties')
        .select('*')
        .eq('company_id', myCompanyId)
        .order('name');

      if (data) {
        setCounterparties(data as Counterparty[]);
      }
    }

    setLoading(false);
  };

  useEffect(() => {
    loadCounterparties();
  }, []);

  const handleSaveComment = (counterpartyId: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await updateCounterpartyCommentAction(counterpartyId, editComment);
      if (res.success) {
        setMsg({ type: 'success', text: 'Примечание контрагента обновлено' });
        setEditingCounterpartyId(null);
        loadCounterparties();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при обновлении примечания' });
      }
    });
  };

  const filteredCounterparties = counterparties.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.inn.includes(searchTerm) ||
      (c.comment && c.comment.toLowerCase().includes(searchTerm.toLowerCase()))
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
            <Users className="h-5 w-5 md:h-6 md:w-6 mr-2 text-purple-400" />
            Подтвержденные Контрагенты
          </h2>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Официальные реквизиты партнеров защищены от изменений
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

      {/* Поиск */}
      <Card className="bg-slate-900/40 border-slate-800 p-3 md:p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            placeholder="Поиск по наименованию, ИНН 14 цифр..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 text-xs md:text-sm"
          />
        </div>
      </Card>

      {/* 1. ПК ТАБЛИЦА (hidden md:block) */}
      <Card className="hidden md:block bg-slate-900/40 border-slate-800 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка списка контрагентов...</span>
            </div>
          ) : filteredCounterparties.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              Подтвержденные контрагенты пока отсутствуют
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Официальное Наименование</TableHead>
                  <TableHead>ИНН КР (Защищен)</TableHead>
                  <TableHead>Email (Защищен)</TableHead>
                  <TableHead>Внутреннее Примечание</TableHead>
                  <TableHead className="text-right">Аналитика</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCounterparties.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-semibold text-white text-sm flex items-center space-x-1.5">
                        <Building2 className="h-4 w-4 text-purple-400 flex-shrink-0" />
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

                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenReport(c)}
                        className="border-slate-800 text-xs text-purple-400 hover:bg-purple-500/10"
                      >
                        <BarChart3 className="h-3.5 w-3.5 mr-1" />
                        Отчет
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
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
        ) : filteredCounterparties.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800">
            Контрагенты не найдены
          </div>
        ) : (
          filteredCounterparties.map((c) => (
            <Card key={c.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-white text-sm flex items-center">
                    <Building2 className="h-4 w-4 text-purple-400 mr-1.5 flex-shrink-0" />
                    <span>{c.name}</span>
                  </h4>
                  <p className="text-[11px] font-mono font-bold text-amber-400 mt-0.5">ИНН: {c.inn}</p>
                </div>
              </div>

              <div className="text-xs text-slate-400 font-mono">
                {c.email || `contact@${c.inn}.kg`}
              </div>

              {c.comment && (
                <div className="p-2 rounded bg-slate-950 text-xs text-slate-300">
                  <span className="text-slate-500 text-[10px] block">Примечание:</span>
                  {c.comment}
                </div>
              )}

              <div className="flex items-center justify-end pt-2 border-t border-slate-800/60">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenReport(c)}
                  className="w-full border-slate-800 text-xs text-purple-400 hover:bg-purple-500/10"
                >
                  <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
                  Открыть отчет по контрагенту
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

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
