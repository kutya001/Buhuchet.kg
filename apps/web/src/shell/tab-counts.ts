'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import type { KpiMissingSummary } from '@buhuchet/shared';
import type { ShellCount, ShellModule } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { missingSummaryQuery } from '../kpi/kpi-data';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { staffTabCountsQuery } from '../staff/staff-data';

/** Числа у вкладок модулей: модуль → вкладка → счётчик. */
export type TabCounts = Partial<Record<MenuModuleId, Partial<Record<string, ShellCount>>>>;

/**
 * Счётчики вкладок модулей меню (прототип: `count` у вкладок, например staffTabs; их видно и в ряду
 * вкладок, и в левой панели). Счётчики есть у модулей с экранами — пока у «Сотрудников»; у
 * остальных их добавят их экраны. Запрос — только для модулей, доступных пользователю; пока ответа
 * нет или запрос не удался — вкладки без чисел.
 */
export function useTabCounts(modules: readonly MenuModuleId[]): TabCounts {
  const t = useT();
  const staff = useQuery({ ...staffTabCountsQuery, enabled: modules.includes('staff') });
  const kpi = useQuery({ ...missingSummaryQuery, enabled: modules.includes('kpi') });
  return useMemo(
    () => ({
      ...(kpi.data ? { kpi: { missing: kpiMissingCount(t, kpi.data) } } : {}),
      ...(staff.data ? { staff: staff.data } : {}),
    }),
    [kpi.data, staff.data, t],
  );
}

/**
 * «Не заполнено» модуля «Показатели контрагентов» (прототип kMissBadge, kpiTabs): контрагентов с
 * незаполненными месяцами; красное — есть просроченные, жёлтое — срок ещё не прошёл, ноль — серый.
 */
export function kpiMissingCount(t: Translate, s: KpiMissingSummary): ShellCount {
  if (s.count === 0) return { value: 0 };
  return s.overdue
    ? { value: s.count, tone: 'red', title: t('kpi.badge.overdue') }
    : { value: s.count, tone: 'yellow', title: t('kpi.badge.soon') };
}

/**
 * Вкладка, чей цветной счётчик показывается и у самого модуля — в левой панели, в нижней панели
 * телефона и в «Других модулях» (прототип ui/shell.js: у «Показателей» — kMissBadge).
 */
const MODULE_COUNT_TAB: Partial<Record<MenuModuleId, string>> = { kpi: 'missing' };

/** Модуль меню с числами у вкладок. */
export function withTabCounts(
  module: ShellModule,
  counts: Partial<Record<string, ShellCount>> | undefined,
): ShellModule {
  if (!counts) return module;
  const tab = MODULE_COUNT_TAB[module.id as MenuModuleId];
  const own = tab ? counts[tab] : undefined;
  return {
    ...module,
    ...(own?.tone ? { count: own } : {}),
    tabs: module.tabs.map((tab) => {
      const count = counts[tab.id];
      return count ? { ...tab, count } : tab;
    }),
  };
}
