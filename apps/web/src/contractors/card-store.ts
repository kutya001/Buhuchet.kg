import type { ContractorRow } from '@buhuchet/shared';
import { useSyncExternalStore } from 'react';
import { useShell } from '../shell/context';
import type { ContractorCardTab } from './contractor-card';

/** Открытая карточка контрагента: номер, строка списка (до загрузки), вкладка и счётчик открытий. */
export interface ContractorCardRequest {
  id: string;
  row: ContractorRow | null;
  tab: ContractorCardTab;
  open: boolean;
  n: number;
}

/*
 * Карточку контрагента открывают из многих мест (список, «Показатели контрагентов», карточки отчёта и
 * задачи; прототип `openCp(c, tab)`), а рисует её одна — `ContractorCardHost` в оболочке. Поэтому
 * открыть карточку — просто вызвать `openContractorCard`, без импорта самой карточки (и без кольца
 * «карточка отчёта ↔ карточка контрагента»).
 */
let now: ContractorCardRequest | null = null;
const listeners = new Set<() => void>();
const set = (next: ContractorCardRequest | null) => {
  now = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Открыть карточку контрагента (поверх открытых окон); открытая карточка заменяется новой. */
export function openContractorCard(
  c: ContractorRow | { id: string },
  tab: ContractorCardTab = 'main',
): void {
  set({ id: c.id, row: 'inn' in c ? c : null, tab, open: true, n: (now?.n ?? 0) + 1 });
}

export function closeContractorCard(): void {
  if (now?.open) set({ ...now, open: false });
}

export function useContractorCardRequest(): ContractorCardRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => null,
  );
}

/** Можно ли открыть карточку контрагента (ссылки в других модулях): право «Просматривать контрагентов». */
export function useContractorCardOn(): boolean {
  return useShell().access.can('cpView');
}
