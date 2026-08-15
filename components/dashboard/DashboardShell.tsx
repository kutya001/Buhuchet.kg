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
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { signOutAction } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';
import { FloatingTopbar } from '@/components/ui/FloatingTopbar';
import { FloatingBottomNav } from '@/components/ui/FloatingBottomNav';

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isActive = (path: string) => pathname === path;

  // Проверка разрешений
  const canViewDashboard = hasPermission(userProfile, 'dashboard', 'view');
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
          {/* Логотип приложения и Кнопка сворачивания */}
          <div className="flex items-center justify-between px-1 py-1 overflow-hidden">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex-shrink-0">
                <FileText className="h-5 w-5" />
              </div>
              {!isCollapsed && (
                <div className="transition-opacity duration-300 min-w-0">
                  <span className="font-bold text-lg text-foreground tracking-tight block truncate">Buhuchet.kg</span>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono truncate">ЭДО Платформа</p>
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="h-7 w-7 text-muted-foreground hover:text-foreground p-0 hidden md:flex shrink-0 ml-1"
              title={isCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </Button>
          </div>

          {/* Единые лаконичные пункты навигации */}
          <nav className="space-y-1">
            {canViewDashboard && (
              <Link
                href="/uchet"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive('/uchet')
                    ? 'bg-blue-600/20 text-blue-500 dark:text-blue-400 border border-blue-500/30 font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
                title="Главная"
              >
                <LayoutDashboard className="h-4 w-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
                {!isCollapsed && <span className="truncate">Главная</span>}
              </Link>
            )}

            {canViewDocuments && (
              <Link
                href="/uchet/documents"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive('/uchet/documents')
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
                href="/uchet/counterparties"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive('/uchet/counterparties')
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
                href="/uchet/files"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive('/uchet/files')
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
                href="/uchet/company"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive('/uchet/company')
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
                href="/uchet/employees"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive('/uchet/employees')
                    ? 'bg-purple-600/20 text-purple-600 dark:text-purple-400 border border-purple-500/30 font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
                title="Сотрудники и Роли"
              >
                <Users className="h-4 w-4 text-purple-400 flex-shrink-0" />
                {!isCollapsed && <span className="truncate">Сотрудники</span>}
              </Link>
            )}

            {/* Если нет активной компании: показываем ссылку на подачу заявки */}
            {!companyName && !isSuperAdmin && (
              <Link
                href="/uchet/pending"
                prefetch={true}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all mt-3 min-h-[44px] ${
                  isActive('/uchet/pending')
                    ? 'bg-sky-600/20 text-sky-400 border border-sky-500/30'
                    : 'text-sky-400 bg-sky-500/10 border border-sky-500/30 hover:bg-sky-500/20'
                }`}
                title="Заявка в компанию"
              >
                <Building2 className="h-4 w-4 flex-shrink-0" />
                {!isCollapsed && <span className="truncate">Заявка в компанию</span>}
              </Link>
            )}

            {isSuperAdmin && (
              <Link
                href="/admin"
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
          <Link href="/uchet/profile" prefetch={true} className="flex items-center space-x-3 px-1 hover:opacity-80 transition-opacity">
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
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onLogout={() => {
            signOutAction();
          }}
        />

        {/* Главный контент с гарантированным пространством pt-24 sm:pt-28 */}
        <main className="flex-1 px-3 sm:px-6 pt-24 sm:pt-28 md:pt-24 pb-28 md:pb-8 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* 3. МОБИЛЬНОЕ ВЫЕЗДНОЕ МЕНЮ СНИЗУ (BOTTOM SHEET DRAWER) - БЕЗ ВРЕМЕНИ И ТЕМ */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Полупрозрачный оверлей */}
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />

          {/* Выездная панель снизу */}
          <div className="relative w-full bg-card border-t border-border rounded-t-3xl p-5 shadow-2xl z-10 space-y-4 max-h-[85vh] overflow-y-auto">
            {/* Шапка выездного меню: Профиль организации */}
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center space-x-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-sm text-foreground truncate">{companyName || 'Buhuchet.kg'}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{userEmail}</span>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMobileMenuOpen(false)}
                className="h-8 w-8 rounded-full p-0 text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Сетка всех модулей */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {canViewDashboard && (
                <Link
                  href="/uchet"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center space-x-2.5 p-3 rounded-2xl border text-xs font-medium ${
                    isActive('/uchet') ? 'bg-blue-600/20 border-blue-500/40 text-blue-400 font-bold' : 'bg-muted/40 border-border text-foreground'
                  }`}
                >
                  <LayoutDashboard className="h-4 w-4 text-blue-500" />
                  <span>Главная</span>
                </Link>
              )}

              {canViewDocuments && (
                <Link
                  href="/uchet/documents"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center space-x-2.5 p-3 rounded-2xl border text-xs font-medium ${
                    isActive('/uchet/documents') ? 'bg-sky-600/20 border-sky-500/40 text-sky-400 font-bold' : 'bg-muted/40 border-border text-foreground'
                  }`}
                >
                  <FileText className="h-4 w-4 text-sky-500" />
                  <span>Документы</span>
                </Link>
              )}

              {canViewCounterparties && (
                <Link
                  href="/uchet/counterparties"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center space-x-2.5 p-3 rounded-2xl border text-xs font-medium ${
                    isActive('/uchet/counterparties') ? 'bg-amber-600/20 border-amber-500/40 text-amber-400 font-bold' : 'bg-muted/40 border-border text-foreground'
                  }`}
                >
                  <Users className="h-4 w-4 text-amber-500" />
                  <span>Организации</span>
                </Link>
              )}

              {canViewFiles && (
                <Link
                  href="/uchet/files"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center space-x-2.5 p-3 rounded-2xl border text-xs font-medium ${
                    isActive('/uchet/files') ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400 font-bold' : 'bg-muted/40 border-border text-foreground'
                  }`}
                >
                  <FolderOpen className="h-4 w-4 text-emerald-500" />
                  <span>Реестр Файлов</span>
                </Link>
              )}

              {canViewCompany && (
                <Link
                  href="/uchet/company"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center space-x-2.5 p-3 rounded-2xl border text-xs font-medium ${
                    isActive('/uchet/company') ? 'bg-muted border-border font-bold' : 'bg-muted/40 border-border text-foreground'
                  }`}
                >
                  <Building2 className="h-4 w-4 text-foreground" />
                  <span>Моя Организация</span>
                </Link>
              )}

              {canViewEmployees && (
                <Link
                  href="/uchet/employees"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center space-x-2.5 p-3 rounded-2xl border text-xs font-medium ${
                    isActive('/uchet/employees') ? 'bg-purple-600/20 border-purple-500/40 text-purple-400 font-bold' : 'bg-muted/40 border-border text-foreground'
                  }`}
                >
                  <Users className="h-4 w-4 text-purple-400" />
                  <span>Сотрудники</span>
                </Link>
              )}

              <Link
                href="/uchet/profile"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center space-x-2.5 p-3 rounded-2xl border text-xs font-medium col-span-2 ${
                  isActive('/uchet/profile') ? 'bg-primary/20 border-primary/40 font-bold' : 'bg-muted/40 border-border text-foreground'
                }`}
              >
                <User className="h-4 w-4 text-primary" />
                <span>Мой Профиль</span>
              </Link>

              {isSuperAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center space-x-2.5 p-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-400 text-xs font-bold col-span-2"
                >
                  <Shield className="h-4 w-4" />
                  <span>Панель Суперадминистратора</span>
                </Link>
              )}
            </div>

            {/* Кнопка Выйти из системы */}
            <form action={signOutAction} className="pt-2">
              <Button
                type="submit"
                variant="destructive"
                className="w-full h-11 rounded-2xl text-xs font-bold gap-2 shadow-lg shadow-red-500/20"
              >
                <LogOut className="h-4 w-4" />
                <span>Выйти из системы</span>
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* 5. МОБИЛЬНЫЙ НИЖНИЙ ПАРЯЩИЙ ОСТРОВОК */}
      <FloatingBottomNav userProfile={userProfile} />
    </div>
  );
}
