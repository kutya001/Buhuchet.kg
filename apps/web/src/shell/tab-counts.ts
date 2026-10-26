'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import type { ShellTab } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { staffTabCountsQuery } from '../staff/staff-data';

/**
 * Вкладки модуля со счётчиками (прототип: `count` у вкладок, например staffTabs). Счётчики есть у
 * модулей с экранами — пока у «Сотрудников»; у остальных их добавят их экраны. Пока ответа нет или
 * запрос не удался — вкладки без чисел.
 */
export function useTabCounts(
  moduleId: MenuModuleId,
  tabs: readonly ShellTab[],
): readonly ShellTab[] {
  const staff = useQuery({ ...staffTabCountsQuery, enabled: moduleId === 'staff' });
  const counts = moduleId === 'staff' ? staff.data : undefined;
  if (!counts) return tabs;
  return tabs.map((tab) => {
    const count = counts[tab.id];
    return count ? { ...tab, count } : tab;
  });
}
