'use client';

import React, { useState, useEffect } from 'react';
import { Search, Building2, Clock, Calendar, ShieldCheck, Menu, MoreVertical, LogOut } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface FloatingTopbarProps {
  companyName?: string;
  companyInn?: string;
  isSuperAdmin?: boolean;
  userEmail?: string;
  userProfile?: any;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onSearchChange?: (val: string) => void;
  onLogout?: () => void;
}

export function FloatingTopbar({
  companyName = 'Buhuchet.kg Administration',
  companyInn,
  isSuperAdmin = false,
  userEmail,
  userProfile,
  isSidebarCollapsed,
  onToggleSidebar,
  onSearchChange,
  onLogout,
}: FloatingTopbarProps) {
  const [timeStr, setTimeStr] = useState<string>('');
  const [dateStr, setDateStr] = useState<string>('');

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
      setDateStr(
        now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
      );
    };

    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/80 bg-background/80 backdrop-blur-md px-4 sm:px-6 py-2.5 transition-all">
      <div className="flex items-center justify-between gap-3">
        {/* Левый блок: Кнопка сайдбара, Компания и ИНН */}
        <div className="flex items-center gap-3">
          {onToggleSidebar && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleSidebar}
              className="h-8 w-8 text-muted-foreground hover:text-foreground hidden md:flex"
              title="Свернуть/Развернуть меню"
            >
              <Menu className="w-4 h-4" />
            </Button>
          )}

          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/60 rounded-xl border border-border/60">
            <Building2 className="w-4 h-4 text-primary shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold truncate max-w-[140px] sm:max-w-[240px] text-foreground leading-none">
                {companyName}
              </span>
              {companyInn && (
                <span className="text-[10px] font-mono text-muted-foreground leading-none mt-0.5">
                  ИНН: {companyInn}
                </span>
              )}
            </div>
          </div>

          {isSuperAdmin && (
            <Badge
              variant="destructive"
              className="hidden sm:flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 uppercase"
            >
              <ShieldCheck className="w-3 h-3" />
              <span>Super Admin</span>
            </Badge>
          )}
        </div>

        {/* Центр: Поиск */}
        <div className="hidden md:flex items-center flex-1 max-w-md mx-4 relative">
          <Search className="w-4 h-4 absolute left-3 text-muted-foreground" />
          <Input
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder="Поиск по документам, ИНН, контрагентам..."
            className="pl-9 h-9 text-xs bg-muted/30 border-border/60 focus:bg-background rounded-xl text-foreground"
          />
        </div>

        {/* Правый блок (Desktop): Время, Дата и Тема */}
        <div className="hidden sm:flex items-center gap-4">
          <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground border-r border-border/60 pr-4">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-primary" />
              <span className="font-bold text-foreground">{timeStr}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              <span>{dateStr}</span>
            </div>
          </div>

          <ThemeToggle />
        </div>

        {/* МОБИЛЬНАЯ ВЕРСИЯ: Кнопка «3 точки» в правом углу (< 768px) */}
        <div className="flex sm:hidden items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl border border-border/60">
                <MoreVertical className="w-4 h-4 text-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-2 space-y-1">
              <div className="px-2 py-1.5 text-xs font-mono text-muted-foreground flex justify-between items-center bg-muted/40 rounded-lg">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-primary" />
                  <span>{timeStr}</span>
                </div>
                <span>{dateStr}</span>
              </div>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 flex justify-between items-center">
                <span className="text-xs font-medium">Тема оформления</span>
                <ThemeToggle />
              </div>
              {onLogout && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onLogout} className="text-red-500 text-xs font-bold gap-2 cursor-pointer">
                    <LogOut className="w-4 h-4" />
                    <span>Выйти из системы</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
