'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Lock,
  Unlock,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  ShieldAlert,
  User,
  MessageSquare,
} from 'lucide-react';
import { getCompanyClosedPeriodsAction, toggleCompanyClosedPeriodAction } from '@/app/dashboard/company/actions';
import type { ClosedPeriodItem, YearClosedPeriodsSummary } from '@/types/company.types';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';

interface ClosedPeriodsJournalProps {
  canEdit: boolean;
}

export function ClosedPeriodsJournal({ canEdit }: ClosedPeriodsJournalProps) {
  const currentYearNum = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYearNum);
  const [summary, setSummary] = useState<YearClosedPeriodsSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Состояние модального окна разблокировки (открытия) периода
  const [unlockTarget, setUnlockTarget] = useState<ClosedPeriodItem | null>(null);
  const [unlockReason, setUnlockReason] = useState<string>('');

  const loadJournal = async (year: number) => {
    setLoading(true);
    const res = await getCompanyClosedPeriodsAction(year);
    if (res.success && res.data) {
      setSummary(res.data);
    } else if (res.error) {
      setMsg({ type: 'error', text: res.error });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadJournal(selectedYear);
  }, [selectedYear]);

  const handleToggleStatus = (item: ClosedPeriodItem) => {
    if (!canEdit) return;

    if (item.status === 'closed') {
      // Для разблокировки запрашиваем обязательный комментарий
      setUnlockTarget(item);
      setUnlockReason('');
    } else {
      // Для закрытия периода блокируем сразу
      setMsg(null);
      startTransition(async () => {
        const res = await toggleCompanyClosedPeriodAction({
          year: item.year,
          month: item.month,
          targetStatus: 'closed',
        });

        if (res.success) {
          setMsg({ type: 'success', text: `Период за ${item.monthName} ${item.year} г. успешно ЗАКРЫТ.` });
          await loadJournal(selectedYear);
        } else {
          setMsg({ type: 'error', text: res.error || 'Ошибка при закрытии периода' });
        }
      });
    }
  };

  const handleConfirmUnlock = () => {
    if (!unlockTarget) return;
    if (!unlockReason || unlockReason.trim().length < 3) {
      setMsg({ type: 'error', text: 'Пожалуйста, укажите валидную причину разблокировки (минимум 3 символа)' });
      return;
    }

    setMsg(null);
    startTransition(async () => {
      const res = await toggleCompanyClosedPeriodAction({
        year: unlockTarget.year,
        month: unlockTarget.month,
        targetStatus: 'open',
        comment: unlockReason,
      });

      if (res.success) {
        setMsg({ type: 'success', text: `Период за ${unlockTarget.monthName} ${unlockTarget.year} г. РАЗБЛОКИРОВАН для редактирования.` });
        setUnlockTarget(null);
        setUnlockReason('');
        await loadJournal(selectedYear);
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при разблокировке периода' });
      }
    });
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border rounded-2xl shadow-xl">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                <Clock className="w-5 h-5 text-amber-400" />
                <span>Журнал Закрытия Отчетных Периодов</span>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                Фиксация закрытых календарных месяцев года для финансовой безопасности и защиты от коррекций прошлых периодов
              </CardDescription>
            </div>

            {/* Выбор Календарного Года */}
            <div className="flex items-center space-x-2">
              <Label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Календарный Год:</Label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="h-10 px-3 rounded-xl bg-background border border-border text-xs font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400"
              >
                {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map((y) => (
                  <option key={y} value={y}>
                    {y} год
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {msg && (
            <Alert
              variant={msg.type === 'success' ? 'success' : 'destructive'}
              className={
                msg.type === 'success'
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                  : 'border-red-500/50 bg-red-500/10 text-red-400'
              }
            >
              {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              <AlertDescription>{msg.text}</AlertDescription>
            </Alert>
          )}

          {/* Плашки статистики года */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-muted/40 border border-border flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[11px] text-muted-foreground font-medium">Всего месяцев</span>
                <p className="text-base font-bold text-foreground">{summary?.totalMonths || 12}</p>
              </div>
              <Calendar className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[11px] text-red-400 font-medium">Закрыто / Заблокировано</span>
                <p className="text-base font-bold text-red-400">{summary?.closedCount || 0}</p>
              </div>
              <Lock className="h-5 w-5 text-red-400" />
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[11px] text-emerald-400 font-medium">Открыто для первички</span>
                <p className="text-base font-bold text-emerald-400">{summary?.openCount || 12}</p>
              </div>
              <Unlock className="h-5 w-5 text-emerald-400" />
            </div>
          </div>

          {/* Реестр Журнала из 12 Месяцев */}
          {loading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка журнала закрытых периодов...</span>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-muted-foreground uppercase text-[10px] font-bold tracking-wider">
                    <th className="py-3 px-4">Месяц</th>
                    <th className="py-3 px-3">Год</th>
                    <th className="py-3 px-3">Статус Периода</th>
                    <th className="py-3 px-3">Дата Изменения</th>
                    <th className="py-3 px-3">Ответственный</th>
                    <th className="py-3 px-3">Причина / Комментарий</th>
                    <th className="py-3 px-4 text-right">Действие</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {summary?.periods.map((item) => {
                    const isClosed = item.status === 'closed';
                    const changeDate = isClosed ? item.closed_at : item.opened_at;
                    const changeUser = isClosed ? item.closed_by_user : item.opened_by_user;

                    return (
                      <tr key={item.month} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-bold text-foreground">{item.monthName}</td>
                        <td className="py-3 px-3 font-mono text-muted-foreground">{item.year}</td>
                        <td className="py-3 px-3">
                          {isClosed ? (
                            <Badge variant="outline" className="bg-red-500/10 border-red-500/30 text-red-400 font-semibold gap-1">
                              <Lock className="w-3 h-3" />
                              <span>Закрыт</span>
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold gap-1">
                              <Unlock className="w-3 h-3" />
                              <span>Открыт</span>
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-3 text-muted-foreground font-mono text-[11px]">
                          {changeDate ? new Date(changeDate).toLocaleString('ru-RU') : '—'}
                        </td>
                        <td className="py-3 px-3 text-muted-foreground text-[11px]">
                          {changeUser ? (
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3 text-muted-foreground" />
                              <span>{changeUser}</span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 px-3 text-muted-foreground text-[11px] max-w-[200px] truncate" title={item.comment || ''}>
                          {item.comment ? (
                            <span className="italic flex items-center gap-1">
                              <MessageSquare className="w-3 h-3 text-amber-400 flex-shrink-0" />
                              <span className="truncate">{item.comment}</span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            size="sm"
                            disabled={!canEdit || isPending}
                            onClick={() => handleToggleStatus(item)}
                            className={
                              isClosed
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold h-8 px-3 rounded-lg'
                                : 'bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold h-8 px-3 rounded-lg'
                            }
                          >
                            {isClosed ? (
                              <>
                                <Unlock className="w-3.5 h-3.5 mr-1" />
                                <span>Открыть период</span>
                              </>
                            ) : (
                              <>
                                <Lock className="w-3.5 h-3.5 mr-1" />
                                <span>Закрыть период</span>
                              </>
                            )}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* МОДАЛЬНОЕ ОКНО ПОДТВЕРЖДЕНИЯ РАЗБЛОКИРОВКИ (ОТКРЫТИЯ) ПЕРИОДА */}
      <UnifiedFormModal
        isOpen={!!unlockTarget}
        onClose={() => setUnlockTarget(null)}
        title={`Разблокировка (Открытие) периода ${unlockTarget?.monthName} ${unlockTarget?.year} г.`}
        subtitle="Укажите обязательную причину снятия финансовой блокировки"
        mode="edit"
        onSubmit={(e) => {
          e.preventDefault();
          handleConfirmUnlock();
        }}
        isSubmitting={isPending}
        submitText="Подтвердить и открыть период"
      >
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" />
              <span>Требование аудита учета</span>
            </p>
            <p className="text-muted-foreground text-[11px]">
              Разблокировка закрытого месяца открывает возможность создания, изменения и удаления первичных документов за {unlockTarget?.monthName} {unlockTarget?.year} года. Все действия фиксируются в аудите безопасности.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-foreground">Причина / Обоснование открытия периода *</Label>
            <Input
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              placeholder="Например: Поступили корректировочные документы от контрагента"
              className="bg-background border-border text-foreground min-h-[44px] text-xs"
              autoFocus
            />
          </div>
        </div>
      </UnifiedFormModal>
    </div>
  );
}
