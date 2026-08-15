'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  User,
  ShieldCheck,
  Mail,
  Phone,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  KeyRound,
  ExternalLink,
} from 'lucide-react';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import {
  getSuperAdminProfileDataAction,
  updateSuperAdminProfileAction,
  updateSuperAdminPasswordAction,
} from '@/app/admin/actions';
import { toast } from 'sonner';

export default function SuperAdminProfilePage() {
  const [profileData, setProfileData] = useState<any>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Смена пароля
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const res = await getSuperAdminProfileDataAction();
    if (res.success && res.data) {
      setProfileData(res.data);
      setFullName(res.data.user?.full_name || '');
      setPhone(res.data.user?.phone || '');
    } else {
      toast.error(res.error || 'Не удалось загрузить данные профиля');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = () => {
    if (!fullName.trim()) {
      toast.error('Укажите ФИО');
      return;
    }

    startTransition(async () => {
      const res = await updateSuperAdminProfileAction({
        full_name: fullName.trim(),
        phone: phone.trim() || undefined,
      });

      if (res.success) {
        toast.success('Профиль суперадминистратора успешно обновлен');
        loadData();
      } else {
        toast.error(res.error || 'Ошибка при сохранении профиля');
      }
    });
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      toast.error('Пароль должен содержать минимум 6 символов');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await updateSuperAdminPasswordAction({ newPassword });
      if (res.success) {
        toast.success('Пароль суперадминистратора успешно обновлен');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast.error(res.error || 'Не удалось изменить пароль');
      }
    } catch (e: any) {
      toast.error(e.message || 'Ошибка смены пароля');
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mr-3 text-primary" />
        <span>Загрузка данных профиля...</span>
      </div>
    );
  }

  const user = profileData?.user;
  const telegram = profileData?.telegramConnection;

  return (
    <UnifiedWorkspaceLayout
      title="Профиль Суперадминистратора"
      description="Управление учетными данными учетной записи, системными правами и привязкой Telegram"
      icon={User}
    >
      <div className="w-full space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Левая колонка: Карточка системного статуса */}
          <div className="space-y-6">
            <Card className="bg-card border-border shadow-xl overflow-hidden">
              <div className="h-24 bg-gradient-to-r from-red-600/30 via-purple-600/20 to-blue-600/20 border-b border-border flex items-end p-4">
                <div className="h-16 w-16 rounded-2xl bg-card border-2 border-red-500/50 shadow-xl flex items-center justify-center text-red-400 font-extrabold text-2xl">
                  {user?.full_name?.substring(0, 1).toUpperCase() || 'A'}
                </div>
              </div>
              <CardContent className="pt-4 space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-foreground">{user?.full_name || 'Суперадминистратор'}</h3>
                  <p className="text-xs text-muted-foreground font-mono">{user?.email}</p>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Badge className="bg-red-500/20 text-red-400 border-red-500/40 text-xs font-bold">
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                    Super Admin
                  </Badge>
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Активен
                  </Badge>
                </div>

                <div className="space-y-2 pt-3 border-t border-border text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Системный ID:</span>
                    <span className="font-mono text-foreground font-semibold">{user?.id?.slice(0, 8)}...</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Дата регистрации:</span>
                    <span className="font-mono text-foreground">
                      {user?.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : '—'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Блок Telegram-привязки */}
            <Card className="bg-card border-border shadow-xl">
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-2">
                  <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg border border-blue-500/20">
                    <Send className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold">Telegram-оповещения</CardTitle>
                    <CardDescription className="text-xs">Статус привязки учетной записи к боту</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {telegram ? (
                  <div className="space-y-2 bg-emerald-500/10 border border-emerald-500/30 p-3 rounded-xl">
                    <div className="flex items-center text-emerald-400 font-bold">
                      <CheckCircle2 className="h-4 w-4 mr-1.5" />
                      Бот подключен
                    </div>
                    <div className="text-muted-foreground">
                      <div>Chat ID: <span className="font-mono text-foreground font-bold">{telegram.telegram_chat_id}</span></div>
                      {telegram.telegram_username && (
                        <div>Username: <span className="font-mono text-blue-400">@{telegram.telegram_username}</span></div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl text-amber-300">
                    <div className="flex items-center font-bold">
                      <AlertCircle className="h-4 w-4 mr-1.5" />
                      Бот не привязан
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Для получения мгновенных уведомлений об активности платформы привяжите Telegram-аккаунт в модуле Telegram-бота.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Правая колонка: Форма редактирования личных данных */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="bg-card border-border shadow-xl">
              <CardHeader>
                <CardTitle className="text-base font-bold">Личные данные администратора</CardTitle>
                <CardDescription className="text-xs">
                  Информация используется в системных журналах аудита и отчетах безопасности
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="admin-name" className="text-xs font-semibold">
                    ФИО администратора
                  </Label>
                  <Input
                    id="admin-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Введите ваше полное имя"
                    className="bg-background border-border text-foreground text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="admin-email" className="text-xs font-semibold">
                    Электронная почта (Email)
                  </Label>
                  <Input
                    id="admin-email"
                    value={user?.email || ''}
                    disabled
                    className="bg-muted/50 border-border text-muted-foreground text-sm cursor-not-allowed font-mono"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Email привязан к учетной записи авторизации Supabase Auth и не может быть изменен напрямую.
                  </span>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="admin-phone" className="text-xs font-semibold">
                    Контактный телефон
                  </Label>
                  <Input
                    id="admin-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+996 (XXX) XX-XX-XX"
                    className="bg-background border-border text-foreground text-sm"
                  />
                </div>

                <div className="pt-4 flex items-center justify-end">
                  <Button
                    onClick={handleSave}
                    disabled={isPending}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs h-10 px-6 rounded-xl shadow-md min-h-[44px]"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Сохранение...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Сохранить изменения
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Карточка смены пароля */}
            <Card className="bg-card border-border shadow-xl">
              <CardHeader>
                <div className="flex items-center space-x-2">
                  <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg border border-purple-500/20">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Смена пароля суперадминистратора</CardTitle>
                    <CardDescription className="text-xs">
                      Установите новый надежный пароль для вашей учетной записи
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handlePasswordChange} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="new-password" className="text-xs font-semibold">
                        Новый пароль
                      </Label>
                      <Input
                        id="new-password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Минимум 6 символов"
                        className="bg-background border-border text-foreground text-sm"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="confirm-password" className="text-xs font-semibold">
                        Подтверждение пароля
                      </Label>
                      <Input
                        id="confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Повторите новый пароль"
                        className="bg-background border-border text-foreground text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button
                      type="submit"
                      disabled={isChangingPassword || !newPassword || !confirmPassword}
                      variant="outline"
                      className="border-purple-500/40 text-purple-300 hover:bg-purple-500/10 text-xs h-10 px-5 rounded-xl min-h-[44px]"
                    >
                      {isChangingPassword ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Обновление пароля...
                        </>
                      ) : (
                        <>
                          <KeyRound className="h-4 w-4 mr-2" />
                          Обновить пароль
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Информационный блок безопасности */}
            <Card className="bg-card border-border shadow-xl">
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-2">
                  <KeyRound className="h-4 w-4 text-purple-400" />
                  <CardTitle className="text-sm font-bold">Безопасность и Доступ</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p>
                  • Все действия администратора фиксируются в неизменяемом журнале аудита <strong className="text-foreground font-mono">admin_audit_logs</strong>.
                </p>
                <p>
                  • Суперадминистратор обладает правами обхода RLS через <strong className="text-foreground font-mono">Service Role</strong> исключительно при подтвержденной серверной сессии.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </UnifiedWorkspaceLayout>
  );
}
