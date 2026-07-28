'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Building2,
  Search,
  Eye,
  FileText,
  Loader2,
  FolderOpen,
  Download,
  Edit2,
  Trash2,
  X,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import {
  getPendingCompaniesAction,
  getAllCompaniesAdminAction,
  approveCompanyAction,
  requestCompanyChangesAction,
  blockCompanyAction,
} from './actions';
import {
  getAllSystemFilesAction,
  updateDocumentFileAction,
  deleteDocumentFileAction,
} from '../dashboard/files/archive-actions';
import { getPresignedDownloadUrlAction, getPresignedUploadUrlAction } from '../dashboard/files/actions';
import type { Company, DocumentFile, FileCategory } from '@/types/database.types';
import { createClient } from '@/lib/supabase/client';

export default function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<'moderation' | 'all_companies' | 'all_files'>('moderation');
  const [pendingCompanies, setPendingCompanies] = useState<Company[]>([]);
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const [systemFiles, setSystemFiles] = useState<any[]>([]);
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Модальные окна модерации организаций
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [moderationComment, setModerationComment] = useState('');
  const [modalMode, setModalMode] = useState<'approve' | 'request_changes' | 'block' | 'details' | null>(null);

  // Модальное окно редактирования/замены файла Суперадмином
  const [editingFile, setEditingFile] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  const [editCatId, setEditCatId] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [replacingFile, setReplacingFile] = useState<File | null>(null);
  const [replaceUploading, setReplaceUploading] = useState(false);

  const supabase = createClient();

  const loadData = async () => {
    setLoading(true);
    const pendRes = await getPendingCompaniesAction();
    if (pendRes.success && pendRes.data) setPendingCompanies(pendRes.data);

    const allRes = await getAllCompaniesAdminAction();
    if (allRes.success && allRes.data) setAllCompanies(allRes.data);

    const filesRes = await getAllSystemFilesAction();
    if (filesRes.success && filesRes.data) setSystemFiles(filesRes.data);

    const { data: catData } = await supabase.from('file_categories').select('*').order('name');
    if (catData) setCategories(catData as FileCategory[]);

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleApprove = (comp: Company) => {
    setMsg(null);
    startTransition(async () => {
      const res = await approveCompanyAction(comp.id);
      if (res.success) {
        setMsg({ type: 'success', text: `Организация "${comp.name}" верифицирована` });
        setModalMode(null);
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка верификации' });
      }
    });
  };

  const handleRequestChanges = (comp: Company) => {
    if (!moderationComment.trim()) {
      alert('Укажите замечания по доработке!');
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await requestCompanyChangesAction(comp.id, moderationComment);
      if (res.success) {
        setMsg({ type: 'success', text: `Замечания отправлены в "${comp.name}"` });
        setModalMode(null);
        setModerationComment('');
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка отправки замечаний' });
      }
    });
  };

  const handleBlock = (comp: Company) => {
    if (!moderationComment.trim()) {
      alert('Укажите причина блокировки!');
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await blockCompanyAction(comp.id, moderationComment);
      if (res.success) {
        setMsg({ type: 'success', text: `Организация "${comp.name}" заблокирована` });
        setModalMode(null);
        setModerationComment('');
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка блокировки' });
      }
    });
  };

  const handleDownloadR2File = async (fileKey?: string | null) => {
    if (!fileKey) return;
    const res = await getPresignedDownloadUrlAction(fileKey);
    if (res.success && res.data?.downloadUrl) {
      window.open(res.data.downloadUrl, '_blank');
    }
  };

  const handleOpenEditFile = (file: any) => {
    setEditingFile(file);
    setEditName(file.file_name);
    setEditCatId(file.category_id || categories[0]?.id || '');
    setEditDesc(file.description || '');
    setReplacingFile(null);
  };

  const handleSaveEditFile = async () => {
    if (!editingFile) return;

    setMsg(null);
    startTransition(async () => {
      let newKey = editingFile.file_path_r2;
      let newSize = editingFile.file_size;
      let newName = editName;

      if (replacingFile) {
        setReplaceUploading(true);
        const presigned = await getPresignedUploadUrlAction(replacingFile.name, replacingFile.type);
        if (!presigned.success || !presigned.data) {
          setMsg({ type: 'error', text: 'Сбой создания ссылки для замены файла' });
          setReplaceUploading(false);
          return;
        }

        const xhr = new XMLHttpRequest();
        xhr.open('PUT', presigned.data.uploadUrl, false);
        xhr.setRequestHeader('Content-Type', replacingFile.type || 'application/octet-stream');
        xhr.send(replacingFile);

        if (xhr.status >= 200 && xhr.status < 300) {
          newKey = presigned.data.fileKey;
          newSize =
            replacingFile.size > 1024 * 1024
              ? `${(replacingFile.size / (1024 * 1024)).toFixed(1)} MB`
              : `${Math.round(replacingFile.size / 1024)} KB`;
          if (!editName) newName = replacingFile.name;
        } else {
          setMsg({ type: 'error', text: 'Ошибка отправки нового файла в R2' });
          setReplaceUploading(false);
          return;
        }
        setReplaceUploading(false);
      }

      const res = await updateDocumentFileAction(editingFile.id, {
        file_name: newName,
        category_id: editCatId,
        description: editDesc,
        file_path_r2: newKey || undefined,
        file_size: newSize || undefined,
      });

      if (res.success) {
        setMsg({ type: 'success', text: 'Файл системы успешно обновлен/заменен!' });
        setEditingFile(null);
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Сбой обновления файла' });
      }
    });
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm('Вы действительно хотите удалить этот файл из системы?')) return;

    startTransition(async () => {
      const res = await deleteDocumentFileAction(fileId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Файл удален из системы' });
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления файла' });
      }
    });
  };

  const filteredFiles = systemFiles.filter((f) => {
    const term = search.toLowerCase();
    const matchesName = f.file_name?.toLowerCase().includes(term);
    const matchesDesc = f.description?.toLowerCase().includes(term);
    const matchesComp = f.companies?.name?.toLowerCase().includes(term) || f.companies?.inn?.includes(term);
    return matchesName || matchesDesc || matchesComp;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка панели суперадмина...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center">
            <Shield className="h-6 w-6 mr-2 text-amber-400" />
            Панель Суперадмина
          </h2>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Верификация организаций Кыргызстана и контроль файлов системы
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

      {/* Вкладки Суперадмина */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('moderation')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-all whitespace-nowrap min-h-[44px] ${
            activeTab === 'moderation'
              ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>На Модерации ({pendingCompanies.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('all_companies')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-all whitespace-nowrap min-h-[44px] ${
            activeTab === 'all_companies'
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>Все Организации ({allCompanies.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('all_files')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-all whitespace-nowrap min-h-[44px] ${
            activeTab === 'all_files'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <FolderOpen className="h-4 w-4" />
          <span>Все Файлы Системы ({systemFiles.length})</span>
        </button>
      </div>

      {/* 1. На Модерации */}
      {activeTab === 'moderation' && (
        <div className="space-y-4">
          {pendingCompanies.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800">
              Нет заявок на модерацию
            </div>
          ) : (
            pendingCompanies.map((comp) => (
              <Card key={comp.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                  <div>
                    <h3 className="font-bold text-white text-base">{comp.name}</h3>
                    <p className="text-xs font-mono text-amber-400">ИНН: {comp.inn}</p>
                    <p className="text-xs text-slate-400">Руководитель: {comp.director_name || '—'}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleApprove(comp)}
                      disabled={isPending}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white min-h-[44px]"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1.5" />
                      Подтвердить
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedCompany(comp);
                        setModalMode('request_changes');
                      }}
                      disabled={isPending}
                      className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 min-h-[44px]"
                    >
                      <AlertTriangle className="h-4 w-4 mr-1.5" />
                      Замечания
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setSelectedCompany(comp);
                        setModalMode('block');
                      }}
                      disabled={isPending}
                      className="min-h-[44px]"
                    >
                      <XCircle className="h-4 w-4 mr-1.5" />
                      Заблокировать
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* 2. Все Организации */}
      {activeTab === 'all_companies' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {allCompanies.map((comp) => (
              <Card key={comp.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-white text-sm">{comp.name}</h4>
                    <p className="text-xs font-mono text-amber-400 mt-0.5">ИНН: {comp.inn}</p>
                  </div>
                  <Badge
                    variant={
                      comp.status === 'active'
                        ? 'success'
                        : comp.status === 'blocked'
                        ? 'destructive'
                        : 'outline'
                    }
                    className="text-[10px]"
                  >
                    {comp.status}
                  </Badge>
                </div>
                <p className="text-xs text-slate-400">Директор: {comp.director_name || '—'}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* 3. Реестр всех файлов системы */}
      {activeTab === 'all_files' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск файла по имени, описанию или названию компании..."
              className="pl-10 bg-slate-950 border-slate-800 text-white min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredFiles.length === 0 ? (
              <div className="col-span-full p-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800">
                Системные файлы не найдены
              </div>
            ) : (
              filteredFiles.map((doc) => (
                <Card key={doc.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3 flex flex-col justify-between hover:border-slate-700 transition-colors">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-white text-xs truncate">{doc.file_name}</h4>
                        <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-400 mt-1">
                          {doc.companies?.name || 'Организация'}
                        </Badge>
                      </div>

                      <div className="flex items-center space-x-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenEditFile(doc)}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-blue-400"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteFile(doc.id)}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 font-medium line-clamp-2">{doc.description || 'Без описания'}</p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 mt-2">
                    <span className="text-[10px] font-mono text-slate-500">{doc.file_size || '1.5 MB'}</span>

                    {doc.file_path_r2 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownloadR2File(doc.file_path_r2)}
                        className="h-8 p-1 text-xs text-blue-400 hover:text-white"
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Скачать R2
                      </Button>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ И ЗАМЕНЫ ФАЙЛА СУПЕРАДМИНОМ */}
      {editingFile && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-lg bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h3 className="font-bold text-white text-base flex items-center">
                <Edit2 className="h-4 w-4 mr-2 text-blue-400" />
                Админ-Редактирование / Замена Файла R2
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setEditingFile(null)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Имя файла</Label>
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
                <Label className="text-xs text-emerald-400 font-semibold flex items-center">
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Перезагрузить сам файл в R2 (опционально)
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

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <Button variant="ghost" onClick={() => setEditingFile(null)} className="min-h-[44px]">
                Отмена
              </Button>
              <Button
                onClick={handleSaveEditFile}
                disabled={isPending || replaceUploading}
                className="bg-blue-600 hover:bg-blue-500 text-white min-h-[44px] px-6"
              >
                {isPending || replaceUploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Сохранить изменения
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО ЗАМЕЧАНИЙ / БЛОКИРОВКИ */}
      {selectedCompany && (modalMode === 'request_changes' || modalMode === 'block') && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-white text-base">
              {modalMode === 'request_changes' ? 'Замечания по модерации' : 'Причина блокировки'}
            </h3>

            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Укажите подробный комментарий</Label>
              <textarea
                value={moderationComment}
                onChange={(e) => setModerationComment(e.target.value)}
                placeholder="Причина отклонения или необходимость выслать новые уставные документы..."
                rows={3}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-slate-100 focus:outline-none"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <Button variant="ghost" onClick={() => setSelectedCompany(null)} className="min-h-[44px]">
                Отмена
              </Button>
              <Button
                onClick={() =>
                  modalMode === 'request_changes'
                    ? handleRequestChanges(selectedCompany)
                    : handleBlock(selectedCompany)
                }
                disabled={isPending}
                className="bg-amber-600 hover:bg-amber-500 text-white min-h-[44px] px-4"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Отправить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
