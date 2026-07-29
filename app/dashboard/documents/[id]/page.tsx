'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FileText,
  Building2,
  Calendar,
  CheckCircle2,
  XCircle,
  Send,
  ArrowLeft,
  Loader2,
  AlertCircle,
  History,
  Paperclip,
  FolderOpen,
  Eye,
  Info,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ScanViewer } from '@/components/documents/ScanViewer';
import { getB2BDocumentByIdAction, updateB2BDocumentStatusAction, deleteB2BDocumentAction } from '../actions';
import { DOCUMENT_TYPES, DOCUMENT_STATUSES } from '@/types/document.types';
import type { Document, Company, DocumentFile, DocumentLog, DocumentStatus } from '@/types/database.types';

type FullB2BDocument = Document & {
  sender_company?: Company | null;
  receiver_company?: Company | null;
  document_files?: DocumentFile[];
  document_logs?: (DocumentLog & { users?: { full_name: string } })[];
  users?: { full_name: string } | null;
};

export default function B2BDocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const docId = params.id as string;

  const [document, setDocument] = useState<FullB2BDocument | null>(null);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Таб переключения на мобильных смартфонах: 'scan' | 'details'
  const [mobileTab, setMobileTab] = useState<'scan' | 'details'>('scan');

  const [cancelComment, setCancelComment] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const loadDoc = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: prof } = await supabase.from('users').select('company_id').eq('id', user.id).single();
      if (prof?.company_id) setCurrentCompanyId(prof.company_id);
    }

    const res = await getB2BDocumentByIdAction(docId);
    if (res.success && res.data) {
      setDocument(res.data as FullB2BDocument);
    } else {
      setDocument(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDoc();
  }, [docId]);

  const handleStatusChange = (newStatus: DocumentStatus, comment?: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await updateB2BDocumentStatusAction(docId, newStatus, comment);
      if (res.success) {
        setMsg({ type: 'success', text: `Статус изменен на "${DOCUMENT_STATUSES[newStatus].label}"` });
        setShowCancelModal(false);
        loadDoc();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка смены статуса' });
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка B2B документа...</span>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="text-center p-12 text-slate-500 space-y-4">
        <AlertCircle className="mx-auto h-12 w-12 text-red-400" />
        <h3 className="text-lg font-bold text-white">Документ не найден</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto">
          Возможно, данный документ был удален или у вашей организации нет доступа к просмотру.
        </p>
        <Link href="/dashboard/documents">
          <Button variant="outline" className="border-slate-800 text-slate-300">
            Вернуться в реестр документов
          </Button>
        </Link>
      </div>
    );
  }

  const statusMeta = DOCUMENT_STATUSES[document.status as DocumentStatus];
  const typeMeta = DOCUMENT_TYPES[document.doc_type];
  const currentFile = document.document_files?.[selectedFileIndex];

  const isReceiver = document.receiver_company_id === currentCompanyId;

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-3 md:space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center space-x-3">
          <Link href="/dashboard/documents">
            <Button variant="outline" size="sm" className="border-slate-800 text-slate-400 hover:text-white text-xs min-h-[44px]">
              <ArrowLeft className="h-4 w-4 mr-1" />
              В реестр
            </Button>
          </Link>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-base md:text-xl font-bold text-white tracking-tight">
                № {document.doc_number || document.id.slice(0, 8)}
              </h2>
              <Badge variant={statusMeta?.variant}>{statusMeta?.label}</Badge>
            </div>
            <p className="text-[11px] md:text-xs text-slate-400 mt-0.5">
              {document.doc_date} • {document.users?.full_name || 'Неизвестен'}
            </p>
          </div>
        </div>

        {/* Панель смены статусов */}
        <div className="flex items-center space-x-2">
          {document.status === 'draft' && (
            <Button
              size="sm"
              onClick={() => handleStatusChange('sent', 'Отправлено получателю')}
              disabled={isPending}
              className="bg-blue-600 hover:bg-blue-500 text-white text-xs w-full sm:w-auto min-h-[44px]"
            >
              <Send className="h-3.5 w-3.5 mr-1" />
              Отправить получателю
            </Button>
          )}

          {isReceiver && document.status === 'sent' && (
            <>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setShowCancelModal(true)}
                disabled={isPending}
                className="text-xs min-h-[44px]"
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Отклонить
              </Button>
              <Button
                size="sm"
                onClick={() => handleStatusChange('accepted', 'Документ принят получателем')}
                disabled={isPending}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs min-h-[44px]"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Принять
              </Button>
            </>
          )}

          {document.status === 'accepted' && (
            <Button
              size="sm"
              onClick={() => handleStatusChange('processed', 'Документ успешно обработан')}
              disabled={isPending}
              className="bg-purple-600 hover:bg-purple-500 text-white text-xs min-h-[44px]"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Обработано
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

      {/* МОБИЛЬНЫЕ ВКТАДКИ СМЕНЫ ВИДА (< lg) */}
      <div className="flex lg:hidden space-x-2 border-b border-slate-800 pb-2 flex-shrink-0">
        <button
          onClick={() => setMobileTab('scan')}
          className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-xl text-xs font-medium border transition-all min-h-[44px] ${
            mobileTab === 'scan'
              ? 'bg-blue-600/20 text-blue-400 border-blue-500/40 font-bold'
              : 'bg-slate-900/40 text-slate-400 border-slate-800'
          }`}
        >
          <Eye className="h-4 w-4" />
          <span>Просмотр Скана R2</span>
        </button>

        <button
          onClick={() => setMobileTab('details')}
          className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-xl text-xs font-medium border transition-all min-h-[44px] ${
            mobileTab === 'details'
              ? 'bg-purple-600/20 text-purple-400 border-purple-500/40 font-bold'
              : 'bg-slate-900/40 text-slate-400 border-slate-800'
          }`}
        >
          <Info className="h-4 w-4" />
          <span>Реквизиты & История</span>
        </button>
      </div>

      {/* Split-Screen Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 flex-1 min-h-0 overflow-hidden">
        {/* Левая колонка: Просмотрщик скана R2 */}
        <div className={`lg:col-span-6 flex flex-col h-full min-h-[350px] ${mobileTab === 'scan' ? 'flex' : 'hidden lg:flex'}`}>
          {document.document_files && document.document_files.length > 1 && (
            <div className="flex items-center space-x-2 mb-2 overflow-x-auto pb-1 flex-shrink-0">
              <span className="text-xs text-slate-500 font-mono flex-shrink-0">Файлы:</span>
              {document.document_files.map((file, idx) => (
                <button
                  key={file.id}
                  onClick={() => setSelectedFileIndex(idx)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border truncate max-w-[140px] transition-all min-h-[40px] ${
                    selectedFileIndex === idx
                      ? 'bg-blue-600/20 text-blue-400 border-blue-500/40 font-bold'
                      : 'bg-slate-900 text-slate-400 border-slate-800'
                  }`}
                >
                  {file.file_name}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0">
            <ScanViewer
              fileName={currentFile?.file_name || document.mock_file_name}
              fileKey={currentFile?.file_path_r2}
              docNumber={document.doc_number}
              docDate={document.doc_date}
              counterpartyName={document.receiver_company?.name || document.sender_company?.name}
              totalAmount={document.total_amount}
            />
          </div>
        </div>

        {/* Правая колонка: Реквизиты, Список сканов и История */}
        <div className={`lg:col-span-6 flex-col space-y-4 overflow-y-auto pr-1 ${mobileTab === 'details' ? 'flex' : 'hidden lg:flex'}`}>
          {/* B2B Адресация */}
          <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">
                B2B Участники Отправки
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                <span className="text-slate-500 font-mono text-[10px] uppercase">Отправитель</span>
                <div className="font-semibold text-white truncate">{document.sender_company?.name || '—'}</div>
                <div className="text-[10px] font-mono text-slate-400">ИНН: {document.sender_company?.inn || '—'}</div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                <span className="text-slate-500 font-mono text-[10px] uppercase">Получатель</span>
                <div className="font-semibold text-white truncate">{document.receiver_company?.name || '—'}</div>
                <div className="text-[10px] font-mono text-slate-400">ИНН: {document.receiver_company?.inn || '—'}</div>
              </div>

              {document.comment && (
                <div className="col-span-2 p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-500 font-mono text-[10px]">Примечание:</span>
                  <p className="text-slate-200 mt-0.5">{document.comment}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Список прикрепленных файлов */}
          <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono flex items-center">
                <Paperclip className="h-3.5 w-3.5 mr-1.5 text-emerald-400" />
                Прикрепленные сканы R2 ({document.document_files?.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {document.document_files?.map((file, idx) => (
                <div
                  key={file.id}
                  onClick={() => {
                    setSelectedFileIndex(idx);
                    setMobileTab('scan');
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    selectedFileIndex === idx
                      ? 'bg-blue-600/10 border-blue-500/40'
                      : 'bg-slate-950/60 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-white truncate">{file.file_name}</span>
                    <Badge variant="outline" className="text-[10px] border-slate-800 text-slate-400">
                      {file.file_categories?.name || 'Категория'}
                    </Badge>
                  </div>
                  <p className="text-slate-300 font-medium text-xs mt-1">{file.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Журнал аудита */}
          <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono flex items-center">
                <History className="h-3.5 w-3.5 mr-1.5 text-amber-400" />
                История изменений и статусов
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {document.document_logs?.map((log) => (
                <div key={log.id} className="p-2 rounded bg-slate-950/40 border border-slate-800/60 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-200">{log.users?.full_name || 'Система'}</span>
                    <span className="text-slate-400 ml-1.5"> &rarr; {log.new_status}</span>
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

      {/* Модалка Отмены */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-slate-900 border-slate-800 shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center">
              <XCircle className="h-5 w-5 mr-2 text-red-400" />
              Причина отклонения документа
            </h3>
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Укажите причину возврата отправителю:</Label>
              <Input
                value={cancelComment}
                onChange={(e) => setCancelComment(e.target.value)}
                placeholder="Нечитаемый скан / Ошибка в реквизитах..."
                className="bg-slate-950 border-slate-800 text-slate-100 min-h-[44px]"
              />
            </div>
            <div className="flex justify-end space-x-3 pt-2">
              <Button variant="outline" onClick={() => setShowCancelModal(false)} className="border-slate-800 text-slate-400 min-h-[44px]">
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleStatusChange('cancelled', cancelComment || 'Документ отклонен получателем')}
                disabled={isPending}
                className="min-h-[44px]"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Отклонить'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
