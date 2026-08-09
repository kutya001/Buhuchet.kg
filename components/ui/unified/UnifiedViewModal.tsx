'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, Eye, Loader2 } from 'lucide-react';

export interface ViewField {
  label: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  colSpan?: 1 | 2 | 3;
}

export interface ViewSection {
  title?: string;
  fields: ViewField[];
}

export interface ViewAction {
  label: string;
  icon?: React.ReactNode;
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export interface UnifiedViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  sections?: ViewSection[];
  previewSlot?: React.ReactNode;
  actions?: ViewAction[];
  isLoading?: boolean;
  columns?: 1 | 2 | 3;
  children?: React.ReactNode;
}

export function UnifiedViewModal({
  isOpen,
  onClose,
  title,
  subtitle,
  badge,
  sections = [],
  previewSlot,
  actions = [],
  isLoading = false,
  columns = 2,
  children,
}: UnifiedViewModalProps) {
  if (!isOpen) return null;

  const gridColsClass =
    columns === 3
      ? 'grid-cols-1 md:grid-cols-3'
      : columns === 1
      ? 'grid-cols-1'
      : 'grid-cols-1 md:grid-cols-2';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <Card className="w-full sm:max-w-4xl bg-card border-t sm:border border-border rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Мобильная полоса перетягивания */}
        <div className="w-12 h-1 bg-border rounded-full mx-auto mt-2 mb-1 sm:hidden opacity-80" />

        {/* ШАПКА МОДАЛЬНОГО ОКНА ПРОСМОТРА */}
        <CardHeader className="p-4 md:p-6 border-b border-border flex flex-row items-center justify-between">
          <div className="flex items-center space-x-3 truncate mr-2">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex-shrink-0">
              <Eye className="h-5 w-5" />
            </div>
            <div className="truncate">
              <div className="flex items-center space-x-2 truncate">
                <CardTitle className="text-base md:text-lg font-bold text-foreground truncate">
                  {title}
                </CardTitle>
                {badge && <div className="flex-shrink-0">{badge}</div>}
              </div>
              {subtitle && (
                <CardDescription className="text-xs text-muted-foreground mt-0.5 truncate">
                  {subtitle}
                </CardDescription>
              )}
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted flex-shrink-0"
          >
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>

        {/* ТЕЛО МОДАЛЬНОГО ОКНА (С КАТАЛОГОМ ПОЛЕЙ И СЛОТОМ ПРЕВЬЮ) */}
        <CardContent className="p-4 md:p-6 overflow-y-auto flex-1 space-y-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              <span className="text-xs text-muted-foreground font-mono">
                Загрузка детальной информации...
              </span>
            </div>
          ) : (
            <>
              {/* Слот предпросмотра скана или медиа */}
              {previewSlot && <div className="rounded-xl overflow-hidden border border-border bg-background/50 p-2">{previewSlot}</div>}

              {/* Секции с полями карточки */}
              {sections.map((section, idx) => (
                <div key={idx} className="space-y-3">
                  {section.title && (
                    <h4 className="text-xs font-bold text-amber-400/90 uppercase tracking-wider font-mono border-b border-border pb-1">
                      {section.title}
                    </h4>
                  )}

                  <div className={`grid ${gridColsClass} gap-3 md:gap-4`}>
                    {section.fields.map((field, fIdx) => {
                      const colSpanClass =
                        field.colSpan === 3
                          ? 'col-span-1 md:col-span-3'
                          : field.colSpan === 2
                          ? 'col-span-1 md:col-span-2'
                          : 'col-span-1';

                      const IconComp = field.icon;

                      return (
                        <div
                          key={fIdx}
                          className={`p-3 rounded-xl bg-background/60 border border-border/80 flex flex-col justify-between space-y-1 ${colSpanClass}`}
                        >
                          <span className="text-[11px] font-medium text-muted-foreground flex items-center">
                            {IconComp && <IconComp className="h-3.5 w-3.5 mr-1.5 text-muted-foreground/80" />}
                            {field.label}
                          </span>
                          <div className="text-xs sm:text-sm font-semibold text-foreground break-words">
                            {field.value ?? '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {children}
            </>
          )}
        </CardContent>

        {/* ПОДВАЛ С ФИКСИРОВАННЫМИ ДЕЙСТВИЯМИ */}
        {actions.length > 0 && (
          <div className="sticky bottom-0 bg-card/95 backdrop-blur-md flex flex-wrap items-center justify-end gap-2 p-4 border-t border-border mt-auto">
            {actions.map((act, aIdx) => (
              <Button
                key={aIdx}
                size="sm"
                variant={act.variant || 'outline'}
                onClick={act.onClick}
                disabled={act.disabled || act.loading}
                className={act.className || 'border-border text-foreground hover:bg-muted text-xs sm:text-sm min-h-[44px] px-3.5 font-semibold rounded-xl'}
              >
                {act.loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  act.icon && <span className="mr-1.5">{act.icon}</span>
                )}
                {act.label}
              </Button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
