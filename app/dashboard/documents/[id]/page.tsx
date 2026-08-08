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
  Undo2,
  Edit2,
  User,
  UserCheck,
  X,
  Clock,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import dynamic from 'next/dynamic';

const ScanViewer = dynamic(
  () => import('@/components/documents/ScanViewer').then((mod) => mod.ScanViewer),
  {
    loading: () => (
      <div className="flex items-center justify-center h-96 bg-card border border-border rounded-xl text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Подготовка интерактивного просмотрщика сканов...</span>
      </div>
    ),
    ssr: false,
  }
);
import {
  getB2BDocumentByIdAction,
  updateB2BDocumentStatusAction,
  deleteB2BDocumentAction,
  recallB2BDocumentAction,
} from '../actions';
import { DOCUMENT_TYPES, DOCUMENT_STATUSES } from '@/types/document.types';
import type { Document, Company, DocumentFile, DocumentLog, DocumentStatus } from '@/types/database.types';

type FullB2BDocument = Document & {
  sender_company?: Company | null;
  receiver_company?: Company | null;
  files?: DocumentFile[];
  document_logs?: (DocumentLog & { users?: { full_name: string } })[];
  users?: { full_name: string } | null;
  author?: { full_name: string; role?: string } | null;
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
    if (!document) return;

    // Оптимистичное локальное обновление в UI (БЕЗ ЛОАДЕРА И ПЕРЕЗАГРУЗКИ)
    const oldDocState = { ...document };
    setDocument((prev) =>
      prev ? { ...prev, status: newStatus, updated_at: new Date().toISOString() } : null
    );
    setMsg({ type: 'success', text: `Статус изменен на "${DOCUMENT_STATUSES[newStatus].label}"` });
    setShowCancelModal(false);

    startTransition(async () => {
      const res = await updateB2BDocumentStatusAction(docId, newStatus, comment);
      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка смены статуса' });
        // Откат при ошибке
        setDocument(oldDocState);
      }
    });
  };

  const handleRecall = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await recallB2BDocumentAction(docId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Документ успешно отозван и переведен в черновики для исправления ошибок.' });
        loadDoc();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка отзыва документа' });
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
        <div className="text-center space-y-3">
          <AlertCircle className="h-10 w-10 text-rose-500 mx-auto" />
          <h3 className="text-lg font-bold text-foreground">Документ не найден</h3>
          <p className="text-sm text-muted-foreground">
            Возможно, данный документ был удален или у вашей организации нет доступа к просмотру.
          </p>
          <div className="pt-4">
            <Link href="/dashboard/documents">
              <Button variant="outline" className="border-border text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Вернуться к списку
              </Button>
            </Link>
          </div>
        </div>
    );
  }

  const statusMeta = DOCUMENT_STATUSES[document.status as DocumentStatus];
  const typeMeta = DOCUMENT_TYPES[document.doc_type];
  const currentFile = document.files?.[selectedFileIndex];

  const isSender = document.sender_company_id === currentCompanyId;
  const isReceiver = document.receiver_company_id === currentCompanyId;

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-3 md:space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0">
        <div>
          <Link href="/dashboard/documents" className="inline-block mb-3">
            <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:text-foreground text-xs min-h-[44px]">
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              Все документы
            </Button>
          </Link>

          <div className="flex items-center space-x-3">
            <div>
              <h2 className="text-base md:text-xl font-bold text-foreground tracking-tight">
                Документ №{document.id.slice(0, 8).toUpperCase()}
              </h2>
              <Badge variant={statusMeta?.variant}>{statusMeta?.label}</Badge>
            </div>
            <p className="text-[11px] md:text-xs text-muted-foreground mt-0.5">
              {document.doc_date} • {document.users?.full_name || 'Неизвестен'}
            </p>
          </div>
        </div>

        {/* Панель смены статусов & Разграничение прав Отправителя и Получателя */}
        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          {/* 1. СТАТУС: Черновик (draft) */}
          {isSender && document.status === 'draft' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCancelModal(true)}
                disabled={isPending}
                className="border-border text-muted-foreground hover:text-foreground hover:bg-muted text-xs min-h-[44px] font-bold"
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Аннулировать
              </Button>

              <Button
                size="sm"
                onClick={() => handleStatusChange('sent', 'Отправлено получателю')}
                disabled={isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs min-h-[44px] font-bold shadow-lg shadow-primary/20"
              >
                <Send className="h-3.5 w-3.5 mr-1" />
                Отправить получателю
              </Button>
            </>
          )}

          {/* 2. СТАТУС: Отправлен (sent) */}
          {isSender && document.status === 'sent' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleStatusChange('recalled', 'Документ отозван отправителем')}
              disabled={isPending}
              className="border-amber-500/40 text-amber-500 hover:bg-amber-500/10 text-xs min-h-[44px] font-bold"
              title="Перевести в статус Отозван"
            >
              <Undo2 className="h-3.5 w-3.5 mr-1" />
              Отозвать документ
            </Button>
          )}

          {isReceiver && document.status === 'sent' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleStatusChange('recalled', 'Возвращено получателем на статус Отозван')}
                disabled={isPending}
                className="border-amber-500/40 text-amber-500 hover:bg-amber-500/10 text-xs min-h-[44px] font-bold"
              >
                <Undo2 className="h-3.5 w-3.5 mr-1" />
                Вернуть на отзыв
              </Button>

              <Button
                size="sm"
                onClick={() => handleStatusChange('accepted', 'Документ принят получателем')}
                disabled={isPending}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs min-h-[44px] font-bold shadow-lg shadow-emerald-600/20"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Принять
              </Button>
            </>
          )}

          {/* 3. СТАТУС: Отозван (recalled) */}
          {isSender && document.status === 'recalled' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleStatusChange('draft', 'Переведен в Черновик для редактирования')}
              disabled={isPending}
              className="border-border text-muted-foreground hover:text-foreground text-xs min-h-[44px] font-bold"
            >
              <Edit2 className="h-3.5 w-3.5 mr-1" />
              Перевести в Черновик
            </Button>
          )}

          {/* 4. СТАТУС: Принят (accepted) */}
          {isReceiver && document.status === 'accepted' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleStatusChange('recalled', 'Возвращено из принятого в статус Отозван')}
                disabled={isPending}
                className="border-amber-500/40 text-amber-500 hover:bg-amber-500/10 text-xs min-h-[44px] font-bold"
              >
                <Undo2 className="h-3.5 w-3.5 mr-1" />
                Вернуть на отзыв
              </Button>

              <Button
                size="sm"
                onClick={() => handleStatusChange('processed', 'Документ успешно обработан')}
                disabled={isPending}
                className="bg-purple-600 hover:bg-purple-500 text-white text-xs min-h-[44px] font-bold shadow-lg shadow-purple-600/20"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Обработать
              </Button>
            </>
          )}

          {/* 5. СТАТУС: Обработан (processed) */}
          {document.status === 'processed' && (
            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs py-1.5 px-3">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1 inline" />
              Документ обработан
            </Badge>
          )}
        </div>
      </div>

      {msg && (
        <Alert
          variant={msg.type === 'success' ? 'default' : 'destructive'}
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
      <div className="flex lg:hidden space-x-2 border-b border-border pb-2 flex-shrink-0">
        <button
          onClick={() => setMobileTab('scan')}
          className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-xl text-xs font-medium border transition-all min-h-[44px] ${
            mobileTab === 'scan'
              ? 'bg-blue-600/20 text-blue-400 border-blue-500/40 font-bold'
              : 'bg-background/40 text-muted-foreground border-border'
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
              : 'bg-background/40 text-muted-foreground border-border'
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
          {document.files && document.files.length > 1 && (
            <div className="flex items-center space-x-2 mb-2 overflow-x-auto pb-1 flex-shrink-0">
              <span className="text-xs text-muted-foreground font-mono flex-shrink-0">Файлы:</span>
              {document.files.map((file, idx) => (
                <button
                  key={file.id}
                  onClick={() => setSelectedFileIndex(idx)}
                  className={`px-4 py-2 rounded-xl text-xs font-medium border transition-all ${
                    selectedFileIndex === idx
                      ? 'bg-purple-600/20 text-purple-400 border-purple-500/40 font-bold'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted'
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
          {/* Участники Документооборота */}
          <Card className="bg-background/40 border-border">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
                Участники Отправки
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-background/60 border border-border space-y-1">
                <span className="text-muted-foreground font-mono text-[10px] uppercase">Отправитель</span>
                <div className="font-semibold text-foreground truncate">{document.sender_company?.name || '—'}</div>
                <div className="text-[10px] font-mono text-muted-foreground">ИНН: {document.sender_company?.inn || '—'}</div>
                <div className="text-[11px] text-sky-500 font-medium pt-1 flex items-center">
                  {document.author?.full_name || 'Владелец'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-background/60 border border-border space-y-1">
                <span className="text-muted-foreground font-mono text-[10px] uppercase">Получатель</span>
                <div className="font-semibold text-foreground truncate">{document.receiver_company?.name || '—'}</div>
                <div className="text-[10px] font-mono text-muted-foreground">ИНН: {document.receiver_company?.inn || '—'}</div>
                {document.status === 'accepted' || document.status === 'processed' ? (
                  <div className="text-[11px] text-emerald-500 font-medium pt-1 flex items-center">
                    <UserCheck className="h-3 w-3 mr-1" />
                    Принято (подписано)
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground pt-1 italic">Ожидает принятия</div>
                )}
              </div>

              {document.comment && (
                <div className="col-span-2 p-2.5 rounded bg-background/60 border border-border">
                  <span className="text-[10px] text-muted-foreground uppercase block mb-1">Сумма документа (без НДС):</span>
                  <div className="font-mono font-bold text-foreground">
                    {document.total_amount ? Number(document.total_amount).toLocaleString('ru-RU') + ' KGS' : '—'}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* МЕТАДАТА СКАНОВ (R2) */}
          <Card className="bg-background/40 border-border">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono flex items-center">
                <Paperclip className="h-3.5 w-3.5 mr-1.5 text-emerald-400" />
                Прикрепленные сканы R2 ({document.files?.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {document.files?.map((file, idx) => (
                <div
                  key={file.id}
                  onClick={() => {
                    setSelectedFileIndex(idx);
                    setMobileTab('scan');
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    selectedFileIndex === idx
                      ? 'bg-blue-600/10 border-blue-500/40'
                      : 'bg-background/60 border-border'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-foreground truncate">{file.file_name}</span>
                    <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                      {file.file_categories?.name || 'Категория'}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground font-medium text-xs mt-1">{file.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Журнал аудита */}
          <Card className="bg-background/40 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-foreground flex items-center">
                <Clock className="h-4 w-4 mr-1.5 text-muted-foreground" />
                История изменений
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1 text-xs">
                {document.document_logs?.map((log) => (
                  <div key={log.id} className="p-2 rounded bg-background/40 border border-border/60 flex flex-col space-y-1">
                    <div className="flex justify-between items-start">
                      <span className="font-semibold text-foreground">
                        {DOCUMENT_STATUSES[log.new_status as DocumentStatus]?.label || log.new_status}
                      </span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                        {new Date(log.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {log.comment && (
                      <span className="text-[11px] text-muted-foreground break-words">{log.comment}</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* МОДАЛЬНОЕ ОКНО АННУЛИРОВАНИЯ */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-card border-border shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-foreground flex items-center">
              <AlertCircle className="h-5 w-5 mr-2 text-destructive" />
              Аннулировать документ
            </h3>
            <p className="text-sm text-muted-foreground">
              Укажите причину аннулирования. Это действие переведет документ в статус "Аннулирован" для обеих сторон.
            </p>
            <div className="space-y-2">
              <Label className="text-foreground">Причина (обязательно)</Label>
              <textarea
                value={cancelComment}
                onChange={(e) => setCancelComment(e.target.value)}
                placeholder="Нечитаемый скан / Ошибка в реквизитах..."
                required
                className="w-full p-3 rounded-md bg-background border border-border text-foreground min-h-[80px] text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex space-x-3 pt-2">
              <Button variant="outline" onClick={() => setShowCancelModal(false)} className="border-border text-muted-foreground min-h-[48px] hover:text-foreground">
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleStatusChange('cancelled', cancelComment || 'Документ отклонен получателем')}
                disabled={isPending}
                className="min-h-[48px]"
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
