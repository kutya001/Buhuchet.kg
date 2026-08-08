'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileText, Plus } from 'lucide-react';
import { hasPermission } from '@/lib/auth/permissions';
import type { UserProfile } from '@/types/database.types';

interface FloatingBottomNavProps {
  userProfile?: UserProfile | null;
}

export function FloatingBottomNav({ userProfile }: FloatingBottomNavProps) {
  const pathname = usePathname();

  const isActive = (path: string) => pathname === path;
  const canCreateDoc = hasPermission(userProfile, 'documents', 'create');
  const canViewDocs = hasPermission(userProfile, 'documents', 'view');

  return (
    <nav className="md:hidden fixed bottom-3 left-3 right-3 h-16 rounded-[28px] bg-card/90 backdrop-blur-2xl border border-border/80 shadow-2xl z-40 flex items-center justify-around px-4 transition-colors duration-300 pb-[env(safe-area-inset-bottom,0px)]">
      {/* 1. СЛЕВА: Главная */}
      <Link
        href="/dashboard"
        prefetch={true}
        className={`flex flex-col items-center justify-center space-y-1 min-w-[56px] transition-colors ${
          isActive('/dashboard') ? 'text-blue-400 font-bold' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <LayoutDashboard className="h-5 w-5" />
        <span className="text-[10px] font-medium tracking-tight">Главная</span>
      </Link>

      {/* 2. ПО ЦЕНТРУ: Выделенная круглая кнопка СОЗДАТЬ ДОКУМЕНТ (+) (Только если есть право create) */}
      {canCreateDoc && (
        <div className="relative -top-5 flex justify-center items-center">
          <Link
            href="/dashboard/documents/new"
            prefetch={true}
            className="flex items-center justify-center h-14 w-14 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-xl shadow-blue-600/40 border-4 border-background active:scale-95 transition-transform"
          >
            <Plus className="h-7 w-7 stroke-[2.5]" />
          </Link>
        </div>
      )}

      {/* 3. СПРАВА: Документы (Только если есть право view) */}
      {canViewDocs && (
        <Link
          href="/dashboard/documents"
          prefetch={true}
          className={`flex flex-col items-center justify-center space-y-1 min-w-[56px] transition-colors ${
            isActive('/dashboard/documents') ? 'text-sky-400 font-bold' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <FileText className="h-5 w-5" />
          <span className="text-[10px] font-medium tracking-tight">Документы</span>
        </Link>
      )}
    </nav>
  );
}
