'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
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
  Shield,
  Building2,
  Users,
  FolderOpen,
  Settings,
  Plus,
  Lock,
  Unlock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  ToggleLeft,
  ToggleRight,
  Clock,
  Check,
  XCircle,
  AlertOctagon,
  Eye,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  createFileCategoryAction,
  updateUserCompanyAndRoleAction,
  toggleFeatureFlagAction,
  toggleCompanyStatusAction,
  approveCompanyAction,
  rejectCompanyWithCommentAction,
} from './actions';
import type { Company, UserProfile, FileCategory, DocumentFile, FeatureFlag, Document } from '@/types/database.types';

type GlobalFile = DocumentFile & {
  file_categories?: FileCategory | null;
  documents?: (Document & {
    sender_company?: Company | null;
    receiver_company?: Company | null;
  }) | null;
};

export default function SuperAdminDashboard() {
  const [activeTab, setActiveTab] = useState<'moderation' | 'companies' | 'categories' | 'users' | 'global_files' | 'flags'>('moderation');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [globalFiles, setGlobalFiles] = useState<GlobalFile[]>([]);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);

  // Модалка отклонения на доработку
  const [rejectCompanyId, setRejectCompanyId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [selectedCompDetails, setSelectedCompDetails] = useState<Company | null>(null);

  // Форма новой категории
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const loadAllAdminData = async () => {
    setLoading(true);

    // 1. Компании
    const { data: compData } = await supabase.from('companies').select('*').order('created_at', { ascending: false });
    if (compData) setCompanies(compData as Company[]);

    // 2. Категории
    const { data: catData } = await supabase.from('file_categories').select('*').order('name');
    if (catData) setCategories(catData as FileCategory[]);

    // 3. Пользователи
    const { data: usersData } = await supabase.from('users').select('*, companies(*)').order('created_at', { ascending: false });
    if (usersData) setUsers(usersData as UserProfile[]);

    // 4. Глобальные файлы
    const { data: filesData } = await supabase
      .from('document_files')
      .select('*, file_categories(*), documents(*, sender_company:companies!sender_company_id(*), receiver_company:companies!receiver_company_id(*))')
      .order('created_at', { ascending: false });
    if (filesData) setGlobalFiles(filesData as GlobalFile[]);

    // 5. Feature Flags
    const { data: flagData } = await supabase.from('feature_flags').select('*').order('key');
    if (flagData) setFeatureFlags(flagData as FeatureFlag[]);

    setLoading(false);
  };

  useEffect(() => {
    loadAllAdminData();
  }, []);

  // Одобрение компании
  const handleApproveCompany = (companyId: string, companyName: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await approveCompanyAction(companyId);
      if (res.success) {
        setMsg({ type: 'success', text: `Организация "${companyName}" успешно активирована!` });
        loadAllAdminData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка активации' });
      }
    });
  };

  // Возврат компании на доработку
  const handleRejectCompany = () => {
    if (!rejectCompanyId || !rejectComment) return;

    setMsg(null);
    startTransition(async () => {
      const res = await rejectCompanyWithCommentAction(rejectCompanyId, rejectComment);
      if (res.success) {
        setMsg({ type: 'success', text: 'Заявка возвращена компании на доработку' });
        setRejectCompanyId(null);
        setRejectComment('');
        loadAllAdminData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка отправки замечаний' });
      }
    });
  };

  // Добавление категории
  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName) return;

    setMsg(null);
    startTransition(async () => {
      const res = await createFileCategoryAction(newCatName, newCatDesc);
      if (res.success) {
        setMsg({ type: 'success', text: `Категория "${newCatName}" создана` });
        setNewCatName('');
        setNewCatDesc('');
        loadAllAdminData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка создания категории' });
      }
    });
  };

  const pendingModerationCompanies = companies.filter(
    (c) => c.status === 'pending_approval' || c.status === 'requires_changes'
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center">
            <Shield className="h-6 w-6 mr-2 text-amber-400" />
            Центр Модерации Суперадмина
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Проверка заявлений на регистрацию юрлиц и управление B2B сетью
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

      {/* Вкладки */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('moderation')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'moderation'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Clock className="h-4 w-4" />
          <span>Заявки на Модерацию ({pendingModerationCompanies.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('companies')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'companies'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>Все Организации ({companies.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('categories')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'categories'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Категории Файлов</span>
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'users'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Пользователи ({users.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('global_files')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'global_files'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <FolderOpen className="h-4 w-4" />
          <span>Глобальные Файлы ({globalFiles.length})</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Загрузка данных админ-панели...</span>
        </div>
      ) : (
        <>
          {/* 1. Вкладка Модерации Заявок */}
          {activeTab === 'moderation' && (
            <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
              <CardContent className="p-0">
                {pendingModerationCompanies.length === 0 ? (
                  <div className="p-12 text-center text-slate-500">
                    Новые заявки на модерацию организаций отсутствуют
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-slate-950/60">
                      <TableRow>
                        <TableHead>Организация / Руководитель</TableHead>
                        <TableHead>ИНН КР (14 цифр)</TableHead>
                        <TableHead>Отрасль</TableHead>
                        <TableHead>Контакты</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead className="text-right">Решение Модератора</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingModerationCompanies.map((comp) => (
                        <TableRow key={comp.id}>
                          <TableCell>
                            <div className="font-bold text-white text-sm">{comp.name}</div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              Руководитель: {comp.director_name || '—'}
                            </div>
                          </TableCell>

                          <TableCell className="font-mono text-sm text-slate-300 font-bold">
                            {comp.inn}
                          </TableCell>

                          <TableCell>
                            <Badge variant="outline" className="border-slate-800 text-slate-300">
                              {comp.industry || 'Услуги'}
                            </Badge>
                          </TableCell>

                          <TableCell className="text-xs space-y-0.5">
                            <div className="text-slate-300 font-mono">{comp.phone || '—'}</div>
                            <div className="text-slate-500 font-mono">{comp.email || '—'}</div>
                          </TableCell>

                          <TableCell>
                            {comp.status === 'pending_approval' && (
                              <Badge variant="warning">Ожидает проверки</Badge>
                            )}
                            {comp.status === 'requires_changes' && (
                              <Badge variant="destructive">На доработке</Badge>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedCompDetails(comp)}
                                className="border-slate-800 text-xs text-slate-300"
                              >
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                Детали
                              </Button>

                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  setRejectCompanyId(comp.id);
                                  setRejectComment('');
                                }}
                                disabled={isPending}
                                className="text-xs"
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1" />
                                На доработку
                              </Button>

                              <Button
                                size="sm"
                                onClick={() => handleApproveCompany(comp.id, comp.name)}
                                disabled={isPending}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                              >
                                <Check className="h-3.5 w-3.5 mr-1" />
                                Одобрить
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {/* 2. Вкладка Все Организации */}
          {activeTab === 'companies' && (
            <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-950/60">
                    <TableRow>
                      <TableHead>Организация</TableHead>
                      <TableHead>ИНН КР</TableHead>
                      <TableHead>Отрасль</TableHead>
                      <TableHead>Статус Модерации</TableHead>
                      <TableHead className="text-right">Действие</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {companies.map((comp) => (
                      <TableRow key={comp.id}>
                        <TableCell className="font-semibold text-white">{comp.name}</TableCell>
                        <TableCell className="font-mono text-slate-300 font-bold">{comp.inn}</TableCell>
                        <TableCell className="text-xs text-slate-400">{comp.industry || '—'}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              comp.status === 'active'
                                ? 'success'
                                : comp.status === 'blocked'
                                ? 'destructive'
                                : 'warning'
                            }
                          >
                            {comp.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleCompanyStatusAction(comp.id, !comp.is_active)}
                            disabled={isPending}
                            className="border-slate-800 text-xs"
                          >
                            {comp.is_active ? 'Заблокировать' : 'Разблокировать'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* 3. Вкладка Категории */}
          {activeTab === 'categories' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-lg">Новая Категория</CardTitle>
                </CardHeader>
                <form onSubmit={handleAddCategory}>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="catName">Наименование *</Label>
                      <Input
                        id="catName"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        required
                        className="bg-slate-950 border-slate-800 text-slate-100"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="catDesc">Описание</Label>
                      <Input
                        id="catDesc"
                        value={newCatDesc}
                        onChange={(e) => setNewCatDesc(e.target.value)}
                        className="bg-slate-950 border-slate-800 text-slate-100"
                      />
                    </div>
                    <Button type="submit" disabled={isPending} className="w-full bg-amber-600 hover:bg-amber-500">
                      Создать категорию
                    </Button>
                  </CardContent>
                </form>
              </Card>

              <Card className="md:col-span-2 bg-slate-900/40 border-slate-800">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-slate-950/60">
                      <TableRow>
                        <TableHead>Категория</TableHead>
                        <TableHead>Описание</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categories.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-semibold text-white">{c.name}</TableCell>
                          <TableCell className="text-xs text-slate-400">{c.description || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* 4. Вкладка Пользователи */}
          {activeTab === 'users' && (
            <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-950/60">
                    <TableRow>
                      <TableHead>ФИО / Email</TableHead>
                      <TableHead>Организация</TableHead>
                      <TableHead>Роль</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => {
                      const userComp = Array.isArray(u.companies) ? u.companies[0] : u.companies;
                      return (
                        <TableRow key={u.id}>
                          <TableCell>
                            <div className="font-medium text-white">{u.full_name}</div>
                            <div className="text-xs text-slate-500">{u.email}</div>
                          </TableCell>
                          <TableCell className="text-xs text-slate-300">{userComp?.name || '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{u.role}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* 5. Глобальные Файлы */}
          {activeTab === 'global_files' && (
            <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-950/60">
                    <TableRow>
                      <TableHead>Имя файла</TableHead>
                      <TableHead>Категория</TableHead>
                      <TableHead>Отправитель</TableHead>
                      <TableHead>Получатель</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {globalFiles.map((gf) => (
                      <TableRow key={gf.id}>
                        <TableCell className="font-medium text-white text-xs">{gf.file_name}</TableCell>
                        <TableCell className="text-xs text-slate-400">{gf.file_categories?.name || '—'}</TableCell>
                        <TableCell className="text-xs text-blue-400">{gf.documents?.sender_company?.name || '—'}</TableCell>
                        <TableCell className="text-xs text-purple-400">{gf.documents?.receiver_company?.name || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Модалка вызова причин возврата на доработку (Bottom Sheet на смартфонах) */}
      {rejectCompanyId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <Card className="w-full max-w-md bg-slate-900 border-t sm:border border-slate-800 shadow-2xl p-6 space-y-4 rounded-t-3xl sm:rounded-2xl animate-in slide-in-from-bottom duration-300">
            <div className="sm:hidden w-12 h-1 bg-slate-700 rounded-full mx-auto mb-1 opacity-80" />
            <h3 className="text-lg font-bold text-white flex items-center">
              <XCircle className="h-5 w-5 mr-2 text-red-400" />
              Причина возврата заявки на доработку
            </h3>
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Укажите замечания модератора:</Label>
              <Input
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                placeholder="Например: Ошибка в ИНН или некорректный адрес юрлица"
                className="bg-slate-950 border-slate-800 text-slate-100 min-h-[44px]"
              />
            </div>
            <div className="flex justify-end space-x-3 pt-2">
              <Button variant="outline" onClick={() => setRejectCompanyId(null)} className="border-slate-800 text-slate-400 min-h-[44px]">
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={handleRejectCompany}
                disabled={isPending}
                className="min-h-[44px]"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Вернуть на доработку'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Модалка деталей реквизитов компании (Bottom Sheet на смартфонах) */}
      {selectedCompDetails && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <Card className="w-full max-w-lg bg-slate-900 border-t sm:border border-slate-800 shadow-2xl p-6 space-y-4 rounded-t-3xl sm:rounded-2xl animate-in slide-in-from-bottom duration-300">
            <div className="sm:hidden w-12 h-1 bg-slate-700 rounded-full mx-auto mb-1 opacity-80" />
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center">
                <Building2 className="h-5 w-5 mr-2 text-blue-400" />
                Реквизиты: {selectedCompDetails.name}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setSelectedCompDetails(null)} className="h-9 w-9 p-0 text-slate-400">
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between p-2 rounded bg-slate-950">
                <span className="text-slate-500">ИНН КР (14 цифр):</span>
                <span className="font-mono font-bold text-amber-400">{selectedCompDetails.inn}</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950">
                <span className="text-slate-500">Отрасль:</span>
                <span className="text-slate-200">{selectedCompDetails.industry || '—'}</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950">
                <span className="text-slate-500">Руководитель:</span>
                <span className="text-slate-200">{selectedCompDetails.director_name || '—'}</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950">
                <span className="text-slate-500">E-mail:</span>
                <span className="text-slate-200">{selectedCompDetails.email || '—'}</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950">
                <span className="text-slate-500">Телефон:</span>
                <span className="text-slate-200">{selectedCompDetails.phone || '—'}</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950">
                <span className="text-slate-500">Юридический адрес:</span>
                <span className="text-slate-200">{selectedCompDetails.legal_address || selectedCompDetails.address || '—'}</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setSelectedCompDetails(null)} className="border-slate-800 text-slate-300">
                Закрыть
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
