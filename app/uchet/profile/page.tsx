'use client';

import React, { useState, useEffect } from 'react';
import { User, Shield, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { updatePersonalProfileDataAction, updatePasswordAction } from './actions';
import type { UserProfile, Company } from '@/types/database.types';
import { PersonalInfoForm } from '@/components/profile/PersonalInfoForm';
import { ChangePasswordForm } from '@/components/profile/ChangePasswordForm';
import { TelegramBindingCard } from '@/components/dashboard/TelegramBindingCard';

export default function ProfilePage() {
  const [profile, setProfile] = useState<(UserProfile & { companies?: Company | null }) | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const loadProfile = async () => {
    setLoading(true);
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
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProfile();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка персонального профиля...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Шапка страницы */}
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center">
          <User className="h-6 w-6 mr-2 text-blue-400" />
          Мой Профиль & Настройки Безопасности
        </h2>
        <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
          Единая точка управления учетной записью пользователя, паролем и Telegram-уведомлениями
        </p>
      </div>

      {/* Блок 1: Личные Данные Пользователя */}
      <PersonalInfoForm
        profile={profile}
        onSave={async ({ fullName, phone }) => {
          const res = await updatePersonalProfileDataAction({ fullName, phone });
          if (res.success) {
            await loadProfile();
          }
          return res;
        }}
      />

      {/* Блок 2: Безопасность и Смена Пароля */}
      <ChangePasswordForm
        onChangePassword={async (newPassword, confirmPassword) => {
          return await updatePasswordAction(newPassword, confirmPassword);
        }}
      />

      {/* Блок 3: Интеграции (Telegram Бот) */}
      <TelegramBindingCard />
    </div>
  );
}
