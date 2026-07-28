import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import {
  FileText,
  Building2,
  User,
  LogOut,
  LayoutDashboard,
  Shield,
  Users,
  FolderOpen,
  Globe,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { signOutAction } from '../(auth)/actions';
import { Button } from '@/components/ui/button';
import { MobileFAB } from '@/components/ui/MobileFAB';

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

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-950 text-slate-100 relative">
      {/* 1. DESKTOP SIDEBAR (Только на экранах md:flex >= 768px) */}
      <aside className="hidden md:flex w-64 border-r border-slate-800/80 bg-slate-900/40 p-4 flex-col justify-between backdrop-blur-xl flex-shrink-0">
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

      {/* 2. MOBILE HEADER & BOTTOM NAV BAR (Только на смартфонах md:hidden) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden pb-20 md:pb-0">
        {/* Header */}
        <header className="h-16 border-b border-slate-800/80 bg-slate-900/40 px-4 md:px-6 flex items-center justify-between backdrop-blur-xl sticky top-0 z-30">
          <div className="flex items-center space-x-3">
            <div className="flex md:hidden h-8 w-8 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <FileText className="h-4 w-4" />
            </div>
            <h1 className="text-base md:text-lg font-semibold text-white truncate">
              {company?.name || 'Buhuchet.kg'}
            </h1>
          </div>

          <div className="flex items-center space-x-3">
            <div className="hidden sm:flex items-center space-x-2 text-xs text-slate-400">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>B2B сеть</span>
            </div>
            <Link href="/dashboard/profile" className="md:hidden">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-300">
                <User className="h-4 w-4" />
              </div>
            </Link>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* 3. MOBILE FLOATING ACTION BUTTON (FAB) */}
      <MobileFAB />

      {/* 4. FIX BOTTOM NAVIGATION BAR FOR MOBILE SMARTPHONES */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-slate-900/95 border-t border-slate-800/80 backdrop-blur-xl z-40 flex items-center justify-around px-2">
        <Link
          href="/dashboard"
          className="flex flex-col items-center justify-center w-full h-full text-slate-400 hover:text-blue-400 transition-colors"
        >
          <LayoutDashboard className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-1">Главная</span>
        </Link>

        <Link
          href="/dashboard/documents"
          className="flex flex-col items-center justify-center w-full h-full text-slate-400 hover:text-sky-400 transition-colors"
        >
          <FileText className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-1">Документы</span>
        </Link>

        <Link
          href="/dashboard/files"
          className="flex flex-col items-center justify-center w-full h-full text-slate-400 hover:text-emerald-400 transition-colors"
        >
          <FolderOpen className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-1">Файлы R2</span>
        </Link>

        <Link
          href="/dashboard/companies-catalog"
          className="flex flex-col items-center justify-center w-full h-full text-slate-400 hover:text-indigo-400 transition-colors"
        >
          <Globe className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-1">Каталог</span>
        </Link>

        <Link
          href="/dashboard/partnerships"
          className="flex flex-col items-center justify-center w-full h-full text-slate-400 hover:text-purple-400 transition-colors"
        >
          <UserCheck className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-1">Заявки</span>
        </Link>
      </nav>
    </div>
  );
}
