'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { User, Phone, Mail, Building2, Shield, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { updateProfileAction } from './actions';
import type { UserProfile, Company } from '@/types/database.types';

export default function ProfilePage() {
  const [profile, setProfile] = useState<(UserProfile & { companies?: Company | null }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [secondaryEmail, setSecondaryEmail] = useState('');

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data } = await supabase
          .from('users')
          .select('*, companies(*)')
          .eq('id', user.id)
          .single();

        if (data) {
          setProfile(data);
          setFullName(data.full_name || '');
          setPhone(data.phone || '+996 ');
        }
      }
      setLoading(false);
    }
    loadProfile();
  }, []);

  // Форматирование телефона КР в вид +996 (XXX) XX-XX-XX
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let input = e.target.value;

    // Если удалили код +996, возвращаем префикс
    if (!input.startsWith('+996')) {
      input = '+996 ';
    }

    // Извлекаем только цифры после +996
    const digits = input.slice(4).replace(/\D/g, '').slice(0, 9);

    let formatted = '+996';
    if (digits.length > 0) {
      formatted += ` (${digits.slice(0, 3)}`;
    }
    if (digits.length >= 4) {
      formatted += `) ${digits.slice(3, 5)}`;
    }
    if (digits.length >= 6) {
      formatted += `-${digits.slice(5, 7)}`;
    }
    if (digits.length >= 8) {
      formatted += `-${digits.slice(7, 9)}`;
    }

    setPhone(formatted);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    const formData = new FormData();
    formData.append('full_name', fullName);
    formData.append('phone', phone);
    formData.append('secondary_email', secondaryEmail);

    startTransition(async () => {
      const res = await updateProfileAction(formData);
      if (res.success && res.data) {
        setSuccessMsg('Профиль успешно обновлен!');
        setProfile((prev) => (prev ? { ...prev, ...res.data } : null));
      } else {
        setErrorMsg(res.error || 'Ошибка при обновлении профиля');
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка данных профиля...</span>
      </div>
    );
  }

  const roleLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'warning' | 'success' }> = {
    owner: { label: 'Владелец (Owner)', variant: 'warning' },
    accountant: { label: 'Бухгалтер (Accountant)', variant: 'success' },
    manager: { label: 'Менеджер (Manager)', variant: 'secondary' },
  };

  const currentRole = profile?.role ? roleLabels[profile.role] : { label: 'Не указана', variant: 'secondary' as const };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Настройки профиля</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Управление личными данными, контактным номером телефона и привязанной компанией
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Информационная карточка роли и организации */}
        <Card className="md:col-span-1 bg-card border-border space-y-4 shadow-xl">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 border border-primary/20 text-primary mb-2">
              <User className="h-10 w-10" />
            </div>
            <CardTitle className="text-lg font-semibold text-foreground">{profile?.full_name}</CardTitle>
            <CardDescription className="text-xs truncate text-muted-foreground">{profile?.email}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 text-xs">
            <div className="flex items-center justify-between p-3 rounded-lg bg-background/80 border border-border">
              <span className="text-muted-foreground flex items-center">
                <Shield className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
                Роль в системе
              </span>
              <Badge variant={currentRole.variant}>{currentRole.label}</Badge>
            </div>

            <div className="p-3 rounded-lg bg-background/80 border border-border space-y-1.5">
              <div className="flex items-center text-muted-foreground">
                <Building2 className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
                Организация
              </div>
              <p className="font-semibold text-foreground truncate">
                {profile?.companies?.name || 'Компания не привязана'}
              </p>
              {profile?.companies?.inn && (
                <p className="text-[11px] text-muted-foreground">ИНН: {profile.companies.inn}</p>
              )}
            </div>

            {profile?.is_super_admin && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 font-medium text-center">
                Супер-Администратор системы
              </div>
            )}
          </CardContent>
        </Card>

        {/* Форма редактирования данных профиля */}
        <Card className="md:col-span-2 bg-card border-border shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">Личные реквизиты</CardTitle>
            <CardDescription className="text-muted-foreground">
              Укажите актуальный номер телефона КР для уведомлений и восстановления доступа
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {successMsg && (
                <Alert variant="success" className="border-emerald-500/50 bg-emerald-500/10 text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>{successMsg}</AlertDescription>
                </Alert>
              )}

              {errorMsg && (
                <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{errorMsg}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="full_name" className="text-foreground">ФИО Пользователя</Label>
                <Input
                  id="full_name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Иванов Иван Иванович"
                  required
                  className="bg-background border-border text-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-foreground">Основной Email (Логин)</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    value={profile?.email || ''}
                    disabled
                    className="pl-9 bg-muted/40 border-border text-muted-foreground cursor-not-allowed"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Основной email используется для входа и не может быть изменен напрямую
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-foreground">Номер телефона в Кыргызстане (+996)</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    value={phone}
                    onChange={handlePhoneChange}
                    placeholder="+996 (700) 12-34-56"
                    className="pl-9 bg-background border-border text-foreground font-mono"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Формат: +996 (код) номер. Например: +996 (555) 00-11-22
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="secondary_email" className="text-foreground">Дополнительный Email (Необязательно)</Label>
                <Input
                  id="secondary_email"
                  type="email"
                  value={secondaryEmail}
                  onChange={(e) => setSecondaryEmail(e.target.value)}
                  placeholder="backup@company.kg"
                  className="bg-background border-border text-foreground"
                />
              </div>
            </CardContent>

            <CardFooter className="pt-4 border-t border-border flex justify-end">
              <Button
                type="submit"
                disabled={isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-md"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  'Сохранить изменения'
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
