'use client';

import { useToast } from '@buhuchet/ui';
import { useEffect, useEffectEvent } from 'react';
import { useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { useIndicatorDialog } from './kpi-indicator-dialog';
import { KpiMissingTab } from './kpi-missing';
import { KpiMonthTab } from './kpi-month';
import { KpiPeriodTab } from './kpi-period';
import { KpiSetupTab } from './kpi-setup';

/*
 * Модуль «Показатели контрагентов» (задача 2.27; ТЗ «Показатели контрагентов»; прототип modules/kpi.js):
 * вкладки «Ввод за месяц», «За период», «Не заполнено», «Настройка показателей». «+ Добавить» →
 * «Показатель» открывает окно нового показателя на любой вкладке; «Из Excel» — задача 2.28.
 */

export function KpiScreen({ tab }: { tab: string }) {
  const indicator = useIndicatorDialog();
  useKpiAddRequest(() => indicator.open(null));
  return (
    <>
      {tab === 'period' ? (
        <KpiPeriodTab />
      ) : tab === 'missing' ? (
        <KpiMissingTab />
      ) : tab === 'setup' ? (
        <KpiSetupTab onEdit={indicator.open} />
      ) : (
        <KpiMonthTab />
      )}
      {indicator.dialog}
    </>
  );
}

/** «+ Добавить» модуля: «Показатель» — окно нового показателя; «Из Excel» пока подтверждается уведомлением. */
function useKpiAddRequest(indicator: () => void) {
  const t = useT();
  const toast = useToast();
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'kpi' ? addRequest : null;
  const start = useEffectEvent((actionId: string, label: string) => {
    if (actionId === 'indicator') indicator();
    // Ввод из Excel — задача 2.28 (#84).
    else toast(t('shell.stub_add', { action: label }), { icon: 'info' });
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId, request.label);
    clearAddRequest();
  }, [request, clearAddRequest]);
}
