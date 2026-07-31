'use client';

import React from 'react';
import Link from 'next/link';
import {
  Building2,
  Users,
  FolderOpen,
  FileText,
  Send,
  BookOpen,
  Database,
  ShieldAlert,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export type SuperAdminTab = 'companies' | 'users' | 'files' | 'documents' | 'telegram' | 'lookups' | 'database';

interface SidebarProps {
  activeTab: SuperAdminTab;
  onTabChange: (tab: SuperAdminTab) => void;
  pendingCount?: number;
}

export function SuperAdminSidebar({ activeTab, onTabChange, pendingCount = 0 }: SidebarProps) {
  const menuItems = [
    { id: 'companies' as SuperAdminTab, label: 'Организации', icon: Building2, badge: pendingCount },
    { id: 'users' as SuperAdminTab, label: 'Пользователи', icon: Users },
    { id: 'files' as SuperAdminTab, label: 'Файлы Cloudflare R2', icon: FolderOpen },
    { id: 'documents' as SuperAdminTab, label: 'Документы ЭДО', icon: FileText },
    { id: 'telegram' as SuperAdminTab, label: 'Telegram Бот', icon: Send },
    { id: 'lookups' as SuperAdminTab, label: 'Справочники', icon: BookOpen },
    { id: 'database' as SuperAdminTab, label: 'Инспектор БД', icon: Database },
  ];

  return (
    <aside className="w-64 border-r border-border bg-card/60 backdrop-blur-md flex flex-col justify-between h-full min-h-screen p-4 select-none shrink-0 sticky top-0">
      <div className="space-y-6">
        {/* Шапка Сайдбара */}
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-primary/10 text-primary rounded-xl border border-primary/20">
              <ShieldAlert className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <h2 className="font-extrabold text-base tracking-tight leading-none text-foreground">Buhuchet.kg</h2>
              <span className="text-[10px] text-muted-foreground font-mono font-semibold">Super Admin Panel</span>
            </div>
          </div>
          <Badge variant="destructive" className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 font-bold">
            PROD
          </Badge>
        </div>

        {/* Навигация Вертикально Сверху Вниз */}
        <nav className="space-y-1">
          <p className="px-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Управление Платформой
          </p>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all duration-150 text-left min-h-[42px]",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 font-bold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={cn("w-4 h-4", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                  <span>{item.label}</span>
                </div>
                {item.badge && item.badge > 0 ? (
                  <span className="bg-amber-500 text-slate-950 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full animate-pulse">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Выход в рабочий кабинет */}
      <div className="pt-4 border-t border-border">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl transition-colors min-h-[40px]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Вернуться в Кабинет</span>
        </Link>
      </div>
    </aside>
  );
}
