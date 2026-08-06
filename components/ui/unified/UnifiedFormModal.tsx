'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, Eye, PlusCircle, Edit3, Loader2 } from 'lucide-react';

export type FormMode = 'view' | 'create' | 'edit';

export type UnifiedFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  mode: FormMode;
  children: React.ReactNode;
  onSubmit?: (e: React.FormEvent) => void;
  isSubmitting?: boolean;
  submitText?: string;
  onSwitchMode?: (newMode: FormMode) => void;
};

export function UnifiedFormModal({
  isOpen,
  onClose,
  title,
  subtitle,
  mode,
  children,
  onSubmit,
  isSubmitting = false,
  submitText,
  onSwitchMode,
}: UnifiedFormModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <Card className="w-full sm:max-w-2xl bg-card border-t sm:border border-border rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Мобильная полоса перетягивания */}
        <div className="w-12 h-1 bg-border rounded-full mx-auto mt-2 mb-1 sm:hidden opacity-80" />

        {/* ШАПКА ФОРМЫ С РЕЖИМАМИ */}
        <CardHeader className="p-4 md:p-6 border-b border-border flex flex-row items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              {mode === 'view' && <Eye className="h-5 w-5" />}
              {mode === 'create' && <PlusCircle className="h-5 w-5" />}
              {mode === 'edit' && <Edit3 className="h-5 w-5" />}
            </div>
            <div>
              <CardTitle className="text-base md:text-lg font-bold text-foreground flex items-center space-x-2">
                <span>{title}</span>
              </CardTitle>
              {subtitle && <CardDescription className="text-xs text-muted-foreground mt-0.5">{subtitle}</CardDescription>}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {mode === 'view' && onSwitchMode && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSwitchMode('edit')}
                className="border-border text-amber-400 text-xs min-h-[36px]"
              >
                <Edit3 className="h-3.5 w-3.5 mr-1" />
                Редактировать
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>

        {/* ТЕЛО ФОРМЫ */}
        <CardContent className="p-4 md:p-6 overflow-y-auto flex-1 space-y-4">
          {onSubmit ? (
            <form onSubmit={onSubmit} className="space-y-4 flex flex-col h-full">
              <div className="flex-1 space-y-4">{children}</div>

              {mode !== 'view' && (
                <div className="sticky bottom-0 bg-card/95 backdrop-blur-md flex items-center justify-end space-x-2 pt-4 pb-2 border-t border-border mt-auto">
                  <Button type="button" variant="ghost" onClick={onClose} className="min-h-[44px]">
                    Отмена
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-amber-600 hover:bg-amber-500 text-white font-bold min-h-[44px] px-6 rounded-xl"
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : submitText || (mode === 'create' ? 'Создать' : 'Сохранить')}
                  </Button>
                </div>
              )}
            </form>
          ) : (
            <div>{children}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
