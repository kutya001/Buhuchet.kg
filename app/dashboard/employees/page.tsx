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
  UserPlus,
  Shield,
  Key,
  Lock,
  Mail,
  Phone,
  Building2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  Plus,
  Edit2,
  Check,
  X,
  User,
  Settings,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  getCompanyEmployeesAction,
  getCompanyRolesAction,
  createEmployeeAction,
  updateEmployeeAction,
  resetEmployeePasswordAction,
  createCompanyRoleAction,
  updateCompanyRoleAction,
  deleteCompanyRoleAction,
} from './actions';
import type { UserProfile, CompanyRole, RolePermissions } from '@/types/database.types';
import { UnifiedDataGrid } from '@/components/ui/unified/UnifiedDataGrid';

import { MODULE_CONFIG, ModuleName, ActionName } from '@/lib/auth/permissions';

export default function EmployeesModulePage() {
  const [activeTab, setActiveTab] = useState<'profile' | 'employees' | 'roles'>('profile');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Состояние пользователя и организации
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null);

  // Смена своего пароля
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdMsg, setPwdMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Реестр сотрудников
  const [employees, setEmployees] = useState<UserProfile[]>([]);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [empPage, setEmpPage] = useState(1);
  const [empLimit, setEmpLimit] = useState(25);
  const [empSearch, setEmpSearch] = useState('');

  // Модальные окна сотрудников
  const [showAddEmpModal, setShowAddEmpModal] = useState(false);
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpEmail, setNewEmpEmail] = useState('');
  const [newEmpPhone, setNewEmpPhone] = useState('');
  const [newEmpPosition, setNewEmpPosition] = useState('Менеджер');
  const [newEmpRoleId, setNewEmpRoleId] = useState('');
  const [newEmpPassword, setNewEmpPassword] = useState('Buhuchet2026!');

  // Редактирование / Сброс пароля сотрудника
  const [editingEmp, setEditingEmp] = useState<UserProfile | null>(null);
  const [resetPwdEmp, setResetPwdEmp] = useState<UserProfile | null>(null);
  const [adminNewPassword, setAdminNewPassword] = useState('');

  // Реестр ролей
  const [roles, setRoles] = useState<CompanyRole[]>([]);
  const [showAddRoleModal, setShowAddRoleModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [editingRole, setEditingRole] = useState<CompanyRole | null>(null);
  const [rolePermissions, setRolePermissions] = useState<RolePermissions>({});

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const supabase = createClient();

  // 1. Первичная загрузка
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
      }

      // Загрузка ролей
      const rolesRes = await getCompanyRolesAction();
      if (rolesRes.success && rolesRes.data) {
        setRoles(rolesRes.data);
      }

      // Загрузка сотрудников
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

  // Фильтрация поиска сотрудников
  const handleSearchClick = async () => {
    setLoading(true);
    const empRes = await getCompanyEmployeesAction(1, empLimit, empSearch);
    if (empRes.success && empRes.data) {
      setEmployees(empRes.data.employees);
      setTotalEmployees(empRes.data.totalCount);
      setEmpPage(1);
    }
    setLoading(false);
  };

  // Смена пароля текущим пользователем
  const handleChangeMyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMsg(null);

    if (newPassword.length < 6) {
      setPwdMsg({ type: 'error', text: 'Новый пароль должен содержать минимум 6 символов' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdMsg({ type: 'error', text: 'Пароли не совпадают' });
      return;
    }

    startTransition(async () => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPwdMsg({ type: 'error', text: `Ошибка смены пароля: ${error.message}` });
      } else {
        setPwdMsg({ type: 'success', text: 'Ваш пароль успешно изменен! Используйте его при следующем входе.' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    });
  };

  // Создание нового сотрудника
  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    startTransition(async () => {
      const res = await createEmployeeAction({
        full_name: newEmpName,
        email: newEmpEmail,
        phone: newEmpPhone,
        position: newEmpPosition,
        role_id: newEmpRoleId || undefined,
        password: newEmpPassword,
      });

      if (res.success) {
        setMsg({ type: 'success', text: `Сотрудник "${newEmpName}" успешно создан! Логин: ${newEmpEmail}` });
        setShowAddEmpModal(false);
        setNewEmpName('');
        setNewEmpEmail('');
        setNewEmpPhone('');
        await loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при создании сотрудника' });
      }
    });
  };

  // Сохранение отредактированного сотрудника
  const handleSaveEmployeeEdit = async () => {
    if (!editingEmp) return;
    setMsg(null);

    const empId = editingEmp.id;
    const updatedData = { ...editingEmp };

    // Оптимистичное обновление
    setEmployees((prev) => prev.map((e) => (e.id === empId ? updatedData : e)));
    setMsg({ type: 'success', text: 'Данные сотрудника обновлены' });
    setEditingEmp(null);

    startTransition(async () => {
      const res = await updateEmployeeAction(empId, {
        full_name: updatedData.full_name,
        position: updatedData.position || undefined,
        role_id: updatedData.role_id || undefined,
        is_active: updatedData.is_active,
      });

      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Сбой обновления' });
        loadData();
      }
    });
  };

  // Сброс пароля сотрудника
  const handleResetEmployeePassword = async () => {
    if (!resetPwdEmp || !adminNewPassword) return;
    setMsg(null);

    startTransition(async () => {
      const res = await resetEmployeePasswordAction(resetPwdEmp.id, adminNewPassword);
      if (res.success) {
        setMsg({ type: 'success', text: `Пароль сотрудника ${resetPwdEmp.full_name} успешно обновлен` });
        setResetPwdEmp(null);
        setAdminNewPassword('');
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка сброса пароля' });
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

    // Оптимистичное обновление матрицы в роли
    setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, permissions: perms } : r)));
    setMsg({ type: 'success', text: `Матрица доступов для роли "${editingRole.name}" сохранена!` });
    setEditingRole(null);

    startTransition(async () => {
      const res = await updateCompanyRoleAction(roleId, {
        permissions: perms,
      });

      if (!res.success) {
        setMsg({ type: 'error', text: res.error || 'Сбой сохранения матрицы прав' });
        loadData();
      }
    });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Заголовок модуля */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground flex items-center">
            <Users className="h-8 w-8 mr-3 text-blue-500" />
            Модуль «Сотрудники» и Роли
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Управление персоналом организации, ролевой моделью доступов (RBAC) и настройками профиля.
          </p>
        </div>

        {/* Переключатель вкладок */}
        <div className="flex items-center space-x-1 p-1 bg-muted/80 border border-border rounded-xl">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
              activeTab === 'profile'
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
            }`}
          >
            <User className="h-4 w-4" />
            <span>Мой профиль</span>
          </button>

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
        </div>
      </div>

      {msg && (
        <Alert className={msg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}>
          {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertDescription className="text-xs font-medium">{msg.text}</AlertDescription>
        </Alert>
      )}

      {/* ========================================================================= */}
      {/* 1. ВКЛАДКА: МОЙ ПРОФИЛЬ */}
      {/* ========================================================================= */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ */}
          <Card className="lg:col-span-6 bg-muted/40 border-border">
            <CardHeader className="border-b border-border/80 pb-4">
              <CardTitle className="text-base font-bold text-foreground flex items-center">
                <UserCheck className="h-5 w-5 mr-2 text-blue-400" />
                Личный Профиль Учетной Записи
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Ваша текущая роль и реквизиты сотрудника в системе.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4 text-xs">
              <div className="p-4 rounded-xl bg-background/60 border border-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-mono uppercase text-[10px]">ФИО сотрудника</span>
                  <Badge variant="outline" className="border-blue-500/30 text-blue-400 font-mono text-[10px]">
                    {currentProfile?.position || 'Сотрудник'}
                  </Badge>
                </div>
                <p className="text-base font-bold text-foreground">{currentProfile?.full_name || 'Загрузка...'}</p>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
                  <div>
                    <span className="text-slate-500 text-[10px]">Логин / Email:</span>
                    <p className="font-mono text-slate-200 truncate">{currentProfile?.email}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px]">Назначенная Роль:</span>
                    <p className="font-semibold text-emerald-400">{currentProfile?.company_roles?.name || (currentProfile?.role === 'owner' ? 'Владелец (Админ)' : 'Пользователь')}</p>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-background/60 border border-border space-y-2">
                <span className="text-muted-foreground font-mono uppercase text-[10px]">Привязанная Организация</span>
                <div className="flex items-center space-x-2 text-foreground font-bold text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span>{(currentProfile?.companies as any)?.name || 'Компания не привязана'}</span>
                </div>
                <p className="text-muted-foreground font-mono text-[11px]">
                  ИНН: {(currentProfile?.companies as any)?.inn || '—'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ФОРМА СМЕНЫ ПАРОЛЯ */}
          <Card className="lg:col-span-6 bg-muted/40 border-border">
            <CardHeader className="border-b border-border/80 pb-4">
              <CardTitle className="text-base font-bold text-foreground flex items-center">
                <Lock className="h-5 w-5 mr-2 text-amber-400" />
                Безопасность & Смена Пароля
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Вы можете самостоятельно изменить свой пароль для входа в платформу.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <form onSubmit={handleChangeMyPassword} className="space-y-4 text-xs">
                {pwdMsg && (
                  <Alert className={pwdMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}>
                    <AlertDescription>{pwdMsg.text}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground">Новый пароль</Label>
                  <Input
                    type="password"
                    placeholder="Минимум 6 символов"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="bg-background border-border text-foreground text-xs rounded-xl min-h-[44px]"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground">Подтвердите новый пароль</Label>
                  <Input
                    type="password"
                    placeholder="Повторите новый пароль"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="bg-background border-border text-foreground text-xs rounded-xl min-h-[44px]"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isPending}
                  className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs min-h-[44px] rounded-xl shadow-md"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Key className="h-4 w-4 mr-2" />}
                  Обновить пароль учетной записи
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. ВКЛАДКА: МОИ СОТРУДНИКИ */}
      {/* ========================================================================= */}
      {activeTab === 'employees' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <Input
                  placeholder="Поиск сотрудника..."
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchClick()}
                  className="pl-9 bg-muted border-border text-xs rounded-xl min-h-[40px] text-foreground"
                />
              </div>
              <Button size="sm" onClick={handleSearchClick} className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs min-h-[40px]">
                Найти
              </Button>
            </div>

            <Button
              onClick={() => setShowAddEmpModal(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs min-h-[44px] rounded-xl shadow-md w-full sm:w-auto"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              + Добавить сотрудника
            </Button>
          </div>

          {/* Таблица сотрудников */}
          <UnifiedDataGrid
            data={employees}
            isLoading={loading}
            keyExtractor={(emp) => emp.id}
            columns={[
              {
                key: 'full_name',
                label: 'Сотрудник / Должность',
                sortable: true,
                getValue: (emp) => emp.full_name,
                render: (emp) => (
                  <div>
                    <p className="font-bold text-foreground text-xs flex items-center">
                      <User className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
                      {emp.full_name}
                    </p>
                    <span className="text-[11px] text-muted-foreground font-mono">{emp.position || 'Сотрудник'}</span>
                  </div>
                ),
              },
              {
                key: 'email',
                label: 'Логин / Email',
                sortable: true,
                getValue: (emp) => emp.email,
                render: (emp) => (
                  <span className="font-mono text-xs text-foreground flex items-center">
                    <Mail className="h-3 w-3 mr-1 text-slate-500" />
                    {emp.email}
                  </span>
                ),
              },
              {
                key: 'role',
                label: 'Назначенная Роль',
                sortable: true,
                getValue: (emp) => emp.company_roles?.name || emp.role,
                render: (emp) => (
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 font-mono text-[11px]">
                    <Shield className="h-3 w-3 mr-1" />
                    {emp.company_roles?.name || (emp.role === 'owner' ? 'Владелец' : 'Без роли')}
                  </Badge>
                ),
              },
              {
                key: 'status',
                label: 'Статус',
                sortable: true,
                getValue: (emp) => emp.is_active,
                render: (emp) => (
                  <Badge className={emp.is_active !== false ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px]' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[10px]'}>
                    {emp.is_active !== false ? 'Активен' : 'Заблокирован'}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                label: 'Действия',
                sortable: false,
                render: (emp) => (
                  <div className="flex items-center justify-end space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingEmp(emp)}
                      className="h-8 border-border text-foreground hover:text-foreground text-xs"
                      title="Редактировать сотрудника"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setResetPwdEmp(emp)}
                      className="h-8 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs"
                      title="Сбросить пароль сотруднику"
                    >
                      <Key className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ),
              },
            ]}
            defaultPageSize={25}
          />
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. ВКЛАДКА: РОЛИ И ДОСТУПЫ (RBAC MATRIX) */}
      {/* ========================================================================= */}
      {activeTab === 'roles' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground flex items-center">
              <Shield className="h-5 w-5 mr-2 text-emerald-400" />
              Ролевая модель и матрица разрешений
            </h2>

            <Button
              onClick={() => setShowAddRoleModal(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs min-h-[44px] rounded-xl shadow-md"
            >
              <Plus className="h-4 w-4 mr-2" />
              + Создать роль
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((role) => (
              <Card key={role.id} className="bg-muted/60 border-border p-4 space-y-3 shadow-lg flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-foreground text-sm flex items-center">
                      <Shield className={`h-4 w-4 mr-2 ${role.is_system ? 'text-amber-400' : 'text-emerald-400'}`} />
                      {role.name}
                    </h3>
                    {role.is_system && (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px] bg-amber-500/10">
                        Системная роль
                      </Badge>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground min-h-[36px]">{role.description || 'Описание роли не указано.'}</p>
                </div>

                <div className="pt-2 border-t border-border/80 space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                    <span>Модулей настроено: {Object.keys(role.permissions || {}).length}</span>
                    {role.is_system && <span className="text-amber-400 font-bold">Нельзя удалить</span>}
                  </div>

                  <div className="flex items-center space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenRoleMatrix(role)}
                      className="flex-1 border-border text-blue-400 hover:bg-blue-500/10 text-xs min-h-[36px]"
                    >
                      <Settings className="h-3.5 w-3.5 mr-1.5" />
                      Настроить доступы
                    </Button>

                    {!role.is_system && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          if (confirm(`Удалить роль "${role.name}"?`)) {
                            const res = await deleteCompanyRoleAction(role.id);
                            if (res.success) {
                              setRoles((prev) => prev.filter((r) => r.id !== role.id));
                              setMsg({ type: 'success', text: `Роль "${role.name}" удалена` });
                            } else {
                              setMsg({ type: 'error', text: res.error || 'Ошибка удаления роли' });
                            }
                          }
                        }}
                        className="border-border text-red-400 hover:bg-red-500/10 text-xs min-h-[36px] px-2.5"
                        title="Удалить пользовательскую роль"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* МОДАЛЬНЫЕ ОКНА */}
      {/* ========================================================================= */}

      {/* МОДАЛКА: Добавление сотрудника */}
      {showAddEmpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-muted border-border text-foreground shadow-2xl">
            <CardHeader className="border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center">
                  <UserPlus className="h-5 w-5 mr-2 text-blue-400" />
                  Создать аккаунт сотрудника
                </CardTitle>
                <button onClick={() => setShowAddEmpModal(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </CardHeader>
            <form onSubmit={handleCreateEmployee}>
              <CardContent className="space-y-4 pt-4 text-xs">
                <div className="space-y-1">
                  <Label className="text-foreground">ФИО Сотрудника *</Label>
                  <Input
                    placeholder="Например: Ивано Асан Рысбекович"
                    value={newEmpName}
                    onChange={(e) => setNewEmpName(e.target.value)}
                    required
                    className="bg-background border-border text-foreground text-xs rounded-xl min-h-[40px]"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-foreground">Логин / Email сотрудника *</Label>
                  <Input
                    type="email"
                    placeholder="asan@company.kg"
                    value={newEmpEmail}
                    onChange={(e) => setNewEmpEmail(e.target.value)}
                    required
                    className="bg-background border-border text-foreground text-xs rounded-xl min-h-[40px]"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-foreground">Должность</Label>
                  <Input
                    placeholder="Например: Бухгалтер по расчетам"
                    value={newEmpPosition}
                    onChange={(e) => setNewEmpPosition(e.target.value)}
                    className="bg-background border-border text-foreground text-xs rounded-xl min-h-[40px]"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-foreground">Назначенная Роль</Label>
                  <select
                    value={newEmpRoleId}
                    onChange={(e) => setNewEmpRoleId(e.target.value)}
                    className="w-full bg-background border border-border text-foreground text-xs rounded-xl px-3 py-2 min-h-[40px]"
                  >
                    <option value="">-- Выберите роль --</option>
                    {roles.filter(r => r.id !== 'owner-system-role').map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-foreground">Временный пароль для первого входа</Label>
                  <Input
                    type="text"
                    value={newEmpPassword}
                    onChange={(e) => setNewEmpPassword(e.target.value)}
                    required
                    className="bg-background border-border text-amber-400 font-mono text-xs rounded-xl min-h-[40px]"
                  />
                  <p className="text-[10px] text-slate-500">Сотрудник сможет сменить этот пароль в своем профиле.</p>
                </div>
              </CardContent>

              <CardFooter className="border-t border-border pt-4 flex justify-end space-x-2">
                <Button variant="outline" type="button" onClick={() => setShowAddEmpModal(false)} className="border-border text-foreground text-xs">
                  Отмена
                </Button>
                <Button type="submit" disabled={isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs">
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                  Создать аккаунт
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* МОДАЛКА: Сброс пароля сотрудника */}
      {resetPwdEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-muted border-border text-foreground shadow-2xl">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-base font-bold flex items-center">
                <Key className="h-5 w-5 mr-2 text-amber-400" />
                Сброс пароля сотруднику: {resetPwdEmp.full_name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-xs">
              <div className="space-y-1">
                <Label className="text-foreground">Новый временный пароль *</Label>
                <Input
                  type="text"
                  placeholder="Введите новый пароль (мин. 6 символов)"
                  value={adminNewPassword}
                  onChange={(e) => setAdminNewPassword(e.target.value)}
                  className="bg-background border-border text-foreground text-xs rounded-xl min-h-[40px]"
                />
              </div>
            </CardContent>
            <CardFooter className="border-t border-border pt-4 flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setResetPwdEmp(null)} className="border-border text-foreground text-xs">
                Отмена
              </Button>
              <Button onClick={handleResetEmployeePassword} disabled={isPending || !adminNewPassword} className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                Установить пароль
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* МОДАЛКА: Создание роли */}
      {showAddRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-muted border-border text-foreground shadow-2xl">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-base font-bold flex items-center">
                <Shield className="h-5 w-5 mr-2 text-emerald-400" />
                Создать новую роль
              </CardTitle>
            </CardHeader>
            <form onSubmit={handleCreateRole}>
              <CardContent className="space-y-3 pt-4 text-xs">
                <div className="space-y-1">
                  <Label className="text-foreground">Название роли *</Label>
                  <Input
                    placeholder="Например: Главный бухгалтер"
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    required
                    className="bg-background border-border text-foreground text-xs rounded-xl min-h-[40px]"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-foreground">Описание роли</Label>
                  <Input
                    placeholder="Краткое описание обязанностей роли"
                    value={newRoleDesc}
                    onChange={(e) => setNewRoleDesc(e.target.value)}
                    className="bg-background border-border text-foreground text-xs rounded-xl min-h-[40px]"
                  />
                </div>
              </CardContent>

              <CardFooter className="border-t border-border pt-4 flex justify-end space-x-2">
                <Button variant="outline" type="button" onClick={() => setShowAddRoleModal(false)} className="border-border text-foreground text-xs">
                  Отмена
                </Button>
                <Button type="submit" disabled={isPending} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs">
                  Создать роль
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* МОДАЛКА: Настройка Матрицы Доступов (ACL Matrix) */}
      {editingRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <Card className="w-full max-w-3xl bg-muted border-border text-foreground shadow-2xl max-h-[90vh] flex flex-col">
            <CardHeader className="border-b border-border flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold flex items-center">
                    <Settings className="h-5 w-5 mr-2 text-emerald-400" />
                    Матрица Доступов Роли: {editingRole.name}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">Настройте гибкие разрешения отдельно для каждого модуля платформы.</CardDescription>
                </div>
                <button onClick={() => setEditingRole(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 pt-4 overflow-y-auto flex-1 text-xs">
              <div className="space-y-4">
                {Object.entries(MODULE_CONFIG).map(([modId, modConf]) => (
                  <div key={modId} className="p-4 rounded-xl bg-background/80 border border-border space-y-3">
                    <span className="font-bold text-foreground text-sm font-mono flex items-center">
                      <ShieldAlert className="h-4 w-4 mr-2 text-blue-400" />
                      {modConf.label}
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {modConf.actions.map((act) => {
                        const isChecked = !!(rolePermissions as any)[modId]?.[act.key];
                        return (
                          <label
                            key={act.key}
                            className={`flex items-center space-x-2.5 p-2.5 rounded-xl border cursor-pointer transition-all ${
                              isChecked
                                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 font-bold'
                                : 'bg-muted border-border text-muted-foreground hover:border-slate-700'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => togglePermission(modId, act.key)}
                              className="rounded border-slate-700 bg-background text-emerald-500 focus:ring-0 h-4 w-4 flex-shrink-0"
                            />
                            <span className="text-xs">{act.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>

            <CardFooter className="border-t border-border pt-4 flex justify-end space-x-2 flex-shrink-0">
              <Button variant="outline" onClick={() => setEditingRole(null)} className="border-border text-foreground text-xs">
                Отмена
              </Button>
              <Button onClick={handleSaveRoleMatrix} disabled={isPending} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                Сохранить матрицу прав
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
