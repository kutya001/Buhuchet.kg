'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, Plus } from 'lucide-react';

export function FloatingBottomNav() {
  const pathname = usePathname();

  const isActive = (path: string) => pathname === path;

  return (
    <nav className="md:hidden fixed bottom-4 left-4 right-4 h-16 rounded-[28px] bg-slate-900/90 backdrop-blur-2xl border border-slate-800/80 shadow-2xl z-40 flex items-center justify-around px-6">
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

      {/* 2. ПО ЦЕНТРУ: Выделенная круглая кнопка ДОБАВИТЬ (+) */}
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
    </nav>
  );
}
