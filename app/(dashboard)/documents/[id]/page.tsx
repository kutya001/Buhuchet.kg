'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import {
  FileText,
  Building2,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
  Lock,
  ArrowLeft,
  Loader2,
  AlertCircle,
  History,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ScanViewer } from '@/components/documents/ScanViewer';
import { changeDocumentStatusAction, deleteDocumentAction } from '../actions';
import { DOCUMENT_TYPES, DOCUMENT_STATUSES } from '@/types/document.types';
import type { Document, Counterparty, DocumentItem, DocumentLog, DocumentStatus } from '@/types/database.types';

type FullDocument = Document & {
  counterparties?: Counterparty | null;
  document_items?: DocumentItem[];
  document_logs?: (DocumentLog & { users?: { full_name: string } })[];
  users?: { full_name: string } | null;
};

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const docId = params.id as string;

  const [document, setDocument] = useState<FullDocument | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('manager');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const [rejectComment, setRejectComment] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const loadDocumentData = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: prof } = await supabase.from('users').select('role').eq('id', user.id).single();
      if (prof) setCurrentUserRole(prof.role || 'manager');
    }

    const { data: doc } = await supabase
      .from('documents')
      .select('*, counterparties(*), document_items(*), document_logs(*, users(full_name)), users(full_name)')
      .eq('id', docId)
      .single();

    if (doc) {
      setDocument(doc as FullDocument);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDocumentData();
  }, [docId]);

  const handleChangeStatus = (newStatus: DocumentStatus, comment?: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await changeDocumentStatusAction(docId, newStatus, comment);
      if (res.success) {
        setMsg({ type: 'success', text: `Статус документа изменен на "${DOCUMENT_STATUSES[newStatus].label}"` });
        setShowRejectModal(false);
        loadDocumentData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка смены статуса' });
      }
    });
  };

  const handleDeleteDoc = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await deleteDocumentAction(docId);
      if (res.success) {
        router.push('/dashboard/documents');
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления документа' });
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка документа...</span>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="text-center p-12 text-slate-500">
        <AlertCircle className="mx-auto h-10 w-10 text-red-400 mb-2" />
        Документ не найден или у вас нет доступа
      </div>
    );
  }

  const statusMeta = DOCUMENT_STATUSES[document.status as DocumentStatus];
  const typeMeta = DOCUMENT_TYPES[document.doc_type];

  const isLocked = document.status === 'posted_1c';
  const isAccountantOrOwner = currentUserRole === 'accountant' || currentUserRole === 'owner';

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-4">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center space-x-3">
          <Link href="/dashboard/documents">
            <Button variant="outline" size="sm" className="border-slate-800 text-slate-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" />
              В реестр
            </Button>
          </Link>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold text-white tracking-tight">
                {typeMeta?.label} № {document.doc_number || document.id.slice(0, 8)}
              </h2>
              <Badge variant={statusMeta?.variant}>{statusMeta?.label}</Badge>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Автор: {document.users?.full_name || 'Неизвестен'} • Дата: {document.doc_date}
            </p>
          </div>
        </div>

        {/* Панель смены статусов */}
        <div className="flex items-center space-x-2">
          {!isLocked && document.status === 'draft' && (
            <Button
              size="sm"
              onClick={() => handleChangeStatus('review', 'Отправлено в бухгалтерию на проверку')}
              disabled={isPending}
              className="bg-amber-600 hover:bg-amber-500 text-white"
            >
              <Send className="h-3.5 w-3.5 mr-1" />
              Отправить на проверку
            </Button>
          )}

          {!isLocked && isAccountantOrOwner && document.status === 'review' && (
            <>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setShowRejectModal(true)}
                disabled={isPending}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Отклонить
              </Button>
              <Button
                size="sm"
                onClick={() => handleChangeStatus('approved', 'Документ проверен и одобрен бухгалтером')}
                disabled={isPending}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Одобрить
              </Button>
            </>
          )}

          {!isLocked && isAccountantOrOwner && document.status === 'approved' && (
            <Button
              size="sm"
              onClick={() => handleChangeStatus('posted_1c', 'Документ проведен в 1С')}
              disabled={isPending}
              className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20"
            >
              <Lock className="h-3.5 w-3.5 mr-1" />
              Провести в 1С
            </Button>
          )}

          {!isLocked && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleDeleteDoc}
              disabled={isPending}
              className="border-slate-800 text-slate-400 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
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

      {/* Split-Screen Workspace (2 колонки) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0 overflow-hidden">
        {/* Левая колонка: Интерактивный Скан Документа */}
        <div className="lg:col-span-6 h-full min-h-[400px]">
          <ScanViewer
            fileName={document.mock_file_name}
            docNumber={document.doc_number}
            docDate={document.doc_date}
            counterpartyName={document.counterparties?.name}
            totalAmount={document.total_amount}
          />
        </div>

        {/* Правая колонка: Детали, товары и история логов */}
        <div className="lg:col-span-6 flex flex-col space-y-4 overflow-y-auto pr-1">
          {/* Карточка Реквизитов */}
          <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-400 uppercase tracking-wider font-mono">
                Реквизиты
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex justify-between items-center p-2.5 rounded bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 flex items-center">
                  <Building2 className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
                  Контрагент:
                </span>
                <span className="font-semibold text-white">
                  {document.counterparties?.name || 'Не выбран'} (ИНН: {document.counterparties?.inn || '—'})
                </span>
              </div>

              <div className="flex justify-between items-center p-2.5 rounded bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 flex items-center">
                  <Calendar className="h-3.5 w-3.5 mr-1.5 text-purple-400" />
                  Дата документа:
                </span>
                <span className="font-mono text-slate-200">{document.doc_date}</span>
              </div>

              {document.comment && (
                <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 font-mono text-[11px]">Комментарий автора:</span>
                  <p className="text-slate-200 mt-0.5">{document.comment}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Табличная часть товаров */}
          <Card className="bg-slate-900/40 border-slate-800 flex-1 flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-slate-400 uppercase tracking-wider font-mono">
                  Спецификация товаров/услуг
                </CardTitle>
                <span className="text-xs font-mono text-slate-500">
                  Позиций: {document.document_items?.length || 0}
                </span>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-0">
              <table className="w-full text-xs">
                <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="text-left p-2.5">Наименование</th>
                    <th className="text-right p-2.5">Кол-во</th>
                    <th className="text-right p-2.5">Цена (сом)</th>
                    <th className="text-right p-2.5">Итого (сом)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {document.document_items?.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/30">
                      <td className="p-2.5 text-slate-200">{item.title}</td>
                      <td className="p-2.5 text-right font-mono text-slate-300">{item.quantity}</td>
                      <td className="p-2.5 text-right font-mono text-slate-300">{Number(item.price).toFixed(2)}</td>
                      <td className="p-2.5 text-right font-mono font-bold text-emerald-400">
                        {Number(item.total).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
            <CardFooter className="pt-3 border-t border-slate-800 flex justify-between items-center">
              <span className="text-xs text-slate-400 font-mono">ИТОГОВАЯ СУММА:</span>
              <span className="text-lg font-bold font-mono text-emerald-400">
                {Number(document.total_amount).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} сом
              </span>
            </CardFooter>
          </Card>

          {/* Журнал аудита / Логи статусов */}
          <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono flex items-center">
                <History className="h-3.5 w-3.5 mr-1.5 text-amber-400" />
                История изменений и согласований
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {document.document_logs?.map((log) => (
                <div key={log.id} className="p-2 rounded bg-slate-950/40 border border-slate-800/60 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-200">
                      {log.users?.full_name || 'Пользователь'}
                    </span>
                    <span className="text-slate-400 ml-2"> &rarr; {log.new_status}</span>
                    {log.comment && <p className="text-[11px] text-slate-500 mt-0.5">{log.comment}</p>}
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">
                    {new Date(log.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Модалка Отклонения */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-slate-900 border-slate-800 shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center">
              <XCircle className="h-5 w-5 mr-2 text-red-400" />
              Причина отклонения документа
            </h3>
            <div className="space-y-2">
              <label className="text-xs text-slate-300">Укажите причину возврата составителю:</label>
              <Input
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                placeholder="Размытое фото / Ошибка в сумме товара..."
                className="bg-slate-950 border-slate-800 text-slate-100"
              />
            </div>
            <div className="flex justify-end space-x-3 pt-2">
              <Button variant="outline" onClick={() => setShowRejectModal(false)} className="border-slate-800 text-slate-400">
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleChangeStatus('rejected', rejectComment || 'Документ отклонен бухгалтером')}
                disabled={isPending}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Отклонить документ'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
