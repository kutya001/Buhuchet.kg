import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Building2, FileCheck2, MapPin, Phone, Shield, HardDrive, Calendar } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default async function CompanyPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('users')
    .select('*, companies(*, subscriptions(*))')
    .eq('id', user.id)
    .single();

  if (!profile?.companies) {
    redirect('/onboarding');
  }

  const company = profile.companies;
  const sub = company.subscriptions;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Реквизиты Организации</h2>
          <p className="text-sm text-slate-400 mt-1">Информация о вашей компании в системе Buhuchet.kg</p>
        </div>

        <Link href="/dashboard/subscription">
          <Button className="bg-blue-600 hover:bg-blue-500 text-white">
            Управление подпиской
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 bg-slate-900/40 border-slate-800">
          <CardHeader>
            <CardTitle className="text-lg flex items-center">
              <Building2 className="h-5 w-5 mr-2 text-blue-400" />
              {company.name}
            </CardTitle>
            <CardDescription>Зарегистрированные реквизиты юридического лица / ИП</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-slate-400 text-sm flex items-center">
                <FileCheck2 className="h-4 w-4 mr-2 text-slate-500" />
                ИНН Организации (КР)
              </span>
              <span className="font-mono font-bold text-white tracking-wider">{company.inn}</span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-slate-400 text-sm flex items-center">
                <Phone className="h-4 w-4 mr-2 text-slate-500" />
                Контактный телефон
              </span>
              <span className="font-mono text-slate-200">{company.phone || '—'}</span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-slate-400 text-sm flex items-center">
                <MapPin className="h-4 w-4 mr-2 text-slate-500" />
                Юридический адрес
              </span>
              <span className="text-slate-200">{company.address || '—'}</span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-slate-400 text-sm flex items-center">
                <Shield className="h-4 w-4 mr-2 text-emerald-400" />
                Статус Активности
              </span>
              <Badge variant={company.is_active ? 'success' : 'destructive'}>
                {company.is_active ? 'Активна' : 'Заблокирована'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/40 border-slate-800 space-y-4">
          <CardHeader>
            <CardTitle className="text-lg">Параметры Аккаунта</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-mono">Тариф</span>
              <div className="font-bold text-white uppercase">{sub?.plan_type || 'basic'}</div>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-mono flex items-center">
                <HardDrive className="h-3.5 w-3.5 mr-1 text-purple-400" />
                Облачный диск R2
              </span>
              <div className="font-bold text-white">{company.storage_limit_gb} ГБ</div>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-mono flex items-center">
                <Calendar className="h-3.5 w-3.5 mr-1 text-blue-400" />
                Срок подписки до
              </span>
              <div className="font-mono text-slate-200">
                {sub?.expires_at ? new Date(sub.expires_at).toLocaleDateString('ru-RU') : '—'}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
