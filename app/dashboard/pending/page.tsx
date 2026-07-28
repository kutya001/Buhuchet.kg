'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Clock,
  AlertOctagon,
  CheckCircle2,
  Send,
  Loader2,
  AlertCircle,
  Building2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { resubmitCompanyForModerationAction } from '@/app/(auth)/onboarding/actions';
import { INDUSTRIES, type Company } from '@/types/database.types';

export default function PendingModerationPage() {
  const router = useRouter();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Форма редактирования для отправки на повторную модерацию
  const [name, setName] = useState('');
  const [inn, setInn] = useState('');
  const [industry, setIndustry] = useState('Услуги / Консалтинг');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [legalAddress, setLegalAddress] = useState('');
  const [directorName, setDirectorName] = useState('');

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const loadCompanyData = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: prof } = await supabase
        .from('users')
        .select('company_id, companies(*)')
        .eq('id', user.id)
        .single();

      const comp = Array.isArray(prof?.companies) ? prof?.companies[0] : prof?.companies;
      if (comp) {
        setCompany(comp as Company);
        setName(comp.name);
        setInn(comp.inn);
        setIndustry(comp.industry || 'Услуги / Консалтинг');
        setEmail(comp.email || '');
        setPhone(comp.phone || '');
        setLegalAddress(comp.legal_address || comp.address || '');
        setDirectorName(comp.director_name || '');

        // Если компания уже активна — отправляем в dashboard
        if (comp.status === 'active') {
          router.push('/dashboard');
        }
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCompanyData();
  }, []);

  const handleResubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    setMsg(null);
    startTransition(async () => {
      const res = await resubmitCompanyForModerationAction(company.id, {
        name,
        inn,
        industry,
        email,
        phone,
        legal_address: legalAddress,
        director_name: directorName,
      });

      if (res.success) {
        setMsg({ type: 'success', text: 'Исправленные данные повторно отправлены на модерацию!' });
        loadCompanyData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка отправки повторной заявки' });
      }
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка статуса организации...</span>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <Card className="max-w-md bg-slate-900 border-slate-800 text-center p-6 space-y-4">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-400" />
          <h3 className="text-lg font-bold text-white">Организация не найдена</h3>
          <p className="text-xs text-slate-400">Вы пока не прошли процедуру онбординга компании</p>
          <Button onClick={() => router.push('/onboarding')} className="bg-blue-600 hover:bg-blue-500">
            Пройти онбординг
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 py-12 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/10 blur-[150px] rounded-full pointer-events-none" />

      <div className="w-full max-w-3xl space-y-6 relative z-10">
        {/* 1. СОСТОЯНИЕ: pending_approval (На модерации) */}
        {company.status === 'pending_approval' && (
          <Card className="bg-slate-900/60 border-slate-800 backdrop-blur-xl shadow-2xl text-center p-8 space-y-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 mx-auto border border-amber-500/20 animate-pulse">
              <Clock className="h-8 w-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">Заявка на Модерации</h2>
              <p className="text-sm text-slate-400 max-w-lg mx-auto">
                Организация <strong className="text-white">«{company.name}»</strong> (ИНН: <span className="font-mono text-amber-400">{company.inn}</span>) находится на проверке у Суперадмина.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 max-w-md mx-auto text-left space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Статус проверки:</span>
                <span className="text-amber-400 font-semibold">На рассмотрении</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Отрасль:</span>
                <span className="text-slate-300">{company.industry || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Руководитель:</span>
                <span className="text-slate-300">{company.director_name || '—'}</span>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Доступ к рабочим разделам (B2B Документы, Файлы, Каталог) будет открыт автоматически сразу после одобрения.
            </p>

            <div>
              <Button variant="outline" onClick={loadCompanyData} className="border-slate-800 text-slate-300">
                <RefreshCw className="h-4 w-4 mr-2" />
                Проверить статус
              </Button>
            </div>
          </Card>
        )}

        {/* 2. СОСТОЯНИЕ: requires_changes (Замечания / На доработку) */}
        {company.status === 'requires_changes' && (
          <Card className="bg-slate-900/60 border-slate-800 backdrop-blur-xl shadow-2xl">
            <CardHeader className="border-b border-slate-800/80 pb-6">
              <div className="flex items-center space-x-3 text-red-400 mb-2">
                <AlertOctagon className="h-6 w-6 flex-shrink-0" />
                <CardTitle className="text-xl font-bold text-white">Требуется доработка реквизитов</CardTitle>
              </div>
              <CardDescription className="text-slate-400 text-sm">
                Модератор вернул заявку на исправление. Пожалуйста, изучите замечания и внесите корректировки.
              </CardDescription>

              {/* Блок текста замечания Суперадмина */}
              <Alert variant="destructive" className="mt-4 border-red-500/40 bg-red-500/10 text-red-300 p-4">
                <AlertTitle className="font-bold text-sm text-red-400 flex items-center">
                  Замечания модератора:
                </AlertTitle>
                <AlertDescription className="text-xs text-red-200 mt-1 font-medium">
                  "{company.moderation_comment || 'Необходимо уточнить официальные реквизиты компании'}"
                </AlertDescription>
              </Alert>
            </CardHeader>

            <form onSubmit={handleResubmit}>
              <CardContent className="space-y-4 pt-6">
                {msg && (
                  <Alert
                    variant={msg.type === 'success' ? 'success' : 'destructive'}
                    className={
                      msg.type === 'success'
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                        : 'border-red-500/50 bg-red-500/10 text-red-400'
                    }
                  >
                    {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                    <AlertDescription>{msg.text}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="name">Официальное Наименование *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
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
                  className="bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-600/20 px-8"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Повторная отправка...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Отправить на повторную модерацию
                    </>
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}

        {/* 3. СОСТОЯНИЕ: blocked (Заблокирована) */}
        {company.status === 'blocked' && (
          <Card className="bg-slate-900/60 border-slate-800 backdrop-blur-xl shadow-2xl text-center p-8 space-y-4">
            <ShieldAlert className="mx-auto h-12 w-12 text-red-500" />
            <h2 className="text-xl font-bold text-white">Организация Заблокирована</h2>
            <p className="text-xs text-slate-400">Доступ к платформе ограничен решением администратора.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
