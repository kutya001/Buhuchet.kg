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
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { signOutAction } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';
import { FloatingTopbar } from '@/components/ui/FloatingTopbar';
import { FloatingBottomNav } from '@/components/ui/FloatingBottomNav';
import { MobileFAB } from '@/components/ui/MobileFAB';

import { hasPermission } from '@/lib/auth/permissions';
import type { UserProfile } from '@/types/database.types';

interface DashboardShellProps {
  userEmail: string;
  fullName?: string | null;
  companyName?: string;
  companyInn?: string;
  isSuperAdmin?: boolean;
  userProfile?: UserProfile | null;
  children: React.ReactNode;
}

export function DashboardShell({
  userEmail,
  fullName,
  companyName,
  companyInn,
  isSuperAdmin,
  userProfile,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const isActive = (path: string) => pathname === path;

  // Проверка разрешений
  const canViewDocuments = hasPermission(userProfile, 'documents', 'view');
  const canViewCounterparties = hasPermission(userProfile, 'counterparties', 'view');
  const canViewFiles = hasPermission(userProfile, 'files', 'view');
  const canViewCompany = hasPermission(userProfile, 'company', 'view');
  const canViewEmployees = hasPermission(userProfile, 'employees', 'view');

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background text-foreground relative overflow-x-hidden">
      {/* 1. DESKTOP COLLAPSIBLE SIDEBAR */}
      <aside
        className={`hidden md:flex flex-col justify-between p-4 bg-card/80 border border-border rounded-2xl sm:rounded-3xl backdrop-blur-xl transition-all duration-300 ease-in-out flex-shrink-0 sticky top-3 sm:top-4 h-[calc(100vh-1.5rem)] sm:h-[calc(100vh-2rem)] my-3 sm:my-4 ml-3 sm:ml-4 shadow-2xl overflow-y-auto ${
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
                <span className="font-bold text-lg text-foreground tracking-tight">Buhuchet.kg</span>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono">B2B Network</p>
              </div>
            )}
          </div>

          {/* Единые лаконичные пункты навигации */}
          <nav className="space-y-1">
            <Link
              href="/dashboard"
              prefetch={true}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive('/dashboard')
                  ? 'bg-blue-600/20 text-blue-500 dark:text-blue-400 border border-blue-500/30 font-bold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
              title="Главная"
            >
              <LayoutDashboard className="h-4 w-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
              {!isCollapsed && <span className="truncate">Главная</span>}
            </Link>

            {canViewDocuments && (
              <Link
                href="/dashboard/documents"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive('/dashboard/documents')
                    ? 'bg-sky-600/20 text-sky-500 dark:text-sky-400 border border-sky-500/30 font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
                title="Документы"
              >
                <FileText className="h-4 w-4 text-sky-500 dark:text-sky-400 flex-shrink-0" />
                {!isCollapsed && <span className="truncate">Документы</span>}
              </Link>
            )}

            {canViewCounterparties && (
              <Link
                href="/dashboard/counterparties"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive('/dashboard/counterparties')
                    ? 'bg-amber-600/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
                title="Организации"
              >
                <Users className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                {!isCollapsed && <span className="truncate">Организации</span>}
              </Link>
            )}

            {canViewFiles && (
              <Link
                href="/dashboard/files"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive('/dashboard/files')
                    ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
                title="Реестр Файлов"
              >
                <FolderOpen className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                {!isCollapsed && <span className="truncate">Реестр Файлов</span>}
              </Link>
            )}

            {canViewCompany && (
              <Link
                href="/dashboard/company"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive('/dashboard/company')
                    ? 'bg-muted text-foreground border border-border font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
                title="Моя Организация"
              >
                <Building2 className="h-4 w-4 text-foreground flex-shrink-0" />
                {!isCollapsed && <span className="truncate">Моя Организация</span>}
              </Link>
            )}

            {canViewEmployees && (
              <Link
                href="/dashboard/employees"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive('/dashboard/employees')
                    ? 'bg-purple-600/20 text-purple-600 dark:text-purple-400 border border-purple-500/30 font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
                title="Сотрудники и Роли"
              >
                <Users className="h-4 w-4 text-purple-400 flex-shrink-0" />
                {!isCollapsed && <span className="truncate">Сотрудники</span>}
              </Link>
            )}

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
        <div className="pt-4 border-t border-border space-y-3">
          <Link href="/dashboard/profile" prefetch={true} className="flex items-center space-x-3 px-1 hover:opacity-80 transition-opacity">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground flex-shrink-0">
              <User className="h-4 w-4" />
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {fullName || userEmail}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {companyName || 'Без организации'}
                </p>
              </div>
            )}
          </Link>

          <form action={signOutAction}>
            <Button
              type="submit"
              variant="outline"
              className={`w-full text-muted-foreground hover:text-red-400 border-border hover:border-red-900/50 hover:bg-red-500/10 min-h-[44px] ${
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
          userProfile={userProfile}
          isSidebarCollapsed={isCollapsed}
          onToggleSidebar={() => setIsCollapsed(!isCollapsed)}
        />

        {/* Главный контент с отступом сверху pt-16 */}
        <main className="flex-1 px-3 sm:px-6 pt-16 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Быстрая кнопка на смартфонах (Только в Реестре Файлов) */}
      <MobileFAB />

      {/* 3. МОБИЛЬНЫЙ НИЖНИЙ ПАРЯЩИЙ ОСТРОВОК */}
      <FloatingBottomNav userProfile={userProfile} />
    </div>
  );
}
