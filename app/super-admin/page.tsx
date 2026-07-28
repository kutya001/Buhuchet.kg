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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  createFileCategoryAction,
  updateUserCompanyAndRoleAction,
  toggleFeatureFlagAction,
  toggleCompanyStatusAction,
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
  const [activeTab, setActiveTab] = useState<'categories' | 'companies' | 'users' | 'global_files' | 'flags'>('categories');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [globalFiles, setGlobalFiles] = useState<GlobalFile[]>([]);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);

  // Форма новой категории
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const loadAllAdminData = async () => {
    setLoading(true);

    // 1. Категории
    const { data: catData } = await supabase.from('file_categories').select('*').order('name');
    if (catData) setCategories(catData as FileCategory[]);

    // 2. Компании
    const { data: compData } = await supabase.from('companies').select('*').order('created_at', { ascending: false });
    if (compData) setCompanies(compData as Company[]);

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

  // Блокировка компании
  const handleToggleCompany = (companyId: string, currentStatus: boolean) => {
    startTransition(async () => {
      await toggleCompanyStatusAction(companyId, !currentStatus);
      loadAllAdminData();
    });
  };

  // Переключение фичи
  const handleToggleFlag = (key: string, currentStatus: boolean) => {
    startTransition(async () => {
      await toggleFeatureFlagAction(key, !currentStatus);
      loadAllAdminData();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center">
            <Shield className="h-6 w-6 mr-2 text-amber-400" />
            Центр Управления Суперадмина
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Глобальная модерация организаций, пользователей, категорий файлов и системных фичей
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
          onClick={() => setActiveTab('companies')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'companies'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>Организации ({companies.length})</span>
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
          <span>Глобальный Реестр Файлов ({globalFiles.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('flags')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'flags'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Settings className="h-4 w-4" />
          <span>Управление Фичами</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Загрузка админ-панели...</span>
        </div>
      ) : (
        <>
          {/* Вкладка 1: Категории Файлов */}
          {activeTab === 'categories' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Форма новой категории */}
              <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-lg">Новая Категория Файла</CardTitle>
                  <CardDescription>Справочник доступных категорий при мультизагрузке</CardDescription>
                </CardHeader>
                <form onSubmit={handleAddCategory}>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="catName">Наименование *</Label>
                      <Input
                        id="catName"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        placeholder="Например: Договор аренды"
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
                        placeholder="Краткое назначение категории..."
                        className="bg-slate-950 border-slate-800 text-slate-100"
                      />
                    </div>
                  </CardContent>

                  <CardContent className="pt-0">
                    <Button
                      type="submit"
                      disabled={isPending}
                      className="w-full bg-amber-600 hover:bg-amber-500 text-white font-medium shadow-lg shadow-amber-600/20"
                    >
                      {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                      Создать категорию
                    </Button>
                  </CardContent>
                </form>
              </Card>

              {/* Список категорий */}
              <Card className="md:col-span-2 bg-slate-900/40 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-lg">Список Категорий Файлов</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-slate-950/60">
                      <TableRow>
                        <TableHead>Категория</TableHead>
                        <TableHead>Описание</TableHead>
                        <TableHead>Статус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categories.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-semibold text-white text-sm">{c.name}</TableCell>
                          <TableCell className="text-xs text-slate-400">{c.description || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={c.is_active ? 'success' : 'secondary'}>
                              {c.is_active ? 'Активна' : 'Скрыта'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Вкладка 2: Организации */}
          {activeTab === 'companies' && (
            <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-950/60">
                    <TableRow>
                      <TableHead>Организация</TableHead>
                      <TableHead>ИНН КР (14 цифр)</TableHead>
                      <TableHead>Телефон</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {companies.map((comp) => (
                      <TableRow key={comp.id}>
                        <TableCell className="font-semibold text-white">{comp.name}</TableCell>
                        <TableCell className="font-mono text-slate-300 font-bold">{comp.inn}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-400">{comp.phone || '—'}</TableCell>
                        <TableCell>
                          <Badge variant={comp.is_active ? 'success' : 'destructive'}>
                            {comp.is_active ? 'Активна' : 'Заблокирована'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleToggleCompany(comp.id, comp.is_active)}
                            disabled={isPending}
                            className={
                              comp.is_active
                                ? 'border-slate-800 text-red-400 hover:bg-red-500/10'
                                : 'border-slate-800 text-emerald-400 hover:bg-emerald-500/10'
                            }
                          >
                            {comp.is_active ? <Lock className="h-3.5 w-3.5 mr-1" /> : <Unlock className="h-3.5 w-3.5 mr-1" />}
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

          {/* Вкладка 3: Пользователи */}
          {activeTab === 'users' && (
            <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-950/60">
                    <TableRow>
                      <TableHead>ФИО / Email</TableHead>
                      <TableHead>Организация</TableHead>
                      <TableHead>Роль</TableHead>
                      <TableHead>Суперадмин</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => {
                      const userComp = Array.isArray(u.companies) ? u.companies[0] : u.companies;

                      return (
                        <TableRow key={u.id}>
                          <TableCell>
                            <div className="font-medium text-white">{u.full_name}</div>
                            <div className="text-xs text-slate-500 font-mono">{u.email}</div>
                          </TableCell>
                          <TableCell className="text-xs text-slate-300">
                            {userComp?.name ? (
                              <span className="font-semibold text-slate-200">{userComp.name}</span>
                            ) : (
                              <span className="text-slate-500 font-mono">— (Без компании)</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="border-slate-800 uppercase font-mono text-[10px]">
                              {u.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {u.is_super_admin ? (
                              <Badge variant="warning">Суперадмин</Badge>
                            ) : (
                              <span className="text-slate-600 text-xs">Нет</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Вкладка 4: Глобальный Реестр Файлов */}
          {activeTab === 'global_files' && (
            <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-950/60">
                    <TableRow>
                      <TableHead>Имя файла</TableHead>
                      <TableHead>Категория</TableHead>
                      <TableHead>Описание</TableHead>
                      <TableHead>Отправитель</TableHead>
                      <TableHead>Получатель</TableHead>
                      <TableHead>Размер</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {globalFiles.map((gf) => (
                      <TableRow key={gf.id}>
                        <TableCell className="font-medium text-white text-xs">{gf.file_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="border-slate-800 text-[10px]">
                            {gf.file_categories?.name || 'Без категории'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-300 max-w-[200px] truncate">{gf.description}</TableCell>
                        <TableCell className="text-xs font-semibold text-blue-400">
                          {gf.documents?.sender_company?.name || '—'}
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-purple-400">
                          {gf.documents?.receiver_company?.name || '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-400">{gf.file_size || '1.5 MB'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Вкладка 5: Feature Flags */}
          {activeTab === 'flags' && (
            <Card className="bg-slate-900/40 border-slate-800">
              <CardHeader>
                <CardTitle className="text-lg">Управление Функционалом (Feature Flags)</CardTitle>
                <CardDescription>Гибкое включение и отключение модулей системы</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {featureFlags.map((flag) => (
                  <div
                    key={flag.key}
                    className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between"
                  >
                    <div>
                      <h4 className="font-semibold text-white text-sm">{flag.title}</h4>
                      <p className="text-xs text-slate-400 mt-0.5">{flag.description}</p>
                      <span className="text-[10px] font-mono text-slate-600 uppercase">Key: {flag.key}</span>
                    </div>

                    <Button
                      size="sm"
                      variant={flag.is_enabled ? 'default' : 'outline'}
                      onClick={() => handleToggleFlag(flag.key, flag.is_enabled)}
                      disabled={isPending}
                      className={
                        flag.is_enabled
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : 'border-slate-800 text-slate-400'
                      }
                    >
                      {flag.is_enabled ? <ToggleRight className="h-4 w-4 mr-1.5" /> : <ToggleLeft className="h-4 w-4 mr-1.5" />}
                      {flag.is_enabled ? 'Модуль Включен' : 'Модуль Отключен'}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
