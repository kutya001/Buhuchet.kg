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
  tone?: 'red' | 'yellow';
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
}

export interface ShellModule {
  id: string;
  title: string;
  icon: IconName;
  href: string;
  tabs: readonly ShellTab[];
  count?: ShellCount;
}
