'use client';

import {
  monthText,
  parseIndicatorValue,
  type IndicatorType,
  type YearMonth,
} from '@buhuchet/domain';
import type { ReactNode } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import type { ExCell, ExPutResult, ExWrite } from './ex-table';
import { monthGenName, numberText } from './kpi-format';
import type { CellChange } from './kpi-table';

/*
 * Ячейки показателей в таблице как в Excel (прототип modules/kpi.js: kTxt, kCellOk, kCellDraw, kPutAll,
 * kExBind): что можно вносить, текст для правки и копирования, вид ячейки и запись значений.
 */

/** Ячейка: чей показатель за какой месяц, вносит ли сотрудник значения этого контрагента. */
export interface KxRef {
  contractorId: string;
  indicatorId: string;
  type: IndicatorType;
  /** Показатель обязательный (пустая прошедшая ячейка подсвечена). */
  required: boolean;
  archived: boolean;
  month: YearMonth;
  /** `required` — ведётся, `early` — раньше «с <месяц>», `off` — не ведётся или не нужен в месяце. */
  state: 'required' | 'early' | 'off';
  /** «с <месяц>» у контрагента — для подсказки ячейки раньше него. */
  start: YearMonth;
  /** Показатель отключён у контрагента с этого месяца. */
  offSince: YearMonth | null;
  value: number | null;
  editable: boolean;
}

/**
 * Текст значения для правки и копирования (прототип `kTxt`): без пробелов, копейки через запятую — так
 * его понимает Excel. Сотые → «1250,5», целое — «12».
 */
export function cellText(type: IndicatorType, value: number | null): string {
  if (value === null) return '';
  if (type === 'int') return String(Math.round(value / 100));
  return String(Math.round(value) / 100).replace('.', ',');
}

/** Можно ли вносить значение (прототип `kCellOk`): показатель не в архиве и ведётся, месяц не позже текущего. */
export const cellOk = (x: KxRef, current: YearMonth) =>
  !x.archived && x.state !== 'off' && x.month <= current;

/** Почему ячейку не изменить (прототип `kNoWhy`, `kRoWhy`). */
export function cellWhy(t: Translate, x: KxRef, current: YearMonth): string {
  if (cellOk(x, current)) return t('kpi.readonly_cell');
  if (x.month > current) return t('kpi.ex.month_future');
  if (x.offSince) return t('kpi.off_since', { month: monthGenName(t, x.offSince) });
  return t('kpi.cell_off');
}

/** Ячейка для `ExTable` (прототип `get` в `kExBind`). */
export function exCellOf(t: Translate, x: KxRef | null | undefined, current: YearMonth): ExCell {
  if (!x) return { t: '', n: null, ed: false, why: t('kpi.ex.no_value') };
  const ok = cellOk(x, current);
  return {
    t: cellText(x.type, x.value),
    n: x.value,
    ed: ok && x.editable,
    why: cellWhy(t, x, current),
  };
}

/**
 * Записи таблицы → изменения значений (прототип `kPutAll`): не число — в `bad`, то же значение — не
 * изменение; `prev` — что было в ячейке (сервер сверит, не изменил ли его другой).
 */
export function cellChanges(
  list: readonly ExWrite[],
  at: (r: number, c: number) => KxRef | null | undefined,
): { changes: (CellChange & { r: number; c: number })[]; bad: string[] } {
  const changes: (CellChange & { r: number; c: number })[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const w of list) {
    const x = at(w.r, w.c);
    if (!x) continue;
    const parsed = parseIndicatorValue(x.type, w.t);
    if (!parsed.ok) {
      bad.push(String(w.t).trim());
      continue;
    }
    const key = `${x.contractorId}|${x.indicatorId}|${x.month}`;
    if (parsed.value === x.value || seen.has(key)) continue;
    seen.add(key);
    changes.push({
      r: w.r,
      c: w.c,
      contractorId: x.contractorId,
      indicatorId: x.indicatorId,
      month: x.month,
      value: parsed.value,
      prev: x.value,
    });
  }
  return { changes, bad };
}

