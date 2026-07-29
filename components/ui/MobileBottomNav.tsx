'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Plus,
  MoreHorizontal,
  FileText,
  FolderOpen,
  Globe,
  UserCheck,
  Building2,
  User,
  Shield,
  LogOut,
  X,
} from 'lucide-react';
import { signOutAction } from '@/app/(auth)/actions';

interface MobileBottomNavProps {
  isSuperAdmin?: boolean;
  userEmail?: string;
  companyName?: string;
}

export function MobileBottomNav({ isSuperAdmin, userEmail, companyName }: MobileBottomNavProps) {
  const pathname = usePathname();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const isActive = (path: string) => pathname === path;

  return (
    <>
      {/* Выезжающая снизу панель "Еще (...)" */}
      {isMoreOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end justify-center p-0">
          {/* Клик снаружи закрывает панель */}
          <div className="absolute inset-0" onClick={() => setIsMoreOpen(false)} />

          <div className="relative w-full bg-slate-900 border-t border-slate-800 rounded-t-3xl p-5 space-y-4 max-h-[85vh] overflow-y-auto z-10 animate-in slide-in-from-bottom duration-300">
            {/* Плашка индикатор свайпа */}
            <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-1" />

            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-white text-base">Все разделы платформы</h3>
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

      {/* НИЖНЯЯ ПАНЕЛЬ НАВИГАЦИИ (BOTTOM NAV BAR) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-slate-900/95 border-t border-slate-800/90 backdrop-blur-xl z-40 flex items-center justify-between px-6 shadow-2xl">
        {/* 1. СЛЕВА: Главная */}
        <Link
          href="/dashboard"
          prefetch={true}
          className={`flex flex-col items-center justify-center space-y-1 min-w-[56px] transition-colors ${
            isActive('/dashboard') ? 'text-blue-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <LayoutDashboard className="h-5 w-5" />
          <span className="text-[10px] font-medium tracking-tight">Главная</span>
        </Link>

        {/* 2. ПО ЦЕНТРУ: Круглая плавающая кнопка ДОБАВИТЬ (+) */}
        <div className="relative -top-5 flex justify-center items-center">
          <Link
            href="/dashboard/documents/new"
            prefetch={true}
            className="flex items-center justify-center h-14 w-14 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-xl shadow-blue-600/40 border-4 border-slate-950 active:scale-95 transition-transform"
          >
            <Plus className="h-7 w-7 stroke-[2.5]" />
          </Link>
        </div>

        {/* 3. СПРАВА: Мои контрагенты */}
        <Link
          href="/dashboard/counterparties"
          prefetch={true}
          className={`flex flex-col items-center justify-center space-y-1 min-w-[56px] transition-colors ${
            isActive('/dashboard/counterparties') ? 'text-amber-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="h-5 w-5" />
          <span className="text-[10px] font-medium tracking-tight">Контрагенты</span>
        </Link>

        {/* 4. ЕЩЕ (...): Открывает Bottom Sheet */}
        <button
          type="button"
          onClick={() => setIsMoreOpen(true)}
          className="flex flex-col items-center justify-center space-y-1 min-w-[56px] text-slate-400 hover:text-slate-200 transition-colors"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span className="text-[10px] font-medium tracking-tight">Еще</span>
        </button>
      </nav>
    </>
  );
}
