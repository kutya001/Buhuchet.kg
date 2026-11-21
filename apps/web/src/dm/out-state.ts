'use client';

import { useSyncExternalStore } from 'react';
import type { DmParamValues } from './out-model';

/*
 * Выбор на «Выводе», который живёт, пока открыта страница (прототип `DMV`: `tpl`, `org`, `p`): шаблон
 * (его же ставит «Показать» каталога), организация «глазами организации» у Админки и последний запуск.
 * Переход между вкладками его не сбрасывает.
 */
export interface DmOutChoice {
  /** Код выбранного шаблона; null — первый в списке. */
  tpl: string | null;
  /** Админка: организация для шаблона организаций; null — первая (демо). */
  org: string | null;
  /** Что показано: параметры последнего «Показать» и номер запуска (повтор «Показать» — заново). */
  shown: { tpl: string; params: DmParamValues; org: string | null; n: number } | null;
}

let state: DmOutChoice = { tpl: null, org: null, shown: null };
const listeners = new Set<() => void>();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function setOutChoice(patch: Partial<DmOutChoice>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export function useOutChoice(): DmOutChoice {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Ключ запомненных параметров шаблона пользователя (прототип `'dm.p.' + S.me + '.' + код`). */
const paramsKey = (userId: string, code: string) => `bh_dm_p.${userId}.${code}`;

/** Последние параметры шаблона на этом устройстве (блок 4, пункт 1); нет или не прочитать — null. */
export function savedParams(userId: string | null, code: string): Record<string, unknown> | null {
  if (!userId) return null;
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(paramsKey(userId, code)) ?? 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function saveParams(userId: string | null, code: string, params: DmParamValues) {
  if (!userId) return;
  try {
    window.localStorage.setItem(paramsKey(userId, code), JSON.stringify(params));
  } catch {
    // Память браузера закрыта (частное окно): параметры просто не запомнятся.
  }
}
