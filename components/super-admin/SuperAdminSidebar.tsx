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
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { signOutAction } from '@/app/(auth)/actions';

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
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function SuperAdminSidebar({
  activeTab,
  onTabChange,
  pendingCount = 0,
  onLogout,
  isOpenMobile = false,
  onCloseMobile,
  isCollapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const menuItems = [
    { id: 'companies' as SuperAdminTab, label: 'Организации', icon: Building2, badge: pendingCount > 0 ? pendingCount : null },
    { id: 'users' as SuperAdminTab, label: 'Пользователи', icon: Users },
    { id: 'r2_files' as SuperAdminTab, label: 'Файлы Cloudflare R2', icon: HardDrive },
    { id: 'edo_documents' as SuperAdminTab, label: 'Документы ЭДО', icon: FileText },
    { id: 'telegram' as SuperAdminTab, label: 'Telegram Бот', icon: Send },
    { id: 'dictionaries' as SuperAdminTab, label: 'Справочники', icon: BookOpen },
    { id: 'db_inspector' as SuperAdminTab, label: 'Инспектор БД', icon: Database },
  ];

  const handleSelect = (tab: SuperAdminTab) => {
    onTabChange(tab);
    if (onCloseMobile) onCloseMobile();
  };

  const navContent = (forceExpanded = false) => {
    const collapsed = forceExpanded ? false : isCollapsed;
    return (
      <div className="flex flex-col justify-between h-full p-4 select-none">
        <div className="space-y-6">
          {/* Шапка Сайдбара */}
          <div className="flex items-center justify-between px-2 py-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-primary/10 text-primary rounded-xl border border-primary/20 shrink-0">
                <ShieldAlert className="w-5 h-5 text-red-500" />
              </div>
              {!collapsed && (
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-sm tracking-tight truncate text-foreground">Buhuchet.kg</span>
                    <Badge variant="destructive" className="text-[9px] font-mono px-1 py-0 uppercase">
                      ADMIN
                    </Badge>
                  </div>
                  <span className="text-[11px] text-muted-foreground font-medium truncate">
                    Суперадминистратор
                  </span>
                </div>
              )}
            </div>

            {/* Кнопка сворачивания десктопного сайдбара */}
            {onToggleCollapse && !forceExpanded && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleCollapse}
                className="hidden md:flex h-7 w-7 text-muted-foreground hover:text-foreground p-0"
                title={isCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
              >
                {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </Button>
            )}

            {onCloseMobile && forceExpanded && (
              <Button variant="ghost" size="icon" className="md:hidden h-8 w-8 text-muted-foreground" onClick={onCloseMobile}>
                <X className="w-5 h-5" />
              </Button>
            )}
          </div>

          {/* Пункты меню */}
          <nav className="space-y-1">
            {!collapsed && (
              <p className="px-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                Управление платформой
              </p>
            )}
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'w-full flex items-center px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 text-left',
                    collapsed ? 'justify-center px-0' : 'justify-between',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 font-bold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                  )}
                >
                  <div className={cn('flex items-center gap-3 min-w-0', collapsed && 'justify-center')}>
                    <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-primary-foreground' : 'text-muted-foreground')} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </div>
                  {!collapsed && item.badge && (
                    <Badge variant="secondary" className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0">
                      {item.badge}
                    </Badge>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Нижняя часть: Серверный Выход из системы */}
        <div className="pt-4 border-t border-border/80">
          <form action={signOutAction}>
            <Button
              type="submit"
              variant="ghost"
              className={cn(
                'w-full flex items-center text-xs font-bold text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors min-h-[40px]',
                collapsed ? 'justify-center px-0' : 'justify-start gap-3 px-3'
              )}
              title="Выйти из системы"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {!collapsed && <span>Выйти из системы</span>}
            </Button>
          </form>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* 1. Десктопная версия (сворачиваемая w-64 <-> w-20) */}
      <aside
        className={cn(
          'hidden md:flex border-r border-border bg-card/60 backdrop-blur-md flex-col h-full min-h-screen shrink-0 transition-all duration-300',
          isCollapsed ? 'w-20' : 'w-64'
        )}
      >
        {navContent(false)}
      </aside>

      {/* 2. Мобильная выездная шторка (Off-canvas Drawer) */}
      {isOpenMobile && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity"
            onClick={onCloseMobile}
          />
          <div className="relative w-4/5 max-w-xs bg-card border-r border-border h-full shadow-2xl z-10 flex flex-col">
            {navContent(true)}
          </div>
        </div>
      )}
    </>
  );
}
