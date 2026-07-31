'use client';

import React from 'react';
import {
  Building2,
  Users,
  HardDrive,
  FileText,
  Send,
  BookOpen,
  Database,
  ShieldAlert,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type SuperAdminTab =
  | 'companies'
  | 'users'
  | 'r2_files'
  | 'edo_documents'
  | 'telegram'
  | 'dictionaries'
  | 'db_inspector';

interface SidebarProps {
  activeTab: SuperAdminTab;
  onTabChange: (tab: SuperAdminTab) => void;
  pendingCount?: number;
  onLogout?: () => void;
}

export function SuperAdminSidebar({ activeTab, onTabChange, pendingCount = 0, onLogout }: SidebarProps) {
  const menuItems = [
    { id: 'companies' as SuperAdminTab, label: 'Организации', icon: Building2, badge: pendingCount > 0 ? pendingCount : null },
    { id: 'users' as SuperAdminTab, label: 'Пользователи', icon: Users },
    { id: 'r2_files' as SuperAdminTab, label: 'Файлы Cloudflare R2', icon: HardDrive },
    { id: 'edo_documents' as SuperAdminTab, label: 'Документы ЭДО', icon: FileText },
    { id: 'telegram' as SuperAdminTab, label: 'Telegram Бот', icon: Send },
    { id: 'dictionaries' as SuperAdminTab, label: 'Справочники', icon: BookOpen },
    { id: 'db_inspector' as SuperAdminTab, label: 'Инспектор БД', icon: Database },
  ];

  return (
    <aside className="w-64 border-r border-border bg-card/60 backdrop-blur-md flex flex-col justify-between min-h-screen p-4 select-none shrink-0 transition-all">
      <div className="space-y-6">
        {/* Шапка Сайдбара: Брендинг и Статус Суперадмина */}
        <div className="flex items-center gap-3 px-2 py-1">
          <div className="p-2.5 bg-primary/10 text-primary rounded-xl border border-primary/20 shrink-0">
            <ShieldAlert className="w-5 h-5 text-red-500" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm tracking-tight truncate text-foreground">Buhuchet.kg</span>
              <Badge variant="destructive" className="text-[9px] font-mono px-1 py-0 uppercase">
                ADMIN
              </Badge>
            </div>
            <span className="text-[11px] text-muted-foreground font-medium truncate">
              Панель Суперадминистратора
            </span>
          </div>
        </div>

        {/* Навигационное меню */}
        <nav className="space-y-1">
          <p className="px-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
            Управление платформой
          </p>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 text-left',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-primary-foreground' : 'text-muted-foreground')} />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge && (
                  <Badge variant="secondary" className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0">
                    {item.badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Нижняя часть: Кнопка «Выйти из системы» */}
      <div className="pt-4 border-t border-border/80">
        <Button
          variant="ghost"
          onClick={() => {
            if (onLogout) onLogout();
            else window.location.href = '/login';
          }}
          className="w-full flex items-center justify-start gap-3 px-3 py-2.5 text-xs font-bold text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Выйти из системы</span>
        </Button>
      </div>
    </aside>
  );
}
