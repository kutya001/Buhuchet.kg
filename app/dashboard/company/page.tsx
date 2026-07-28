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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { MultiFileDropzone, type FileItemState } from '@/components/documents/MultiFileDropzone';
import { uploadLegalDocumentAction, getCompanyLegalDocsAction } from '../files/archive-actions';
import { getPresignedDownloadUrlAction } from '../files/actions';
import type { Company, DocumentFile, FileCategory } from '@/types/database.types';

export default function CompanyProfilePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'profile' | 'legal_docs'>('profile');
  const [company, setCompany] = useState<Company | null>(null);
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [legalDocs, setLegalDocs] = useState<DocumentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Состояние файлов для загрузки уставных документов
  const [uploadFiles, setUploadFiles] = useState<FileItemState[]>([]);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

        // 1. Чтение учредительных документов через Server Action
        const legalRes = await getCompanyLegalDocsAction();
        if (legalRes.success && legalRes.data) {
          setLegalDocs(legalRes.data);
        }
      }
    }

    // 2. Категории файлов
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

  // Мгновенное АВТО-СОХРАНЕНИЕ в Supabase сразу после завершения загрузки скана в Cloudflare R2
  const handleAutoSaveLegalDoc = async (item: FileItemState): Promise<boolean> => {
    if (!item.file_path_r2) return false;

    const res = await uploadLegalDocumentAction({
      category_id: item.category_id,
      file_name: item.file_name,
      file_size: item.file_size,
      file_type: item.file_type,
      file_path_r2: item.file_path_r2,
      description: item.description || `Учредительный документ ${item.file_name}`,
      comment: item.comment,
      is_legal_doc: true,
    });

    if (res.success) {
      setMsg({ type: 'success', text: `Скан "${item.file_name}" успешно сохранен и прикреплен к организации!` });
      router.refresh();
      const updatedDocs = await getCompanyLegalDocsAction();
      if (updatedDocs.success && updatedDocs.data) {
        setLegalDocs(updatedDocs.data);
      }
      return true;
    } else {
      setMsg({ type: 'error', text: res.error || 'Ошибка прикрепления документа' });
      return false;
    }
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
          {/* Форма добавления нового уставного документа */}
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
              onAutoSave={handleAutoSaveLegalDoc}
            />
          </Card>

          {/* Список загруженных уставных файлов */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {legalDocs.length === 0 ? (
              <div className="col-span-full p-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800">
                Учредительные документы пока не прикреплены
              </div>
            ) : (
              legalDocs.map((doc) => (
                <Card key={doc.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-white text-xs truncate max-w-[180px]">{doc.file_name}</h4>
                        <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-400 mt-1">
                          {doc.file_categories?.name || 'Учредительный'}
                        </Badge>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 font-medium">{doc.description}</p>
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
    </div>
  );
}
