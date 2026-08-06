'use client';

import React, { useState, useEffect, useTransition, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
  Users,
  UserCheck,
  UserPlus,
  ChevronLeft,
  ChevronRight,
  Database,
  BookOpen,
  Plus,
  Check,
  Ban,
  HelpCircle,
  Clock,
} from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import {
  getPendingCompaniesAction,
  getAllCompaniesAdminAction,
  createCompanyAdminAction,
  approveCompanyAction,
  requestCompanyChangesAction,
  blockCompanyAction,
  updateCompanyAdminAction,
  getAllUsersAdminAction,
  updateUserAdminAction,
  deleteUserAdminAction,
  getAllDocumentsAdminAction,
  updateDocumentAdminAction,
  deleteDocumentAdminAction,
  createFileCategoryAdminAction,
  updateFileCategoryAdminAction,
  deleteFileCategoryAdminAction,
  inspectTableDataAdminAction,
} from './actions';
import { signOutAction } from '@/app/(auth)/actions';
import {
  getAllSystemFilesAction,
  updateDocumentFileAction,
  deleteDocumentFileAction,
} from '../dashboard/files/archive-actions';
import { getPresignedDownloadUrlAction, getPresignedUploadUrlAction } from '../dashboard/files/actions';
import type { Company, DocumentFile, FileCategory } from '@/types/database.types';
import { createClient } from '@/lib/supabase/client';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';

const ITEMS_PER_PAGE = 10;

import {
  getTelegramAdminStatsAction,
  testTelegramBotHealthAdminAction,
  forceSetTelegramWebhookAdminAction,
  sendAdminTestTelegramMessageAction,
  disconnectUserTelegramAdminAction,
  type TelegramAdminStatsData,
  type TelegramBotHealthData,
} from './telegram-actions';
import { SuperAdminTelegramTab } from '@/components/super-admin/SuperAdminTelegramTab';

import { SuperAdminSidebar, SuperAdminTab } from '@/components/super-admin/SuperAdminSidebar';
import { FloatingTopbar } from '@/components/ui/FloatingTopbar';
import { MobileFAB } from '@/components/ui/MobileFAB';
import { cn } from '@/lib/utils';