/** `put` для `ExTable`: разбор и запись; `save` — false, если сервер не записал (уведомление показано). */
export async function putCells(
  list: readonly ExWrite[],
  at: (r: number, c: number) => KxRef | null | undefined,
  save: (changes: CellChange[]) => Promise<boolean>,
): Promise<ExPutResult> {
  const { changes, bad } = cellChanges(list, at);
  if (!changes.length) return { bad, changed: [] };
  const ok = await save(changes.map(({ r: _r, c: _c, ...rest }) => rest));
  if (!ok) return { bad, changed: [], failed: true };
  return { bad, changed: changes.map(({ r, c }) => ({ r, c })) };
}

/** Стили ячейки (`.kno`, `.emp`, `.kearly`): серая без ввода, пустая обязательная — жёлтая. */
const OFF = 'bg-pane-alt! text-faint';
const EMPTY = 'bg-[color-mix(in_srgb,var(--bu-b-yellow)_16%,var(--bu-pane))]!';

/** Ключ ячейки в `data-kx`: контрагент, показатель и месяц. */
export const kxKey = (x: Pick<KxRef, 'contractorId' | 'indicatorId' | 'month'>) =>
  `${x.contractorId}|${x.indicatorId}|${x.month}`;

/** Ключ ячейки для `ExTable` (`key`): та же ячейка при любой перерисовке; без значения — `null`. */
export const exKey = (x: KxRef | null | undefined) => (x ? kxKey(x) : null);

/**
 * Вид ячейки значения (прототип `kCellDraw`): атрибуты `<td>` и содержимое — для своей таблицы
 * (`KxTd`) и для ячейки списка (`GridColumn.td`, `list`). Не ведётся — «—»; раньше «с …» —
 * «необязательно»; в своей таблице они серые, а пустая обязательная за прошедший месяц подсвечена
 * (`.kt td.kno`, `.emp`, `.kearly`), в списке фона нет, как в прототипе (`.gt`).
 */
export function kxCell(t: Translate, x: KxRef, current: YearMonth, list = false) {
  const ok = cellOk(x, current);
  const early = ok && x.state === 'early';
  const empty = ok && x.value === null && !early && x.required && x.month < current;
  const title = !ok
    ? cellWhy(t, x, current)
    : early
      ? t('kpi.early_cell', { from: monthText(x.start) })
      : x.editable
        ? undefined
        : t('kpi.readonly_cell');
  const props = {
    'data-kx': kxKey(x),
    'data-kno': ok ? undefined : '',
    'data-kpi-off': x.state === 'off' ? '' : undefined,
    'data-ro': ok && !x.editable ? '' : undefined,
    'data-kx-empty': empty ? '' : undefined,
    title,
    className: `text-right! tabular-nums ${list ? '' : !ok || early ? OFF : empty ? EMPTY : ''}`,
  };
  const content: ReactNode =
    x.value !== null ? (
      numberText(x.type, x.value)
    ) : !ok ? (
      '—'
    ) : early ? (
      <span className="text-[11.5px] text-faint">{t('kpi.ex.optional')}</span>
    ) : null;
  return { props, content };
}

/** Ячейка значения своей таблицы: координаты `r`, `c` для таблицы как в Excel. */
export function KxTd({ r, c, x, current }: { r: number; c: number; x: KxRef; current: YearMonth }) {
  const t = useT();
  const { props, content } = kxCell(t, x, current);
  return (
    <td data-sr={r} data-sc={c} {...props}>
      {content}
    </td>
  );
}

/**
 * Координаты ячеек списка (прототип `kGridEx`): `td[data-kx]` по порядку строк на странице получают
 * `data-sr`, `data-sc`; возвращает ключи ячеек по координатам. Список сам строк не нумерует — строки
 * в свёрнутых группах не нарисованы.
 */
export function numberCells(root: HTMLElement): string[][] {
  const out: string[][] = [];
  root.querySelectorAll('tbody tr').forEach((tr) => {
    const cells = tr.querySelectorAll<HTMLElement>('td[data-kx]');
    if (!cells.length) return;
    const r = out.length;
    out.push(
      [...cells].map((td, c) => {
        td.dataset.sr = String(r);
        td.dataset.sc = String(c);
        return td.dataset.kx ?? '';
      }),
    );
  });
  return out;
}
