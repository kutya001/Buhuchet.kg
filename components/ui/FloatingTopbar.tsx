'use client';

import React, { useState, useEffect } from 'react';
import { Menu, Search, Clock, Moon, Sun, Coffee, LogOut, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme/ThemeProvider';

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
  isSidebarCollapsed,
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
      const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const date = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
      setTimeStr(time);
      setDateStr(date);
    };

    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Вычисление динамического позиционирования сдвига слева для десктопа
  const desktopLeftClass = isSidebarCollapsed === undefined
    ? 'md:left-6'
    : isSidebarCollapsed
    ? 'md:left-24'
    : 'md:left-72';

  return (
    <header className={`fixed top-2 left-3 right-3 ${desktopLeftClass} sm:right-6 z-40 rounded-2xl bg-card/90 backdrop-blur-2xl border border-border/80 shadow-xl px-3 py-1.5 transition-all duration-300`}>
      <div className="flex items-center justify-between gap-2">
        {/* Левая часть: Гамбургер + Лупа/Поиск */}
        <div className="flex items-center gap-2 min-w-0">
          {/* Гамбургер для открытия меню */}
          {onOpenMobileMenu && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenMobileMenu}
              className="h-9 w-9 rounded-xl border border-border/60 shrink-0 bg-background/50 hover:bg-accent backdrop-blur-sm"
              title="Открыть меню"
            >
              <Menu className="w-4 h-4 text-foreground" />
            </Button>
          )}

          {/* Кнопка Лупы для поиска */}
          {!isSearchExpanded ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSearchExpanded(true)}
              className="h-9 w-9 rounded-xl border border-border/60 shrink-0"
              title="Поиск"
            >
              <Search className="w-4 h-4 text-foreground" />
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 animate-in fade-in duration-200 min-w-[180px] max-w-[260px]">
              <Input
                autoFocus
                onChange={(e) => onSearchChange?.(e.target.value)}
                placeholder="Поиск по ИНН, документам..."
                className="h-9 text-xs bg-muted/60 border-border rounded-xl flex-1 text-foreground"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSearchExpanded(false)}
                className="h-8 w-8 rounded-xl p-0 shrink-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Правая часть: Дата/Время (01.08.2026 - 00:07) + Переключатель Темы (Иконки) */}
        {!isSearchExpanded && (
          <div className="flex items-center gap-2 shrink-0">
            {/* Виджет Даты и Времени точно как на скриншоте: DD.MM.YYYY - HH:mm */}
            <div
              className="px-2.5 py-1 text-[11px] font-mono text-muted-foreground bg-muted/40 rounded-xl border border-border/60 flex items-center justify-center shrink-0"
              suppressHydrationWarning
            >
              <span className="font-bold text-foreground">
                {mounted ? `${dateStr} - ${timeStr}` : '--.--.---- - --:--'}
              </span>
            </div>

            {/* Островок выбора темы: Moon / Sun / Coffee */}
            <div className="inline-flex items-center p-1 rounded-xl bg-card border border-border/80 backdrop-blur-xl shrink-0">
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
          </div>
        )}
      </div>
    </header>
  );
}
