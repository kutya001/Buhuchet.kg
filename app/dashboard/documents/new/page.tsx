'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  FileText,
  Send,
  Building2,
  ArrowLeft,
  Loader2,
  AlertCircle,
  FolderPlus,
  UserPlus,
  Globe,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { createB2BDocumentAction } from '../actions';
import { MultiFileDropzone, FileItemState } from '@/components/documents/MultiFileDropzone';
import type { Company, FileCategory, DocumentType, CompanyPartnership } from '@/types/database.types';

export default function NewB2BDocumentPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [approvedPartners, setApprovedPartners] = useState<Company[]>([]);
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [loading, setLoading] = useState(true);

  // Поля формы
  const [docType, setDocType] = useState<DocumentType>('realization');
  const [receiverCompanyId, setReceiverCompanyId] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [docDate, setDocDate] = useState(new Date().toISOString().split('T')[0]);
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<FileItemState[]>([]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function loadApprovedPartnersData() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let myCompanyId = '';
      if (user) {
        const { data: prof } = await supabase.from('users').select('company_id').eq('id', user.id).single();
        if (prof?.company_id) myCompanyId = prof.company_id;
      }

      if (myCompanyId) {
        // 1. Получаем только ОДОБРЕННЫЕ партнерства (status = 'approved')
        const { data: partData } = await supabase
          .from('company_partnerships')
          .select('*, requester_company:companies!requester_company_id(*), target_company:companies!target_company_id(*)')
          .eq('status', 'approved')
          .or(`requester_company_id.eq.${myCompanyId},target_company_id.eq.${myCompanyId}`);

        if (partData) {
          const partnersList: Company[] = [];
          (partData as (CompanyPartnership & { requester_company: Company; target_company: Company })[]).forEach((p) => {
            if (p.requester_company_id === myCompanyId && p.target_company) {
              partnersList.push(p.target_company);
            } else if (p.target_company_id === myCompanyId && p.requester_company) {
              partnersList.push(p.requester_company);
            }
          });

          setApprovedPartners(partnersList);
        }
      }

      // 2. Категории файлов
      const { data: catData } = await supabase
        .from('file_categories')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (catData) {
        setCategories(catData as FileCategory[]);
      }

      setLoading(false);
    }

    loadApprovedPartnersData();
  }, []);

  const handleSubmit = (targetStatus: 'draft' | 'sent') => {
    setErrorMsg(null);

    if (!receiverCompanyId) {
      setErrorMsg('Выберите подтвержденную компанию-получателя документа');
      return;
    }

    if (files.length === 0) {
      setErrorMsg('Прикрепите хотя бы один файл с описанием');
      return;
    }

    for (const f of files) {
      if (!f.description || f.description.trim().length < 3) {
        setErrorMsg(`Заполните описание для файла "${f.file_name}" (минимум 3 символа)`);
        return;
      }
    }

    const payload = {
      doc_type: docType,
      receiver_company_id: receiverCompanyId,
      doc_number: docNumber || null,
      doc_date: docDate,
      comment: comment || null,
      status: targetStatus,
      files,
    };

    startTransition(async () => {
      const res = await createB2BDocumentAction(payload);
      if (res.success && res.data) {
        router.push(`/dashboard/documents/${res.data.id}`);
      } else {
        setErrorMsg(res.error || 'Ошибка сохранения B2B документа');
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка списка подтвержденных партнеров...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Link href="/dashboard/documents">
            <Button variant="outline" size="sm" className="border-slate-800 text-slate-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" />
              К реестру
            </Button>
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Создание & B2B Отправка Документа</h2>
            <p className="text-sm text-slate-400">Адресация документов только подтвержденным B2B партнерам</p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-400">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      {/* Проверка наличия подтвержденных партнеров */}
      {approvedPartners.length === 0 ? (
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-300 p-6">
          <Globe className="h-6 w-6 text-amber-400 mb-2" />
          <AlertTitle className="text-lg font-bold text-white">У вашей организации пока нет подтвержденных B2B партнеров!</AlertTitle>
          <AlertDescription className="text-sm text-amber-200/80 mt-2 space-y-4">
            <p>
              В соответствии с правилами безопасности платформы, отправка первичных документов разрешена 
              <strong> только организациям с подтвержденным статусом сотрудничества</strong>.
            </p>
            <div>
              <Link href="/dashboard/companies-catalog">
                <Button className="bg-amber-600 hover:bg-amber-500 text-white font-semibold">
                  <UserPlus className="mr-2 h-4 w-4" />
                  Перейти в Каталог Компаний и запросить сотрудничество
                </Button>
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-6">
          {/* Шапка B2B адресации */}
          <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Building2 className="h-5 w-5 mr-2 text-blue-400" />
                Адресация и Реквизиты
              </CardTitle>
            </CardHeader>

            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="receiver">Подтвержденная Организация-Получатель *</Label>
                <select
                  id="receiver"
                  value={receiverCompanyId}
                  onChange={(e) => setReceiverCompanyId(e.target.value)}
                  required
                  className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Выберите подтвержденного партнера из списка --</option>
                  {approvedPartners.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (ИНН: {c.inn}) — [{c.industry || 'Отрасль'}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="doc_type">Тип Документа</Label>
                <select
                  id="doc_type"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocumentType)}
                  className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="realization">Реализация (Продажа)</option>
                  <option value="purchase">Закуп (Поступление)</option>
                  <option value="payment">Оплата (Перевод / Чек)</option>
                  <option value="advance">Авансовый отчет</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="doc_number">Номер Документа</Label>
                <Input
                  id="doc_number"
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  placeholder="№ 102-А"
                  className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="doc_date">Дата Документа</Label>
                <Input
                  id="doc_date"
                  type="date"
                  value={docDate}
                  onChange={(e) => setDocDate(e.target.value)}
                  required
                  className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="comment">Примечание к отправке</Label>
                <Input
                  id="comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Например: Пакет документов за текущий квартал"
                  className="bg-slate-950 border-slate-800 text-slate-100"
                />
              </div>
            </CardContent>
          </Card>

          {/* Мультизагрузка файлов */}
          <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <FolderPlus className="h-5 w-5 mr-2 text-emerald-400" />
                Прикрепить файлы / сканы первички
              </CardTitle>
              <CardDescription>
                Загрузите сканы в Cloudflare R2 и заполните обязательные категории и описания
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MultiFileDropzone
                categories={categories}
                files={files}
                onFilesChange={setFiles}
                disabled={isPending}
              />
            </CardContent>

            <CardFooter className="pt-4 pb-6 flex justify-end space-x-3 border-t border-slate-800/60">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSubmit('draft')}
                disabled={isPending}
                className="border-slate-800 text-slate-300 hover:text-white"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Сохранить черновик
              </Button>

              <Button
                type="button"
                onClick={() => handleSubmit('sent')}
                disabled={isPending}
                className="bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-600/20"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Отправка...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Отправить партнеру
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
