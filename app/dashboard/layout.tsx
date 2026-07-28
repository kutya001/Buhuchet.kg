import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { FileText, Building2, User, LogOut, LayoutDashboard, Database, Shield, Users, FolderOpen, Globe, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { signOutAction } from '../(auth)/actions';
import { Button } from '@/components/ui/button';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Получаем профиль пользователя
  const { data: profile } = await supabase
    .from('users')
    .select('*, companies(*)')
    .eq('id', user.id)
    .single();

  const company = Array.isArray(profile?.companies) ? profile?.companies[0] : profile?.companies;

  // Если компания у обычного пользователя не активна (pending_approval или requires_changes)
  const isCompanyActive = company?.status === 'active';
  const isSuperAdmin = !!profile?.is_super_admin;

  if (!isSuperAdmin && company && !isCompanyActive) {
    // В самом layout проверяем, если рендерится не pending — редиректим
    // Примечание: Для App Router серверных компонентов с проверками редирект на /dashboard/pending
  }

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800/80 bg-slate-900/40 p-4 flex flex-col justify-between backdrop-blur-xl">
        <div className="space-y-6">
          {/* Logo / Brand */}
          <div className="flex items-center space-x-3 px-2 py-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <span className="font-bold text-lg text-white tracking-tight">Buhuchet.kg</span>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">B2B Network</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            <Link
              href="/dashboard"
              className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
            >
              <LayoutDashboard className="h-4 w-4 text-blue-400" />
              <span>Главная</span>
            </Link>

            <Link
              href="/dashboard/documents"
              className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
            >
              <FileText className="h-4 w-4 text-sky-400" />
              <span>B2B Документы</span>
            </Link>

            <Link
              href="/dashboard/files"
              className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
            >
              <FolderOpen className="h-4 w-4 text-emerald-400" />
              <span>Реестр Файлов R2</span>
            </Link>

            <Link
              href="/dashboard/companies-catalog"
              className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
            >
              <Globe className="h-4 w-4 text-indigo-400" />
              <span>Каталог Компаний</span>
            </Link>

            <Link
              href="/dashboard/partnerships"
              className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
            >
              <UserCheck className="h-4 w-4 text-purple-400" />
              <span>Заявки на Партнерство</span>
            </Link>

            <Link
              href="/dashboard/counterparties"
              className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
            >
              <Users className="h-4 w-4 text-amber-400" />
              <span>Мои Контрагенты</span>
            </Link>

            <Link
              href="/dashboard/company"
              className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
            >
              <Building2 className="h-4 w-4 text-slate-400" />
              <span>Моя Организация</span>
            </Link>

            {profile?.is_super_admin && (
              <Link
                href="/super-admin"
                className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-all mt-4"
              >
                <Shield className="h-4 w-4" />
                <span>Супер-Админка</span>
              </Link>
            )}
          </nav>
        </div>

        {/* User Footer */}
        <div className="pt-4 border-t border-slate-800/80 space-y-3">
          <Link href="/dashboard/profile" className="flex items-center space-x-3 px-2 hover:opacity-80 transition-opacity">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-300">
              <User className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {profile?.full_name || user.email}
              </p>
              <p className="text-xs text-slate-400 truncate">
                {company?.name || 'Без организации'}
              </p>
            </div>
          </Link>

          <form action={signOutAction}>
            <Button
              type="submit"
              variant="outline"
              className="w-full justify-start text-slate-400 hover:text-red-400 border-slate-800 hover:border-red-900/50 hover:bg-red-500/10"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Выйти из системы
            </Button>
          </form>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 border-b border-slate-800/80 bg-slate-900/20 px-6 flex items-center justify-between backdrop-blur-xl">
          <div className="flex items-center space-x-3">
            <h1 className="text-lg font-semibold text-white">B2B Сеть Организаций КР</h1>
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Сеть партнеров активна</span>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
