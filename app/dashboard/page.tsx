import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { FileText, Building2, CheckCircle2, Clock } from 'lucide-react';

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('users')
    .select('*, companies(*)')
    .eq('id', user?.id || '')
    .single();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">
          Добро пожаловать, {profile?.full_name || user?.email}!
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          {profile?.companies?.name
            ? `Организация: ${profile.companies.name} (ИНН: ${profile.companies.inn})`
            : 'У вас пока нет привязанной организации'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-900/40 border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              Всего документов
            </CardTitle>
            <FileText className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">0</div>
            <p className="text-xs text-slate-500 mt-1">За текущий месяц</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/40 border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              На проверке
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">0</div>
            <p className="text-xs text-slate-500 mt-1">Ожидают решения бухгалтера</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/40 border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              Проведено в 1С
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-400">0</div>
            <p className="text-xs text-slate-500 mt-1">Успешно выгружено</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/40 border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              Статус подписки
            </CardTitle>
            <Building2 className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-400">
              {profile?.companies ? 'Trial (14 дней)' : '—'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Базовый тариф</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-900/40 border-slate-800">
        <CardHeader>
          <CardTitle>Быстрый старт</CardTitle>
          <CardDescription>
            Шаг 1 успешно выполнен: проект развернут, Supabase Auth подключен, стилизация Shadcn UI настроена.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
