'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { signOutAction } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';
import { FloatingTopbar } from '@/components/ui/FloatingTopbar';
import { FloatingBottomNav } from '@/components/ui/FloatingBottomNav';
import { MobileFAB } from '@/components/ui/MobileFAB';

interface DashboardShellProps {
  userEmail: string;
  fullName?: string | null;
  companyName?: string;
  companyInn?: string;
  isSuperAdmin?: boolean;
  children: React.ReactNode;
}

export function DashboardShell({
  userEmail,
  fullName,
  companyName,
  companyInn,
  isSuperAdmin,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const isActive = (path: string) => pathname === path;

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-950 text-slate-100 relative overflow-x-hidden">
      {/* 1. DESKTOP COLLAPSIBLE SIDEBAR */}
      <aside
        className={`hidden md:flex flex-col justify-between p-4 bg-slate-900/40 border-r border-slate-800/80 backdrop-blur-xl transition-all duration-300 ease-in-out flex-shrink-0 ${
          isCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        <div className="space-y-6">
          {/* Логотип приложения */}
          <div className="flex items-center space-x-3 px-2 py-1 overflow-hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex-shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            {!isCollapsed && (
              <div className="transition-opacity duration-300">
                <span className="font-bold text-lg text-white tracking-tight">Buhuchet.kg</span>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">B2B Network</p>
              </div>
            )}
          </div>

          {/* Пункты навигации */}
          <nav className="space-y-1">
            <Link
              href="/dashboard"
              prefetch={true}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive('/dashboard')
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              title="Главная"
            >
              <LayoutDashboard className="h-4 w-4 text-blue-400 flex-shrink-0" />
              {!isCollapsed && <span className="truncate">Главная</span>}
            </Link>

            <Link
              href="/dashboard/documents"
              prefetch={true}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive('/dashboard/documents')
                  ? 'bg-sky-600/20 text-sky-400 border border-sky-500/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              title="B2B Документы"
            >
              <FileText className="h-4 w-4 text-sky-400 flex-shrink-0" />
              {!isCollapsed && <span className="truncate">B2B Документы</span>}
            </Link>

            <Link
              href="/dashboard/files"
              prefetch={true}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive('/dashboard/files')
                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              title="Реестр Файлов R2"
            >
              <FolderOpen className="h-4 w-4 text-emerald-400 flex-shrink-0" />
              {!isCollapsed && <span className="truncate">Реестр Файлов R2</span>}
            </Link>

            <Link
              href="/dashboard/companies-catalog"
              prefetch={true}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive('/dashboard/companies-catalog')
                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              title="Каталог Компаний"
            >
              <Globe className="h-4 w-4 text-indigo-400 flex-shrink-0" />
              {!isCollapsed && <span className="truncate">Каталог Компаний</span>}
            </Link>

            <Link
              href="/dashboard/partnerships"
              prefetch={true}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive('/dashboard/partnerships')
                  ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              title="Заявки на Партнерство"
            >
              <UserCheck className="h-4 w-4 text-purple-400 flex-shrink-0" />
              {!isCollapsed && <span className="truncate">Заявки Сети</span>}
            </Link>

            <Link
              href="/dashboard/counterparties"
              prefetch={true}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive('/dashboard/counterparties')
                  ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              title="Мои Контрагенты"
            >
              <Users className="h-4 w-4 text-amber-400 flex-shrink-0" />
              {!isCollapsed && <span className="truncate">Мои Контрагенты</span>}
            </Link>

            <Link
              href="/dashboard/company"
              prefetch={true}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive('/dashboard/company')
                  ? 'bg-slate-700/30 text-white border border-slate-600/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              title="Моя Организация"
            >
              <Building2 className="h-4 w-4 text-slate-400 flex-shrink-0" />
              {!isCollapsed && <span className="truncate">Моя Организация</span>}
            </Link>

            {isSuperAdmin && (
              <Link
                href="/super-admin"
                prefetch={true}
                className="flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-all mt-4 min-h-[44px]"
                title="Панель Суперадмина"
              >
                <Shield className="h-4 w-4 flex-shrink-0" />
                {!isCollapsed && <span className="truncate font-bold">Супер-Админка</span>}
              </Link>
            )}
          </nav>
        </div>

        {/* Профиль и Выход */}
        <div className="pt-4 border-t border-slate-800/80 space-y-3">
          <Link href="/dashboard/profile" prefetch={true} className="flex items-center space-x-3 px-1 hover:opacity-80 transition-opacity">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-300 flex-shrink-0">
              <User className="h-4 w-4" />
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {fullName || userEmail}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {companyName || 'Без организации'}
                </p>
              </div>
            )}
          </Link>

          <form action={signOutAction}>
            <Button
              type="submit"
              variant="outline"
              className={`w-full text-slate-400 hover:text-red-400 border-slate-800 hover:border-red-900/50 hover:bg-red-500/10 min-h-[44px] ${
                isCollapsed ? 'px-0 justify-center' : 'justify-start'
              }`}
              title="Выйти из системы"
            >
              <LogOut className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && <span className="ml-2">Выйти</span>}
            </Button>
          </form>
        </div>
      </aside>

      {/* 2. MAIN CONTENT AREA WITH ABSOLUTELY FIXED FLOATING TOPBAR */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden pb-24 md:pb-6">
        {/* Намертво зафиксированный верхний островок */}
        <FloatingTopbar
          companyName={companyName}
          companyInn={companyInn}
          isSuperAdmin={isSuperAdmin}
          userEmail={userEmail}
          isSidebarCollapsed={isCollapsed}
          onToggleSidebar={() => setIsCollapsed(!isCollapsed)}
        />

        {/* Главный контент с отступом сверху pt-16 */}
        <main className="flex-1 px-3 sm:px-6 pt-16 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Быстрая кнопка на смартфонах */}
      <MobileFAB />

      {/* 3. МОБИЛЬНЫЙ НИЖНИЙ ПАРЯЩИЙ ОСТРОВОК (3 кнопки) */}
      <FloatingBottomNav />
    </div>
  );
}
