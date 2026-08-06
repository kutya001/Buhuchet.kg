'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { User, Phone, Mail, Shield, CheckCircle2, AlertCircle, Loader2, Save } from 'lucide-react';
import type { UserProfile, Company } from '@/types/database.types';

interface PersonalInfoFormProps {
  profile: (UserProfile & { companies?: Company | null }) | null;
  onSave: (data: { fullName: string; phone: string }) => Promise<{ success: boolean; error?: string }>;
}

export function PersonalInfoForm({ profile, onSave }: PersonalInfoFormProps) {
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '+996 ');

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Форматирование телефона КР в вид +996 (XXX) XX-XX-XX
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let input = e.target.value;
    if (!input.startsWith('+996')) {
      input = '+996 ';
    }
    const digits = input.slice(4).replace(/\D/g, '').slice(0, 9);
    let formatted = '+996';
    if (digits.length > 0) formatted += ` (${digits.slice(0, 3)}`;
    if (digits.length >= 4) formatted += `) ${digits.slice(3, 5)}`;
    if (digits.length >= 6) formatted += `-${digits.slice(5, 7)}`;
    if (digits.length >= 8) formatted += `-${digits.slice(7, 9)}`;

    setPhone(formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const res = await onSave({ fullName, phone });
    setSaving(false);

    if (res.success) {
      setMsg({ type: 'success', text: 'Личные данные успешно обновлены' });
    } else {
      setMsg({ type: 'error', text: res.error || 'Ошибка сохранения личных данных' });
    }
  };

  const getRoleLabel = () => {
    if (profile?.is_super_admin) return 'Суперадминистратор Платформы';
    if (profile?.role === 'owner') return 'Владелец / Руководитель Организации';
    if (profile?.role === 'accountant') return 'Главный Бухгалтер';
    return 'Менеджер / Сотрудник';
  };

  return (
    <Card className="bg-card/80 border-border rounded-2xl shadow-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <User className="w-5 h-5 text-blue-400" />
              <span>Личные Данные Учетной Записи</span>
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Управление персональными данными профиля пользователя
            </CardDescription>
          </div>

          <Badge variant="outline" className="text-xs px-3 py-1 font-semibold border-blue-500/40 bg-blue-500/10 text-blue-400">
            {getRoleLabel()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {msg && (
          <div className={`p-3 rounded-xl mb-4 border text-xs flex items-center gap-2 ${
            msg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {msg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{msg.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* ФИО */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs font-semibold">ФИО (Полное имя)</Label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Иванов Иван Иванович"
                  className="h-10 text-xs pl-9 bg-muted/40 rounded-xl"
                />
              </div>
            </div>

            {/* Email (Read-only) */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Электронная почта (E-mail)</Label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  disabled
                  value={profile?.email || ''}
                  className="h-10 text-xs pl-9 bg-muted/20 font-mono text-muted-foreground rounded-xl"
                />
              </div>
            </div>

            {/* Телефон */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Контактный Телефон (КР)</Label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="+996 (555) 00-00-00"
                  className="h-10 text-xs pl-9 bg-muted/40 font-mono rounded-xl"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="submit" disabled={saving} className="rounded-xl h-10 text-xs font-bold gap-2 px-6">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>Обновить личные данные</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
