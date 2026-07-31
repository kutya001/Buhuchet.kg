'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  FileText,
  Send,
  ArrowLeft,
  Building2,
  Calendar,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plus,
  Search,
  FolderOpen,
  X,
  Check,
  Folder,
  Edit2,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { MultiFileDropzone, type FileItemState } from '@/components/documents/MultiFileDropzone';
import {
  createB2BDocumentAction,
  getB2BDocumentByIdAction,
  updateB2BDocumentFullAction,
} from '../actions';
import { getCompanyFilesArchiveAction } from '../../files/archive-actions';
import type { Company, FileCategory, DocumentType, DocumentFile } from '@/types/database.types';

export default function NewB2BDocumentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editDocId = searchParams.get('edit');

  const [partners, setPartners] = useState<Company[]>([]);
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [archiveFiles, setArchiveFiles] = useState<DocumentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Поля формы
  const [receiverCompanyId, setReceiverCompanyId] = useState('');
  const [docType, setDocType] = useState<DocumentType>('realization');
  const [docNumber, setDocNumber] = useState('');
  const [docDate, setDocDate] = useState(new Date().toISOString().split('T')[0]);
  const [comment, setComment] = useState('');

  // Список сканов R2
  const [filesState, setFilesState] = useState<FileItemState[]>([]);

  // Модалка архива
  const [showArchiveSelectModal, setShowArchiveSelectModal] = useState(false);
  const [archiveSearchTerm, setArchiveSearchTerm] = useState('');

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function loadFormData() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let myCompanyId = '';
      if (user) {
        const { data: prof } = await supabase.from('users').select('company_id').eq('id', user.id).single();
        if (prof?.company_id) myCompanyId = prof.company_id;
      }

      // 1. Подтвержденные компании-партнеры
      if (myCompanyId) {
        const { data: partData } = await supabase
          .from('company_partnerships')
          .select('*, requester_company:companies!requester_company_id(*), target_company:companies!target_company_id(*)')
          .eq('status', 'approved')
          .or(`requester_company_id.eq.${myCompanyId},target_company_id.eq.${myCompanyId}`);

        if (partData) {
          const approvedPartners: Company[] = [];
          partData.forEach((p: any) => {
            if (p.requester_company_id === myCompanyId && p.target_company) {
              approvedPartners.push(p.target_company);
            } else if (p.target_company_id === myCompanyId && p.requester_company) {
              approvedPartners.push(p.requester_company);
            }
          });
          setPartners(approvedPartners);
          if (approvedPartners.length > 0 && !editDocId) {
            setReceiverCompanyId(approvedPartners[0].id);
          }
        }
      }

      // 2. Категории файлов
      const { data: catData } = await supabase.from('file_categories').select('*').order('name');
      if (catData) setCategories(catData as FileCategory[]);

      // 3. Сканы из архива компании
      const archiveRes = await getCompanyFilesArchiveAction();
      if (archiveRes.success && archiveRes.data) {
        setArchiveFiles(archiveRes.data);
      }

      // 4. Если режим редактирования — загружаем существующие данные черновика
      if (editDocId) {
        const docRes = await getB2BDocumentByIdAction(editDocId);
        if (docRes.success && docRes.data) {
          const doc = docRes.data;
          setReceiverCompanyId(doc.receiver_company_id || '');
          setDocType(doc.doc_type || 'realization');
          setDocNumber(doc.doc_number || '');
          setDocDate(doc.doc_date || new Date().toISOString().split('T')[0]);
          setComment(doc.comment || '');

          if (doc.files && doc.files.length > 0) {
            const initialFiles: FileItemState[] = doc.files.map((f: any, idx: number) => ({
              tempId: `existing-${f.id}-${idx}`,
              category_id: f.category_id || catData?.[0]?.id || '',
              file_name: f.file_name,
              size_bytes: typeof f.size_bytes === 'number' ? f.size_bytes : 1572864,
              file_type: f.file_type || 'pdf',
              file_path_r2: f.file_path_r2 || undefined,
              description: f.description || `Скан ${f.file_name}`,
              comment: f.comment || '',
              progress: 100,
              uploading: false,
            }));
            setFilesState(initialFiles);
          }
        }
      }

      setLoading(false);
    }

    loadFormData();
  }, [editDocId]);

  const handleSelectFromArchive = (file: DocumentFile) => {
    const existingIndex = filesState.findIndex((f) => f.file_path_r2 === file.file_path_r2);
    if (existingIndex !== -1) {
      return;
    }

    const newItem: FileItemState = {
      tempId: `archive-${file.id}-${Date.now()}`,
      category_id: file.category_id || categories[0]?.id || '',
      file_name: file.file_name,
      size_bytes: typeof file.size_bytes === 'number' ? file.size_bytes : 1572864,
      file_type: file.file_type || 'image',
      file_path_r2: file.file_path_r2 || undefined,
      description: file.description || `Скан из архива: ${file.file_name}`,
      comment: file.comment || '',
      progress: 100,
      uploading: false,
    };

    setFilesState([...filesState, newItem]);
    setShowArchiveSelectModal(false);
  };

  const handleSave = (status: 'draft' | 'sent' = 'sent') => {
    setMsg(null);

    if (!receiverCompanyId) {
      setMsg({ type: 'error', text: 'Выберите зарегистрированного контрагента получателя' });
      return;
    }

    if (filesState.length === 0) {
      setMsg({ type: 'error', text: 'Прикрепите хотя бы один скан документа' });
      return;
    }

    const unuploaded = filesState.filter((f) => f.uploading || !f.file_path_r2);
    if (unuploaded.length > 0) {
      setMsg({ type: 'error', text: 'Дождитесь завершения загрузки всех файлов в облачный архив' });
      return;
    }

    startTransition(async () => {
      const payloadFiles = filesState.map((f) => ({
        category_id: f.category_id,
        file_name: f.file_name,
        size_bytes: f.size_bytes,
        file_type: f.file_type,
        file_path_r2: f.file_path_r2!,
        description: f.description,
        comment: f.comment,
      }));

      let res;
      if (editDocId) {
        // Режим редактирования
        res = await updateB2BDocumentFullAction(editDocId, {
          receiver_company_id: receiverCompanyId,
          doc_type: docType,
          doc_number: docNumber,
          doc_date: docDate,
          comment,
          status,
          files: payloadFiles,
        });

        if (res.success) {
          router.push(`/dashboard/documents/${editDocId}`);
        } else {
          setMsg({ type: 'error', text: res.error || 'Ошибка при сохранении изменений' });
        }
      } else {
        // Режим создания нового документа
        res = await createB2BDocumentAction({
          receiver_company_id: receiverCompanyId,
          doc_type: docType,
          doc_number: docNumber,
          doc_date: docDate,
          status,
          comment,
          files: payloadFiles,
        });

        if (res.success && res.data) {
          router.push(`/dashboard/documents/${res.data.id}`);
        } else {
          setMsg({ type: 'error', text: res.error || 'Ошибка отправки документа' });
        }
      }
    });
  };

  const filteredArchiveFiles = archiveFiles.filter(
    (f) =>
      f.file_name.toLowerCase().includes(archiveSearchTerm.toLowerCase()) ||
      f.description.toLowerCase().includes(archiveSearchTerm.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center space-x-3">
        <Link href="/dashboard/documents">
          <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:text-foreground hover:bg-muted min-h-[44px]">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад в реестр
          </Button>
        </Link>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center">
            {editDocId ? <Edit2 className="h-5 w-5 mr-2 text-blue-400" /> : <FileText className="h-5 w-5 mr-2 text-blue-400" />}
            {editDocId ? 'Редактирование Черновика Документа' : 'Создание Документа'}
          </h2>
          <p className="text-xs md:text-sm text-muted-foreground">
            {editDocId ? 'Полное изменение реквизитов и прикрепленных сканов первички' : 'Передача сканов первички зарегистрированному партнеру КР'}
          </p>
        </div>
      </div>

      <Card className="bg-card border-border backdrop-blur-xl shadow-2xl">
        <form onSubmit={(e) => { e.preventDefault(); handleSave('sent'); }}>
          <CardContent className="space-y-6 pt-6">
            {msg && (
              <Alert
                variant={msg.type === 'success' ? 'success' : 'destructive'}
              >
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{msg.text}</AlertDescription>
              </Alert>
            )}

            {/* Получатель */}
            <div className="space-y-2">
              <Label className="text-xs md:text-sm font-semibold text-foreground">
                Организация Получатель (Подтвержденный контрагент КР) *
              </Label>
              {partners.length === 0 ? (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-500 flex items-center justify-between">
                  <span>У вас пока нет подтвержденных контрагентов для отправки.</span>
                  <Link href="/dashboard/counterparties" className="underline font-bold">
                    Модуль Контрагенты
                  </Link>
                </div>
              ) : (
                <select
                  value={receiverCompanyId}
                  onChange={(e) => setReceiverCompanyId(e.target.value)}
                  required
                  className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring font-semibold"
                >
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (ИНН: {p.inn})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Реквизиты документа */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="docType" className="text-xs md:text-sm text-muted-foreground">
                  Тип Документа *
                </Label>
                <select
                  id="docType"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocumentType)}
                  className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="realization">Накладная реализации</option>
                  <option value="purchase">Акт выполненных работ</option>
                  <option value="payment">Платежный документ</option>
                  <option value="advance">Авансовый отчет</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="docNumber" className="text-xs md:text-sm text-muted-foreground">
                  Номер документа *
                </Label>
                <Input
                  id="docNumber"
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  placeholder="Например: № ТН-4501"
                  required
                  className="bg-background border-border text-foreground font-mono min-h-[44px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="docDate" className="text-xs md:text-sm text-muted-foreground">
                  Дата документа *
                </Label>
                <Input
                  id="docDate"
                  type="date"
                  value={docDate}
                  onChange={(e) => setDocDate(e.target.value)}
                  required
                  className="bg-background border-border text-foreground font-mono min-h-[44px]"
                />
              </div>
            </div>

            {/* Управление прикрепленными сканами R2 */}
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <Label className="text-xs md:text-sm font-semibold text-foreground">
                  Прикрепленные сканы первички (Удаление, Добавление, Замена) *
                </Label>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowArchiveSelectModal(true)}
                  className="border-border text-purple-400 hover:bg-purple-500/10 text-xs min-h-[44px]"
                >
                  <FolderOpen className="h-4 w-4 mr-1.5" />
                  Добавить скан из Архива
                </Button>
              </div>

              <MultiFileDropzone
                categories={categories}
                files={filesState}
                onFilesChange={setFilesState}
                disabled={isPending}
              />
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              <Label htmlFor="comment" className="text-xs md:text-sm text-muted-foreground">
                Примечание получателю
              </Label>
              <Input
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Сообщение или инструкции бухгалтерской службе..."
                className="bg-background border-border text-foreground min-h-[44px]"
              />
            </div>
          </CardContent>

          <CardFooter className="pt-4 pb-6 border-t border-border flex flex-col sm:flex-row justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSave('draft')}
              disabled={isPending || loading || partners.length === 0}
              className="w-full sm:w-auto border-border text-foreground hover:bg-muted font-medium min-h-[48px]"
            >
              Сохранить черновик
            </Button>

            <Button
              type="submit"
              disabled={isPending || loading || partners.length === 0}
              className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-md px-8 min-h-[48px]"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Отправка...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Отправить получателю
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* МОДАЛЬНОЕ ОКНО ВЫБОРА ИЗ ИМЕЮЩИХСЯ ФАЙЛОВ */}
      {showArchiveSelectModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <Card className="w-full max-w-2xl bg-card border-t sm:border border-border shadow-2xl overflow-hidden flex flex-col max-h-[88vh] rounded-t-3xl sm:rounded-2xl animate-in slide-in-from-bottom duration-300">
            <div className="sm:hidden w-12 h-1 bg-border rounded-full mx-auto mt-3 mb-1 opacity-80" />

            <CardHeader className="border-b border-border flex flex-row items-center justify-between pb-3 pt-3 sm:pt-6">
              <div>
                <CardTitle className="text-base md:text-lg text-foreground flex items-center">
                  <FolderOpen className="h-5 w-5 mr-2 text-purple-400" />
                  Выбрать скан из Личного Архива / Устава
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Повторное прикрепление ранее загруженных R2-файлов
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowArchiveSelectModal(false)}
                className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </Button>
            </CardHeader>

            <div className="p-4 border-b border-border bg-muted/40">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по наименованию скана..."
                  value={archiveSearchTerm}
                  onChange={(e) => setArchiveSearchTerm(e.target.value)}
                  className="pl-9 bg-background border-border text-foreground text-xs md:text-sm min-h-[44px]"
                />
              </div>
            </div>

            <CardContent className="p-4 space-y-2 overflow-y-auto max-h-96">
              {filteredArchiveFiles.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground text-xs">
                  Файлы в личном архиве не найдены
                </div>
              ) : (
                filteredArchiveFiles.map((file) => {
                  const isSelected = filesState.some((f) => f.file_path_r2 === file.file_path_r2);

                  return (
                    <div
                      key={file.id}
                      onClick={() => !isSelected && handleSelectFromArchive(file)}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between ${
                        isSelected
                          ? 'bg-muted/40 border-border opacity-60 cursor-not-allowed'
                          : 'bg-background border-border hover:border-purple-500/50 cursor-pointer'
                      }`}
                    >
                      <div className="min-w-0 pr-3">
                        <div className="font-bold text-foreground text-xs truncate">{file.file_name}</div>
                        <p className="text-xs text-muted-foreground mt-0.5">{file.description}</p>
                        <Badge variant="outline" className="text-[10px] border-border text-purple-400 mt-1">
                          {file.file_categories?.name || 'Архив'}
                        </Badge>
                      </div>

                      <Button
                        size="sm"
                        disabled={isSelected}
                        variant={isSelected ? 'outline' : 'default'}
                        className={`text-xs min-h-[40px] ${
                          isSelected ? 'border-slate-800 text-slate-500' : 'bg-purple-600 hover:bg-purple-500 text-white'
                        }`}
                      >
                        {isSelected ? (
                          <>
                            <Check className="h-3.5 w-3.5 mr-1" />
                            Прикреплен
                          </>
                        ) : (
                          'Прикрепить'
                        )}
                      </Button>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
