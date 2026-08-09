'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LayoutGrid } from 'lucide-react';

export interface WorkspaceTab {
  key: string;
  label: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface UnifiedWorkspaceLayoutProps {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tabs?: WorkspaceTab[];
  activeTab?: string;
  onTabChange?: (tabKey: any) => void;
  filtersSlot?: React.ReactNode;
  actionButtonsSlot?: React.ReactNode;
  statsSlot?: React.ReactNode;
  children: React.ReactNode;
}

export function UnifiedWorkspaceLayout({
  title,
  description,
  badge,
  icon: IconComp = LayoutGrid,
  tabs = [],
  activeTab,
  onTabChange,
  filtersSlot,
  actionButtonsSlot,
  statsSlot,
  children,
}: UnifiedWorkspaceLayoutProps) {
  return (
    <div className="w-full space-y-4 md:space-y-6 pb-20 md:pb-8">
      {/* 1. ГЛАВНАЯ ШАПКА МОДУЛЯ (TITLE, BADGE, DESCRIPTIONS & ACTION BUTTONS) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card/80 backdrop-blur-md p-4 md:p-6 rounded-2xl border border-border shadow-xl">
        <div className="flex items-center space-x-3.5 min-w-0">
          <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex-shrink-0">
            <IconComp className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-2.5 flex-wrap">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground truncate">
                {title}
              </h1>
              {badge && <div className="flex-shrink-0">{badge}</div>}
            </div>
            {description && (
              <p className="text-xs md:text-sm text-muted-foreground mt-0.5 truncate">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Кнопки быстрых действий (Создать, Экспорт, Настройки) */}
        {actionButtonsSlot && (
          <div className="flex items-center gap-2 flex-wrap min-w-0 self-stretch sm:self-auto justify-end">
            {actionButtonsSlot}
          </div>
        )}
      </div>

      {/* 2. БЛОК СТАТИСТИКИ (ЕСЛИ ПЕРЕДАН СЛОТ STATS) */}
      {statsSlot && <div className="w-full">{statsSlot}</div>}

      {/* 3. ВКЛАДКИ И ФИЛЬТРЫ МОДУЛЯ */}
      {(tabs.length > 0 || filtersSlot) && (
        <div className="flex flex-col space-y-3">
          {/* Свайп-вкладки (Десктоп + Мобильные с горизонтальной прокруткой) */}
          {tabs.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none border-b border-border/60">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.key;
                const TabIcon = tab.icon;

                return (
                  <button
                    key={tab.key}
                    onClick={() => onTabChange && onTabChange(tab.key)}
                    className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all whitespace-nowrap min-h-[40px] ${
                      isActive
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-md font-bold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent'
                    }`}
                  >
                    {TabIcon && <TabIcon className="h-4 w-4 flex-shrink-0" />}
                    <span>{tab.label}</span>
                    {typeof tab.count === 'number' && (
                      <span
                        className={`ml-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono ${
                          isActive
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Слот горизонтальных фильтров (Поиск, Выбор категорий, Даты) */}
          {filtersSlot && (
            <div className="w-full bg-card/60 border border-border/80 rounded-xl p-3 md:p-4">
              {filtersSlot}
            </div>
          )}
        </div>
      )}

      {/* 4. ОСНОВНОЙ КОНТЕНТ (РЕЕСТРЫ, СЕТКИ, ФОРМЫ) */}
      <div className="w-full">{children}</div>
    </div>
  );
}
