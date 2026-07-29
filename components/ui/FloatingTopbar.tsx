'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Clock,
  Building2,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  FileText,
  FolderOpen,
  Globe,
  UserCheck,
  User,
  Shield,
  LogOut,
  X,
  Users,
  LayoutDashboard,
} from 'lucide-react';
import { signOutAction } from '@/app/(auth)/actions';

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
  '/dashboard/documents': 'B2B Документы',
  '/dashboard/documents/new': 'Новый Документ',
  '/dashboard/files': 'Реестр Файлов R2',
  '/dashboard/companies-catalog': 'Каталог Компаний КР',
  '/dashboard/partnerships': 'Заявки на Партнерство',
  '/dashboard/counterparties': 'Мои Контрагенты',
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
  const [timeStr, setTimeStr] = useState<string>('');
  const [dateStr, setDateStr] = useState<string>('');
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  // Живые часы и дата Кыргызской Республики
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

  const currentPageTitle = PAGE_NAMES[pathname] || 'Панель Управления';

  return (
    <>
      {/* 1. ВЕРХНИЙ ПАРЯЩИЙ МАТОВЫЙ ОСТРОВОК */}
      <header className="sticky top-3 z-30 mx-3 sm:mx-6 mb-4 h-16 rounded-2xl bg-slate-900/70 backdrop-blur-xl border border-slate-800/80 shadow-2xl flex items-center justify-between px-4 sm:px-6 transition-all duration-300">
        {/* Левая секция: Переключатель Сайдбара & Текущая Страница */}
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="hidden md:flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-300 hover:text-white hover:bg-slate-700/80 transition-all active:scale-95"
            title={isSidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>

          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <h1 className="text-sm sm:text-base font-bold text-white tracking-tight truncate">
              {currentPageTitle}
            </h1>
          </div>
        </div>

        {/* Центральная/Правая секция: Организация, Дата/Время КР */}
        <div className="flex items-center space-x-4">
          {/* Инфо о Компании */}
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-bold text-slate-200 truncate max-w-[180px] lg:max-w-[240px]">
              {companyName || 'Организация'}
            </span>
            {companyInn && (
              <span className="text-[10px] font-mono text-amber-400">
                ИНН: {companyInn}
              </span>
            )}
          </div>

          {/* Живые часы и дата */}
          <div className="hidden lg:flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs font-mono text-slate-300">
            <Clock className="h-3.5 w-3.5 text-blue-400" />
            <span>{timeStr}</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">{dateStr}</span>
          </div>

          {/* В Мобильной версии: Кнопка ТРИ ТОЧКИ (...) для вызова Шторки */}
          <button
            type="button"
            onClick={() => setIsMoreOpen(true)}
            className="md:hidden flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800/80 border border-slate-700/60 text-slate-200 hover:text-white active:scale-95 transition-all shadow-lg"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* 2. ВЫЕЗЖАЮЩАЯ ШТОРКА (BOTTOM SHEET) ДЛЯ МОБИЛЬНЫХ ПРИ НАЖАТИИ НА "..." В ВЕРХНЕМ ОСТРОВКЕ */}
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
                <span className="text-xs font-semibold text-slate-200">B2B Документы</span>
              </Link>

              <Link
                href="/dashboard/files"
                prefetch={true}
                onClick={() => setIsMoreOpen(false)}
                className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-emerald-500/50 flex flex-col items-center justify-center text-center space-y-1.5 min-h-[72px]"
              >
                <FolderOpen className="h-6 w-6 text-emerald-400" />
                <span className="text-xs font-semibold text-slate-200">Реестр Файлов R2</span>
              </Link>

              <Link
                href="/dashboard/companies-catalog"
                prefetch={true}
                onClick={() => setIsMoreOpen(false)}
                className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-indigo-500/50 flex flex-col items-center justify-center text-center space-y-1.5 min-h-[72px]"
              >
                <Globe className="h-6 w-6 text-indigo-400" />
                <span className="text-xs font-semibold text-slate-200">Каталог Компаний</span>
              </Link>

              <Link
                href="/dashboard/partnerships"
                prefetch={true}
                onClick={() => setIsMoreOpen(false)}
                className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-purple-500/50 flex flex-col items-center justify-center text-center space-y-1.5 min-h-[72px]"
              >
                <UserCheck className="h-6 w-6 text-purple-400" />
                <span className="text-xs font-semibold text-slate-200">Заявки Сети</span>
              </Link>

              <Link
                href="/dashboard/counterparties"
                prefetch={true}
                onClick={() => setIsMoreOpen(false)}
                className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-amber-500/50 flex flex-col items-center justify-center text-center space-y-1.5 min-h-[72px]"
              >
                <Users className="h-6 w-6 text-amber-400" />
                <span className="text-xs font-semibold text-slate-200">Мои Контрагенты</span>
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
