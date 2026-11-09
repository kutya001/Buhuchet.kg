'use client';

import type { IndicatorType } from '@buhuchet/domain';
import { Icon, iconButtonClass, Popover } from '@buhuchet/ui';

/*
 * Вид таблиц показателей (прототип modules/kpi.js: `.kt`; стили spec/prototype/src/css/popups.css):
 * «Ввод за месяц», «Внести за прошлые месяцы», вкладка «Показатели» карточки контрагента. Выделение,
 * ввод и буфер обмена — у таблицы как в Excel (`ex-table.ts`, `kpi-ex.tsx`).
 */

/** `table.kt`. */
export const TABLE_CLASS =
  'w-max min-w-full border-separate border-spacing-0 text-[13px] [&_td]:border-b [&_td]:border-line [&_td]:bg-pane [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-left [&_td]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:whitespace-nowrap';
/** Обёртка с прокруткой (`.tbl-wrap.kpi-wrap`). */
export const WRAP_CLASS = 'min-w-0 overflow-auto rounded-lg border border-line bg-pane';
/** Заголовок столбца (`thead th`): закреплён сверху. */
export const HEAD_CLASS =
  'sticky top-0 z-[2] bg-pane-alt align-bottom text-[12.5px] font-[650] [&_small]:block [&_small]:text-[11px] [&_small]:font-[450] [&_small]:text-faint';
/** Первый столбец (`.kt-cp`): закреплён слева. */
export const FIRST_CLASS = 'sticky left-0 z-[1] max-w-[240px] overflow-hidden text-ellipsis';
/** Итоговая строка (`tfoot`). */
export const FOOT_CLASS =
  '[&_td]:bg-pane-alt [&_td]:font-[650] [&_th]:bg-pane-alt [&_th]:font-[650]';
/** Строка с просроченным заполнением (`tr.overdue`). */
export const OVERDUE_ROW =
  '[&_td]:bg-danger-bg! [&_td:first-child]:shadow-[inset_3px_0_0_var(--bu-red)]';
/** Обязательная пустая ячейка (`td.emp`). */
export const EMPTY_CELL = 'bg-[color-mix(in_srgb,var(--bu-b-yellow)_16%,var(--bu-pane))]!';
/** Ячейка не ведётся или раньше «с <месяц>» (`td.kno`, `td.kearly`). */
export const OFF_CELL = 'bg-pane-alt! text-faint';
export const NUM = 'text-right!';

export interface CellRef {
  contractorId: string;
  indicatorId: string;
  month: string;
  type: IndicatorType;
}

/** Значение ячейки после правки или вставки; `prev` — что было в ячейке, когда её начали править. */
export interface CellChange extends Omit<CellRef, 'type'> {
  value: number | null;
  prev: number | null;
}

/** «ⓘ» у названия показателя: описание при наведении (ПК) или по нажатию (прототип `tipI`). */
export function InfoTip({ label, text }: { label: string; text: string }) {
  return (
    <Popover
      label={label}
      padded
      hover
      className="relative inline-flex align-middle"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={label}
          aria-expanded={open}
          aria-controls={id}
          className={`${iconButtonClass('sm')} -my-1 h-6 w-6 min-w-6 text-faint`}
        >
          <Icon name="info" size="sm" />
        </button>
      )}
    >
      {() => <span className="block max-w-[300px] text-[12.5px] whitespace-normal">{text}</span>}
    </Popover>
  );
}
