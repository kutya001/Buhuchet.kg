'use client';

import React, { useState, useEffect } from 'react';
import { Search, Building2, Clock, Calendar, ShieldCheck, Menu } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface FloatingTopbarProps {
  companyName?: string;
  companyInn?: string;
  isSuperAdmin?: boolean;
  userEmail?: string;
  userProfile?: any;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onSearchChange?: (val: string) => void;
}

export function FloatingTopbar({
  companyName = 'Организация КР',
  companyInn,
  isSuperAdmin = false,
  userEmail,
  userProfile,
  isSidebarCollapsed,
  onToggleSidebar,
  onSearchChange,
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
      <div className="flex items-center justify-between gap-4">
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
            <div className="flex flex-col">
              <span className="text-xs font-bold truncate max-w-[150px] sm:max-w-[240px] text-foreground leading-none">
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
              className="hidden sm:flex items-center gap-1 text-[10px] uppercase font-mono px-2 py-0.5"
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

        {/* Правый блок: Время, Дата и Тема */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-3 text-xs font-mono text-muted-foreground border-r border-border/60 pr-4">
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
      </div>
    </header>
  );
}
