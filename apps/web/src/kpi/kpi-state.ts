'use client';

import { useSyncExternalStore } from 'react';

/*
 * Выбор на экранах модуля, который живёт, пока открыта страница (прототип `S.kpiM`, `S.kpiP`, `S.kSetV`):
 * месяц «Ввода за месяц» (по нему же плашки на других вкладках), период «За период» и вид «Настройки
 * показателей». Переход между вкладками его не сбрасывает; после перезагрузки — снова по умолчанию.
 */

export interface KpiChoice {
  /** null — месяц по умолчанию с сервера (текущий месяц заполнения). */
  month: string | null;
  /** null — последние 12 месяцев до текущего месяца заполнения. */
  period: { from: string; to: string } | null;
  setupView: 'list' | 'who';
}

let state: KpiChoice = { month: null, period: null, setupView: 'list' };
const listeners = new Set<() => void>();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function setKpiChoice(patch: Partial<KpiChoice>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export function useKpiChoice(): KpiChoice {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}
