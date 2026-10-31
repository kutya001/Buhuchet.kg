'use client';

import {
  AssignmentMassOptions,
  DueChangeReasons,
  ManualReportOptions,
  ReportCalendar,
  ReportCard,
  ReportMatrix,
  ReportTabCounts,
  ResponsibleOptions,
} from '@buhuchet/shared';
import type { ShellCount } from '@buhuchet/ui';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure } from '../api-client';

/**
 * Данные модуля «Отчеты для сдачи» через TanStack Query: счётчики вкладок, плашки и числа быстрого
 * фильтра, карточка отчёта, списки окна «Разовый отчёт», причины изменения срока, сетка «Кто что
 * сдаёт», окно массового назначения, числа «Календаря», сотрудники для «сменить». После действия —
 * `useReportsRefresh`.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

/** Вкладки списка с плашками и быстрым фильтром (прототип repTabs). */
export const REPORT_LIST_TABS = ['week', 'overdue', 'waiting', 'all'] as const;
export type ReportListTab = (typeof REPORT_LIST_TABS)[number];

const summaryFn = async () =>
  json(await api.api.reports['tab-counts'].$get(), (v) => ReportTabCounts.parse(v));

/** Счётчики вкладок, плашки, числа «Все / Сдать / Уплатить» (прототип counts, renderReports). */
export const reportSummaryQuery = queryOptions({
  queryKey: ['reports', 'summary'],
  queryFn: summaryFn,
});

/**
 * Числа у вкладок (прототип repTabs): «На неделе», «Просрочено» — красным, «Ожидают подтверждения»; у
 * «Все отчёты» числа нет. Ноль — серым, как в прототипе (`badge` без цвета).
 */
export const reportTabCounts = (
  s: Pick<ReportTabCounts, 'week' | 'overdue' | 'waiting'>,
): Partial<Record<string, ShellCount>> => ({
  week: { value: s.week },
  overdue: { value: s.overdue, tone: 'red' },
  waiting: { value: s.waiting },
});

/**
 * Подсказка «Подключите виды отчётов» (прототип modules/tax-pick.js, `txNote`): пока нет ни одного
 * подключённого вида — с кнопкой «Выбрать налоги» у права «Вести справочники организации», без него —
 * «Подключает владелец»; вид подключён — подсказки нет.
 */
export const noTypesHint = (
  items: readonly { enabled: boolean }[],
  canDicts: boolean,
): 'pick' | 'owner' | null => (items.some((x) => x.enabled) ? null : canDicts ? 'pick' : 'owner');

export const reportTabCountsQuery = queryOptions({
  queryKey: ['reports', 'summary'],
  queryFn: summaryFn,
  select: reportTabCounts,
});

/** Карточка отчёта: поля строки, сдача, строки суммы, файлы, история. */
export function reportQuery(id: string) {
  return queryOptions({
    queryKey: ['reports', 'card', id],
    queryFn: async () =>
      json(await api.api.reports[':id'].$get({ param: { id } }), (v) => ReportCard.parse(v)),
  });
}

/** Списки окна «Разовый отчёт»: контрагенты в области и подключённые виды. */
export const manualOptionsQuery = queryOptions({
  queryKey: ['reports', 'manual-options'],
  queryFn: async () =>
    json(await api.api.reports['manual-options'].$get(), (v) => ManualReportOptions.parse(v)),
});

/** Справочник платформы «Причины изменения срока отчёта» — действующие, по порядку справочника. */
export const dueReasonsQuery = queryOptions({
  queryKey: ['reports', 'due-reasons'],
  queryFn: async () =>
    json(await api.api['due-change-reasons'].$get({ query: {} }), (v) =>
      DueChangeReasons.parse(v).items.filter((r) => r.active),
    ),
  staleTime: 10 * 60_000,
});

/** Сетка «Кто что сдаёт» с поиском оболочки по названию и ИНН (прототип renderMatrix). */
export function reportMatrixQuery(q: string) {
  return queryOptions({
    queryKey: ['reports', 'matrix', q],
    queryFn: async () =>
      json(await api.api.reports.matrix.$get({ query: q ? { q } : {} }), (v) =>
        ReportMatrix.parse(v),
      ),
  });
}

/** Окно «Назначить отчёт нескольким контрагентам»: виды, выбранный вид и контрагенты в области. */
export function massAssignQuery(type: string | null) {
  return queryOptions({
    queryKey: ['reports', 'mass', type ?? ''],
    queryFn: async () =>
      json(await api.api.assignments.mass.$get({ query: type ? { type } : {} }), (v) =>
        AssignmentMassOptions.parse(v),
      ),
    staleTime: 30_000,
  });
}

/** Числа дней «Календаря» месяца `YYYY-MM` (прототип renderCalendar). */
export function reportCalendarQuery(month: string) {
  return queryOptions({
    queryKey: ['reports', 'calendar', month],
    queryFn: async () =>
      json(await api.api.reports.calendar.$get({ query: { month } }), (v) =>
        ReportCalendar.parse(v),
      ),
  });
}

/** Действующие сотрудники для «сменить» ответственного в карточке отчёта. */
export const responsibleOptionsQuery = queryOptions({
  queryKey: ['reports', 'responsible-options'],
  queryFn: async () =>
    json(await api.api.assignments['responsible-options'].$get(), (v) =>
      ResponsibleOptions.parse(v),
    ),
  staleTime: 60_000,
});

/**
 * После действия с отчётом — перечитать карточки, списки вкладок и дня «Календаря», счётчики, сетку
 * «Кто что сдаёт», числа «Календаря» и блоки «Файлы».
 */
export function useReportsRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['reports', 'summary'] });
    void client.invalidateQueries({ queryKey: ['reports', 'card'] });
    void client.invalidateQueries({ queryKey: ['reports', 'matrix'] });
    void client.invalidateQueries({ queryKey: ['reports', 'calendar'] });
    void client.invalidateQueries({ queryKey: ['files', 'report'] });
    for (const tab of [...REPORT_LIST_TABS, 'calendar'])
      void client.invalidateQueries({ queryKey: ['list', `reports.${tab}`] });
    // Регулярные задачи — это отчёты месяца (задача 2.24): их статус и счётчики меняются вместе с отчётом.
    void client.invalidateQueries({ queryKey: ['tasks'] });
    for (const tab of ['mine', 'byme', 'all', 'overdue'])
      void client.invalidateQueries({ queryKey: ['list', `tasks.${tab}`] });
  }, [client]);
}
