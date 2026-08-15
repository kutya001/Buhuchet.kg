'use client';

import React, { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Building2,
  ArrowRight,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Mail,
  Phone,
  MapPin,
  User,
  ArrowLeft,
} from 'lucide-react';
import {
  createCompanyOnboardingAction,
} from './actions';
import { INDUSTRIES } from '@/types/database.types';
import { createClient } from '@/lib/supabase/client';

export default function OnboardingPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [checkingUser, setCheckingUser] = useState(true);

  // Поля формы Владельца
  const [name, setName] = useState('');
  const [inn, setInn] = useState('');
  const [industry, setIndustry] = useState('Услуги / Консалтинг');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [legalAddress, setLegalAddress] = useState('');
  const [directorName, setDirectorName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Проверка роли пользователя: если сотрудник без компании, перенаправляем на /dashboard/pending
  useEffect(() => {
    const verifyUser = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      const { data: prof } = await supabase
        .from('users')
        .select('company_id, role, role_id')
        .eq('id', user.id)
        .single();

      if (prof?.company_id && (prof.role === 'owner' || prof.role_id)) {
        router.push('/dashboard');
        return;
      }

      if (user.user_metadata?.account_type === 'employee' || prof?.role === 'manager') {
        router.push('/dashboard/pending');
        return;
      }

      if (user.user_metadata?.full_name) {
        setDirectorName(user.user_metadata.full_name);
      }
      if (user.email) {
        setEmail(user.email);
      }

      setCheckingUser(false);
    };

    verifyUser();
  }, [router]);

  // Обработка формы Владельца
  const handleOwnerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (inn.length !== 14 || !/^\d+$/.test(inn)) {
      setErrorMsg('ИНН Кыргызстана должен состоять строго из 14 цифр');
      return;
    }

    startTransition(async () => {
      const res = await createCompanyOnboardingAction({
        name,
        inn,
        industry,
        email,
        phone,
        legal_address: legalAddress,
        director_name: directorName,
      });

      if (res.success) {
        router.push('/dashboard');
      } else {
        setErrorMsg(res.error || 'Ошибка создания организации');
      }
    });
  };

  if (checkingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка данных...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/10 blur-[150px] rounded-full pointer-events-none" />

      <Card className="w-full max-w-2xl bg-card border-border backdrop-blur-xl shadow-2xl relative z-10">
        <CardHeader className="text-center space-y-2 pb-6 border-b border-border">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400 mx-auto border border-amber-500/30">
            <Building2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-bold text-foreground tracking-tight">
            Регистрация Юридического Лица / ИП
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            Заполните официальные реквизиты вашей организации для прохождения модерации
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleOwnerSubmit}>
          <CardContent className="space-y-4 pt-6">
            {errorMsg && (
              <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-400">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="name" className="text-foreground">Официальное Наименование Организации *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ОсОО «Азия Трейд Логистик»"
                required
                className="bg-background border-border text-foreground font-semibold min-h-[44px]"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="inn" className="text-foreground">ИНН КР (14 цифр) *</Label>
                <Input
                  id="inn"
                  value={inn}
                  onChange={(e) => setInn(e.target.value.replace(/\D/g, '').slice(0, 14))}
                  placeholder="20101202310050"
                  maxLength={14}
                  required
                  className="bg-background border-border text-foreground font-mono min-h-[44px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="industry" className="text-foreground">Отрасль Организации *</Label>
                <select
                  id="industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind}>
                      {ind}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-foreground">Официальный E-mail *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="info@company.kg"
                  required
                  className="bg-background border-border text-foreground min-h-[44px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-foreground">Контактный Телефон *</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+996 (555) 12-34-56"
                  required
                  className="bg-background border-border text-foreground font-mono min-h-[44px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="director" className="text-foreground">ФИО Руководителя *</Label>
                <Input
                  id="director"
                  value={directorName}
                  onChange={(e) => setDirectorName(e.target.value)}
                  placeholder="Асанов Асан Асанович"
                  required
                  className="bg-background border-border text-foreground min-h-[44px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="address" className="text-foreground">Юридический Адрес *</Label>
                <Input
                  id="address"
                  value={legalAddress}
                  onChange={(e) => setLegalAddress(e.target.value)}
                  placeholder="г. Бишкек, ул. Киевская 110"
                  required
                  className="bg-background border-border text-foreground min-h-[44px]"
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-4 pb-6 border-t border-border flex justify-end">
            <Button
              type="submit"
              disabled={isPending}
              className="w-full md:w-auto bg-amber-600 hover:bg-amber-500 text-white font-bold shadow-lg shadow-amber-600/20 px-8 min-h-[44px]"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Отправка на модерацию...
                </>
              ) : (
                <>
                  Отправить компанию на модерацию
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
