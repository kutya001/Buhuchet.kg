import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';
import type { IconName } from '../icons';

/** Ссылка внутри оболочки: сайт передаёт свою (Next.js `Link`), по умолчанию — обычная `<a>`. */
export type ShellLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  children?: ReactNode;
};
export type ShellLink = ComponentType<ShellLinkProps>;

/** Счётчик у модуля или вкладки (например, просроченные отчёты — красный). */
export interface ShellCount {
  value: number | string;
  /** `gray` — только у точки: непрочитанные новости (прототип v138 `.kb-dot.gray`). */
  tone?: 'red' | 'yellow' | 'gray';
  /** Подсказка, например «Просрочено». */
  title?: string;
  /** Синяя точка вместо числа (прототип `.kb-dot`: «Начните с Базы знаний»). */
  dot?: boolean;
}

export interface ShellTab {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  count?: ShellCount;
  /** Группа вкладки: между группами в ряду — черта (прототип `.tab-sep`). */
  group?: string;
  /** Подсказка вкладки, например «Группа · Название»; без неё — `label`. */
  title?: string;
}

export interface ShellModule {
  id: string;
  title: string;
  /** Короткое название для левой панели и верхней панели («Отчёты»); полное — в подсказке (прототип v138). */
  short?: string;
  icon: IconName;
  href: string;
  tabs: readonly ShellTab[];
  count?: ShellCount;
}