export default function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<SuperAdminTab>('companies');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [telegramSubTab, setTelegramSubTab] = useState<'connections' | 'codes' | 'logs'>('connections');
  const [telegramStats, setTelegramStats] = useState<TelegramAdminStatsData | null>(null);
  const [botHealth, setBotHealth] = useState<TelegramBotHealthData | null>(null);

  // Фильтр внутри модуля Организации: 'all' | 'pending' | 'problematic'
  const [companySubTab, setCompanySubTab] = useState<'all' | 'pending' | 'problematic'>('all');

  const [pendingCompanies, setPendingCompanies] = useState<Company[]>([]);
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [systemFiles, setSystemFiles] = useState<any[]>([]);
  const [allDocuments, setAllDocuments] = useState<any[]>([]);
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Состояние пагинации
  const [currentPage, setCurrentPage] = useState(1);

  // 1. Модалки МОДЕРАЦИИ И ОРГАНИЗАЦИЙ
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [moderationComment, setModerationComment] = useState('');
  const [modalMode, setModalMode] = useState<'request_changes' | 'block' | null>(null);

  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [newCompName, setNewCompName] = useState('');
  const [newCompInn, setNewCompInn] = useState('');
  const [newCompDirector, setNewCompDirector] = useState('');

  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [compName, setCompName] = useState('');
  const [compInn, setCompInn] = useState('');
  const [compIndustry, setCompIndustry] = useState('');
  const [compStatus, setCompStatus] = useState<any>('active');
  const [compAddress, setCompAddress] = useState('');
  const [compDirector, setCompDirector] = useState('');

  // 2. Модалки Пользователей
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userRole, setUserRole] = useState<'owner' | 'accountant' | 'manager'>('owner');
  const [userCompId, setUserCompId] = useState<string>('');
  const [userIsSuperAdmin, setUserIsSuperAdmin] = useState(false);

  // 3. Модалки Документов
  const [editingDoc, setEditingDoc] = useState<any | null>(null);
  const [editDocNumber, setEditDocNumber] = useState('');
  const [editDocStatus, setEditDocStatus] = useState<any>('sent');
  const [editDocComment, setEditDocComment] = useState('');

  // 4. Модалки Справочников Категорий
  const [showCreateCatModal, setShowCreateCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatCode, setNewCatCode] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');

  // 5. МОДУЛЬ БАЗЫ ДАННЫХ (READ-ONLY)
  const [selectedDbTable, setSelectedDbTable] = useState<string>('companies');
  const [dbData, setDbData] = useState<{ columns: string[]; rows: any[] }>({ columns: [], rows: [] });
  const [dbLoading, setDbLoading] = useState(false);

  const supabase = createClient();

  // 1. Первичная загрузка компаний и фоновая предзагрузка остальных модулей
  const loadInitialData = async () => {
    setLoading(true);
    const [pendRes, allRes] = await Promise.all([
      getPendingCompaniesAction(),
      getAllCompaniesAdminAction(),
    ]);
    if (pendRes.success && pendRes.data) setPendingCompanies(pendRes.data);
    if (allRes.success && allRes.data) setAllCompanies(allRes.data);
    setLoading(false);

    // Фоновая мгновенная предзагрузка всех остальных модулей платформы (без блокировки UI)
    Promise.allSettled([
      getAllUsersAdminAction().then((res) => {
        if (res.success && res.data) setAllUsers(res.data);
      }),
      getAllSystemFilesAction().then((res) => {
        if (res.success && res.data) setSystemFiles(res.data);
      }),
      getAllDocumentsAdminAction().then((res) => {
        if (res.success && res.data) setAllDocuments(res.data);
      }),
      supabase.from('file_categories').select('*').order('name').then((res) => {
        if (res.data) setCategories(res.data as FileCategory[]);
      }),
    ]);
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // 2. Бесшовное дозагружение при открытии табу, если фоновый запрос еще в пути (без сброса страницы в loading=true)
  useEffect(() => {
    if (activeTab === 'users' && allUsers.length === 0) {
      getAllUsersAdminAction().then((res) => {
        if (res.success && res.data) setAllUsers(res.data);
      });
    } else if (activeTab === 'r2_files' && systemFiles.length === 0) {
      getAllSystemFilesAction().then((res) => {
        if (res.success && res.data) setSystemFiles(res.data);
      });
    } else if (activeTab === 'edo_documents' && allDocuments.length === 0) {
      getAllDocumentsAdminAction().then((res) => {
        if (res.success && res.data) setAllDocuments(res.data);
      });
    } else if (activeTab === 'dictionaries' && categories.length === 0) {
      supabase.from('file_categories').select('*').order('name').then((res) => {
        if (res.data) setCategories(res.data as FileCategory[]);
      });
    } else if (activeTab === 'db_inspector') {
      loadDbInspectorData(selectedDbTable);
    }
  }, [activeTab, selectedDbTable]);

  // Инспектор БД
  const loadDbInspectorData = async (tbl: string) => {
    setDbLoading(true);
    const res = await inspectTableDataAdminAction(tbl, 50);
    if (res.success && res.data) {
      setDbData(res.data);
    } else {
      setDbData({ columns: [], rows: [] });
    }
    setDbLoading(false);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeTab, companySubTab]);

  // 3. БЕСШОВНЫЕ ОПТИМИСТИЧНЫЕ ДЕЙСТВИЯ МОДЕРАЦИИ ОРГАНИЗАЦИЙ (БЕЗ ПЕРЕЗАГРУЗОК)
  const handleApprove = (comp: Company) => {
    setMsg(null);
    // Оптимистично меняем статус локально в state
    setPendingCompanies((prev) => prev.filter((c) => c.id !== comp.id));
    setAllCompanies((prev) =>
      prev.map((c) => (c.id === comp.id ? { ...c, status: 'active', moderation_comment: null } : c))
    );
    setMsg({ type: 'success', text: `Организация "${comp.name}" верифицирована` });

    startTransition(async () => {
      const res = await approveCompanyAction(comp.id);
      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка верификации' });
        loadInitialData();
      }
    });
  };

  const handleConfirmModerationAction = () => {
    if (!selectedCompany || !modalMode) return;
    if (!moderationComment.trim()) {
      alert('Укажите причину для компании!');
      return;
    }

    const compId = selectedCompany.id;
    const targetStatus = modalMode === 'request_changes' ? 'requires_changes' : 'blocked';
    const commentText = moderationComment.trim();

    // Оптимистичное локальное обновление
    setPendingCompanies((prev) => prev.filter((c) => c.id !== compId));
    setAllCompanies((prev) =>
      prev.map((c) => (c.id === compId ? { ...c, status: targetStatus, moderation_comment: commentText } : c))
    );

    setMsg({
      type: 'success',
      text:
        modalMode === 'request_changes'
          ? `Отправлен запрос исправлений для "${selectedCompany.name}"`
          : `Организация "${selectedCompany.name}" заблокирована`,
    });

    const mode = modalMode;
    setSelectedCompany(null);
    setModalMode(null);
    setModerationComment('');

    startTransition(async () => {
      let res;
      if (mode === 'request_changes') {
        res = await requestCompanyChangesAction(compId, commentText);
      } else {
        res = await blockCompanyAction(compId, commentText);
      }

      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка модерации' });
        loadInitialData();
      }
    });
  };

  const handleCreateCompany = () => {
    if (!newCompName || !newCompInn) {
      alert('Укажите название и ИНН организации!');
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await createCompanyAdminAction({
        name: newCompName,
        inn: newCompInn,
        director_name: newCompDirector,
      });

      if (res.success) {
        setMsg({ type: 'success', text: `Организация "${newCompName}" создана` });
        setShowCreateCompanyModal(false);
        setNewCompName('');
        setNewCompInn('');
        setNewCompDirector('');
        await loadInitialData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка создания' });
      }
    });
  };

  const handleSaveCompany = () => {
    if (!editingCompany) return;
    setMsg(null);
    const compId = editingCompany.id;
    const updatedComp = {
      ...editingCompany,
      name: compName,
      inn: compInn,
      industry: compIndustry,
      status: compStatus,
      legal_address: compAddress,
      director_name: compDirector,
    };

    setAllCompanies((prev) => prev.map((c) => (c.id === compId ? updatedComp : c)));
    setMsg({ type: 'success', text: `Реквизиты организации "${compName}" обновлены` });
    setEditingCompany(null);

    startTransition(async () => {
      const res = await updateCompanyAdminAction(compId, {
        name: compName,
        inn: compInn,
        industry: compIndustry,
        status: compStatus,
        legal_address: compAddress,
        director_name: compDirector,
      });

      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка при обновлении компании' });
        loadInitialData();
      }
    });
  };

  // ДЕЙСТВИЯ: ПОЛЬЗОВАТЕЛИ
  const handleSaveUser = () => {
    if (!editingUser) return;
    setMsg(null);
    const userId = editingUser.id;
    const updatedUser = {
      ...editingUser,
      full_name: userName,
      email: userEmail,
      role: userRole,
      company_id: userCompId || null,
      is_super_admin: userIsSuperAdmin,
    };

    setAllUsers((prev) => prev.map((u) => (u.id === userId ? updatedUser : u)));
    setMsg({ type: 'success', text: `Пользователь "${userName || userEmail}" обновлен` });
    setEditingUser(null);

    startTransition(async () => {
      const res = await updateUserAdminAction(userId, {
        full_name: userName,
        email: userEmail,
        role: userRole,
        company_id: userCompId || null,
        is_super_admin: userIsSuperAdmin,
      });

      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка при обновлении пользователя' });
        getAllUsersAdminAction().then((r) => r.data && setAllUsers(r.data));
      }
    });
  };

  const handleDeleteUser = async (userId: string, name: string) => {
    if (!confirm(`Удалить пользователя "${name}" из системы?`)) return;
    setAllUsers((prev) => prev.filter((u) => u.id !== userId));
    setMsg({ type: 'success', text: 'Пользователь удален из системы' });

    startTransition(async () => {
      const res = await deleteUserAdminAction(userId);
      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления пользователя' });
        getAllUsersAdminAction().then((r) => r.data && setAllUsers(r.data));
      }
    });
  };

  // ДЕЙСТВИЯ: B2B ДОКУМЕНТЫ
  const handleSaveDoc = () => {
    if (!editingDoc) return;
    setMsg(null);
    const docId = editingDoc.id;
    setAllDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, doc_number: editDocNumber, status: editDocStatus, comment: editDocComment } : d))
    );
    setMsg({ type: 'success', text: 'B2B Документ обновлен' });
    setEditingDoc(null);

    startTransition(async () => {
      const res = await updateDocumentAdminAction(docId, {
        doc_number: editDocNumber,
        status: editDocStatus,
        comment: editDocComment,
      });

      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка обновления документа' });
        getAllDocumentsAdminAction().then((r) => r.data && setAllDocuments(r.data));
      }
    });
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!confirm('Удалить этот B2B документ из базы данных?')) return;
    setAllDocuments((prev) => prev.filter((d) => d.id !== docId));
    setMsg({ type: 'success', text: 'Документ удален' });

    startTransition(async () => {
      const res = await deleteDocumentAdminAction(docId);
      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления документа' });
        getAllDocumentsAdminAction().then((r) => r.data && setAllDocuments(r.data));
      }
    });
  };

  // ДЕЙСТВИЯ: СПРАВОЧНИКИ
  const handleCreateCategory = () => {
    if (!newCatName || !newCatCode) {
      alert('Укажите название и код категории!');
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await createFileCategoryAdminAction(newCatName, newCatCode, newCatDesc);
      if (res.success) {
        setMsg({ type: 'success', text: 'Категория создана' });
        setShowCreateCatModal(false);
        setNewCatName('');
        setNewCatCode('');
        setNewCatDesc('');
        supabase.from('file_categories').select('*').order('name').then((r) => r.data && setCategories(r.data as FileCategory[]));
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка создания категории' });
      }
    });
  };

  const handleDeleteCategory = async (catId: string) => {
    if (!confirm('Удалить эту категорию сканов?')) return;
    setCategories((prev) => prev.filter((c) => c.id !== catId));
    setMsg({ type: 'success', text: 'Категория удалена' });

    startTransition(async () => {
      const res = await deleteFileCategoryAdminAction(catId);
      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления' });
        supabase.from('file_categories').select('*').order('name').then((r) => r.data && setCategories(r.data as FileCategory[]));
      }
    });
  };

  // ДЕЙСТВИЯ С ФАЙЛАМИ R2
  const handleDownloadR2File = async (fileKey?: string | null) => {
    if (!fileKey) return;
    const res = await getPresignedDownloadUrlAction(fileKey);
    if (res.success && res.data?.downloadUrl) {
      window.open(res.data.downloadUrl, '_blank');
    }
  };

  // Фильтрация организаций с учетом под-вкладки 'all' | 'pending' | 'problematic'
  const filteredCompanies = useMemo(() => {
    const term = search.toLowerCase();
    return allCompanies.filter((c) => {
      const matchesSearch = c.name.toLowerCase().includes(term) || c.inn.includes(term);
      if (!matchesSearch) return false;

      if (companySubTab === 'pending') {
        return c.status === 'pending_approval';
      }
      if (companySubTab === 'problematic') {
        return c.status === 'requires_changes' || c.status === 'blocked';
      }

      return true;
    });
  }, [allCompanies, search, companySubTab]);

  const filteredUsers = useMemo(() => {
    const term = search.toLowerCase();
    return allUsers.filter(
      (u) =>
        u.full_name?.toLowerCase().includes(term) ||
        u.email?.toLowerCase().includes(term) ||
        u.companies?.name?.toLowerCase().includes(term)
    );
  }, [allUsers, search]);

  const filteredFiles = useMemo(() => {
    const term = search.toLowerCase();
    return systemFiles.filter(
      (f) => f.file_name?.toLowerCase().includes(term) || f.description?.toLowerCase().includes(term)
    );
  }, [systemFiles, search]);

  const filteredDocs = useMemo(() => {
    const term = search.toLowerCase();
    return allDocuments.filter(
      (d) =>
        d.doc_number?.toLowerCase().includes(term) ||
        d.sender_company?.name.toLowerCase().includes(term) ||
        d.receiver_company?.name.toLowerCase().includes(term)
    );
  }, [allDocuments, search]);

  // ---------------- CONFIG FOR SECTION 1: COMPANIES (UnifiedDataGrid) ----------------
  const companyColumns: ColumnDef<Company>[] = [
    {
      key: 'name',
      label: 'Наименование Организации',
      sortable: true,
      getValue: (c) => c.name,
      render: (c) => (
        <div className="font-bold text-white text-sm flex items-center space-x-2">
          <Building2 className="h-4 w-4 text-amber-400 flex-shrink-0" />
          <span>{c.name}</span>
        </div>
      ),
    },
    {
      key: 'inn',
      label: 'ИНН КР',
      sortable: true,
      getValue: (c) => c.inn,
      render: (c) => <span className="font-mono text-sm font-bold text-slate-300">{c.inn}</span>,
    },
    {
      key: 'status',
      label: 'Статус Модерации',
      sortable: true,
      getValue: (c) => c.status,
      render: (c) => (
        <Badge
          className={
            c.status === 'active'
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
              : c.status === 'blocked'
              ? 'bg-red-500/20 text-red-400 border-red-500/30'
              : c.status === 'requires_changes'
              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
              : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
          }
        >
          {c.status === 'active' ? 'Верифицирована' : null}
          {c.status === 'pending_approval' ? 'На проверке' : null}
          {c.status === 'requires_changes' ? 'Требует правок' : null}
          {c.status === 'blocked' ? 'Заблокирована' : null}
        </Badge>
      ),
    },
    {
      key: 'director_name',
      label: 'Руководитель',
      sortable: true,
      getValue: (c) => c.director_name,
      render: (c) => <span className="text-xs text-slate-300">{c.director_name || '—'}</span>,
    },
    {
      key: 'industry',
      label: 'Отрасль',
      sortable: true,
      getValue: (c) => c.industry,
      render: (c) => <span className="text-xs text-slate-400 font-mono">{c.industry || '—'}</span>,
    },
    {
      key: 'created_at',
      label: 'Дата создания',
      sortable: true,
      getValue: (c) => c.created_at,
      render: (c) => <span className="font-mono text-xs text-slate-400">{new Date(c.created_at).toLocaleDateString('ru-RU')}</span>,
    },
    {
      key: 'actions',
      label: 'Модерация',
      sortable: false,
      render: (c) => (
        <div className="flex items-center justify-end space-x-1.5">
          {c.status === 'pending_approval' && (
            <Button size="sm" onClick={() => handleApprove(c)} disabled={isPending} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs min-h-[34px]">
              <Check className="h-3.5 w-3.5 mr-1" />
              Принять
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingCompany(c);
              setCompName(c.name);
              setCompInn(c.inn);
              setCompIndustry(c.industry || '');
              setCompStatus(c.status);
              setCompAddress(c.legal_address || '');
              setCompDirector(c.director_name || '');
            }}
            className="border-slate-800 text-slate-300 hover:text-white text-xs min-h-[34px]"
          >
            <Edit2 className="h-3.5 w-3.5 mr-1 text-blue-400" />
            Правка
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelectedCompany(c);
              setModalMode('request_changes');
            }}
            className="border-amber-900/40 text-amber-400 hover:bg-amber-500/10 text-xs min-h-[34px]"
          >
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            Замечание
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelectedCompany(c);
              setModalMode('block');
            }}
            className="border-red-900/40 text-red-400 hover:bg-red-500/10 text-xs min-h-[34px]"
          >
            <Ban className="h-3.5 w-3.5 mr-1" />
            Блок
          </Button>
        </div>
      ),
    },
  ];

  // ---------------- CONFIG FOR SECTION 2: USERS (UnifiedDataGrid) ----------------
  const userColumns: ColumnDef<any>[] = [
    {
      key: 'full_name',
      label: 'ФИО Пользователя',
      sortable: true,
      getValue: (u) => u.full_name || u.email,
      render: (u) => (
        <div className="font-bold text-white text-sm flex items-center space-x-2">
          <Users className="h-4 w-4 text-emerald-400 flex-shrink-0" />
          <div>
            <span>{u.full_name || 'Сотрудник'}</span>
            <p className="text-[11px] text-slate-400 font-mono">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'company',
      label: 'Привязанная Компания',
      sortable: true,
      getValue: (u) => u.companies?.name,
      render: (u) => (
        <div className="text-xs text-slate-300">
          <span className="font-semibold">{u.companies?.name || '—'}</span>
          {u.companies?.inn && <p className="text-[10px] text-slate-500 font-mono">ИНН: {u.companies.inn}</p>}
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Системная Роль',
      sortable: true,
      getValue: (u) => u.role,
      render: (u) => (
        <Badge variant="outline" className="border-amber-500/30 text-amber-400 text-xs">
          {u.role === 'owner' ? 'Владелец' : u.role === 'accountant' ? 'Бухгалтер' : 'Менеджер'}
        </Badge>
      ),
    },
    {
      key: 'is_super_admin',
      label: 'Статус Админа',
      sortable: true,
      getValue: (u) => u.is_super_admin,
      render: (u) =>
        u.is_super_admin ? (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
            <Shield className="h-3 w-3 mr-1" />
            Суперадмин
          </Badge>
        ) : (
          <span className="text-slate-500 text-xs">Обычный</span>
        ),
    },
    {
      key: 'actions',
      label: 'Действия',
      sortable: false,
      render: (u) => (
        <div className="flex items-center justify-end space-x-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingUser(u);
              setUserName(u.full_name || '');
              setUserEmail(u.email || '');
              setUserRole(u.role || 'owner');
              setUserCompId(u.company_id || '');
              setUserIsSuperAdmin(!!u.is_super_admin);
            }}
            className="border-slate-800 text-blue-400 hover:bg-blue-500/10 text-xs min-h-[34px]"
          >
            <Edit2 className="h-3.5 w-3.5 mr-1" />
            Изменить
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleDeleteUser(u.id, u.full_name || u.email)}
            className="border-red-900/40 text-red-400 hover:bg-red-500/10 text-xs min-h-[34px]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  // ---------------- CONFIG FOR SECTION 3: SYSTEM FILES (UnifiedDataGrid) ----------------
  const systemFilesColumns: ColumnDef<any>[] = [
    {
      key: 'file_name',
      label: 'Наименование Файла',
      sortable: true,
      getValue: (f) => f.file_name,
      render: (f) => (
        <div className="font-mono font-semibold text-white text-xs sm:text-sm flex items-center space-x-2">
          <FileText className="h-4 w-4 text-purple-400 flex-shrink-0" />
          <span className="truncate max-w-[220px]">{f.file_name}</span>
        </div>
      ),
    },
    {
      key: 'company',
      label: 'Организация-Владелец',
      sortable: true,
      getValue: (f) => f.companies?.name,
      render: (f) => (
        <span className="text-xs text-slate-300 font-semibold">{f.companies?.name || 'Система'}</span>
      ),
    },
    {
      key: 'category',
      label: 'Категория',
      sortable: true,
      getValue: (f) => f.file_categories?.name,
      render: (f) => (
        <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-xs">
          {f.file_categories?.name || 'Архив'}
        </Badge>
      ),
    },
    {
      key: 'size_bytes',
      label: 'Размер',
      sortable: true,
      getValue: (f) => f.size_bytes,
      render: (f) => <span className="font-mono text-xs text-slate-400">{formatBytes(f.size_bytes)}</span>,
    },
    {
      key: 'created_at',
      label: 'Дата Загрузки',
      sortable: true,
      getValue: (f) => f.created_at,
      render: (f) => <span className="font-mono text-xs text-slate-400">{new Date(f.created_at).toLocaleDateString('ru-RU')}</span>,
    },
    {
      key: 'actions',
      label: 'Действие',
      sortable: false,
      render: (f) =>
        f.file_path_r2 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleDownloadR2File(f.file_path_r2)}
            className="border-slate-800 text-purple-400 text-xs min-h-[34px]"
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            R2 Ссылка
          </Button>
        ) : (
          <span className="text-slate-500 text-xs">—</span>
        ),
    },
  ];

  // ---------------- CONFIG FOR SECTION 4: DOCUMENTS (UnifiedDataGrid) ----------------
  const systemDocumentsColumns: ColumnDef<any>[] = [
    {
      key: 'doc_number',
      label: '№ Документа',
      sortable: true,
      getValue: (d) => d.doc_number || d.id,
      render: (d) => (
        <div className="font-mono font-bold text-white text-xs sm:text-sm">
          {d.doc_number ? `№ ${d.doc_number}` : 'Черновик'}
        </div>
      ),
    },
    {
      key: 'doc_type',
      label: 'Тип',
      sortable: true,
      getValue: (d) => d.doc_type,
      render: (d) => (
        <Badge variant="outline" className="border-blue-500/30 text-blue-400 text-xs">
          {d.doc_type}
        </Badge>
      ),
    },
    {
      key: 'sender',
      label: 'Отправитель',
      sortable: true,
      getValue: (d) => d.sender_company?.name,
      render: (d) => <span className="text-xs text-slate-300 font-semibold">{d.sender_company?.name || '—'}</span>,
    },
    {
      key: 'receiver',
      label: 'Получатель',
      sortable: true,
      getValue: (d) => d.receiver_company?.name,
      render: (d) => <span className="text-xs text-slate-300 font-semibold">{d.receiver_company?.name || '—'}</span>,
    },
    {
      key: 'total_amount',
      label: 'Сумма (сом)',
      sortable: true,
      getValue: (d) => d.total_amount,
      render: (d) => (
        <span className="font-mono font-bold text-emerald-400 text-xs sm:text-sm">
          {Number(d.total_amount || 0).toLocaleString('ru-RU')} c.
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Статус',
      sortable: true,
      getValue: (d) => d.status,
      render: (d) => (
        <Badge className="bg-slate-800 text-slate-300 text-xs">
          {d.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: 'Корректировка',
      sortable: false,
      render: (d) => (
        <div className="flex items-center justify-end space-x-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingDoc(d);
              setEditDocNumber(d.doc_number || '');
              setEditDocStatus(d.status);
              setEditDocComment(d.comment || '');
            }}
            className="border-slate-800 text-blue-400 text-xs min-h-[34px]"
          >
            <Edit2 className="h-3.5 w-3.5 mr-1" />
            Правка
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleDeleteDoc(d.id)}
            className="border-red-900/40 text-red-400 text-xs min-h-[34px]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  // ---------------- CONFIG FOR SECTION 6: DATABASE INSPECTOR (UnifiedDataGrid) ----------------
  const dbColumns: ColumnDef<Record<string, any>>[] = useMemo(() => {
    return dbData.columns.map((col) => ({
      key: col,
      label: col,
      sortable: true,
      getValue: (row) => (typeof row[col] === 'object' ? JSON.stringify(row[col]) : row[col]),
      render: (row) => (
        <span
          className="font-mono text-xs truncate max-w-[220px] block"
          title={typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}
        >
          {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? 'null')}
        </span>
      ),
    }));
  }, [dbData.columns]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка панели суперадмина...</span>
      </div>
    );
  }

  const handleTabChange = (tab: SuperAdminTab) => {
    startTransition(() => {
      setActiveTab(tab);
    });
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground antialiased w-full overflow-x-hidden">
      {/* Левый Вертикальный Сайдбар (Десктоп + Мобильная Шторка) */}
      <SuperAdminSidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        pendingCount={pendingCompanies.length}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onLogout={() => {
          signOutAction();
        }}
      />

      {/* Основной Контент Панели с учетом плавающего сайдбара */}
      <div
        className={cn(
          'flex-1 flex flex-col min-w-0 w-full overflow-hidden transition-all duration-300',
          isSidebarCollapsed ? 'md:pl-[96px]' : 'md:pl-[288px]'
        )}
      >
        <FloatingTopbar
          companyName="Buhuchet.kg Administration"
          isSuperAdmin={true}
          isSidebarCollapsed={isSidebarCollapsed}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onLogout={() => {
            signOutAction();
          }}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 pt-20 sm:pt-24 pb-28 md:pb-8">
          <div className="space-y-6 pt-4 sm:pt-6">

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

      {/* ------------------- РАЗДЕЛ Telegram БОТ ------------------- */}
      {activeTab === 'telegram' && <SuperAdminTelegramTab />}

      {/* ------------------- РАЗДЕЛ 1: УПРАВЛЕНИЕ ОРГАНИЗАЦИЯМИ ------------------- */}
      {activeTab === 'companies' && (
        <div className="space-y-4">
          <div className="flex items-center space-x-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
            <button
              onClick={() => setCompanySubTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                companySubTab === 'all' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Все Компании ({allCompanies.length})
            </button>
            <button
              onClick={() => setCompanySubTab('pending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                companySubTab === 'pending' ? 'bg-blue-500/20 text-blue-400 font-bold border border-blue-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              На верификации ({pendingCompanies.length})
            </button>
            <button
              onClick={() => setCompanySubTab('problematic')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                companySubTab === 'problematic' ? 'bg-red-500/20 text-red-400 font-bold border border-red-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Заблокированы ({allCompanies.filter((c) => c.status === 'blocked' || c.status === 'requires_changes').length})
            </button>
          </div>

          <UnifiedDataGrid<Company>
            columns={companyColumns}
            data={
              companySubTab === 'pending'
                ? pendingCompanies
                : companySubTab === 'problematic'
                ? allCompanies.filter((c) => c.status === 'blocked' || c.status === 'requires_changes')
                : allCompanies
            }
            keyExtractor={(c) => c.id}
            searchPlaceholder="Поиск организации по ИНН, названию, руководителю..."
            emptyMessage="Организации в выбранной категории отсутствуют."
            isLoading={loading}
            defaultPageSize={25}
            actionButton={
              <Button
                size="sm"
                onClick={() => setShowCreateCompanyModal(true)}
                className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs min-h-[40px]"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                + Создать Компанию
              </Button>
            }
          />
        </div>
      )}

      {/* ------------------- РАЗДЕЛ 2: УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ------------------- */}
      {activeTab === 'users' && (
        <UnifiedDataGrid<any>
          columns={userColumns}
          data={allUsers}
          keyExtractor={(u) => u.id}
          searchPlaceholder="Поиск пользователя по ФИО, email, ИНН компании..."
          emptyMessage="Пользователи в системе не найдены."
          isLoading={loading}
          defaultPageSize={25}
        />
      )}

      {/* ------------------- РАЗДЕЛ 3: ВСЕ ФАЙЛЫ R2 ------------------- */}
      {activeTab === 'r2_files' && (
        <UnifiedDataGrid<any>
          columns={systemFilesColumns}
          data={systemFiles}
          keyExtractor={(f) => f.id}
          searchPlaceholder="Поиск файла по имени, компании..."
          emptyMessage="Файлы в системе отсутствуют."
          isLoading={loading}
          defaultPageSize={25}
        />
      )}

      {/* ------------------- РАЗДЕЛ 4: B2B ДОКУМЕНТЫ ------------------- */}
      {activeTab === 'edo_documents' && (
        <UnifiedDataGrid<any>
          columns={systemDocumentsColumns}
          data={allDocuments}
          keyExtractor={(d) => d.id}
          searchPlaceholder="Поиск по № документа, отправителю, получателю..."
          emptyMessage="Документы не найдены."
          isLoading={loading}
          defaultPageSize={25}
        />
      )}

      {/* ------------------- РАЗДЕЛ 5: СПРАВОЧНИКИ КАТЕГОРИЙ ------------------- */}
      {activeTab === 'dictionaries' && (
        <UnifiedDataGrid<FileCategory>
          columns={[
            {
              key: 'name',
              label: 'Наименование Категории',
              sortable: true,
              render: (cat) => <span className="font-bold text-foreground text-sm">{cat.name}</span>,
            },
            {
              key: 'code',
              label: 'Системный код',
              sortable: true,
              render: (cat) => <Badge variant="outline" className="font-mono text-xs border-indigo-500/30 text-indigo-400">{cat.code}</Badge>,
            },
            {
              key: 'description',
              label: 'Описание',
              sortable: true,
              render: (cat) => <span className="text-xs text-muted-foreground">{cat.description || '—'}</span>,
            },
          ]}
          data={categories}
          keyExtractor={(cat) => cat.id}
          searchPlaceholder="Поиск по наименованию категории..."
          emptyMessage="Категории файлов отсутствуют."
          isLoading={loading}
          defaultPageSize={25}
          actionButton={
            <Button
              size="sm"
              onClick={() => setShowCreateCatModal(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs min-h-[40px]"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              + Добавить Категорию
            </Button>
          }
        />
      )}

      {/* ------------------- РАЗДЕЛ 6: ИНСПЕКТОР БАЗЫ ДАННЫХ ------------------- */}
      {activeTab === 'db_inspector' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/40 p-4 rounded-2xl border border-slate-800">
            <div>
              <h3 className="text-sm md:text-base font-bold text-white flex items-center">
                <Database className="h-5 w-5 mr-2 text-red-400" />
                Прямая Инспекция Таблиц PostgreSQL
              </h3>
              <p className="text-xs text-slate-400">Просмотр перпендикулярных записей и схем таблиц PostgreSQL</p>
            </div>

            <select
              value={selectedDbTable}
              onChange={(e) => setSelectedDbTable(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-white text-xs rounded-xl px-3 py-2 min-h-[40px]"
            >
              <option value="companies">Таблица: companies</option>
              <option value="users">Таблица: users</option>
              <option value="documents">Таблица: documents</option>
              <option value="files">Таблица: files</option>
              <option value="counterparties">Таблица: counterparties</option>
              <option value="company_partnerships">Таблица: company_partnerships</option>
            </select>
          </div>

          <UnifiedDataGrid<Record<string, any>>
            forceView="table"
            columns={dbColumns}
            data={dbData.rows}
            keyExtractor={(r) => (r.id ? String(r.id) : JSON.stringify(r))}
            searchPlaceholder="Поиск по сырым данным таблицы PostgreSQL..."
            emptyMessage="Записи в выбранной таблице PostgreSQL отсутствуют."
            isLoading={dbLoading}
            defaultPageSize={25}
          />
        </div>
      )}

      {/* ------------------- ВСЕ 5 МОДАЛЬНЫХ ОКНО СУПЕРАДМИНА (UnifiedFormModal) ------------------- */}

      {/* МОДАЛКА 1: Модерация / Запрос изменений / Блокировка */}
      <UnifiedFormModal
        isOpen={!!selectedCompany && !!modalMode}
        onClose={() => {
          setSelectedCompany(null);
          setModalMode(null);
        }}
        title={modalMode === 'request_changes' ? 'Запрос исправлений у компании' : 'Заблокировать организацию'}
        subtitle={selectedCompany?.name || 'Компания'}
        mode="edit"
        onSubmit={(e) => {
          e.preventDefault();
          handleConfirmModerationAction();
        }}
        isSubmitting={isPending}
        submitText={modalMode === 'request_changes' ? 'Отправить Замечание' : 'Заблокировать'}
      >
        <div className="space-y-3">
          <Label className="text-xs text-slate-300">Причина или Замечание к уставным документам *</Label>
          <Input
            value={moderationComment}
            onChange={(e) => setModerationComment(e.target.value)}
            placeholder="Необходим скан Устава в высоком качестве..."
            required
            className="bg-slate-950 border-slate-800 text-white min-h-[44px]"
          />
        </div>
      </UnifiedFormModal>

      {/* МОДАЛКА 2: Создание компании Суперадмином */}
      <UnifiedFormModal
        isOpen={showCreateCompanyModal}
        onClose={() => setShowCreateCompanyModal(false)}
        title="Создать Организацию в Системе"
        subtitle="Ручное добавление новой компании суперадминистратором"
        mode="create"
        onSubmit={(e) => {
          e.preventDefault();
          handleCreateCompany();
        }}
        isSubmitting={isPending}
        submitText="Создать"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Наименование организации *</Label>
            <Input
              value={newCompName}
              onChange={(e) => setNewCompName(e.target.value)}
              placeholder="ОсОО АзияТрейд..."
              required
              className="bg-slate-950 border-slate-800 text-white min-h-[44px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">ИНН КР (14 цифр) *</Label>
            <Input
              value={newCompInn}
              onChange={(e) => setNewCompInn(e.target.value.replace(/\D/g, '').slice(0, 14))}
              placeholder="01203202410145"
              maxLength={14}
              required
              className="bg-slate-950 border-slate-800 text-white font-mono min-h-[44px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">ФИО Руководителя</Label>
            <Input
              value={newCompDirector}
              onChange={(e) => setNewCompDirector(e.target.value)}
              placeholder="Асанов Асан Асанович"
              className="bg-slate-950 border-slate-800 text-white min-h-[44px]"
            />
          </div>
        </div>
      </UnifiedFormModal>

      {/* МОДАЛКА 3: Редактирование профиля организации */}
      <UnifiedFormModal
        isOpen={!!editingCompany}
        onClose={() => setEditingCompany(null)}
        title="Редактирование Профиля Компании"
        subtitle={editingCompany?.name || 'Компания'}
        mode="edit"
        onSubmit={(e) => {
          e.preventDefault();
          handleSaveCompany();
        }}
        isSubmitting={isPending}
        submitText="Сохранить"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Наименование</Label>
            <Input value={compName} onChange={(e) => setCompName(e.target.value)} className="bg-slate-950 border-slate-800 text-white min-h-[44px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">ИНН</Label>
            <Input value={compInn} onChange={(e) => setCompInn(e.target.value)} className="bg-slate-950 border-slate-800 text-white font-mono min-h-[44px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Статус Верификации</Label>
            <select value={compStatus} onChange={(e) => setCompStatus(e.target.value)} className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-white">
              <option value="active">Verified / Active</option>
              <option value="pending">Pending Verification</option>
              <option value="needs_changes">Needs Changes</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Руководитель</Label>
            <Input value={compDirector} onChange={(e) => setCompDirector(e.target.value)} className="bg-slate-950 border-slate-800 text-white min-h-[44px]" />
          </div>
        </div>
      </UnifiedFormModal>

      {/* МОДАЛКА 4: Редактирование Пользователя */}
      <UnifiedFormModal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        title="Управление Правами Пользователя"
        subtitle={userName || userEmail}
        mode="edit"
        onSubmit={(e) => {
          e.preventDefault();
          handleSaveUser();
        }}
        isSubmitting={isPending}
        submitText="Сохранить"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">ФИО Пользователя</Label>
            <Input value={userName} onChange={(e) => setUserName(e.target.value)} className="bg-slate-950 border-slate-800 text-white min-h-[44px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">E-mail</Label>
            <Input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} className="bg-slate-950 border-slate-800 text-white font-mono min-h-[44px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Роль в Компании</Label>
            <select value={userRole} onChange={(e) => setUserRole(e.target.value as any)} className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-white">
              <option value="owner">Владелец</option>
              <option value="accountant">Главный Бухгалтер</option>
              <option value="manager">Менеджер</option>
            </select>
          </div>
          <div className="flex items-center space-x-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
            <input type="checkbox" id="super_admin_flag" checked={userIsSuperAdmin} onChange={(e) => setUserIsSuperAdmin(e.target.checked)} className="h-5 w-5 rounded text-red-500" />
            <Label htmlFor="super_admin_flag" className="text-xs text-red-400 font-bold cursor-pointer">
              Права Суперадминистратора (SuperAdmin)
            </Label>
          </div>
        </div>
      </UnifiedFormModal>

      {/* МОДАЛКА 5: Добавление категории сканов */}
      <UnifiedFormModal
        isOpen={showCreateCatModal}
        onClose={() => setShowCreateCatModal(false)}
        title="Создать Категорию Файлов"
        subtitle="Новый системный класс учредительных документов"
        mode="create"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newCatName || !newCatCode) return;
          startTransition(async () => {
            const res = await createFileCategoryAdminAction(newCatName, newCatCode, newCatDesc);
            if (res.success) {
              setMsg({ type: 'success', text: 'Категория добавлена' });
              setShowCreateCatModal(false);
              setNewCatName('');
              setNewCatCode('');
              setNewCatDesc('');
              supabase.from('file_categories').select('*').order('name').then((r) => r.data && setCategories(r.data as FileCategory[]));
            } else {
              setMsg({ type: 'error', text: res.error || 'Ошибка создания категории' });
            }
          });
        }}
        isSubmitting={isPending}
        submitText="Создать"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Наименование *</Label>
            <Input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="Лицензия ГНС..." required className="bg-slate-950 border-slate-800 text-white min-h-[44px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Системный код (латиница) *</Label>
            <Input value={newCatCode} onChange={(e) => setNewCatCode(e.target.value)} placeholder="license_tax" required className="bg-slate-950 border-slate-800 text-white font-mono min-h-[44px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Описание</Label>
            <Input value={newCatDesc} onChange={(e) => setNewCatDesc(e.target.value)} className="bg-slate-950 border-slate-800 text-white min-h-[44px]" />
          </div>
        </div>
      </UnifiedFormModal>
        </div>
        </main>
      </div>
    </div>
  );
}
