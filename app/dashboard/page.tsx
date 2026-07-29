import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { FileText, Building2, CheckCircle2, Clock, FolderOpen } from 'lucide-react';
import Link from 'next/link';

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Параллельный Promise.all для получения профиля и реальной статистики
  const [profileRes, docsCountRes, filesCountRes] = await Promise.all([
    supabase
      .from('users')
      .select('*, companies(*)')
      .eq('id', user.id)
      .single(),
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('document_files')
      .select('id', { count: 'exact', head: true }),
  ]);

  const profile = profileRes.data;
  const company = Array.isArray(profile?.companies) ? profile?.companies[0] : profile?.companies;
  const docsCount = docsCountRes.count || 0;
  const filesCount = filesCountRes.count || 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          Добро пожаловать, {profile?.full_name || user?.email}!
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 mt-1">
          {company?.name
            ? `Организация: ${company.name} (ИНН: ${company.inn})`
            : 'У вас пока нет привязанной организации'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-slate-900/40 border-slate-800 hover:border-blue-500/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              B2B Документы
            </CardTitle>
            <FileText className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{docsCount}</div>
            <p className="text-xs text-slate-500 mt-1">Товарные накладные & акты</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/40 border-slate-800 hover:border-emerald-500/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              Сканы в R2
            </CardTitle>
            <FolderOpen className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-400">{filesCount}</div>
            <p className="text-xs text-slate-500 mt-1">Загружено в облако</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/40 border-slate-800 hover:border-emerald-500/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              Статус Сети
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-400">Активно</div>
            <p className="text-xs text-slate-500 mt-1">Прямой обмен первички КР</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/40 border-slate-800 hover:border-purple-500/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              Тариф
            </CardTitle>
            <Building2 className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-400">
              {company ? 'Бизнес B2B' : '—'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Безлимитный обмен</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-900/40 border-slate-800 p-6 space-y-3">
        <h3 className="font-bold text-white text-base">Быстрые действия</h3>
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/documents/new" prefetch={true}>
            <button className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs sm:text-sm transition-colors min-h-[44px]">
              + Создать B2B документ
            </button>
          </Link>

          <Link href="/dashboard/files" prefetch={true}>
            <button className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs sm:text-sm transition-colors min-h-[44px]">
              📁 Загрузить сканы в R2
            </button>
          </Link>

          <Link href="/dashboard/companies-catalog" prefetch={true}>
            <button className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs sm:text-sm transition-colors min-h-[44px]">
              🌐 Найти партнеров в КР
            </button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
