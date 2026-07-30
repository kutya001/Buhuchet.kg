'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Building2,
  Mail,
  Phone,
  MapPin,
  User,
  Shield,
  FileText,
  Upload,
  Camera,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Download,
  FolderOpen,
  Edit2,
  Trash2,
  X,
  RefreshCw,
} from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { MultiFileDropzone, type FileItemState } from '@/components/documents/MultiFileDropzone';
import {
  uploadLegalDocumentAction,
  getCompanyLegalDocsAction,
  updateDocumentFileAction,
  deleteDocumentFileAction,
} from '../files/archive-actions';
import { getPresignedDownloadUrlAction, getPresignedUploadUrlAction } from '../files/actions';
import type { Company, DocumentFile, FileCategory } from '@/types/database.types';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';

export default function CompanyProfilePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'profile' | 'legal_docs'>('profile');
  const [company, setCompany] = useState<Company | null>(null);
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [legalDocs, setLegalDocs] = useState<DocumentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Состояние формы сохранения новых документов
  const [uploadFiles, setUploadFiles] = useState<FileItemState[]>([]);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Модальное окно редактирования/замены
  const [editingDoc, setEditingDoc] = useState<DocumentFile | null>(null);
  const [editName, setEditName] = useState('');
  const [editCatId, setEditCatId] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [replacingFile, setReplacingFile] = useState<File | null>(null);
  const [replaceUploading, setReplaceUploading] = useState(false);

  const supabase = createClient();

  const loadCompanyData = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: prof } = await supabase
        .from('users')
        .select('company_id, companies(*)')
        .eq('id', user.id)
        .single();

      const comp = Array.isArray(prof?.companies) ? prof?.companies[0] : prof?.companies;
      if (comp) {
        setCompany(comp as Company);

        const legalRes = await getCompanyLegalDocsAction();
        if (legalRes.success && legalRes.data) {
          setLegalDocs(legalRes.data);
        }
      }
    }

    const { data: catData } = await supabase.from('file_categories').select('*').order('name');
    if (catData) setCategories(catData as FileCategory[]);

    setLoading(false);
  };

  useEffect(() => {
    loadCompanyData();
  }, []);

  const handleDownloadR2File = async (fileKey?: string | null) => {
    if (!fileKey) return;
    const res = await getPresignedDownloadUrlAction(fileKey);
    if (res.success && res.data?.downloadUrl) {
      window.open(res.data.downloadUrl, '_blank');
    }
  };

  // Ручное сохранение выбранных файлов из таблицы формы
  const handleSaveLegalDocs = () => {
    if (uploadFiles.length === 0) return;

    setMsg(null);
    startTransition(async () => {
      let successCount = 0;
      for (const item of uploadFiles) {
        if (!item.file_path_r2) continue;

        const res = await uploadLegalDocumentAction({
          category_id: item.category_id,
          file_name: item.file_name,
          file_size: item.size_bytes,
          file_type: item.file_type,
          file_path_r2: item.file_path_r2,
          description: item.description || `Учредительный документ ${item.file_name}`,
          comment: item.comment,
          is_legal_doc: true,
        });

        if (res.success) successCount++;
      }

      if (successCount > 0) {
        setMsg({ type: 'success', text: `Сохранено уставных сканов: ${successCount}` });
        setUploadFiles([]);
        router.refresh();
        await loadCompanyData();
      } else {
        setMsg({ type: 'error', text: 'Ошибка при сохранении документов' });
      }
    });
  };

  const handleOpenEdit = (doc: DocumentFile) => {
    setEditingDoc(doc);
    setEditName(doc.file_name);
    setEditCatId(doc.category_id || categories[0]?.id || '');
    setEditDesc(doc.description || '');
    setReplacingFile(null);
  };

  const handleSaveEdit = async () => {
    if (!editingDoc) return;

    setMsg(null);
    startTransition(async () => {
      let newKey = editingDoc.file_path_r2;
      let newSize = editingDoc.size_bytes;
      let newName = editName;

      // Если пользователь выбрал новый файл для замены
      if (replacingFile) {
        setReplaceUploading(true);
        const presigned = await getPresignedUploadUrlAction(replacingFile.name, replacingFile.type);
        if (!presigned.success || !presigned.data) {
          setMsg({ type: 'error', text: 'Сбой создания ссылки для замены файла' });
          setReplaceUploading(false);
          return;
        }

        const xhr = new XMLHttpRequest();
        xhr.open('PUT', presigned.data.uploadUrl, false); // синхронный отправщик в R2
        xhr.setRequestHeader('Content-Type', replacingFile.type || 'application/octet-stream');
        xhr.send(replacingFile);

        if (xhr.status >= 200 && xhr.status < 300) {
          newKey = presigned.data.fileKey;
          newSize = replacingFile.size;
          if (!editName) newName = replacingFile.name;
        } else {
          setMsg({ type: 'error', text: 'Ошибка отправки нового скана в R2' });
          setReplaceUploading(false);
          return;
        }
        setReplaceUploading(false);
      }

      const res = await updateDocumentFileAction(editingDoc.id, {
        file_name: newName,
        category_id: editCatId,
        description: editDesc,
        file_path_r2: newKey || undefined,
        file_size: newSize || undefined,
      });

      if (res.success) {
        setMsg({ type: 'success', text: 'Учредительный документ успешно обновлен!' });
        setEditingDoc(null);
        router.refresh();
        await loadCompanyData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Сбой обновления документа' });
      }
    });
  };

  const handleDeleteDoc = async (fileId: string) => {
    if (!confirm('Вы действительно хотите удалить этот учредительный скан?')) return;

    startTransition(async () => {
      const res = await deleteDocumentFileAction(fileId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Скан удален' });
        router.refresh();
        await loadCompanyData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления скана' });
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка профиля компании...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center">
            <Building2 className="h-6 w-6 mr-2 text-blue-400" />
            Управление Организацией
          </h2>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Карточка организации и реквизиты учредительных документов КР
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

      {/* Вкладки Раздела */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('profile')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-all ${
            activeTab === 'profile'
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>Профиль & Реквизиты</span>
        </button>

        <button
          onClick={() => setActiveTab('legal_docs')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-all ${
            activeTab === 'legal_docs'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Учредительные Документы ({legalDocs.length})</span>
        </button>
      </div>

      {/* 1. Вкладка Профиль & Реквизиты */}
      {activeTab === 'profile' && company && (
        <Card className="bg-slate-900/40 border-slate-800 p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-slate-500">Наименование</Label>
                <p className="text-lg font-bold text-white mt-0.5">{company.name}</p>
              </div>

              <div>
                <Label className="text-xs text-slate-500">ИНН Кыргызской Республики</Label>
                <p className="text-base font-mono font-bold text-amber-400 mt-0.5">{company.inn}</p>
              </div>

              <div>
                <Label className="text-xs text-slate-500">Отрасль Организации</Label>
                <p className="text-sm text-slate-200 mt-0.5">{company.industry || 'Услуги / Консалтинг'}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="text-xs text-slate-500">ФИО Руководителя</Label>
                <p className="text-sm font-medium text-slate-200 mt-0.5">{company.director_name || '—'}</p>
              </div>

              <div>
                <Label className="text-xs text-slate-500">Официальный E-mail</Label>
                <p className="text-sm font-mono text-slate-200 mt-0.5">{company.email || '—'}</p>
              </div>

              <div>
                <Label className="text-xs text-slate-500">Юридический Адрес</Label>
                <p className="text-sm text-slate-200 mt-0.5">{company.legal_address || company.address || '—'}</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 2. Вкладка Учредительные Документы */}
      {activeTab === 'legal_docs' && (
        <div className="space-y-6">
          <Card className="bg-slate-900/40 border-slate-800 p-4 md:p-6 space-y-4">
            <h3 className="text-sm md:text-base font-bold text-white flex items-center">
              <Upload className="h-4 w-4 mr-2 text-purple-400" />
              Загрузить Учредительные Сканы (Устав, Свидетельство, Паспорт)
            </h3>

            <MultiFileDropzone
              categories={categories}
              files={uploadFiles}
              onFilesChange={setUploadFiles}
              disabled={isPending}
            />

            {uploadFiles.length > 0 && (
              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSaveLegalDocs}
                  disabled={isPending || uploadFiles.some((f) => f.uploading)}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs md:text-sm min-h-[48px] px-6 shadow-lg shadow-purple-600/20"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Сохранить ({uploadFiles.length}) в Учредительные Документы
                </Button>
              </div>
            )}
          </Card>

          {/* ЕДИНООБРАЗНАЯ ТАБЛИЦА/КАРТОЧКИ УСТАВНЫХ ФАЙЛОВ UnifiedDataGrid */}
          <UnifiedDataGrid<DocumentFile>
            columns={[
              {
                key: 'file_name',
                label: 'Наименование Файла',
                sortable: true,
                render: (doc) => (
                  <div className="font-semibold text-white text-xs sm:text-sm flex items-center space-x-2">
                    <FileText className="h-4 w-4 text-purple-400 flex-shrink-0" />
                    <span className="truncate max-w-[200px]">{doc.file_name}</span>
                  </div>
                ),
              },
              {
                key: 'category',
                label: 'Категория',
                sortable: true,
                getValue: (doc) => doc.file_categories?.name,
                render: (doc) => (
                  <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-xs">
                    {doc.file_categories?.name || 'Учредительный'}
                  </Badge>
                ),
              },
              {
                key: 'size_bytes',
                label: 'Размер',
                sortable: true,
                render: (doc) => <span className="font-mono text-xs text-slate-400">{formatBytes(doc.size_bytes)}</span>,
              },
              {
                key: 'actions',
                label: 'Действия',
                sortable: false,
                render: (doc) => (
                  <div className="flex items-center justify-end space-x-2">
                    {doc.file_path_r2 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadR2File(doc.file_path_r2!)}
                        className="border-slate-800 text-purple-400 text-xs min-h-[36px]"
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        Скачать
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleOpenEdit(doc)}
                      className="h-8 w-8 p-0 text-slate-400 hover:text-blue-400"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteDoc(doc.id)}
                      className="h-8 w-8 p-0 text-slate-400 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              },
            ]}
            data={legalDocs}
            keyExtractor={(doc) => doc.id}
            searchPlaceholder="Поиск по имени документа..."
            emptyMessage="Учредительные документы пока не загружены."
            isLoading={loading}
            defaultPageSize={25}
          />
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ И ЗАМЕНЫ ФАЙЛА R2 (UnifiedFormModal) */}
      <UnifiedFormModal
        isOpen={!!editingDoc}
        onClose={() => setEditingDoc(null)}
        title="Редактирование / Замена Файла R2"
        subtitle="Изменение категорий и замена исходного скана"
        mode="edit"
        onSubmit={(e) => {
          e.preventDefault();
          handleSaveEdit();
        }}
        isSubmitting={isPending || replaceUploading}
        submitText="Сохранить изменения"
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-slate-400">Название файла</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="bg-slate-950 border-slate-800 text-white min-h-[44px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-400">Категория скана</Label>
            <select
              value={editCatId}
              onChange={(e) => setEditCatId(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-400">Описание</Label>
            <Input
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="bg-slate-950 border-slate-800 text-white min-h-[44px]"
            />
          </div>

          {/* Замена файла в R2 */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <Label className="text-xs text-purple-400 font-semibold flex items-center">
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Заменить сам скан в Cloudflare R2 (опционально)
            </Label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => e.target.files?.[0] && setReplacingFile(e.target.files[0])}
              className="text-xs text-slate-400 file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-slate-800 file:text-slate-200"
            />
            {replacingFile && (
              <p className="text-[11px] text-emerald-400 font-mono">
                Выбран для замены: {replacingFile.name}
              </p>
            )}
          </div>
        </div>
      </UnifiedFormModal>
    </div>
  );
}
