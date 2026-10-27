'use client';

import type { IndicatorType } from '@buhuchet/domain';
import { Icon, iconButtonClass, Popover } from '@buhuchet/ui';
import {
  useCallback,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { numberText, parseCell, pasteBlock } from './kpi-format';

/*
 * Таблица ввода показателей, как в Excel (прототип modules/kpi.js: `.kt`, `.kin`, ввод в `kpiMonth`,
 * `kPastDlg`, `kpiCardMount`; стили spec/prototype/src/css/popups.css): ячейки-поля, переход стрелками и
 * Enter, вставка блока из Excel. Ею пользуются «Ввод за месяц», «Внести за прошлые месяцы» и вкладка
 * «Показатели» карточки контрагента.
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

/** Поле значения (`.kin`). */
const INPUT_CLASS =
  'w-[110px] rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right text-ink tabular-nums placeholder:text-[11.5px] placeholder:text-faint hover:border-line focus:border-line-strong focus:bg-pane focus:shadow-[0_0_0_3px_var(--bu-sel)] focus:outline-none read-only:cursor-default read-only:hover:border-transparent';

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

/**
 * Поле ячейки: пока в нём фокус — свой текст, иначе — значение с сервера. Правка сохраняется при
 * уходе из поля, если число изменилось; не число — `onBad`, поле возвращает прежнее значение.
 */
export function ValueInput({
  r,
  c,
  cell,
  value,
  readOnly,
  label,
  placeholder,
  title,
  wide = false,
  onCommit,
  onBad,
  onPaste,
  onMove,
}: {
  r: number;
  c: number;
  cell: CellRef;
  value: number | null;
  readOnly: boolean;
  label: string;
  placeholder?: string | undefined;
  title?: string | undefined;
  /** Шире (список месяцев на телефоне, `.kmlist .kin`). */
  wide?: boolean;
  /** `prev` — значение, когда поле получило фокус: сервер сверит, не изменил ли его другой. */
  onCommit: (value: number | null, prev: number | null) => void;
  onBad: (text: string) => void;
  onPaste: (r: number, c: number, block: string[][]) => void;
  onMove: (r: number, c: number, key: string, input: HTMLInputElement) => boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const seen = useRef(value);
  const shown = text ?? numberText(cell.type, value);

  const commit = () => {
    if (text === null || readOnly) return;
    setText(null);
    const next = parseCell(cell.type, text);
    if (next === undefined) return onBad(text);
    if (next !== seen.current) onCommit(next, seen.current);
  };

  return (
    <input
      className={`${INPUT_CLASS} ${wide ? 'w-[120px]' : ''}`}
      data-r={r}
      data-c={c}
      data-cid={cell.contractorId}
      data-ind={cell.indicatorId}
      data-m={cell.month}
      data-type={cell.type}
      data-prev={value ?? ''}
      value={shown}
      readOnly={readOnly}
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      title={title}
      aria-label={label}
      onFocus={(e) => {
        seen.current = value;
        if (!readOnly) setText(numberText(cell.type, value));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        if (!readOnly) setText(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape' && text !== null) {
          setText(null);
          return;
        }
        if (onMove(r, c, e.key, e.currentTarget)) e.preventDefault();
        // Enter в последней строке: ниже ячейки нет — сохранить, как «change» поля в прототипе.
        else if (e.key === 'Enter') commit();
      }}
      onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
        const block = pasteBlock(e.clipboardData.getData('text'));
        if (!block) return;
        e.preventDefault();
        setText(null);
        onPaste(r, c, block);
      }}
    />
  );
}

/**
 * Переход между ячейками и вставка блока (прототип: стрелки вверх и вниз, Enter — вниз; вправо и
 * влево — когда курсор у края текста; пропускаются ячейки без поля). Tab — по порядку полей, как в
 * браузере.
 */
export function useCellGrid(
  table: RefObject<HTMLElement | null>,
  size: { rows: number; cols: number },
) {
  const at = useCallback(
    (r: number, c: number) =>
      table.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`) ?? null,
    [table],
  );

  const onMove = useCallback(
    (r: number, c: number, key: string, input: HTMLInputElement) => {
      let target: HTMLInputElement | null = null;
      if (key === 'ArrowDown' || key === 'Enter') {
        for (let k = r + 1; k <= size.rows && !target; k++) target = at(k, c);
      } else if (key === 'ArrowUp') {
        for (let k = r - 1; k >= 0 && !target; k--) target = at(k, c);
      } else if (key === 'ArrowRight' && input.selectionEnd === input.value.length) {
        for (let k = c + 1; k <= size.cols && !target; k++) target = at(r, k);
      } else if (key === 'ArrowLeft' && input.selectionStart === 0) {
        for (let k = c - 1; k >= 0 && !target; k--) target = at(r, k);
      }
      if (!target) return false;
      target.focus();
      return true;
    },
    [at, size.rows, size.cols],
  );

  /** Ячейки блока от (r0, c0): изменения, сколько не чисел; поля только для чтения пропускаются. */
  const pasted = useCallback(
    (r0: number, c0: number, block: string[][]) => {
      const changes: CellChange[] = [];
      let bad = 0;
      block.forEach((line, dr) =>
        line.forEach((text, dc) => {
          const el = at(r0 + dr, c0 + dc);
          if (!el || el.readOnly) return;
          const { cid, ind, m, type, prev } = el.dataset;
          const value = parseCell(type as IndicatorType, text);
          if (value === undefined) {
            bad += 1;
            return;
          }
          const was = prev ? Number(prev) : null;
          changes.push({ contractorId: cid!, indicatorId: ind!, month: m!, value, prev: was });
        }),
      );
      return { changes, bad };
    },
    [at],
  );

  return { onMove, pasted };
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
