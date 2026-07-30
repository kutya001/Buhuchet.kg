'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card } from '@/components/ui/card';
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
  FileText,
  Loader2,
  FolderOpen,
  Download,
  Edit2,
  Trash2,
  RefreshCw,
  AlertCircle,
  Users,
  UserCheck,
  UserPlus,
  Database,
  BookOpen,
  Plus,
  Check,
  Ban,
  Clock,
  ExternalLink,
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
  deleteFileCategoryAdminAction,
  inspectTableDataAdminAction,
} from './actions';
import {
  getAllSystemFilesAction,
  deleteDocumentFileAction,
} from '../dashboard/files/archive-actions';
import { getPresignedDownloadUrlAction } from '../dashboard/files/actions';
import type { Company, DocumentFile, FileCategory } from '@/types/database.types';
import { createClient } from '@/lib/supabase/client';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';

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
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

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

  // ДЕЙСТВИЯ МОДЕРАЦИИ ОРГАНИЗАЦИЙ
  const handleApprove = (comp: Company) => {
    setMsg(null);
    startTransition(async () => {
      const res = await approveCompanyAction(comp.id);
      if (res.success) {
        setMsg({ type: 'success', text: `Организация "${comp.name}" успешно подтверждена!` });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка подтверждения' });
      }
    });
  };

  const handleRequestChanges = () => {
    if (!selectedCompany || !moderationComment) return;
    setMsg(null);
    startTransition(async () => {
      const res = await requestCompanyChangesAction(selectedCompany.id, moderationComment);
      if (res.success) {
        setMsg({ type: 'success', text: `Запрос исправления отправлен компании "${selectedCompany.name}"` });
        setSelectedCompany(null);
        setModerationComment('');
        setModalMode(null);
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка отправки' });
      }
    });
  };

  const handleBlock = () => {
    if (!selectedCompany || !moderationComment) return;
    setMsg(null);
    startTransition(async () => {
      const res = await blockCompanyAction(selectedCompany.id, moderationComment);
      if (res.success) {
        setMsg({ type: 'success', text: `Организация "${selectedCompany.name}" заблокирована.` });
        setSelectedCompany(null);
        setModerationComment('');
        setModalMode(null);
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка блокировки' });
      }
    });
  };

  const handleCreateCompany = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompName || !newCompInn || newCompInn.length !== 14) {
      alert('Заполните название и ИНН (14 цифр)!');
      return;
    }

    setMsg(null);
    startTransition(async () => {
      const res = await createCompanyAdminAction({
        name: newCompName,
        inn: newCompInn,
        director_name: newCompDirector || undefined,
      });

      if (res.success) {
        setMsg({ type: 'success', text: `Организация "${newCompName}" верифицирована и создана` });
        setShowCreateCompanyModal(false);
        setNewCompName('');
        setNewCompInn('');
        setNewCompDirector('');
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка создания' });
      }
    });
  };

  const handleOpenEditCompany = (comp: Company) => {
    setEditingCompany(comp);
    setCompName(comp.name);
    setCompInn(comp.inn);
    setCompIndustry(comp.industry || '');
    setCompStatus(comp.status);
    setCompAddress(comp.legal_address || '');
    setCompDirector(comp.director_name || '');
  };

  const handleSaveCompanyEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompany) return;
    setMsg(null);

    startTransition(async () => {
      const res = await updateCompanyAdminAction(editingCompany.id, {
        name: compName,
        inn: compInn,
        industry: compIndustry || undefined,
        status: compStatus,
        legal_address: compAddress || undefined,
        director_name: compDirector || undefined,
      });

      if (res.success) {
        setMsg({ type: 'success', text: `Данные компании "${compName}" обновлены` });
        setEditingCompany(null);
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка обновления' });
      }
    });
  };

  // ПОЛЬЗОВАТЕЛИ
  const handleOpenEditUser = (u: any) => {
    setEditingUser(u);
    setUserName(u.full_name || '');
    setUserEmail(u.email || '');
    setUserRole(u.role || 'owner');
    setUserCompId(u.company_id || '');
    setUserIsSuperAdmin(!!u.is_super_admin);
  };

  const handleSaveUserEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setMsg(null);

    startTransition(async () => {
      const res = await updateUserAdminAction(editingUser.id, {
        full_name: userName,
        role: userRole,
        company_id: userCompId || undefined,
        is_super_admin: userIsSuperAdmin,
      });

      if (res.success) {
        setMsg({ type: 'success', text: `Пользователь "${userName}" обновлен` });
        setEditingUser(null);
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка обновления пользователя' });
      }
    });
  };

  const handleDeleteUser = (userId: string, name: string) => {
    if (!confirm(`Вы действительно хотите удалить пользователя ${name}?`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await deleteUserAdminAction(userId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Пользователь удален' });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления' });
      }
    });
  };

  // ДОКУМЕНТЫ
  const handleOpenEditDoc = (doc: any) => {
    setEditingDoc(doc);
    setEditDocNumber(doc.doc_number || '');
    setEditDocStatus(doc.status || 'sent');
    setEditDocComment(doc.comment || '');
  };

  const handleSaveDocEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDoc) return;
    setMsg(null);

    startTransition(async () => {
      const res = await updateDocumentAdminAction(editingDoc.id, {
        doc_number: editDocNumber,
        status: editDocStatus,
        comment: editDocComment,
      });

      if (res.success) {
        setMsg({ type: 'success', text: 'Документ обновлен' });
        setEditingDoc(null);
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка обновления документа' });
      }
    });
  };

  const handleDeleteDoc = (docId: string) => {
    if (!confirm('Вы действительно хотите полностью удалить этот документ?')) return;
    setMsg(null);
    startTransition(async () => {
      const res = await deleteDocumentAdminAction(docId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Документ удален' });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления документа' });
      }
    });
  };

  // СКАЧИВАНИЕ И УДАЛЕНИЕ СИСТЕМНЫХ ФАЙЛОВ
  const handleDownloadFile = async (fileKey: string) => {
    if (!fileKey) return;
    const res = await getPresignedDownloadUrlAction(fileKey);
    if (res.success && res.data?.downloadUrl) {
      window.open(res.data.downloadUrl, '_blank');
    } else {
      alert(res.error || 'Сбой получения R2 ссылки');
    }
  };

  const handleDeleteFile = (fileId: string, name: string) => {
    if (!confirm(`Удалить файл ${name} из системного архива R2?`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await deleteDocumentFileAction(fileId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Файл успешно удален из R2' });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления файла' });
      }
    });
  };

  // СПРАВОЧНИКИ
  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName || !newCatCode) return;
    setMsg(null);

    startTransition(async () => {
      const res = await createFileCategoryAdminAction(newCatName, newCatDesc || '');

      if (res.success) {
        setMsg({ type: 'success', text: `Категория "${newCatName}" создана` });
        setShowCreateCatModal(false);
        setNewCatName('');
        setNewCatCode('');
        setNewCatDesc('');
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка создания категории' });
      }
    });
  };

  const handleDeleteCategory = (catId: string, name: string) => {
    if (!confirm(`Удалить категорию "${name}"?`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await deleteFileCategoryAdminAction(catId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Категория удалена' });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления' });
      }
    });
  };

  // ---------------- CONFIG FOR TAB 1: COMPANIES (UnifiedDataGrid) ----------------
  const filteredCompanies = allCompanies.filter((c) => {
    if (companySubTab === 'pending') return c.status === 'pending_approval';
    if (companySubTab === 'problematic') return c.status === 'requires_changes' || c.status === 'blocked';
    return true;
  });

  const companiesColumns: ColumnDef<Company>[] = [
    {
      key: 'name',
      label: 'Наименование Организации',
      sortable: true,
      getValue: (c) => c.name,
      render: (c) => (
        <div className="font-semibold text-white text-sm flex items-center space-x-1.5">
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
              : c.status === 'pending_approval'
              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
              : c.status === 'blocked'
              ? 'bg-red-500/20 text-red-400 border-red-500/30'
              : 'bg-purple-500/20 text-purple-400 border-purple-500/30'
          }
        >
          {c.status === 'active' && 'Подтверждена (Active)'}
          {c.status === 'pending_approval' && 'На модерации'}
          {c.status === 'requires_changes' && 'Нужны правки'}
          {c.status === 'blocked' && 'Заблокирована'}
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
      key: 'actions',
      label: 'Модерация',
      sortable: false,
      render: (c) => (
        <div className="flex items-center justify-end space-x-2">
          {c.status === 'pending_approval' && (
            <Button size="sm" onClick={() => handleApprove(c)} disabled={isPending} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs min-h-[36px]">
              <Check className="h-3.5 w-3.5 mr-1" />
              Одобрить
            </Button>
          )}

          <Button size="sm" variant="outline" onClick={() => handleOpenEditCompany(c)} className="border-slate-800 text-blue-400 hover:bg-blue-500/10 text-xs min-h-[36px]">
            <Edit2 className="h-3.5 w-3.5 mr-1" />
            Редактировать
          </Button>

          {c.status !== 'blocked' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedCompany(c);
                setModalMode('block');
              }}
              className="border-red-900/40 text-red-400 hover:bg-red-500/10 text-xs min-h-[36px]"
            >
              <Ban className="h-3.5 w-3.5 mr-1" />
              Блок
            </Button>
          )}
        </div>
      ),
    },
  ];

  // ---------------- CONFIG FOR TAB 2: USERS (UnifiedDataGrid) ----------------
  const usersColumns: ColumnDef<any>[] = [
    {
      key: 'full_name',
      label: 'ФИО Пользователя',
      sortable: true,
      getValue: (u) => u.full_name || u.email,
      render: (u) => (
        <div className="font-semibold text-white text-sm flex items-center space-x-1.5">
          <Users className="h-4 w-4 text-emerald-400 flex-shrink-0" />
          <span>{u.full_name || 'Без имени'}</span>
        </div>
      ),
    },
    {
      key: 'email',
      label: 'Email',
      sortable: true,
      getValue: (u) => u.email,
      render: (u) => <span className="font-mono text-xs text-slate-300">{u.email}</span>,
    },
    {
      key: 'role',
      label: 'Роль',
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
      label: 'Суперадмин',
      sortable: true,
      getValue: (u) => u.is_super_admin,
      render: (u) =>
        u.is_super_admin ? (
          <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
            <Shield className="h-3.5 w-3.5 mr-1" />
            Суперадмин
          </Badge>
        ) : (
          <span className="text-slate-500 text-xs">—</span>
        ),
    },
    {
      key: 'actions',
      label: 'Действия',
      sortable: false,
      render: (u) => (
        <div className="flex items-center justify-end space-x-2">
          <Button size="sm" variant="outline" onClick={() => handleOpenEditUser(u)} className="border-slate-800 text-blue-400 hover:bg-blue-500/10 text-xs min-h-[36px]">
            <Edit2 className="h-3.5 w-3.5 mr-1" />
            Редактировать
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleDeleteUser(u.id, u.full_name || u.email)} className="border-red-900/40 text-red-400 hover:bg-red-500/10 text-xs min-h-[36px]">
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Удалить
          </Button>
        </div>
      ),
    },
  ];

  // ---------------- CONFIG FOR TAB 3: FILES (UnifiedDataGrid) ----------------
  const filesColumns: ColumnDef<any>[] = [
    {
      key: 'file_name',
      label: 'Наименование Файла',
      sortable: true,
      getValue: (f) => f.file_name,
      render: (f) => (
        <div className="font-semibold text-white text-xs sm:text-sm flex items-center space-x-2">
          <FileText className="h-4 w-4 text-purple-400 flex-shrink-0" />
          <span className="truncate max-w-[220px] font-mono">{f.file_name}</span>
        </div>
      ),
    },
    {
      key: 'company',
      label: 'Организация',
      sortable: true,
      getValue: (f) => f.companies?.name,
      render: (f) => <span className="text-xs font-semibold text-slate-300">{f.companies?.name || '—'}</span>,
    },
    {
      key: 'file_size',
      label: 'Размер',
      sortable: true,
      getValue: (f) => f.file_size,
      render: (f) => <span className="font-mono text-xs text-slate-400">{f.file_size || '1.5 MB'}</span>,
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
      label: 'Действия',
      sortable: false,
      render: (f) => (
        <div className="flex items-center justify-end space-x-2">
          {f.file_path_r2 && (
            <Button size="sm" variant="outline" onClick={() => handleDownloadFile(f.file_path_r2)} className="border-slate-800 text-purple-400 text-xs min-h-[36px]">
              <Download className="h-3.5 w-3.5 mr-1" />
              Скачать
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => handleDeleteFile(f.id, f.file_name)} className="border-red-900/40 text-red-400 hover:bg-red-500/10 text-xs min-h-[36px]">
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Удалить
          </Button>
        </div>
      ),
    },
  ];

  // ---------------- CONFIG FOR TAB 4: DOCUMENTS (UnifiedDataGrid) ----------------
  const documentsColumns: ColumnDef<any>[] = [
    {
      key: 'doc_number',
      label: '№ Документа',
      sortable: true,
      getValue: (d) => d.doc_number || d.id,
      render: (d) => <span className="font-mono font-bold text-white text-xs sm:text-sm">№ {d.doc_number || d.id.slice(0, 8)}</span>,
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
      render: (d) => <span className="font-mono font-bold text-emerald-400 text-xs sm:text-sm">{Number(d.total_amount || 0).toLocaleString('ru-RU')} c.</span>,
    },
    {
      key: 'actions',
      label: 'Действия',
      sortable: false,
      render: (d) => (
        <div className="flex items-center justify-end space-x-2">
          <Button size="sm" variant="outline" onClick={() => handleOpenEditDoc(d)} className="border-slate-800 text-blue-400 hover:bg-blue-500/10 text-xs min-h-[36px]">
            <Edit2 className="h-3.5 w-3.5 mr-1" />
            Редактировать
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleDeleteDoc(d.id)} className="border-red-900/40 text-red-400 hover:bg-red-500/10 text-xs min-h-[36px]">
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Удалить
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* 1. ШАПКА ПАНЕЛИ СУПЕРАДМИНА */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center">
            <Shield className="h-6 w-6 mr-2.5 text-purple-400" />
            Панель Суперадминистратора КР
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Модерация организаций, контроль B2B документов, файлы R2 и пользователи системы
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => setShowCreateCompanyModal(true)}
          className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs min-h-[44px] shadow-lg shadow-purple-600/20"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          + Верифицировать Компанию
        </Button>
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

      {/* 2. НАВИГАЦИОННЫЕ ВКЛАДКИ СУПЕРАДМИНА */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('companies')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'companies'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/40 font-bold shadow-lg shadow-purple-500/10'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>Организации КР ({allCompanies.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'users'
              ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 font-bold shadow-lg shadow-emerald-500/10'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Пользователи ({allUsers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('files')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'files'
              ? 'bg-amber-600/20 text-amber-400 border border-amber-500/40 font-bold shadow-lg shadow-amber-500/10'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <FolderOpen className="h-4 w-4" />
          <span>Все Файлы R2 ({systemFiles.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('documents')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'documents'
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40 font-bold shadow-lg shadow-blue-500/10'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Все Документы ({allDocuments.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('lookups')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all min-h-[44px] ${
            activeTab === 'lookups'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/40 font-bold shadow-lg shadow-indigo-500/10'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <BookOpen className="h-4 w-4" />
          <span>Справочники</span>
        </button>
      </div>

      {/* ------------------- ВКЛАДКА 1: ОРГАНИЗАЦИИ КР (UnifiedDataGrid) ------------------- */}
      {activeTab === 'companies' && (
        <div className="space-y-4">
          <div className="flex items-center space-x-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
            <button
              onClick={() => setCompanySubTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                companySubTab === 'all' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Все Компания ({allCompanies.length})
            </button>
            <button
              onClick={() => setCompanySubTab('pending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
                companySubTab === 'pending' ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Требуют Модерации ({pendingCompanies.length})
            </button>
          </div>

          <UnifiedDataGrid<Company>
            columns={companiesColumns}
            data={filteredCompanies}
            keyExtractor={(c) => c.id}
            searchPlaceholder="Поиск организации по названию, ИНН..."
            emptyMessage="Организации не найдены."
            isLoading={loading}
            defaultPageSize={25}
          />
        </div>
      )}

      {/* ------------------- ВКЛАДКА 2: ПОЛЬЗОВАТЕЛИ (UnifiedDataGrid) ------------------- */}
      {activeTab === 'users' && (
        <UnifiedDataGrid<any>
          columns={usersColumns}
          data={allUsers}
          keyExtractor={(u) => u.id}
          searchPlaceholder="Поиск пользователя по имени, email..."
          emptyMessage="Пользователи не найдены."
          isLoading={loading}
          defaultPageSize={25}
        />
      )}

      {/* ------------------- ВКЛАДКА 3: ФАЙЛЫ R2 (UnifiedDataGrid) ------------------- */}
      {activeTab === 'files' && (
        <UnifiedDataGrid<any>
          columns={filesColumns}
          data={systemFiles}
          keyExtractor={(f) => f.id}
          searchPlaceholder="Поиск по наименованию файла, организации..."
          emptyMessage="Системные файлы не найдены."
          isLoading={loading}
          defaultPageSize={25}
        />
      )}

      {/* ------------------- ВКЛАДКА 4: ДОКУМЕНТЫ (UnifiedDataGrid) ------------------- */}
      {activeTab === 'documents' && (
        <UnifiedDataGrid<any>
          columns={documentsColumns}
          data={allDocuments}
          keyExtractor={(d) => d.id}
          searchPlaceholder="Поиск по № документа, отправителю..."
          emptyMessage="Документы не найдены."
          isLoading={loading}
          defaultPageSize={25}
        />
      )}

      {/* МОДАЛЬНЫЕ ОКНА НА UnifiedFormModal */}
      {/* 1. СОЗДАНИЕ КОМПАНИИ СУПЕРАДМИНОМ */}
      <UnifiedFormModal
        isOpen={showCreateCompanyModal}
        onClose={() => setShowCreateCompanyModal(false)}
        title="Верификация и Создание Организации"
        subtitle="Ручное добавление юридического лица в реестр КР"
        mode="create"
        onSubmit={handleCreateCompany}
        isSubmitting={isPending}
        submitText="Создать и верифицировать"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Наименование компании *</Label>
            <Input
              value={newCompName}
              onChange={(e) => setNewCompName(e.target.value)}
              placeholder="ОсОО АльфаЛогистик"
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
              placeholder="Иванов И.И."
              className="bg-slate-950 border-slate-800 text-white min-h-[44px]"
            />
          </div>
        </div>
      </UnifiedFormModal>

      {/* 2. РЕДАКТИРОВАНИЕ КОМПАНИИ */}
      <UnifiedFormModal
        isOpen={!!editingCompany}
        onClose={() => setEditingCompany(null)}
        title="Редактирование Организации"
        subtitle={`ИНН: ${editingCompany?.inn || '—'}`}
        mode="edit"
        onSubmit={handleSaveCompanyEdit}
        isSubmitting={isPending}
        submitText="Сохранить"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Наименование компании</Label>
            <Input
              value={compName}
              onChange={(e) => setCompName(e.target.value)}
              className="bg-slate-950 border-slate-800 text-white min-h-[44px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-300">ИНН КР</Label>
            <Input
              value={compInn}
              onChange={(e) => setCompInn(e.target.value)}
              className="bg-slate-950 border-slate-800 text-white font-mono min-h-[44px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Статус модерации</Label>
            <select
              value={compStatus}
              onChange={(e) => setCompStatus(e.target.value as any)}
              className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-white font-bold"
            >
              <option value="active">Active (Подтверждена)</option>
              <option value="pending_approval">Pending Approval (На модерации)</option>
              <option value="requires_changes">Requires Changes (Правки)</option>
              <option value="blocked">Blocked (Заблокирована)</option>
            </select>
          </div>
        </div>
      </UnifiedFormModal>
    </div>
  );
}
