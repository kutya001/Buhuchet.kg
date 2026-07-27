'use client';

import React, { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Building2, FileCheck2, MapPin, Phone, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { createCompanyAction } from './actions';

export default function OnboardingPage() {
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [inn, setInn] = useState('');
  const [phone, setPhone] = useState('+996 ');

  const handleInnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Разрешаем только цифры, максимум 14
    const digits = e.target.value.replace(/\D/g, '').slice(0, 14);
    setInn(digits);
  };

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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);

    const formData = new FormData(e.currentTarget);
    formData.set('inn', inn);
    formData.set('phone', phone);

    startTransition(async () => {
      const res = await createCompanyAction(formData);
      if (res && !res.success) {
        setErrorMsg(res.error || 'Ошибка при создании организации');
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 py-12">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />

      <Card className="w-full max-w-xl bg-slate-900/60 border-slate-800 backdrop-blur-xl shadow-2xl relative z-10">
        <CardHeader className="text-center pb-6 border-b border-slate-800/60 space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/10 border border-blue-500/20 text-blue-400">
            <Building2 className="h-7 w-7" />
          </div>
          <div>
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-2">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Добро пожаловать в Buhuchet.kg</span>
            </div>
            <CardTitle className="text-2xl font-bold text-white">Создание Организации</CardTitle>
            <CardDescription className="text-slate-400 mt-1">
              Введите реквизиты вашей компании для активирования демо-доступа на 14 дней
            </CardDescription>
          </div>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4 pt-6">
            {errorMsg && (
              <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-400">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">Название компании (ОсОО / ИП)</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  id="name"
                  name="name"
                  placeholder="ОсОО «Азия Трейд»"
                  required
                  className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="inn">ИНН Организации (14 цифр)</Label>
                <span className="text-[11px] font-mono text-slate-500">{inn.length} / 14</span>
              </div>
              <div className="relative">
                <FileCheck2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  id="inn"
                  name="inn"
                  value={inn}
                  onChange={handleInnChange}
                  placeholder="20101202310050"
                  required
                  maxLength={14}
                  className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 font-mono tracking-wider placeholder:text-slate-500"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                ИНН юридического лица или ИП в Кыргызстане состоит ровно из 14 цифр
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Телефон компании (+996)</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  id="phone"
                  name="phone"
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="+996 (555) 12-34-56"
                  className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Юридический адрес (Необязательно)</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  id="address"
                  name="address"
                  placeholder="г. Бишкек, ул. Киевская 114"
                  className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-4 pb-6 flex flex-col space-y-3">
            <Button
              type="submit"
              disabled={isPending || inn.length !== 14}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-600/25 transition-all"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Создание компании...
                </>
              ) : (
                'Активировать компанию и продолжить'
              )}
            </Button>
            <p className="text-center text-xs text-slate-500">
              Вы автоматически получите статус Владельца (Owner) и 14 дней демо-доступа
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
