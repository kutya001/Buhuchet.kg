'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Clock,
  Building2,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  FileText,
  FolderOpen,
  User,
  Shield,
  LogOut,
  X,
  Users,
  LayoutDashboard,
  Search,
} from 'lucide-react';
import { signOutAction } from '@/app/(auth)/actions';
import { Input } from '@/components/ui/input';

interface FloatingTopbarProps {
  companyName?: string;
  companyInn?: string;
  isSuperAdmin?: boolean;
  userEmail?: string;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

const PAGE_NAMES: Record<string, string> = {
  '/dashboard': 'Главная Панель',
  '/dashboard/documents': 'Документы',
  '/dashboard/documents/new': 'Новый Документ',
  '/dashboard/files': 'Реестр Файлов',
  '/dashboard/counterparties': 'Контрагенты',
  '/dashboard/company': 'Моя Организация',
  '/dashboard/profile': 'Профиль Пользователя',
  '/super-admin': 'Панель Суперадмина',
};

export function FloatingTopbar({
  companyName,
  companyInn,
  isSuperAdmin,
  userEmail,
  isSidebarCollapsed,
  onToggleSidebar,
}: FloatingTopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [timeStr, setTimeStr] = useState<string>('');
  const [dateStr, setDateStr] = useState<string>('');
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  // Универсальный выпадающий поиск
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');

  // Часы и дата КР
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
      setDateStr(
        now.toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Синхронизация поиска с URL
  useEffect(() => {
    setSearchValue(searchParams.get('search') || '');
  }, [searchParams]);

  const handleSearchChange = (val: string) => {
    setSearchValue(val);
    const params = new URLSearchParams(searchParams.toString());
    if (val) {
      params.set('search', val);
    } else {
      params.delete('search');
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  const currentPageTitle = PAGE_NAMES[pathname] || 'Панель Управления';

  return (
    <>
      {/* 1. НАМЕРТВО ЗАФИКСИРОВАННЫЙ ВЕРХНИЙ ПАРЯЩИЙ ОСТРОВОК (FIXED TOP-2) */}
      <header
        className={`fixed top-2 left-2 right-2 h-12 sm:h-14 rounded-2xl bg-slate-900/90 backdrop-blur-2xl border border-slate-800/80 shadow-2xl z-40 flex items-center justify-between px-3 sm:px-5 transition-all duration-300 ${
          isSidebarCollapsed ? 'md:left-[88px]' : 'md:left-[264px]'
        }`}
      >
        {/* Левая секция: Кнопка Сайдбара & Текущая Страница */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="hidden md:flex h-8 w-8 items-center justify-center rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-300 hover:text-white hover:bg-slate-700/80 transition-all active:scale-95"
            title={isSidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>

          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-ping flex-shrink-0" />
            <h1 className="text-xs sm:text-base font-bold text-white tracking-tight truncate max-w-[130px] sm:max-w-none">
              {currentPageTitle}
            </h1>
          </div>
        </div>

        {/* Центральная/Правая секция: УНИВЕРСАЛЬНАЯ ЛУПА, Инфо о Компании, Часы КР */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* УНИВЕРСАЛЬНАЯ КНОПКА ПОИСКА (ЛУПА) */}
          <button
            type="button"
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className={`flex h-8 sm:h-9 w-8 sm:w-9 items-center justify-center rounded-xl border transition-all active:scale-95 ${
              isSearchOpen || searchValue
                ? 'bg-blue-600/30 border-blue-500/50 text-blue-400 font-bold'
                : 'bg-slate-800/80 border-slate-700/60 text-slate-300 hover:text-white'
            }`}
            title="Универсальный поиск по системе"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Инфо о Компании */}
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-bold text-slate-200 truncate max-w-[140px] lg:max-w-[200px]">
              {companyName || 'Организация'}
            </span>
            {companyInn && (
              <span className="text-[10px] font-mono text-amber-400">
                ИНН: {companyInn}
              </span>
            )}
          </div>

          {/* Часы КР */}
          <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-slate-950/60 border border-slate-800 text-xs font-mono text-slate-300">
            <Clock className="h-3.5 w-3.5 text-blue-400" />
            <span>{timeStr}</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">{dateStr}</span>
          </div>

          {/* Мобильные 3 ТОЧКИ (...) */}
          <button
            type="button"
            onClick={() => setIsMoreOpen(true)}
            className="md:hidden flex h-8 sm:h-9 w-8 sm:w-9 items-center justify-center rounded-xl bg-slate-800/80 border border-slate-700/60 text-slate-200 hover:text-white active:scale-95 transition-all shadow-lg"
            title="Открыть все страницы"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* 2. АНИМИРОВАННО ВЫЕДВИГАЮЩАЯСЯ ВНИЗ УНИВЕРСАЛЬНАЯ ПАНЕЛЬ ПОИСКА */}
      {isSearchOpen && (
        <div
          className={`fixed top-16 left-2 right-2 z-40 p-3 rounded-2xl bg-slate-900/95 backdrop-blur-2xl border border-slate-800 shadow-2xl transition-all duration-300 animate-in slide-in-from-top ${
            isSidebarCollapsed ? 'md:left-[88px]' : 'md:left-[264px]'
          }`}
        >
          <div className="relative flex items-center">
            <Search className="absolute left-3.5 h-4 w-4 text-blue-400" />
            <Input
              autoFocus
              value={searchValue}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Универсальный поиск по документам, файлам R2 и контрагентам КР..."
              className="pl-10 pr-9 bg-slate-950/80 border-slate-800 text-slate-100 text-xs sm:text-sm h-11 rounded-xl focus:ring-blue-500"
            />
            {searchValue ? (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute right-3 p-1 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => setIsSearchOpen(false)}
                className="absolute right-3 p-1 text-slate-500 hover:text-slate-300 text-xs font-mono"
              >
                ESC
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. ВЫЕЗЖАЮЩАЯ ШТОРКА (BOTTOM SHEET) ДЛЯ МОБИЛЬНЫХ ПРИ НАЖАТИИ НА "..." */}
      {isMoreOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end justify-center p-0">
          <div className="absolute inset-0" onClick={() => setIsMoreOpen(false)} />

          <div className="relative w-full bg-slate-900/95 border-t border-slate-800 rounded-t-3xl p-5 space-y-4 max-h-[85vh] overflow-y-auto z-10 animate-in slide-in-from-bottom duration-300 shadow-2xl backdrop-blur-2xl">
            <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-1" />

            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-white text-base">Меню Навигации</h3>
                <p className="text-xs text-slate-400 font-mono truncate">{companyName || userEmail}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsMoreOpen(false)}
                className="p-2 text-slate-400 hover:text-white rounded-full bg-slate-800/60"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <Link
                href="/dashboard"
                prefetch={true}
                onClick={() => setIsMoreOpen(false)}
                className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-blue-500/50 flex flex-col items-center justify-center text-center space-y-1.5 min-h-[72px]"
              >
                <LayoutDashboard className="h-6 w-6 text-blue-400" />
                <span className="text-xs font-semibold text-slate-200">Главная</span>
              </Link>

              <Link
                href="/dashboard/documents"
                prefetch={true}
                onClick={() => setIsMoreOpen(false)}
                className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-sky-500/50 flex flex-col items-center justify-center text-center space-y-1.5 min-h-[72px]"
              >
                <FileText className="h-6 w-6 text-sky-400" />
                <span className="text-xs font-semibold text-slate-200">Документы</span>
              </Link>

              <Link
                href="/dashboard/counterparties"
                prefetch={true}
                onClick={() => setIsMoreOpen(false)}
                className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-amber-500/50 flex flex-col items-center justify-center text-center space-y-1.5 min-h-[72px]"
              >
                <Users className="h-6 w-6 text-amber-400" />
                <span className="text-xs font-semibold text-slate-200">Контрагенты</span>
              </Link>

              <Link
                href="/dashboard/files"
                prefetch={true}
                onClick={() => setIsMoreOpen(false)}
                className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-emerald-500/50 flex flex-col items-center justify-center text-center space-y-1.5 min-h-[72px]"
              >
                <FolderOpen className="h-6 w-6 text-emerald-400" />
                <span className="text-xs font-semibold text-slate-200">Реестр Файлов</span>
              </Link>

              <Link
                href="/dashboard/company"
                prefetch={true}
                onClick={() => setIsMoreOpen(false)}
                className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-blue-500/50 flex flex-col items-center justify-center text-center space-y-1.5 min-h-[72px]"
              >
                <Building2 className="h-6 w-6 text-slate-400" />
                <span className="text-xs font-semibold text-slate-200">Моя Организация</span>
              </Link>

              <Link
                href="/dashboard/profile"
                prefetch={true}
                onClick={() => setIsMoreOpen(false)}
                className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-blue-500/50 flex flex-col items-center justify-center text-center space-y-1.5 min-h-[72px]"
              >
                <User className="h-6 w-6 text-amber-400" />
                <span className="text-xs font-semibold text-slate-200">Мой Профиль</span>
              </Link>

              {isSuperAdmin && (
                <Link
                  href="/super-admin"
                  prefetch={true}
                  onClick={() => setIsMoreOpen(false)}
                  className="col-span-2 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center space-x-2 text-amber-400 font-bold text-xs min-h-[48px]"
                >
                  <Shield className="h-5 w-5" />
                  <span>Панель Суперадмина</span>
                </Link>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800">
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="w-full p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-xs flex items-center justify-center space-x-2 min-h-[48px]"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Выйти из системы</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
