'use client';

import React, { useState, useEffect } from 'react';
import { Menu, Search, Clock, Moon, Sun, Coffee, MoreVertical, LogOut, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme/ThemeProvider';
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
  onLogout?: () => void;
  onOpenMobileMenu?: () => void;
  onSearchChange?: (val: string) => void;
}

export function FloatingTopbar({
  onLogout,
  onOpenMobileMenu,
  onSearchChange,
}: FloatingTopbarProps) {
  const [mounted, setMounted] = useState(false);
  const [timeStr, setTimeStr] = useState<string>('');
  const [dateStr, setDateStr] = useState<string>('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
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
    <header className="fixed top-3 left-3 right-3 sm:left-6 sm:right-6 z-40 rounded-2xl bg-card/80 backdrop-blur-2xl border border-border/80 shadow-xl px-3 sm:px-5 py-2 transition-all">
      <div className="flex items-center justify-between gap-2">
        {/* Левая часть: Гамбургер + Поиск */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Гамбургер на мобилке */}
          {onOpenMobileMenu && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenMobileMenu}
              className="md:hidden h-9 w-9 rounded-xl border border-border/60 shrink-0 bg-background/50 hover:bg-accent backdrop-blur-sm"
              title="Открыть меню"
            >
              <Menu className="w-5 h-5 text-foreground" />
            </Button>
          )}

          {/* ПОИСК ДЛЯ ПК */}
          <div className="hidden sm:flex items-center flex-1 max-w-md relative">
            <Search className="w-4 h-4 absolute left-3 text-muted-foreground" />
            <Input
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Поиск по документам, ИНН, контрагентам..."
              className="pl-9 h-9 text-xs bg-muted/40 border-border/60 focus:bg-background rounded-xl w-full text-foreground"
            />
          </div>

          {/* ВЫПАДАЮЩИЙ ПОИСК ДЛЯ МОБИЛОК (По лупе) */}
          <div className="flex sm:hidden items-center flex-1">
            {isSearchExpanded ? (
              <div className="flex items-center gap-1.5 w-full animate-in fade-in duration-200">
                <Input
                  autoFocus
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  placeholder="Поиск..."
                  className="h-9 text-xs bg-muted/60 border-border rounded-xl flex-1 text-foreground"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSearchExpanded(false)}
                  className="h-8 w-8 rounded-xl p-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSearchExpanded(true)}
                className="h-9 w-9 rounded-xl border border-border/60"
                title="Поиск"
              >
                <Search className="w-4 h-4 text-foreground" />
              </Button>
            )}
          </div>
        </div>

        {/* Правая часть (Desktop): Время, Дата + Иконки Тем + Выход */}
        {!isSearchExpanded && (
          <div className="hidden md:flex items-center gap-3">
            {/* Часы и Дата */}
            <div className="px-2.5 py-1 text-xs font-mono text-muted-foreground flex items-center gap-2 bg-muted/40 rounded-xl border border-border/60" suppressHydrationWarning>
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-primary" />
                <span className="font-bold text-foreground">{mounted ? timeStr : '--:--:--'}</span>
              </div>
              <span>•</span>
              <span>{mounted ? dateStr : '--.--.----'}</span>
            </div>

            {/* ЧИСТЫЕ ИКОНКИ ТЕМ (Без надписей Тёмная / Светлая / Тёплая) */}
            <div className="inline-flex items-center p-1 rounded-xl bg-muted/40 border border-border/60 backdrop-blur-xl">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                title="Тёмная тема"
                className={`p-1.5 rounded-lg transition-all ${
                  theme === 'dark'
                    ? 'bg-primary text-primary-foreground shadow-md scale-105'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <Moon className="h-4 w-4 text-blue-400" />
              </button>

              <button
                type="button"
                onClick={() => setTheme('light')}
                title="Светлая тема"
                className={`p-1.5 rounded-lg transition-all ${
                  theme === 'light'
                    ? 'bg-primary text-primary-foreground shadow-md scale-105'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <Sun className="h-4 w-4 text-amber-500" />
              </button>

              <button
                type="button"
                onClick={() => setTheme('warm')}
                title="Тёплая тема"
                className={`p-1.5 rounded-lg transition-all ${
                  theme === 'warm'
                    ? 'bg-primary text-primary-foreground shadow-md scale-105'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <Coffee className="h-4 w-4 text-amber-700" />
              </button>
            </div>

            {onLogout && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onLogout}
                className="h-9 w-9 rounded-xl border border-border/60 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                title="Выйти из системы"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}

        {/* Правая часть (Мобилка): Меню «3 точки» */}
        {!isSearchExpanded && (
          <div className="flex md:hidden items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl border border-border/60">
                  <MoreVertical className="w-4 h-4 text-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 p-2 space-y-1">
                <div className="px-2 py-1.5 text-xs font-mono text-muted-foreground flex justify-between items-center bg-muted/40 rounded-lg" suppressHydrationWarning>
                  <span className="font-bold text-foreground">{mounted ? timeStr : '--:--'}</span>
                  <span>{mounted ? dateStr : '--.--'}</span>
                </div>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Тема оформления</span>
                  <div className="flex gap-1 pt-1 justify-around bg-muted/40 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setTheme('dark')}
                      className={`p-1.5 rounded-lg transition-all ${theme === 'dark' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                      title="Тёмная"
                    >
                      <Moon className="w-4 h-4 text-blue-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme('light')}
                      className={`p-1.5 rounded-lg transition-all ${theme === 'light' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                      title="Светлая"
                    >
                      <Sun className="w-4 h-4 text-amber-500" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme('warm')}
                      className={`p-1.5 rounded-lg transition-all ${theme === 'warm' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                      title="Тёплая"
                    >
                      <Coffee className="w-4 h-4 text-amber-700" />
                    </button>
                  </div>
                </div>
                {onLogout && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onLogout} className="text-red-500 text-xs font-bold gap-2 cursor-pointer">
                      <LogOut className="w-4 h-4" />
                      <span>Выйти</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </header>
  );
}
