'use client';

import { createContext, useContext } from 'react';

/** Запрос «+ Добавить»: какой способ выбран в каком модуле; `n` отличает повторный выбор того же. */
export interface AddRequest {
  moduleId: string;
  actionId: string;
  label: string;
  n: number;
}

export interface ShellState {
  /** Общий поиск по текущей вкладке; при смене модуля или вкладки очищается. */
  search: string;
  addRequest: AddRequest | null;
  clearAddRequest: () => void;
}

export const ShellContext = createContext<ShellState>({
  search: '',
  addRequest: null,
  clearAddRequest: () => {},
});

/** Состояние рабочей страницы для экранов модулей: поиск и выбранный способ добавления. */
export function useShell(): ShellState {
  return useContext(ShellContext);
}
