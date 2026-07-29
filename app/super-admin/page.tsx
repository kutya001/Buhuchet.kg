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
import {
  getAllSystemFilesAction,
  updateDocumentFileAction,
  deleteDocumentFileAction,
} from '../dashboard/files/archive-actions';
import { getPresignedDownloadUrlAction, getPresignedUploadUrlAction } from '../dashboard/files/actions';
import type { Company, DocumentFile, FileCategory } from '@/types/database.types';
import { createClient } from '@/lib/supabase/client';

const ITEMS_PER_PAGE = 10;

export default function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<
    'companies' | 'users' | 'files' | 'documents' | 'lookups' | 'database'
  >('companies');

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

  // Загрузка всех данных
  const loadData = async () => {
    setLoading(true);
    const [pendRes, allRes, usersRes, filesRes, docsRes, catRes] = await Promise.all([
      getPendingCompaniesAction(),
      getAllCompaniesAdminAction(),
      getAllUsersAdminAction(),
      getAllSystemFilesAction(),
      getAllDocumentsAdminAction(),
      supabase.from('file_categories').select('*').order('name'),
    ]);

    if (pendRes.success && pendRes.data) setPendingCompanies(pendRes.data);
    if (allRes.success && allRes.data) setAllCompanies(allRes.data);
    if (usersRes.success && usersRes.data) setAllUsers(usersRes.data);
    if (filesRes.success && filesRes.data) setSystemFiles(filesRes.data);
    if (docsRes.success && docsRes.data) setAllDocuments(docsRes.data);
    if (catRes.data) setCategories(catRes.data as FileCategory[]);

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

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
    if (activeTab === 'database') {
      loadDbInspectorData(selectedDbTable);
    }
  }, [activeTab, selectedDbTable]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeTab, companySubTab]);

  // ДЕЙСТВИЯ МОДЕРАЦИИ ОРГАНИЗАЦИЙ
  const handleApprove = (comp: Company) => {
    setMsg(null);
    startTransition(async () => {
      const res = await approveCompanyAction(comp.id);
      if (res.success) {
        setMsg({ type: 'success', text: `Организация "${comp.name}" верифицирована` });
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка верификации' });
      }
    });
  };

  const handleConfirmModerationAction = () => {
    if (!selectedCompany || !modalMode) return;
    if (!moderationComment.trim()) {
      alert('Укажите причину для компании!');
      return;
    }

    setMsg(null);
    startTransition(async () => {
      let res;
      if (modalMode === 'request_changes') {
        res = await requestCompanyChangesAction(selectedCompany.id, moderationComment);
      } else {
        res = await blockCompanyAction(selectedCompany.id, moderationComment);
      }

      if (res.success) {
        setMsg({
          type: 'success',
          text:
            modalMode === 'request_changes'
              ? `Отправлен запрос исправлений для "${selectedCompany.name}"`
              : `Организация "${selectedCompany.name}" заблокирована`,
        });
        setSelectedCompany(null);
        setModalMode(null);
        setModerationComment('');
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка модерации' });
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
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка создания' });
      }
    });
  };

  const handleSaveCompany = () => {
    if (!editingCompany) return;
    setMsg(null);
    startTransition(async () => {
      const res = await updateCompanyAdminAction(editingCompany.id, {
        name: compName,
        inn: compInn,
        industry: compIndustry,
        status: compStatus,
        legal_address: compAddress,
        director_name: compDirector,
      });

      if (res.success) {
        setMsg({ type: 'success', text: `Реквизиты организации "${compName}" обновлены` });
        setEditingCompany(null);
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при обновлении компании' });
      }
    });
  };

  // ДЕЙСТВИЯ: ПОЛЬЗОВАТЕЛИ
  const handleSaveUser = () => {
    if (!editingUser) return;
    setMsg(null);
    startTransition(async () => {
      const res = await updateUserAdminAction(editingUser.id, {
        full_name: userName,
        email: userEmail,
        role: userRole,
        company_id: userCompId || null,
        is_super_admin: userIsSuperAdmin,
      });

      if (res.success) {
        setMsg({ type: 'success', text: `Пользователь "${userName || userEmail}" обновлен` });
        setEditingUser(null);
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при обновлении пользователя' });
      }
    });
  };

  const handleDeleteUser = async (userId: string, name: string) => {
    if (!confirm(`Удалить пользователя "${name}" из системы?`)) return;
    startTransition(async () => {
      const res = await deleteUserAdminAction(userId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Пользователь удален из системы' });
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления пользователя' });
      }
    });
  };

  // ДЕЙСТВИЯ: B2B ДОКУМЕНТЫ
  const handleSaveDoc = () => {
    if (!editingDoc) return;
    setMsg(null);
    startTransition(async () => {
      const res = await updateDocumentAdminAction(editingDoc.id, {
        doc_number: editDocNumber,
        status: editDocStatus,
        comment: editDocComment,
      });

      if (res.success) {
        setMsg({ type: 'success', text: 'B2B Документ обновлен' });
        setEditingDoc(null);
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка обновления документа' });
      }
    });
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!confirm('Удалить этот B2B документ из базы данных?')) return;
    startTransition(async () => {
      const res = await deleteDocumentAdminAction(docId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Документ удален' });
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления документа' });
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
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка создания категории' });
      }
    });
  };

  const handleDeleteCategory = async (catId: string) => {
    if (!confirm('Удалить эту категорию сканов?')) return;
    startTransition(async () => {
      const res = await deleteFileCategoryAdminAction(catId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Категория удалена' });
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления' });
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

  // Расчет пагинации
  const paginatedCompanies = filteredCompanies.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const totalPagesCompanies = Math.ceil(filteredCompanies.length / ITEMS_PER_PAGE) || 1;

  const paginatedUsers = filteredUsers.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const totalPagesUsers = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE) || 1;

  const paginatedFiles = filteredFiles.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const totalPagesFiles = Math.ceil(filteredFiles.length / ITEMS_PER_PAGE) || 1;

  const paginatedDocs = filteredDocs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const totalPagesDocs = Math.ceil(filteredDocs.length / ITEMS_PER_PAGE) || 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка панели суперадмина...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 max-w-full overflow-x-hidden w-full px-1 sm:px-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-white tracking-tight flex items-center">
            <Shield className="h-5 w-5 sm:h-6 sm:w-6 mr-2 text-amber-400 flex-shrink-0" />
            Панель Суперадминистратора
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Глобальный контроль, модерация заявок и CRUD над всеми модулями
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

      {/* ШЕСТЬ ОСНОВНЫХ МОДУЛЕЙ СУПЕРАДМИНА — МОБИЛЬНЫЙ ОСТРОВОК */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto no-scrollbar scrollbar-none">
        <button
          onClick={() => setActiveTab('companies')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap min-h-[48px] ${
            activeTab === 'companies'
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>Организации ({allCompanies.length})</span>
          {pendingCompanies.length > 0 && (
            <span className="bg-amber-500 text-slate-950 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full animate-pulse ml-1">
              {pendingCompanies.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap min-h-[48px] ${
            activeTab === 'users'
              ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Пользователи ({allUsers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('files')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap min-h-[48px] ${
            activeTab === 'files'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <FolderOpen className="h-4 w-4" />
          <span>Файлы R2 ({systemFiles.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('documents')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap min-h-[48px] ${
            activeTab === 'documents'
              ? 'bg-sky-600/20 text-sky-400 border border-sky-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Все Документы ({allDocuments.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('lookups')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap min-h-[48px] ${
            activeTab === 'lookups'
              ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <BookOpen className="h-4 w-4" />
          <span>Справочники ({categories.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('database')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap min-h-[48px] ${
            activeTab === 'database'
              ? 'bg-red-600/20 text-red-400 border border-red-500/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Database className="h-4 w-4" />
          <span>Модуль БД (Read-Only)</span>
        </button>
      </div>

      {/* ------------------- МОДУЛЬ 1: ОРГАНИЗАЦИИ И МОДЕРАЦИЯ ------------------- */}
      {activeTab === 'companies' && (
        <div className="space-y-4">
          {/* ФИЛЬТР ПОД-ВКЛАДОК МОДЕРАЦИИ */}
          <div className="flex items-center space-x-2 bg-slate-900/60 p-1.5 rounded-xl border border-slate-800 overflow-x-auto">
            <button
              onClick={() => setCompanySubTab('all')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[38px] ${
                companySubTab === 'all'
                  ? 'bg-blue-600 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>Все ({allCompanies.length})</span>
            </button>

            <button
              onClick={() => setCompanySubTab('pending')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[38px] ${
                companySubTab === 'pending'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-amber-400 hover:bg-amber-500/10'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>На Модерации ({pendingCompanies.length})</span>
              {pendingCompanies.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-300 animate-ping ml-1" />
              )}
            </button>

            <button
              onClick={() => setCompanySubTab('problematic')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[38px] ${
                companySubTab === 'problematic'
                  ? 'bg-red-600 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
              <span>Замечания / Блок</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск организации по названию или ИНН..."
              className="bg-slate-900 border-slate-800 text-white text-xs sm:text-sm min-h-[48px]"
            />
            <Button
              onClick={() => setShowCreateCompanyModal(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold min-h-[48px] w-full sm:w-auto"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Создать Компанию
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {paginatedCompanies.length === 0 ? (
              <div className="col-span-full p-12 text-center text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800">
                {companySubTab === 'pending'
                  ? 'Новые заявки на модерацию отсутствуют'
                  : 'Организации не найдены'}
              </div>
            ) : (
              paginatedCompanies.map((comp) => (
                <Card key={comp.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3 flex flex-col justify-between shadow-xl">
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-white text-sm truncate">{comp.name}</h4>
                        <p className="text-xs font-mono text-amber-400 mt-0.5">ИНН: {comp.inn}</p>
                      </div>
                      <Badge
                        variant={
                          comp.status === 'active'
                            ? 'success'
                            : comp.status === 'blocked'
                            ? 'destructive'
                            : 'secondary'
                        }
                        className="text-[10px] ml-2 flex-shrink-0"
                      >
                        {comp.status === 'pending_approval'
                          ? 'Ожидает модерации'
                          : comp.status === 'requires_changes'
                          ? 'Требует изменений'
                          : comp.status === 'active'
                          ? 'Активна'
                          : 'Заблокирована'}
                      </Badge>
                    </div>

                    <div className="text-xs space-y-1 text-slate-400">
                      <p>Руководитель: <span className="text-slate-200">{comp.director_name || '—'}</span></p>
                      <p>Отрасль: <span className="text-slate-200">{comp.industry || '—'}</span></p>
                      {comp.moderation_comment && (
                        <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-400 mt-1">
                          Замечание: {comp.moderation_comment}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* КНОПКИ ДЕЙСТВИЙ И МОДЕРАЦИИ */}
                  <div className="pt-2 border-t border-slate-800 flex flex-col gap-2">
                    {(comp.status === 'pending_approval' || comp.status === 'requires_changes' || comp.status === 'blocked') && (
                      <div className="grid grid-cols-3 gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => handleApprove(comp)}
                          disabled={isPending}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] min-h-[40px] px-1 font-bold"
                          title="Одобрить организацию"
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Одобрить
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedCompany(comp);
                            setModalMode('request_changes');
                            setModerationComment(comp.moderation_comment || '');
                          }}
                          disabled={isPending}
                          className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 text-[11px] min-h-[40px] px-1 font-semibold"
                          title="Отправить замечание"
                        >
                          <HelpCircle className="h-3.5 w-3.5 mr-1" />
                          Замечание
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedCompany(comp);
                            setModalMode('block');
                            setModerationComment(comp.moderation_comment || '');
                          }}
                          disabled={isPending}
                          className="border-red-500/40 text-red-400 hover:bg-red-500/10 text-[11px] min-h-[40px] px-1 font-semibold"
                          title="Заблокировать компанию"
                        >
                          <Ban className="h-3.5 w-3.5 mr-1" />
                          Блок
                        </Button>
                      </div>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingCompany(comp);
                        setCompName(comp.name);
                        setCompInn(comp.inn);
                        setCompIndustry(comp.industry || 'Услуги');
                        setCompStatus(comp.status);
                        setCompAddress(comp.legal_address || '');
                        setCompDirector(comp.director_name || '');
                      }}
                      className="w-full border-slate-800 text-xs text-blue-400 hover:bg-blue-500/10 min-h-[44px] font-semibold"
                    >
                      <Edit2 className="h-4 w-4 mr-1" />
                      Редактировать реквизиты
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>

          {totalPagesCompanies > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400 font-mono">
                Стр. <span className="text-white font-bold">{currentPage}</span> из <span className="text-white font-bold">{totalPagesCompanies}</span>
              </p>
              <div className="flex items-center space-x-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="border-slate-800 text-slate-300 min-h-[44px] text-xs"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Назад
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.min(totalPagesCompanies, p + 1))}
                  disabled={currentPage === totalPagesCompanies}
                  className="border-slate-800 text-slate-300 min-h-[44px] text-xs"
                >
                  Вперед
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------- МОДУЛЬ 2: ПОЛЬЗОВАТЕЛИ ------------------- */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск пользователя по имени или email..."
            className="bg-slate-900 border-slate-800 text-white text-xs sm:text-sm min-h-[48px]"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {paginatedUsers.map((usr) => (
              <Card key={usr.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-white text-sm truncate">{usr.full_name || 'Без имени'}</h4>
                      <p className="text-xs font-mono text-slate-400 truncate">{usr.email}</p>
                    </div>
                    {usr.is_super_admin && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/10">
                        Суперадмин
                      </Badge>
                    )}
                  </div>

                  <div className="text-xs space-y-1">
                    <p className="text-slate-300">
                      Компания: <span className="font-medium text-white">{usr.companies?.name || 'Без организации'}</span>
                    </p>
                    <p className="text-slate-400 uppercase font-mono text-[10px]">Роль: {usr.role || 'owner'}</p>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingUser(usr);
                      setUserName(usr.full_name || '');
                      setUserEmail(usr.email || '');
                      setUserRole(usr.role || 'owner');
                      setUserCompId(usr.company_id || '');
                      setUserIsSuperAdmin(!!usr.is_super_admin);
                    }}
                    className="flex-1 text-xs border-slate-800 text-blue-400 hover:bg-blue-500/10 min-h-[48px] font-semibold"
                  >
                    <Edit2 className="h-4 w-4 mr-1" />
                    Редактировать
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteUser(usr.id, usr.full_name || usr.email)}
                    className="text-xs text-red-400 hover:bg-red-500/10 min-h-[48px]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {totalPagesUsers > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400 font-mono">
                Стр. <span className="text-white font-bold">{currentPage}</span> из <span className="text-white font-bold">{totalPagesUsers}</span>
              </p>
              <div className="flex items-center space-x-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="border-slate-800 text-slate-300 min-h-[44px] text-xs"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Назад
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.min(totalPagesUsers, p + 1))}
                  disabled={currentPage === totalPagesUsers}
                  className="border-slate-800 text-slate-300 min-h-[44px] text-xs"
                >
                  Вперед
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------- МОДУЛЬ 3: ФАЙЛЫ R2 ------------------- */}
      {activeTab === 'files' && (
        <div className="space-y-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по наименованию файла R2..."
            className="bg-slate-900 border-slate-800 text-white text-xs sm:text-sm min-h-[48px]"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {paginatedFiles.map((file) => (
              <Card key={file.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="font-bold text-white text-xs truncate font-mono">{file.file_name}</div>
                  <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-400">
                    {file.companies?.name || 'Архив'}
                  </Badge>
                  <p className="text-xs text-slate-300 line-clamp-2">{file.description || 'Без описания'}</p>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-500">{file.file_size || '1.2 MB'}</span>

                  {file.file_path_r2 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownloadR2File(file.file_path_r2)}
                      className="h-9 text-xs text-blue-400 hover:text-white font-semibold min-h-[44px]"
                    >
                      <Download className="h-4 w-4 mr-1" />
                      R2
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {totalPagesFiles > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400 font-mono">
                Стр. <span className="text-white font-bold">{currentPage}</span> из <span className="text-white font-bold">{totalPagesFiles}</span>
              </p>
              <div className="flex items-center space-x-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="border-slate-800 text-slate-300 min-h-[44px] text-xs"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Назад
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.min(totalPagesFiles, p + 1))}
                  disabled={currentPage === totalPagesFiles}
                  className="border-slate-800 text-slate-300 min-h-[44px] text-xs"
                >
                  Вперед
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------- МОДУЛЬ 4: ВСЕ B2B ДОКУМЕНТЫ ------------------- */}
      {activeTab === 'documents' && (
        <div className="space-y-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по номеру документа или контрагентам..."
            className="bg-slate-900 border-slate-800 text-white text-xs sm:text-sm min-h-[48px]"
          />

          <div className="block md:hidden space-y-3">
            {paginatedDocs.map((doc) => (
              <Card key={doc.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-white text-sm font-mono">№ {doc.doc_number || doc.id.slice(0, 8)}</h4>
                    <span className="text-[11px] text-slate-400 block mt-0.5">{doc.doc_type}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {doc.status}
                  </Badge>
                </div>

                <div className="text-xs space-y-1 pt-1 border-t border-slate-800/60">
                  <p className="text-slate-300">Отправитель: <span className="font-medium text-white">{doc.sender_company?.name || '—'}</span></p>
                  <p className="text-slate-300">Получатель: <span className="font-medium text-white">{doc.receiver_company?.name || '—'}</span></p>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingDoc(doc);
                      setEditDocNumber(doc.doc_number || '');
                      setEditDocStatus(doc.status);
                      setEditDocComment(doc.comment || '');
                    }}
                    className="flex-1 border-slate-800 text-xs text-blue-400 min-h-[48px] font-semibold"
                  >
                    <Edit2 className="h-4 w-4 mr-1" />
                    Изменить
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteDoc(doc.id)}
                    className="text-xs text-red-400 hover:bg-red-500/10 min-h-[48px]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          <Card className="hidden md:block bg-slate-900/40 border-slate-800 overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-950/60">
                  <TableRow>
                    <TableHead>Номер & Тип</TableHead>
                    <TableHead>Отправитель</TableHead>
                    <TableHead>Получатель</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действия Суперадмина</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedDocs.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-mono text-xs font-bold text-white">
                        № {doc.doc_number || doc.id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-300">{doc.sender_company?.name || '—'}</TableCell>
                      <TableCell className="text-xs text-slate-300">{doc.receiver_company?.name || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {doc.status}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingDoc(doc);
                            setEditDocNumber(doc.doc_number || '');
                            setEditDocStatus(doc.status);
                            setEditDocComment(doc.comment || '');
                          }}
                          className="border-slate-800 text-xs text-blue-400 min-h-[36px]"
                        >
                          <Edit2 className="h-3.5 w-3.5 mr-1" />
                          Изменить
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteDoc(doc.id)}
                          className="text-xs text-red-400 hover:bg-red-500/10 min-h-[36px]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {totalPagesDocs > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400 font-mono">
                Стр. <span className="text-white font-bold">{currentPage}</span> из <span className="text-white font-bold">{totalPagesDocs}</span>
              </p>
              <div className="flex items-center space-x-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="border-slate-800 text-slate-300 min-h-[44px] text-xs"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Назад
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.min(totalPagesDocs, p + 1))}
                  disabled={currentPage === totalPagesDocs}
                  className="border-slate-800 text-slate-300 min-h-[44px] text-xs"
                >
                  Вперед
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------- МОДУЛЬ 5: СПРАВОЧНИКИ ------------------- */}
      {activeTab === 'lookups' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="font-bold text-white text-base">Категории первички и сканов (`file_categories`)</h3>
            <Button
              size="sm"
              onClick={() => setShowCreateCatModal(true)}
              className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold min-h-[48px] w-full sm:w-auto"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Добавить Категорию
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {categories.map((cat) => (
              <Card key={cat.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-2 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-white text-sm">{cat.name}</h4>
                    {cat.code && (
                      <Badge variant="outline" className="text-[10px] font-mono border-slate-700 text-amber-400">
                        {cat.code}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{cat.description || 'Без описания'}</p>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteCategory(cat.id)}
                    className="text-xs text-red-400 hover:bg-red-500/10 min-h-[44px]"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Удалить
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ------------------- МОДУЛЬ 6: БАЗА ДАННЫХ (READ-ONLY INSPECTOR) ------------------- */}
      {activeTab === 'database' && (
        <div className="space-y-4">
          <Card className="bg-slate-900/60 border-slate-800 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-white text-base flex items-center">
                  <Database className="h-5 w-5 mr-2 text-red-400" />
                  Инспектор БД Supabase (Read-Only)
                </h3>
                <p className="text-xs text-slate-400">Прямое чтение таблиц PostgreSQL без возможности разрушения</p>
              </div>

              <div className="flex items-center space-x-2">
                <Label className="text-xs text-slate-300 font-mono">Таблица:</Label>
                <select
                  value={selectedDbTable}
                  onChange={(e) => setSelectedDbTable(e.target.value)}
                  className="h-11 rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-slate-100 font-mono font-bold"
                >
                  <option value="companies">companies (Организации)</option>
                  <option value="users">users (Пользователи)</option>
                  <option value="documents">documents (B2B Документы)</option>
                  <option value="document_files">document_files (Сканы R2)</option>
                  <option value="counterparties">counterparties (Контрагенты)</option>
                  <option value="company_partnerships">company_partnerships (Заявки)</option>
                  <option value="file_categories">file_categories (Категории)</option>
                  <option value="document_logs">document_logs (Аудит)</option>
                </select>
              </div>
            </div>

            {dbLoading ? (
              <div className="flex items-center justify-center p-12 text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span>Чтение данных таблицы "{selectedDbTable}"...</span>
              </div>
            ) : dbData.rows.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs">Таблица пуста</div>
            ) : (
              <div className="overflow-x-auto max-h-96 rounded-xl border border-slate-800">
                <Table>
                  <TableHeader className="bg-slate-950 font-mono text-[11px]">
                    <TableRow>
                      {dbData.columns.map((col) => (
                        <TableHead key={col} className="text-slate-300 whitespace-nowrap">
                          {col}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="font-mono text-xs">
                    {dbData.rows.map((row, idx) => (
                      <TableRow key={idx} className="hover:bg-slate-800/40">
                        {dbData.columns.map((col) => (
                          <TableCell key={col} className="truncate max-w-[200px] text-slate-200">
                            {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? 'null')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО МОДЕРАЦИИ (ЗАМЕЧАНИЕ / БЛОКИРОВКА) */}
      {selectedCompany && modalMode && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4">
            <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-1 sm:hidden opacity-80" />
            <h3 className="text-base sm:text-lg font-bold text-white flex items-center">
              {modalMode === 'request_changes' ? (
                <>
                  <HelpCircle className="h-5 w-5 mr-2 text-amber-400" />
                  Запрос изменений организации
                </>
              ) : (
                <>
                  <Ban className="h-5 w-5 mr-2 text-red-400" />
                  Блокировка организации
                </>
              )}
            </h3>

            <div className="space-y-2">
              <Label className="text-xs text-slate-300 font-semibold">
                Укажите причину для компании "{selectedCompany.name}":
              </Label>
              <textarea
                value={moderationComment}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setModerationComment(e.target.value)}
                placeholder={
                  modalMode === 'request_changes'
                    ? 'Укажите некорректные данные или документы...'
                    : 'Причина блокировки компании...'
                }
                className="w-full h-24 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedCompany(null);
                  setModalMode(null);
                }}
                className="min-h-[48px]"
              >
                Отмена
              </Button>

              <Button
                onClick={handleConfirmModerationAction}
                disabled={isPending}
                className={
                  modalMode === 'request_changes'
                    ? 'bg-amber-600 hover:bg-amber-500 text-white font-bold min-h-[48px] px-6'
                    : 'bg-red-600 hover:bg-red-500 text-white font-bold min-h-[48px] px-6'
                }
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Подтвердить'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* МОДАЛКА СОЗДАНИЯ КОМПАНИИ */}
      {showCreateCompanyModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-1 sm:hidden opacity-80" />
            <h3 className="text-base sm:text-lg font-bold text-white">Создание Организации Суперадмином</h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-300">Наименование *</Label>
                <Input value={newCompName} onChange={(e) => setNewCompName(e.target.value)} placeholder="ОсОО АлгазТрейд..." className="bg-slate-950 border-slate-800 text-white min-h-[48px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-300">ИНН (14 цифр) *</Label>
                <Input value={newCompInn} onChange={(e) => setNewCompInn(e.target.value)} placeholder="01203202410145" className="bg-slate-950 border-slate-800 text-white font-mono min-h-[48px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-300">ФИО Директора</Label>
                <Input value={newCompDirector} onChange={(e) => setNewCompDirector(e.target.value)} placeholder="Иванов И.И." className="bg-slate-950 border-slate-800 text-white min-h-[48px]" />
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <Button variant="ghost" onClick={() => setShowCreateCompanyModal(false)} className="min-h-[48px]">Отмена</Button>
              <Button onClick={handleCreateCompany} disabled={isPending} className="bg-blue-600 hover:bg-blue-500 text-white font-bold min-h-[48px] px-6">Создать</Button>
            </div>
          </Card>
        </div>
      )}

      {/* МОДАЛКА РЕДАКТИРОВАНИЯ ОРГАНИЗАЦИИ */}
      {editingCompany && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-xl bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-1 sm:hidden opacity-80" />
            <h3 className="text-base sm:text-lg font-bold text-white flex items-center">
              <Edit2 className="h-4 w-4 mr-2 text-blue-400" />
              Админ-Редактирование Организации
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Наименование *</Label>
                <Input value={compName} onChange={(e) => setCompName(e.target.value)} className="bg-slate-950 border-slate-800 text-white min-h-[48px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">ИНН 14 цифр *</Label>
                <Input value={compInn} onChange={(e) => setCompInn(e.target.value)} className="bg-slate-950 border-slate-800 text-white font-mono min-h-[48px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Статус</Label>
                <select value={compStatus} onChange={(e) => setCompStatus(e.target.value as any)} className="w-full min-h-[48px] rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-slate-100">
                  <option value="active">Активна (active)</option>
                  <option value="pending_approval">На модерации (pending_approval)</option>
                  <option value="requires_changes">Замечания (requires_changes)</option>
                  <option value="blocked">Заблокирована (blocked)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">ФИО Руководителя</Label>
                <Input value={compDirector} onChange={(e) => setCompDirector(e.target.value)} className="bg-slate-950 border-slate-800 text-white min-h-[48px]" />
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <Button variant="ghost" onClick={() => setEditingCompany(null)} className="min-h-[48px]">Отмена</Button>
              <Button onClick={handleSaveCompany} disabled={isPending} className="bg-blue-600 hover:bg-blue-500 text-white font-bold min-h-[48px] px-6">Сохранить</Button>
            </div>
          </Card>
        </div>
      )}

      {/* МОДАЛКА РЕДАКТИРОВАНИЯ ПОЛЬЗОВАТЕЛЯ */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-lg bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-1 sm:hidden opacity-80" />
            <h3 className="text-base sm:text-lg font-bold text-white flex items-center">
              <UserCheck className="h-4 w-4 mr-2 text-emerald-400" />
              Редактирование Пользователя
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">ФИО Пользователя</Label>
                <Input value={userName} onChange={(e) => setUserName(e.target.value)} className="bg-slate-950 border-slate-800 text-white min-h-[48px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">E-mail</Label>
                <Input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} className="bg-slate-950 border-slate-800 text-white font-mono min-h-[48px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Роль</Label>
                <select value={userRole} onChange={(e) => setUserRole(e.target.value as any)} className="w-full min-h-[48px] rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-slate-100">
                  <option value="owner">Владелец (owner)</option>
                  <option value="accountant">Бухгалтер (accountant)</option>
                  <option value="manager">Менеджер (manager)</option>
                </select>
              </div>
              <div className="flex items-center space-x-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
                <input type="checkbox" id="is_super_admin" checked={userIsSuperAdmin} onChange={(e) => setUserIsSuperAdmin(e.target.checked)} className="h-5 w-5 rounded bg-slate-900 text-amber-500" />
                <Label htmlFor="is_super_admin" className="text-xs text-amber-400 font-bold cursor-pointer">Права Суперадмина</Label>
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <Button variant="ghost" onClick={() => setEditingUser(null)} className="min-h-[48px]">Отмена</Button>
              <Button onClick={handleSaveUser} disabled={isPending} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold min-h-[48px] px-6">Сохранить</Button>
            </div>
          </Card>
        </div>
      )}

      {/* МОДАЛКА РЕДАКТИРОВАНИЯ B2B ДОКУМЕНТА */}
      {editingDoc && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-1 sm:hidden opacity-80" />
            <h3 className="text-base sm:text-lg font-bold text-white">Редактирование B2B Документа</h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-300">Номер документа</Label>
                <Input value={editDocNumber} onChange={(e) => setEditDocNumber(e.target.value)} className="bg-slate-950 border-slate-800 text-white min-h-[48px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-300">Статус</Label>
                <select value={editDocStatus} onChange={(e) => setEditDocStatus(e.target.value as any)} className="w-full min-h-[48px] rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 px-3">
                  <option value="draft">Черновик (draft)</option>
                  <option value="sent">На рассмотрении (sent)</option>
                  <option value="accepted">Принято (accepted)</option>
                  <option value="processed">Обработано (processed)</option>
                  <option value="cancelled">Отклонено (cancelled)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <Button variant="ghost" onClick={() => setEditingDoc(null)} className="min-h-[48px]">Отмена</Button>
              <Button onClick={handleSaveDoc} disabled={isPending} className="bg-blue-600 hover:bg-blue-500 text-white font-bold min-h-[48px] px-6">Сохранить</Button>
            </div>
          </Card>
        </div>
      )}

      {/* МОДАЛКА СОЗДАНИЯ КАТЕГОРИИ */}
      {showCreateCatModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-1 sm:hidden opacity-80" />
            <h3 className="text-base sm:text-lg font-bold text-white">Новая Категория Сканов</h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-300">Наименование *</Label>
                <Input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="Уставные Документы..." className="bg-slate-950 border-slate-800 text-white min-h-[48px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-300">Символьный Код *</Label>
                <Input value={newCatCode} onChange={(e) => setNewCatCode(e.target.value)} placeholder="statute_docs" className="bg-slate-950 border-slate-800 text-white font-mono min-h-[48px]" />
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <Button variant="ghost" onClick={() => setShowCreateCatModal(false)} className="min-h-[48px]">Отмена</Button>
              <Button onClick={handleCreateCategory} disabled={isPending} className="bg-amber-600 hover:bg-amber-500 text-white font-bold min-h-[48px] px-6">Добавить</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
