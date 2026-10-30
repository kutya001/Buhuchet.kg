'use client';

import { EmptyState } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent } from 'react';
import { useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { moduleHref } from '../shell/modules';
import { indicatorsQuery } from './kpi-data';
import { useKpiImport } from './kpi-import';
import { useIndicatorDialog } from './kpi-indicator-dialog';
import { KpiMissingTab } from './kpi-missing';
import { KpiMonthTab } from './kpi-month';
import { KpiPeriodTab } from './kpi-period';
import { KpiSetupTab } from './kpi-setup';

/*
 * Модуль «Показатели контрагентов» (задача 2.27; ТЗ «Показатели контрагентов»; прототип modules/kpi.js):
 * вкладки «Ввод за месяц», «За период», «Не заполнено», «Настройка показателей». «+ Добавить» →
 * «Показатель» открывает окно нового показателя на любой вкладке, «Ввод из Excel» — окно шаблона и
 * загрузки (задача 2.28).
 */

export function KpiScreen({ tab }: { tab: string }) {
  const indicator = useIndicatorDialog();
  const excel = useKpiImport();
  useKpiAddRequest({ indicator: () => indicator.open(null), excel: () => void excel.open() });
  const noContractors = useQuery(indicatorsQuery).data?.contractors === 0;
  return (
    <>
      {noContractors && tab !== 'setup' ? (
        <NoContractors />
      ) : tab === 'period' ? (
        <KpiPeriodTab />
      ) : tab === 'missing' ? (
        <KpiMissingTab />
      ) : tab === 'setup' ? (
        <KpiSetupTab onEdit={indicator.open} />
      ) : (
        <KpiMonthTab />
      )}
      {indicator.dialog}
      {excel.dialog}
    </>
  );
}

/**
 * Первый вход: у сотрудника нет ни одного неразового контрагента — вместо таблиц подсказка и «Перейти к
 * контрагентам» (прототип ui/empty.js, `firstEmpty`); «Настройка показателей» открывается как обычно.
 */
function NoContractors() {
  const t = useT();
  const router = useRouter();
  const { access } = useShell();
  return (
    <EmptyState
      icon="gauge"
      title={t('kpi.first.title')}
      text={t('kpi.first.text')}
      actions={[
        {
          id: 'cps',
          label: t('kpi.first.go_cps'),
          icon: 'building',
          primary: true,
          onClick: () => router.push(moduleHref('cps', access)),
        },
      ]}
    />
  );
}

/** «+ Добавить» модуля: «Показатель» — окно нового показателя, «Ввод из Excel» — окно шаблона и загрузки. */
function useKpiAddRequest(actions: { indicator: () => void; excel: () => void }) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'kpi' ? addRequest : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === 'indicator') actions.indicator();
    else if (actionId === 'excel') actions.excel();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);
}
