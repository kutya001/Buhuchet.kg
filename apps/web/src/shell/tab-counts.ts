'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import type { ShellCount, ShellModule } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { staffTabCountsQuery } from '../staff/staff-data';
import { taskTabCountsQuery } from '../tasks/tasks-data';

/** Числа у вкладок модулей: модуль → вкладка → счётчик. */
export type TabCounts = Partial<Record<MenuModuleId, Partial<Record<string, ShellCount>>>>;

/**
 * Счётчики вкладок модулей меню (прототип: `count` у вкладок, например staffTabs; их видно и в ряду
 * вкладок, и в левой панели). Счётчики есть у модулей с экранами — у «Сотрудников» и «Задач»; у
 * остальных их добавят их экраны. Запрос — только для модулей, доступных пользователю; пока ответа
 * нет или запрос не удался — вкладки без чисел.
 */
export function useTabCounts(modules: readonly MenuModuleId[]): TabCounts {
  const staff = useQuery({ ...staffTabCountsQuery, enabled: modules.includes('staff') });
  const tasks = useQuery({ ...taskTabCountsQuery, enabled: modules.includes('tasks') });
  return useMemo(
    () => ({
      ...(staff.data ? { staff: staff.data } : {}),
      ...(tasks.data ? { tasks: tasks.data } : {}),
    }),
    [staff.data, tasks.data],
  );
}

/** Модуль меню с числами у вкладок. */
export function withTabCounts(
  module: ShellModule,
  counts: Partial<Record<string, ShellCount>> | undefined,
): ShellModule {
  if (!counts) return module;
  return {
    ...module,
    tabs: module.tabs.map((tab) => {
      const count = counts[tab.id];
      return count ? { ...tab, count } : tab;
    }),
  };
}
