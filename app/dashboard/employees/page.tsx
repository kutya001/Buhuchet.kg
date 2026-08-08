'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Users,
  UserCheck,
  Shield,
  Phone,
  Building2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  Edit2,
  X,
  User,
  Trash2,
  MessageCircle,
  Clock,
  UserPlus,
  Send,
  Plus,
} from 'lucide-react';
import { UnifiedDataGrid } from '@/components/ui/unified/UnifiedDataGrid';
import { createClient } from '@/lib/supabase/client';
import {
  getCompanyEmployeesAction,
  getCompanyRolesAction,
  getPendingRequestsAction,
  approveEmployeeRequestAction,
  rejectEmployeeRequestAction,
  updateEmployeeRoleAndPositionAction,
  removeEmployeeAction,
  createCompanyRoleAction,
  updateCompanyRoleAction,
  deleteCompanyRoleAction,
} from './actions';
import type { UserProfile, CompanyRole, RolePermissions } from '@/types/database.types';
import { MODULE_CONFIG, ModuleName, ActionName, hasPermission } from '@/lib/auth/permissions';

export default function EmployeesModulePage() {
  const [activeTab, setActiveTab] = useState<'employees' | 'requests' | 'roles'>('employees');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Текущий профиль пользователя
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null);

  // Реестры
  const [pendingRequests, setPendingRequests] = useState<UserProfile[]>([]);
  const [employees, setEmployees] = useState<UserProfile[]>([]);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [empPage, setEmpPage] = useState(1);
  const [empLimit, setEmpLimit] = useState(25);
  const [empSearch, setEmpSearch] = useState('');

  // Модальные окна и формы
  const [editingEmp, setEditingEmp] = useState<UserProfile | null>(null);
  const [editRoleId, setEditRoleId] = useState('');
  const [editPosition, setEditPosition] = useState('');

  // Принятие заявки
  const [approvingUser, setApprovingUser] = useState<UserProfile | null>(null);
  const [approveRoleId, setApproveRoleId] = useState('');
  const [approvePosition, setApprovePosition] = useState('Менеджер');

  // Роли
  const [roles, setRoles] = useState<CompanyRole[]>([]);
  const [showAddRoleModal, setShowAddRoleModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [editingRole, setEditingRole] = useState<CompanyRole | null>(null);
  const [rolePermissions, setRolePermissions] = useState<RolePermissions>({});

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const supabase = createClient();

  const loadData = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: prof } = await supabase
        .from('users')
        .select('*, companies(*), company_roles(*)')
        .eq('id', user.id)
        .single();

      if (prof) {
        setCurrentProfile(prof);

        if (prof.company_id) {
          // Загрузка поступающих заявок
          const pendRes = await getPendingRequestsAction(prof.company_id);
          if (pendRes.success && pendRes.data) {
            setPendingRequests(pendRes.data);
          }
        }
      }

      // Загрузка ролей
      const rolesRes = await getCompanyRolesAction();
      if (rolesRes.success && rolesRes.data) {
        setRoles(rolesRes.data);
        if (rolesRes.data.length > 0) {
          setApproveRoleId(rolesRes.data[0].id);
        }
      }

      // Загрузка активных сотрудников
      const empRes = await getCompanyEmployeesAction(empPage, empLimit, empSearch);
      if (empRes.success && empRes.data) {
        setEmployees(empRes.data.employees);
        setTotalEmployees(empRes.data.totalCount);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [empPage, empLimit]);

  const handleSearchClick = async () => {
    setEmpPage(1);
    await loadData();
  };

  // Подтверждение заявки сотрудника
  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvingUser) return;
    setMsg(null);

    startTransition(async () => {
      const res = await approveEmployeeRequestAction({
        userId: approvingUser.id,
        roleId: approveRoleId,
        position: approvePosition,
      });

      if (res.success) {
        setMsg({ type: 'success', text: `Сотрудник ${approvingUser.full_name} успешно зачислен в штат!` });
        setApprovingUser(null);
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Сбой утверждения заявки' });
      }
    });
  };

  // Отклонение заявки
  const handleReject = async (userId: string) => {
    if (!confirm('Вы действительно хотите отклонить эту заявку?')) return;
    setMsg(null);

    startTransition(async () => {
      const res = await rejectEmployeeRequestAction(userId);
      if (res.success) {
        setMsg({ type: 'success', text: 'Заявка сотрудника отклонена' });
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка отклонения заявки' });
      }
    });
  };

  // Сохранение изменений Роли и Должности сотрудника
  const handleSaveRoleAndPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp) return;
    setMsg(null);

    startTransition(async () => {
      const res = await updateEmployeeRoleAndPositionAction({
        userId: editingEmp.id,
        roleId: editRoleId,
        position: editPosition,
      });

      if (res.success) {
        setMsg({ type: 'success', text: `Данные сотрудника ${editingEmp.full_name} обновлены` });
        setEditingEmp(null);
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка обновления сотрудника' });
      }
    });
  };

  // Исключение сотрудника из компании
  const handleRemoveEmp = async (userId: string, empName: string) => {
    if (!confirm(`Вы действительно хотите исключить сотрудника "${empName}" из компании?`)) return;
    setMsg(null);

    startTransition(async () => {
      const res = await removeEmployeeAction(userId);
      if (res.success) {
        setMsg({ type: 'success', text: `Сотрудник ${empName} исключен из штата` });
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка исключения сотрудника' });
      }
    });
  };

  // Создание новой роли
  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    startTransition(async () => {
      const res = await createCompanyRoleAction({
        name: newRoleName,
        description: newRoleDesc,
      });

      if (res.success) {
        setMsg({ type: 'success', text: `Роль "${newRoleName}" успешно создана!` });
        setShowAddRoleModal(false);
        setNewRoleName('');
        setNewRoleDesc('');
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Сбой создания роли' });
      }
    });
  };

  // Открытие редактора матрицы доступов роли
  const handleOpenRoleMatrix = (role: CompanyRole) => {
    setEditingRole(role);
    setRolePermissions(role.permissions || {});
  };

  // Переключение разрешения в матрице
  const togglePermission = (moduleId: string, action: string) => {
    setRolePermissions((prev) => {
      const modPerms = (prev as any)[moduleId] || {};
      const currentVal = !!modPerms[action];
      return {
        ...prev,
        [moduleId]: {
          ...modPerms,
          [action]: !currentVal,
        },
      };
    });
  };

  // Сохранение матрицы прав роли
  const handleSaveRoleMatrix = async () => {
    if (!editingRole) return;
    setMsg(null);

    const roleId = editingRole.id;
    const perms = { ...rolePermissions };

    setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, permissions: perms } : r)));
    setMsg({ type: 'success', text: `Матрица доступов для роли "${editingRole.name}" сохранена!` });
    setEditingRole(null);

    startTransition(async () => {
      const res = await updateCompanyRoleAction(roleId, {
        permissions: perms,
      });

      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Ошибка сохранения матрицы прав' });
        await loadData();
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка списка сотрудников и ролей...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Шапка модуля */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center">
            <Users className="h-6 w-6 mr-2 text-blue-400" />
            Управление Персоналом и Доступами
          </h2>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            Утверждение поступающих заявок сотрудников, назначение ролей и ролевая матрица RBAC
          </p>
        </div>

        {/* Переключатель вкладок */}
        <div className="flex items-center space-x-1 p-1 bg-muted/80 border border-border rounded-xl">
          {(!currentProfile || hasPermission(currentProfile, 'employees', 'tab_employees')) && (
            <button
              onClick={() => setActiveTab('employees')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                activeTab === 'employees'
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
              }`}
            >
              <Users className="h-4 w-4" />
              <span>Мои сотрудники ({totalEmployees})</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('requests')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
              activeTab === 'requests'
                ? 'bg-amber-500 text-slate-950 font-extrabold shadow-md'
                : pendingRequests.length > 0
                ? 'text-amber-400 bg-amber-500/10 border border-amber-500/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
            }`}
          >
            <Clock className="h-4 w-4" />
            <span>Заявки в штат ({pendingRequests.length})</span>
          </button>

          {(!currentProfile || hasPermission(currentProfile, 'employees', 'tab_roles')) && (
            <button
              onClick={() => setActiveTab('roles')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                activeTab === 'roles'
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
              }`}
            >
              <Shield className="h-4 w-4" />
              <span>Роли и доступы ({roles.length})</span>
            </button>
          )}
        </div>
      </div>

      {msg && (
        <Alert className={msg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}>
          {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertDescription className="text-xs font-medium">{msg.text}</AlertDescription>
        </Alert>
      )}

      {/* ========================================================================= */}
      {/* 1. ВКЛАДКА: МОИ СОТРУДНИКИ */}
      {/* ========================================================================= */}
      {activeTab === 'employees' && (
        <div className="space-y-6">
          {/* СЕКЦИЯ: ЗАЯВКИ НА ВСТУПЛЕНИЕ (Отображается при наличии pending-заявок) */}
          {pendingRequests.length > 0 && (
            <Card className="bg-amber-500/5 border-amber-500/30 rounded-2xl p-4 md:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                    <Clock className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">Заявки на вступление ({pendingRequests.length})</h3>
                    <p className="text-xs text-muted-foreground">Пользователи, выбравшие вашу компанию при регистрации</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingRequests.map((req) => (
                  <Card key={req.id} className="bg-card border-border/80 p-4 rounded-xl space-y-3 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-bold text-foreground">{req.full_name}</p>
                        <p className="text-xs font-mono text-muted-foreground">{req.email}</p>
                        <p className="text-xs text-muted-foreground">{req.phone || 'Телефон не указан'}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">
                        Ожидает
                      </Badge>
                    </div>

                    <div className="pt-2 flex items-center gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReject(req.id)}
                        disabled={isPending}
                        className="h-8 text-xs border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                      >
                        <X className="w-3.5 h-3.5 mr-1" />
                        Отклонить
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => {
                          setApprovingUser(req);
                          setApprovePosition(req.position || 'Менеджер');
                        }}
                        disabled={isPending}
                        className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Принять в штат
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </Card>
          )}

          {/* Единая система реестра сотрудников UnifiedDataGrid */}
          <UnifiedDataGrid<UserProfile>
            gridId="employees_registry"
            columns={[
              {
                key: 'full_name',
                label: 'ФИО Сотрудника',
                sortable: true,
                render: (emp) => (
                  <div className="flex items-center space-x-2">
                    <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 font-bold shrink-0">
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-bold text-foreground text-xs">{emp.full_name}</p>
                      <p className="text-[11px] font-mono text-muted-foreground">{emp.email}</p>
                    </div>
                  </div>
                ),
              },
              {
                key: 'position',
                label: 'Должность',
                sortable: true,
                render: (emp) => (
                  <Badge variant="outline" className="text-[11px] font-medium border-border/80 bg-muted/30 text-foreground">
                    {emp.position || '—'}
                  </Badge>
                ),
              },
              {
                key: 'role',
                label: 'Системная Роль',
                sortable: true,
                render: (emp) =>
                  emp.role === 'owner' ? (
                    <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold">
                      Владелец (Админ)
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-purple-500/40 text-purple-400 text-[10px] font-bold">
                      {emp.company_roles?.name || 'Менеджер'}
                    </Badge>
                  ),
              },
              {
                key: 'phone',
                label: 'Телефон',
                sortable: true,
                render: (emp) => <span className="text-xs font-mono text-foreground">{emp.phone || '—'}</span>,
              },
            ]}
            data={employees}
            keyExtractor={(emp) => emp.id}
            onRowClick={(emp) => {
              if (emp.role !== 'owner') {
                setEditingEmp(emp);
                setEditRoleId(emp.role_id || (roles[0]?.id || ''));
                setEditPosition(emp.position || '');
              }
            }}
            getRowActions={(emp) => {
              const isOwnerEmp = emp.role === 'owner';
              const cleanPhone = emp.phone ? emp.phone.replace(/\D/g, '') : '';
              const actions: any[] = [];

              if (emp.phone) {
                actions.push(
                  {
                    label: '🟢 WhatsApp',
                    action: () => window.open(`https://wa.me/${cleanPhone}`, '_blank'),
                  },
                  {
                    label: '🔵 Telegram',
                    action: () => window.open(`https://t.me/+${cleanPhone}`, '_blank'),
                  },
                  {
                    label: '📞 Позвонить',
                    action: () => (window.location.href = `tel:${emp.phone}`),
                  }
                );
              }

              if (!isOwnerEmp) {
                actions.push(
                  {
                    label: '✏️ Изменить роль / должность',
                    separatorBefore: actions.length > 0,
                    action: () => {
                      setEditingEmp(emp);
                      setEditRoleId(emp.role_id || (roles[0]?.id || ''));
                      setEditPosition(emp.position || '');
                    },
                  },
                  {
                    label: '❌ Исключить из штата',
                    danger: true,
                    action: () => handleRemoveEmp(emp.id, emp.full_name),
                  }
                );
              }

              return actions;
            }}
            searchPlaceholder="Поиск по имени, должности, email..."
            emptyMessage="Сотрудники не найдены."
            isLoading={loading}
            defaultPageSize={25}
          />
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. ВКЛАДКА: ЗАЯВКИ НА ВСТУПЛЕНИЕ В ШТАТ */}
      {/* ========================================================================= */}
      {activeTab === 'requests' && (
        <div className="space-y-6">
          <Card className="bg-card border-border/80 rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center">
                  <Clock className="w-5 h-5 mr-2 text-amber-400" />
                  Заявки сотрудников на присоединение
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Пользователи, зарегистрировавшиеся в платформе и выбравшие вашу организацию
                </p>
              </div>
              <Badge variant="outline" className="border-amber-500/30 text-amber-400 font-mono text-xs">
                Всего: {pendingRequests.length}
              </Badge>
            </div>

            {pendingRequests.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground space-y-2">
                <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400 opacity-60" />
                <p className="text-sm font-bold text-foreground">Новых заявок нет</p>
                <p className="text-xs">Все кандидаты обработаны или зачислены в штат компании.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingRequests.map((req) => (
                  <Card key={req.id} className="bg-muted/30 border-border p-4 rounded-xl space-y-3 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-bold text-foreground">{req.full_name}</p>
                        <p className="text-xs font-mono text-muted-foreground">{req.email}</p>
                        <p className="text-xs text-muted-foreground">{req.phone || 'Телефон не указан'}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">
                        Ожидает
                      </Badge>
                    </div>

                    <div className="pt-2 flex items-center gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReject(req.id)}
                        disabled={isPending}
                        className="h-8 text-xs border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                      >
                        <X className="w-3.5 h-3.5 mr-1" />
                        Отклонить
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => {
                          setApprovingUser(req);
                          setApprovePosition(req.position || 'Менеджер');
                        }}
                        disabled={isPending}
                        className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Зачислить
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. ВКЛАДКА: РОЛИ И ДОСТУПЫ */}
      {/* ========================================================================= */}
      {activeTab === 'roles' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-foreground">Ролевая матрица организации</h3>
            <Button
              onClick={() => setShowAddRoleModal(true)}
              className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl h-10 px-4 gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Создать кастомную роль</span>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {roles.map((role) => (
              <Card key={role.id} className="bg-card border-border rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-purple-400" />
                    <h4 className="font-bold text-foreground text-sm">{role.name}</h4>
                  </div>
                  {role.is_system && (
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">
                      Системная
                    </Badge>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">{role.description || 'Описание не указано'}</p>

                <div className="pt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenRoleMatrix(role)}
                    className="h-8 text-xs font-bold rounded-lg border-purple-500/40 text-purple-400 hover:bg-purple-500/10"
                  >
                    <Edit2 className="w-3.5 h-3.5 mr-1.5" />
                    Настроить матрицу прав
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО ПРИНЯТИЯ ЗАЯВКИ */}
      {approvingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md">
          <Card className="max-w-md w-full bg-card border-border rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">Принятие сотрудника в штат</h3>
              <Button size="icon" variant="ghost" onClick={() => setApprovingUser(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Зачисление пользователя <strong>{approvingUser.full_name}</strong> ({approvingUser.email})
            </p>

            <form onSubmit={handleApproveSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Должность в компании</Label>
                <Input
                  value={approvePosition}
                  onChange={(e) => setApprovePosition(e.target.value)}
                  placeholder="Менеджер по продажам"
                  className="h-10 text-xs bg-muted/40 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Назначаемая Роль</Label>
                <select
                  value={approveRoleId}
                  onChange={(e) => setApproveRoleId(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-muted/40 border border-border text-xs text-foreground focus:outline-none"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setApprovingUser(null)} className="h-10 text-xs">
                  Отмена
                </Button>
                <Button type="submit" disabled={isPending} className="h-10 text-xs font-bold bg-emerald-600 text-white rounded-xl">
                  Подтвердить прием
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ РОЛИ И ДОЛЖНОСТИ */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md">
          <Card className="max-w-md w-full bg-card border-border rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">Изменение Роли и Должности</h3>
              <Button size="icon" variant="ghost" onClick={() => setEditingEmp(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Сотрудник: <strong>{editingEmp.full_name}</strong> ({editingEmp.email})
            </p>

            <form onSubmit={handleSaveRoleAndPosition} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Должность в компании</Label>
                <Input
                  value={editPosition}
                  onChange={(e) => setEditPosition(e.target.value)}
                  placeholder="Бухгалтер / Менеджер"
                  className="h-10 text-xs bg-muted/40 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Системная Роль</Label>
                <select
                  value={editRoleId}
                  onChange={(e) => setEditRoleId(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-muted/40 border border-border text-xs text-foreground focus:outline-none"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditingEmp(null)} className="h-10 text-xs">
                  Отмена
                </Button>
                <Button type="submit" disabled={isPending} className="h-10 text-xs font-bold rounded-xl">
                  Сохранить изменения
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО СОЗДАНИЯ РОЛИ */}
      {showAddRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md">
          <Card className="max-w-md w-full bg-card border-border rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">Создание новой роли</h3>
              <Button size="icon" variant="ghost" onClick={() => setShowAddRoleModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <form onSubmit={handleCreateRole} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Название роли</Label>
                <Input
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="Старший Закупщик / Фин. Контролер"
                  className="h-10 text-xs bg-muted/40 rounded-xl"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Описание роли</Label>
                <Input
                  value={newRoleDesc}
                  onChange={(e) => setNewRoleDesc(e.target.value)}
                  placeholder="Отвечает за выгрузку актов в 1С"
                  className="h-10 text-xs bg-muted/40 rounded-xl"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowAddRoleModal(false)} className="h-10 text-xs">
                  Отмена
                </Button>
                <Button type="submit" disabled={isPending} className="h-10 text-xs font-bold bg-purple-600 text-white rounded-xl">
                  Создать роль
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* РЕДАКТОР МАТРИЦЫ ПРАВ РОЛИ */}
      {editingRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md overflow-y-auto">
          <Card className="max-w-3xl w-full bg-card border-border rounded-2xl p-6 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">Матрица доступов роли "{editingRole.name}"</h3>
                <p className="text-xs text-muted-foreground">Настройка видимости модулей и разрешенных экшенов</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setEditingRole(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-6">
              {Object.entries(MODULE_CONFIG).map(([modKey, mod]) => (
                <div key={modKey} className="space-y-2 border-b border-border/60 pb-4">
                  <h4 className="font-bold text-sm text-foreground">{mod.label}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {mod.actions.map((act) => {
                      const modPerms = (rolePermissions as any)[modKey] || {};
                      const isChecked = !!modPerms[act.key];

                      return (
                        <label
                          key={act.key}
                          className={`flex items-center space-x-2.5 p-2 rounded-xl border text-xs cursor-pointer select-none transition-all ${
                            isChecked
                              ? 'bg-purple-600/10 border-purple-500/40 text-purple-300 font-bold'
                              : 'bg-muted/20 border-border/60 text-muted-foreground'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => togglePermission(modKey, act.key)}
                            className="rounded border-border text-purple-600 focus:ring-purple-500"
                          />
                          <span>{act.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-border">
              <Button variant="ghost" onClick={() => setEditingRole(null)} className="h-10 text-xs">
                Отмена
              </Button>
              <Button onClick={handleSaveRoleMatrix} className="h-10 text-xs font-bold bg-purple-600 text-white rounded-xl">
                Сохранить матрицу прав
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
