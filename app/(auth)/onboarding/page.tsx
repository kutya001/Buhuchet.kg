'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Building2, ArrowRight, Loader2, AlertCircle, ShieldCheck, Mail, Phone, MapPin, User } from 'lucide-react';
import { createCompanyOnboardingAction } from './actions';
import { INDUSTRIES } from '@/types/database.types';

export default function OnboardingPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [inn, setInn] = useState('');
  const [industry, setIndustry] = useState('Услуги / Консалтинг');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [legalAddress, setLegalAddress] = useState('');
  const [directorName, setDirectorName] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
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
        setErrorMsg(res.error || 'Ошибка прохождения онбординга');
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 py-12 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/10 blur-[150px] rounded-full pointer-events-none" />

      <Card className="w-full max-w-2xl bg-slate-900/60 border-slate-800 backdrop-blur-xl shadow-2xl relative z-10">
        <CardHeader className="text-center space-y-2 pb-6 border-b border-slate-800/60">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400 mx-auto border border-blue-500/30">
            <Building2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-bold text-white tracking-tight">
            Регистрация Юридического Лица
          </CardTitle>
          <CardDescription className="text-slate-400 text-sm">
            Заполните реквизиты вашей организации для отправки заявки на модерацию
          </CardDescription>
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
              <Label htmlFor="name">Официальное Наименование Организации *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ОсОО «Азия Трейд Логистик»"
                required
                className="bg-slate-950 border-slate-800 text-slate-100 font-semibold"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="inn">ИНН КР (14 цифр) *</Label>
                <Input
                  id="inn"
                  value={inn}
                  onChange={(e) => setInn(e.target.value.replace(/\D/g, '').slice(0, 14))}
                  placeholder="20101202310050"
                  maxLength={14}
                  required
                  className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="industry">Отрасль Организации *</Label>
                <select
                  id="industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <Label htmlFor="email">Официальный E-mail *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="info@company.kg"
                  required
                  className="bg-slate-950 border-slate-800 text-slate-100"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Контактный Телефон *</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+996 (555) 12-34-56"
                  required
                  className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="director">ФИО Руководителя *</Label>
                <Input
                  id="director"
                  value={directorName}
                  onChange={(e) => setDirectorName(e.target.value)}
                  placeholder="Асанов Асан Асанович"
                  required
                  className="bg-slate-950 border-slate-800 text-slate-100"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Юридический Адрес *</Label>
                <Input
                  id="address"
                  value={legalAddress}
                  onChange={(e) => setLegalAddress(e.target.value)}
                  placeholder="г. Бишкек, ул. Киевская 110"
                  required
                  className="bg-slate-950 border-slate-800 text-slate-100"
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-4 pb-6 border-t border-slate-800/60 flex justify-end">
            <Button
              type="submit"
              disabled={isPending}
              className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-600/20 px-8"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Отправка на модерацию...
                </>
              ) : (
                <>
                  Отправить заявку на модерацию
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
