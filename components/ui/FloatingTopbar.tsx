'use client';

import React, { useState, useEffect } from 'react';
import { Menu, Search, Clock, Moon, Sun, Coffee, MoreVertical, LogOut } from 'lucide-react';
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

export function FloatingTopbar({ onLogout, onOpenMobileMenu, onSearchChange }: FloatingTopbarProps) {
  const [mounted, setMounted] = useState(false);
  const [timeStr, setTimeStr] = useState<string>('');
  const [dateStr, setDateStr] = useState<string>('');
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
    <header className="sticky top-0 z-40 w-full border-b border-border/80 bg-background/80 backdrop-blur-md px-3 sm:px-6 py-2.5 transition-all">
      <div className="flex items-center justify-between gap-3">
        {/* Левая часть: Вызов мобильного меню (Гамбургер) + Глобальный поиск */}
        <div className="flex items-center gap-3 flex-1">
          {/* Гамбургер для открытия мобильного выездного сайдбара */}
          {onOpenMobileMenu && (
            <Button
              variant="outline"
              size="icon"
              onClick={onOpenMobileMenu}
              className="md:hidden h-9 w-9 rounded-xl border-border/60 shrink-0 bg-background/50 hover:bg-accent backdrop-blur-sm"
              title="Открыть меню"
            >
              <Menu className="w-5 h-5 text-foreground" />
            </Button>
          )}

          {/* Глобальный Поиск */}
          <div className="flex items-center flex-1 max-w-md relative">
            <Search className="w-4 h-4 absolute left-3 text-muted-foreground" />
            <Input
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Поиск по документам, ИНН, контрагентам..."
              className="pl-9 h-9 text-xs bg-muted/30 border-border/60 focus:bg-background rounded-xl w-full text-foreground"
            />
          </div>
        </div>

        {/* Правая часть (Desktop): Время, Дата + Переключатель Тёмная / Светлая / Тёплая */}
        <div className="hidden lg:flex items-center gap-4">
          {/* Виджет Времени и Даты */}
          <div className="px-2.5 py-1 text-xs font-mono text-muted-foreground flex items-center gap-2 bg-muted/40 rounded-lg border border-border/60" suppressHydrationWarning>
            <div className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-primary" />
              <span className="font-bold text-foreground">{mounted ? timeStr : '--:--:--'}</span>
            </div>
            <span>•</span>
            <span>{mounted ? dateStr : '--.--.----'}</span>
          </div>

          {/* Переключатель 3 тем оформления */}
          <div className="inline-flex items-center p-1 rounded-2xl bg-card border border-border backdrop-blur-xl shadow-sm">
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-300 ${
                theme === 'dark'
                  ? 'bg-primary text-primary-foreground shadow-md font-bold scale-105'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Moon className="h-4 w-4 text-blue-400" />
              <span className="hidden sm:inline-block text-[11px]">Тёмная</span>
            </button>

            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-300 ${
                theme === 'light'
                  ? 'bg-primary text-primary-foreground shadow-md font-bold scale-105'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Sun className="h-4 w-4 text-amber-500" />
              <span className="hidden sm:inline-block text-[11px]">Светлая</span>
            </button>

            <button
              type="button"
              onClick={() => setTheme('warm')}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-300 ${
                theme === 'warm'
                  ? 'bg-primary text-primary-foreground shadow-md font-bold scale-105'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Coffee className="h-4 w-4 text-amber-700" />
              <span className="hidden sm:inline-block text-[11px]">Тёплая</span>
            </button>
          </div>
        </div>

        {/* Правая часть (Мобилка): Меню «3 точки» */}
        <div className="flex lg:hidden items-center gap-1">
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
                <div className="flex gap-1 pt-1">
                  <Button size="sm" variant={theme === 'dark' ? 'default' : 'outline'} onClick={() => setTheme('dark')} className="flex-1 h-7 text-[10px] p-0">
                    Тёмная
                  </Button>
                  <Button size="sm" variant={theme === 'light' ? 'default' : 'outline'} onClick={() => setTheme('light')} className="flex-1 h-7 text-[10px] p-0">
                    Светлая
                  </Button>
                  <Button size="sm" variant={theme === 'warm' ? 'default' : 'outline'} onClick={() => setTheme('warm')} className="flex-1 h-7 text-[10px] p-0">
                    Тёплая
                  </Button>
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
      </div>
    </header>
  );
}
