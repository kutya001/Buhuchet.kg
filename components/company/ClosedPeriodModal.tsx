'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Lock,
  Unlock,
  ShieldAlert,
  FileText,
  FolderArchive,
  Save,
  Loader2,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

const MONTH_NAMES_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

interface ClosedPeriodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (params: {
    year: number;
    month: number;
    lockDocuments: boolean;
    lockFiles: boolean;
    reason?: string;
  }) => Promise<void>;
  initialData?: {
    year?: number;
    month?: number;
    lock_documents?: boolean;
    lock_files?: boolean;
    reason?: string | null;
    comment?: string | null;
  } | null;
  isSaving?: boolean;
}

export function ClosedPeriodModal({
  isOpen,
  onClose,
  onSave,
  initialData,
  isSaving = false,
}: ClosedPeriodModalProps) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [year, setYear] = useState<number>(initialData?.year || currentYear);
  const [month, setMonth] = useState<number>(initialData?.month || currentMonth);
  const [lockDocuments, setLockDocuments] = useState<boolean>(initialData?.lock_documents ?? true);
  const [lockFiles, setLockFiles] = useState<boolean>(initialData?.lock_files ?? true);
  const [reason, setReason] = useState<string>(initialData?.reason || initialData?.comment || '');

  useEffect(() => {
    if (initialData) {
      setYear(initialData.year || currentYear);
      setMonth(initialData.month || currentMonth);
      setLockDocuments(initialData.lock_documents ?? true);
      setLockFiles(initialData.lock_files ?? true);
      setReason(initialData.reason || initialData.comment || '');
    } else {
      setYear(currentYear);
      setMonth(currentMonth);
      setLockDocuments(true);
      setLockFiles(true);
      setReason('');
    }
  }, [initialData, currentYear, currentMonth, isOpen]);

  const isMasterLocked = lockDocuments && lockFiles;

  const handleToggleMaster = () => {
    const nextState = !isMasterLocked;
    setLockDocuments(nextState);
    setLockFiles(nextState);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      year,
      month,
      lockDocuments,
      lockFiles,
      reason: reason.trim() || undefined,
    });
  };

  const yearsOptions = useMemo(() => {
    const years = [];
    for (let y = currentYear - 4; y <= currentYear + 2; y++) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-150">
      <Card className="max-w-xl w-full bg-card border-border rounded-2xl p-5 sm:p-6 space-y-5 shadow-2xl">
        
        {/* Заголовок */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">
                {initialData ? 'Настройка закрытия периода' : 'Закрытие отчетного периода'}
              </h3>
              <p className="text-xs text-muted-foreground">
                Установка финансового замка на внесение изменений за отчетный месяц
              </p>
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} className="rounded-xl h-8 w-8">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Селекторы года и месяца */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Отчетный год</Label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                disabled={isSaving}
                className="w-full h-10 px-3 rounded-xl bg-muted/40 border border-border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {yearsOptions.map((y) => (
                  <option key={y} value={y} className="bg-card text-foreground">
                    {y} год
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Отчетный месяц</Label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                disabled={isSaving}
                className="w-full h-10 px-3 rounded-xl bg-muted/40 border border-border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {MONTH_NAMES_RU.map((name, idx) => (
                  <option key={idx + 1} value={idx + 1} className="bg-card text-foreground">
                    {name} ({String(idx + 1).padStart(2, '0')})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Мастер-переключатель */}
          <div className="p-3.5 rounded-xl bg-muted/30 border border-border flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {isMasterLocked ? (
                <Lock className="w-4 h-4 text-rose-400" />
              ) : (
                <Unlock className="w-4 h-4 text-emerald-400" />
              )}
              <div>
                <div className="text-xs font-bold text-foreground">
                  Закрыть весь период целиком
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Одновременная блокировка первички и реестра файлов
                </div>
              </div>
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleToggleMaster}
              className={`h-8 text-xs font-semibold rounded-lg transition-all ${
                isMasterLocked
                  ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                  : 'bg-muted/40 text-muted-foreground'
              }`}
            >
              {isMasterLocked ? 'Все заблокировано' : 'Заблокировать все'}
            </Button>
          </div>

          {/* Гранулярные блокировки по модулям */}
          <div className="space-y-2.5 pt-1">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Блокировки по разделам учета
            </Label>

            {/* 1. Модуль Документооборот */}
            <label className="p-3 rounded-xl border border-border bg-card/60 hover:bg-muted/20 transition-all flex items-start justify-between gap-3 cursor-pointer select-none">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <FileText className="w-4 h-4 text-purple-400" />
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-foreground flex items-center gap-2">
                    <span>Документооборот</span>
                    {lockDocuments ? (
                      <Badge variant="outline" className="border-rose-500/40 text-rose-400 bg-rose-500/10 text-[9px]">
                        🔒 Заблокирован
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 text-[9px]">
                        🔓 Открыт
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Блокировка создания, редактирования и удаления документов с датой документа в выбранном месяце.
                  </p>
                </div>
              </div>

              <input
                type="checkbox"
                checked={lockDocuments}
                onChange={(e) => setLockDocuments(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
              />
            </label>

            {/* 2. Модуль Реестр файлов */}
            <label className="p-3 rounded-xl border border-border bg-card/60 hover:bg-muted/20 transition-all flex items-start justify-between gap-3 cursor-pointer select-none">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <FolderArchive className="w-4 h-4 text-blue-400" />
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-foreground flex items-center gap-2">
                    <span>Реестр файлов и сканов</span>
                    {lockFiles ? (
                      <Badge variant="outline" className="border-rose-500/40 text-rose-400 bg-rose-500/10 text-[9px]">
                        🔒 Заблокирован
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 text-[9px]">
                        🔓 Открыт
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Блокировка загрузки новых сканов и удаления файлов с датой создания в выбранном месяце.
                  </p>
                </div>
              </div>

              <input
                type="checkbox"
                checked={lockFiles}
                onChange={(e) => setLockFiles(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
              />
            </label>
          </div>

          {/* Примечание / Причина */}
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs font-semibold text-foreground">
              Основание / Примечание (необязательно)
            </Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Сдача квартальной отчетности / Налоговая проверка"
              disabled={isSaving}
              className="h-10 text-xs bg-muted/40 rounded-xl"
            />
          </div>

          {/* Кнопки действий */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isSaving}
              className="h-10 text-xs rounded-xl"
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              className="h-10 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-xl px-5 shadow-lg shadow-purple-600/20"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  Сохранить период
                </>
              )}
            </Button>
          </div>
        </form>

      </Card>
    </div>
  );
}
