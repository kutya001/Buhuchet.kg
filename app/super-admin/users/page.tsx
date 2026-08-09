'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Users, Shield, Building2, Trash2, Key, UserCheck } from 'lucide-react';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedViewModal } from '@/components/ui/unified/UnifiedViewModal';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { toast } from 'sonner';
import {
  getUsersAdminAction,
  getSuperAdminUserDetailsAction,
  deleteUserAdminAction,
  resetUserPasswordAdminAction,
} from '@/app/super-admin/actions';

export default function SuperAdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

  const [viewingUserDetails, setViewingUserDetails] = useState<any | null>(null);
  const [loadingUserDetails, setLoadingUserDetails] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    const res = await getUsersAdminAction({});
    if (res.success && res.data) {
      setUsers(res.data);
    } else {
      toast.error(res.error || 'Не удалось загрузить реестр пользователей');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleOpenUserDetails = async (userId?: string) => {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      toast.error('Ошибка: выбран некорректный пользователь');
      return;
    }
    setLoadingUserDetails(true);
    setViewingUserDetails({});
    const res = await getSuperAdminUserDetailsAction({ userId });
    if (res.success && res.data) {
      setViewingUserDetails(res.data);
    } else {
      toast.error(res.error || 'Не удалось загрузить данные пользователя');
      setViewingUserDetails(null);
    }
    setLoadingUserDetails(false);
  };

  const handleDeleteUser = (userId: string, name: string) => {
    setViewingUserDetails(null);
    startTransition(async () => {
      const res = await deleteUserAdminAction(userId);
      if (res.success) {
        toast.success(`Пользователь "${name}" удален из системы`);
        loadUsers();
      } else {
        toast.error(res.error || 'Ошибка при удалении пользователя');
      }
    });
  };

  const handleResetPassword = async (userId: string, email: string) => {
    const res = await resetUserPasswordAdminAction(userId);
    if (res.success && res.data) {
      toast.success(`Новый пароль для ${email}: ${res.data.newPassword}`);
    } else {
      toast.error(res.error || 'Не удалось сбросить пароль');
    }
  };

  const columns: ColumnDef<any>[] = [
    {
      key: 'full_name',
      label: 'ФИО пользователя',
      sortable: true,
      getValue: (u) => u.full_name || u.email,
      render: (u) => (
        <div className="font-semibold text-foreground text-xs sm:text-sm flex items-center space-x-2">
          <Users className="h-4 w-4 text-indigo-400 flex-shrink-0" />
          <div>
            <span>{u.full_name || 'Не указано'}</span>
            <p className="text-[11px] text-muted-foreground font-normal">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'company',
      label: 'Организация',
      sortable: true,
      getValue: (u) => u.companies?.name || '—',
      render: (u) => (
        <div className="flex items-center space-x-1.5 text-xs">
          <Building2 className="h-3.5 w-3.5 text-amber-400" />
          <span>{u.companies?.name || 'Без привязки'}</span>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Роль в системе',
      sortable: true,
      getValue: (u) => u.role,
      render: (u) => {
        if (u.is_super_admin) {
          return (
            <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-[11px]">
              <Shield className="h-3 w-3 mr-1" /> Суперадмин
            </Badge>
          );
        }
        if (u.role === 'owner') {
          return (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-[11px]">
              Владелец
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="border-border text-muted-foreground text-[11px]">
            Сотрудник
          </Badge>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Дата регистрации',
      sortable: true,
      getValue: (u) => u.created_at,
      render: (u) => (
        <span className="font-mono text-xs text-muted-foreground">
          {new Date(u.created_at).toLocaleDateString('ru-RU')}
        </span>
      ),
    },
  ];

  return (
    <UnifiedWorkspaceLayout
      title="Реестр пользователей платформы"
      description="Управление аккаунтами специалистов, доступами и ролевой моделью"
      icon={Users}
    >
      <UnifiedDataGrid<any>
        gridId="superadmin_users_grid"
        columns={columns}
        data={users}
        keyExtractor={(u) => u.id}
        onRowClick={(u) => handleOpenUserDetails(u.id)}
        searchPlaceholder="Поиск по ФИО, email, организации..."
        emptyMessage="Пользователи не найдены."
        isLoading={loading}
        defaultPageSize={25}
      />

      {/* МОДАЛКА ПРОСМОТРА ПОЛЬЗОВАТЕЛЯ (UnifiedViewModal) */}
      {viewingUserDetails && (
        <UnifiedViewModal
          isOpen={!!viewingUserDetails}
          onClose={() => setViewingUserDetails(null)}
          title={viewingUserDetails.full_name || viewingUserDetails.email || 'Пользователь'}
          subtitle={`Email: ${viewingUserDetails.email}`}
          isLoading={loadingUserDetails}
          badge={
            <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/40 text-[10px]">
              {viewingUserDetails.role || 'пользователь'}
            </Badge>
          }
          sections={[
            {
              title: 'Данные аккаунта',
              fields: [
                { label: 'ФИО', value: viewingUserDetails.full_name || 'Не указано', icon: Users },
                { label: 'Электронная почта', value: viewingUserDetails.email },
                { label: 'Телефон', value: viewingUserDetails.phone || 'Не указан' },
                { label: 'Организация', value: viewingUserDetails.companies?.name || '—', icon: Building2 },
              ],
            },
            {
              title: 'Доступы и безопасность',
              fields: [
                {
                  label: 'Роль в компании',
                  value: viewingUserDetails.is_super_admin
                    ? 'Суперадминистратор платформы'
                    : viewingUserDetails.role === 'owner'
                    ? 'Владелец организации'
                    : 'Сотрудник / Менеджер',
                  colSpan: 2,
                },
                {
                  label: 'Уведомления Telegram',
                  value: viewingUserDetails.telegram_chat_id ? 'Подключен' : 'Не привязан',
                },
              ],
            },
          ]}
          actions={[
            {
              label: '🔑 Сбросить пароль',
              onClick: () => handleResetPassword(viewingUserDetails.id, viewingUserDetails.email),
            },
            {
              label: '🗑️ Удалить пользователя',
              variant: 'destructive',
              onClick: () =>
                handleDeleteUser(
                  viewingUserDetails.id,
                  viewingUserDetails.full_name || viewingUserDetails.email
                ),
            },
          ]}
        />
      )}
    </UnifiedWorkspaceLayout>
  );
}
