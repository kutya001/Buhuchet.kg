'use client';

import type { RoleSaveEditor } from '@buhuchet/domain';
import { createContext, useContext } from 'react';
import type { ShellAccess } from './modules';

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
  /** Очистить поиск (чип «Поиск» и «Сбросить всё» в списке). */
  clearSearch: () => void;
  addRequest: AddRequest | null;
  clearAddRequest: () => void;
  /** Что можно вошедшему: права (например, «Выгружать в Excel») и функции учётной политики. */
  access: ShellAccess;
  /** Учётная запись вошедшего (у администратора платформы — тоже): «Это вы» в «Учётных записях». */
  userId: string | null;
  /** Вошедший сотрудник; у администратора платформы — null. */
  employeeId: string | null;
  /**
   * Вошедший для формы роли: своя роль, действующие права и область (права своей роли меняет
   * владелец, больше своего не выдают); у администратора — null.
   */
  editor: RoleSaveEditor | null;
}

const NO_ACCESS: ShellAccess = {
  admin: false,
  reportConfirm: false,
  can: () => false,
  feature: () => false,
};

export const ShellContext = createContext<ShellState>({
  search: '',
  clearSearch: () => {},
  addRequest: null,
  clearAddRequest: () => {},
  access: NO_ACCESS,
  userId: null,
  employeeId: null,
  editor: null,
});

/** Состояние рабочей страницы для экранов модулей: поиск, права и выбранный способ добавления. */
export function useShell(): ShellState {
  return useContext(ShellContext);
}
