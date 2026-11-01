'use client';

import type { ListFilterValue, MenuModuleId } from '@buhuchet/domain';
import { ListFilters } from '@buhuchet/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { tabHref } from '../shell/modules';

type Filters = Readonly<Record<string, ListFilterValue>>;

/**
 * Адрес вкладки списка с готовым фильтром (прототип `go(модуль, вкладка, preset)`): плашка «Главной»
 * открывает список с тем же фильтром, по которому посчитано её число. Фильтр — `?preset=<JSON>`.
 */
export function presetHref(moduleId: MenuModuleId, tabId: string, filters: Filters = {}): string {
  const href = tabHref(moduleId, tabId);
  return Object.keys(filters).length
    ? `${href}?preset=${encodeURIComponent(JSON.stringify(filters))}`
    : href;
}

/** Фильтр из адреса; испорченный или чужой — нет фильтра. */
function parsePreset(raw: string | null): Filters | undefined {
  if (!raw) return undefined;
  try {
    const parsed = ListFilters.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as Filters) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Фильтр, с которым открыт список (`presetHref`): первые фильтры списка (`initialFilters` у
 * `useListPage`), адрес — без `?preset=`. Читает только экран открытой вкладки: соседняя вкладка, которую
 * оболочка рисует для свайпа, фильтр не берёт и адрес не трогает.
 */
export function usePresetFilters(moduleId: MenuModuleId, tabId: string): Filters | undefined {
  const router = useRouter();
  const href = tabHref(moduleId, tabId);
  const active = usePathname() === href;
  const raw = useSearchParams().get('preset');
  const [preset] = useState(() => (active ? parsePreset(raw) : undefined));
  useEffect(() => {
    if (active && raw !== null) router.replace(href, { scroll: false });
  }, [active, raw, router, href]);
  return preset;
}
