'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import type { KpiMissingSummary } from '@buhuchet/shared';
import type { ShellCount, ShellModule } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { missingSummaryQuery } from '../kpi/kpi-data';
import { contractorTabCountsQuery } from '../contractors/contractor-data';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { newsDraftsCountQuery } from '../news/news-data';
import { pdictsTabCountsQuery } from '../platform-dicts/pdicts-data';
import { reportTabCountsQuery } from '../reports/reports-data';
import { staffTabCountsQuery } from '../staff/staff-data';
import { taskTabCountsQuery } from '../tasks/tasks-data';

/** Числа у вкладок модулей: модуль → вкладка → счётчик. */
export type TabCounts = Partial<Record<MenuModuleId, Partial<Record<string, ShellCount>>>>;

/**
 * Счётчики вкладок модулей меню (прототип: `count` у вкладок, например staffTabs; их видно и в ряду
 * вкладок, и в левой панели). Счётчики есть у модулей с экранами — у «Контрагентов», «Отчетов для сдачи»,
 * «Сотрудников», «Задач», «Показателей контрагентов» («Не заполнено»), у «Запросов» «Справочников
 * платформы» и черновики «Новостей» в Админке; у остальных их добавят их экраны. Запрос — только для
 * модулей, доступных пользователю; пока ответа нет или запрос не удался — вкладки без чисел.
 */
export function useTabCounts(modules: readonly MenuModuleId[]): TabCounts {
  const t = useT();
  const cps = useQuery({ ...contractorTabCountsQuery, enabled: modules.includes('cps') });
  const reports = useQuery({ ...reportTabCountsQuery, enabled: modules.includes('reports') });
  const staff = useQuery({ ...staffTabCountsQuery, enabled: modules.includes('staff') });
  const tasks = useQuery({ ...taskTabCountsQuery, enabled: modules.includes('tasks') });
  const kpi = useQuery({ ...missingSummaryQuery, enabled: modules.includes('kpi') });
  const pdicts = useQuery({ ...pdictsTabCountsQuery, enabled: modules.includes('pdicts') });
  const kbadm = useQuery({ ...newsDraftsCountQuery, enabled: modules.includes('kbadm') });
  return useMemo(
    () => ({
      ...(cps.data ? { cps: cps.data } : {}),
      ...(reports.data ? { reports: reports.data } : {}),
      ...(staff.data ? { staff: staff.data } : {}),
      ...(tasks.data ? { tasks: tasks.data } : {}),
      ...(kpi.data ? { kpi: { missing: kpiMissingCount(t, kpi.data) } } : {}),
      ...(pdicts.data ? { pdicts: pdicts.data } : {}),
      ...(kbadm.data ? { kbadm: kbadm.data } : {}),
    }),
    [cps.data, reports.data, staff.data, tasks.data, kpi.data, pdicts.data, kbadm.data, t],
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
 * телефона и в «Других модулях» (прототип ui/shell.js: у «Отчетов для сдачи» — просроченные, у
 * «Показателей» — kMissBadge).
 */
const MODULE_COUNT_TAB: Partial<Record<MenuModuleId, string>> = {
  reports: 'overdue',
  kpi: 'missing',
};

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
    // У модуля — только ненулевой цветной счётчик (прототип: `cn.overdue ? badge : ''`).
    ...(own?.tone && own.value ? { count: own } : {}),
    tabs: module.tabs.map((tab) => {
      const count = counts[tab.id];
      return count ? { ...tab, count } : tab;
    }),
  };
}

/**
 * Точка на «Меню» телефона (прототип renderSheetDot): у модуля из «Других модулей» цветной счётчик —
 * точка его цвета (незаполненные показатели); иначе точка модуля с точкой («Начните с Базы знаний»).
 */
export function menuDot(others: readonly { title: string; count?: ShellCount | undefined }[]): {
  dot?: string;
  dotTone?: 'red' | 'yellow';
} {
  const colored = others.find((m) => m.count?.tone && m.count.value);
  if (colored?.count?.tone) {
    return { dot: colored.count.title ?? colored.title, dotTone: colored.count.tone };
  }
  const title = others.find((m) => m.count?.dot)?.count?.title;
  return title ? { dot: title } : {};
}
