'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Lock, Shield, CheckCircle2, AlertCircle, Loader2, KeyRound } from 'lucide-react';

interface ChangePasswordFormProps {
  onChangePassword: (newPassword: string, confirmPassword: string) => Promise<{ success: boolean; error?: string }>;
}

export function ChangePasswordForm({ onChangePassword }: ChangePasswordFormProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    if (!newPassword || newPassword.length < 8) {
      setMsg({ type: 'error', text: 'Пароль должен содержать минимум 8 символов' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMsg({ type: 'error', text: 'Новые пароли не совпадают' });
      return;
    }

    setSaving(true);
    const res = await onChangePassword(newPassword, confirmPassword);
    setSaving(false);

    if (res.success) {
      setMsg({ type: 'success', text: 'Пароль учетной записи успешно обновлен' });
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setMsg({ type: 'error', text: res.error || 'Ошибка при обновлении пароля' });
    }
  };

  return (
    <Card className="bg-card/80 border-border rounded-2xl shadow-xl">
      <CardHeader>
        <div className="space-y-1">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-purple-400" />
            <span>Безопасность и Смена Пароля</span>
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Обновление пароля авторизации Supabase Auth
          </CardDescription>
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
            {/* Новый пароль */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Новый Пароль (мин. 8 символов)</Label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-10 text-xs pl-9 bg-muted/40 rounded-xl"
                />
              </div>
            </div>

            {/* Подтверждение */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Подтверждение Нового Пароля</Label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-10 text-xs pl-9 bg-muted/40 rounded-xl"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="submit" disabled={saving} className="rounded-xl h-10 text-xs font-bold gap-2 px-6 bg-purple-600 hover:bg-purple-500 text-white">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              <span>Обновить пароль</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
