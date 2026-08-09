'use client';

import React from 'react';
import { useTheme, Theme } from './ThemeProvider';
import { Moon, Sun, Coffee } from 'lucide-react';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  const themes: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: 'dark', label: 'Тёмная', icon: <Moon className="h-4 w-4 text-blue-400" /> },
    { id: 'light', label: 'Светлая', icon: <Sun className="h-4 w-4 text-amber-500" /> },
    { id: 'warm', label: 'Тёплая', icon: <Coffee className="h-4 w-4 text-amber-700" /> },
  ];

  return (
    <div
      className={`inline-flex items-center p-1 rounded-2xl bg-card border border-border backdrop-blur-xl shadow-sm ${className}`}
      title="Сменить тему оформления (Тёмная / Светлая / Тёплая)"
    >
      {themes.map((t) => {
        const isActive = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            className={`flex items-center space-x-1 sm:space-x-1.5 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-xl text-xs font-semibold transition-all duration-300 ${
              isActive
                ? 'bg-primary text-primary-foreground shadow-md font-bold scale-105'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline-block text-[11px]">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
