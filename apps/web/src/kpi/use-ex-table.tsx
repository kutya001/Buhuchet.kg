'use client';

import { ActionMenu, PHONE_QUERY, useMediaQuery, useToast, type ActionEntry } from '@buhuchet/ui';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { ExTable, type ExHintItem, type ExHow, type ExOptions, type ExTexts } from './ex-table';

/*
 * Таблица как в Excel в React (прототип ui/extable.js, `exTable`): экран рисует ячейки
 * `<td data-sr data-sc>`, обёртку (`wrapRef`), пустой слой (`layer`) и строку состояния (`stat`);
 * выделение, правка, буфер обмена и меню правой кнопки — у `ExTable`. После каждой перерисовки
 * таблица находит ячейки заново: и после своей, и после перерисовки списка внутри обёртки.
 */

/** Стили выделения (`.ex td[data-sr].ex-s`, `.ex-a`, `.ex-e`, `.kno`, `.ro`): атрибуты ставит `ExTable`. */
export const EX_WRAP =
  'relative [&_td[data-sr]]:min-w-[96px] [&_td[data-sr]]:cursor-cell [&_td[data-sr]]:select-none max-md:[&_td[data-sr]]:min-w-[84px] [&_td[data-sr][data-ex-s]]:bg-[color-mix(in_srgb,var(--bu-b-blue)_17%,var(--bu-pane))]! [&_td[data-sr][data-ex-a]]:shadow-[inset_0_0_0_2px_var(--bu-b-blue)] [&_td[data-sr][data-kno]]:cursor-not-allowed [&_td[data-sr][data-ro]]:text-muted [&_[data-exc]]:cursor-pointer [&_[data-exr]]:cursor-pointer [&_thead_[data-exc]:hover]:text-brand-blue';

/** Строка состояния под таблицей (`.ex-stat`). */
export const EX_STAT =
  'my-2 flex min-h-[30px] flex-wrap items-center gap-x-3.5 gap-y-[3px] rounded-lg border border-line bg-pane-alt px-2.5 py-1 text-[12.5px] text-muted [&_b]:text-ink [&_b]:tabular-nums [&_kbd]:rounded [&_kbd]:border [&_kbd]:border-b-2 [&_kbd]:border-line [&_kbd]:bg-pane [&_kbd]:px-1 [&_kbd]:font-mono [&_kbd]:text-[11px] [&_kbd]:font-semibold [&_kbd]:text-ink';

/** Тексты таблицы из словаря. */
export function exTexts(t: Translate): ExTexts {
  const done = (how: ExHow) =>
    how === 'clear'
      ? 'kpi.ex.cleared'
      : how === 'undo'
        ? 'kpi.ex.undone'
        : ('kpi.ex.written' as const);
  return {
    keyboard: t('kpi.ex.keyboard'),
    cell: t('kpi.ex.cell'),
    value: t('kpi.ex.value'),
    locked: t('kpi.ex.locked'),
    notNumber: (text) => t('kpi.not_number', { text }),
    summary: (how, n, bad, skipped) =>
      [
        t(done(how), { n }),
        ...(bad.length
          ? [
              bad.length < 4
                ? t('kpi.ex.bad_list', { n: bad.length, list: bad.map((b) => `«${b}»`).join(', ') })
                : t('kpi.ex.bad', { n: bad.length }),
            ]
          : []),
        ...(skipped ? [t('kpi.ex.skipped', { n: skipped })] : []),
      ].join(', '),
    copied: t('kpi.ex.copied'),
    fillNeedsRows: t('kpi.ex.fill_rows'),
    nothingToUndo: t('kpi.ex.nothing_undo'),
    clipboardDenied: t('kpi.ex.clipboard_denied'),
    pressCtrlV: t('kpi.ex.press_ctrl_v'),
    stat: {
      selected: t('kpi.ex.stat.selected'),
      filled: t('kpi.ex.stat.filled'),
      sum: t('kpi.ex.stat.sum'),
      avg: t('kpi.ex.stat.avg'),
      min: t('kpi.ex.stat.min'),
      max: t('kpi.ex.stat.max'),
      empty: t('kpi.ex.stat.empty'),
    },
    menu: {
      copy: t('kpi.ex.menu.copy'),
      cut: t('kpi.ex.menu.cut'),
      paste: t('kpi.ex.menu.paste'),
      fillDown: t('kpi.ex.menu.fill'),
      fillDownSub: t('kpi.ex.menu.fill_sub'),
      clear: t('kpi.ex.menu.clear'),
      undo: t('kpi.ex.menu.undo'),
      undoReason: t('kpi.ex.menu.undo_reason'),
    },
  };
}

/** Подсказка строки состояния без выделения (прототип `kExHint`). */
export function exHint(t: Translate, phone: boolean): ExHintItem[] {
  if (phone) return [[t('kpi.ex.hint.phone')]];
  const k = (key: string) => ({ k: key });
  return [
    [`${t('kpi.ex.hint.select')} `, k('Shift'), t('kpi.ex.hint.arrows')],
    [k('Enter'), ` ${t('kpi.ex.hint.enter')}`],
    [k('Tab'), ` ${t('kpi.ex.hint.tab')}`],
    [k('Delete'), ` ${t('kpi.ex.hint.delete')}`],
    [k('Ctrl+C'), ' ', k('Ctrl+V'), ` ${t('kpi.ex.hint.clipboard')}`],
    [k('Ctrl+Enter'), ` ${t('kpi.ex.hint.all')}`],
    [k('Ctrl+Z'), ` ${t('kpi.ex.hint.undo')}`],
  ];
}

/**
 * Данные таблицы: размер `rows` × `cols` (ячейки `data-sr`, `data-sc` рисует экран) или `number` —
 * разметить ячейки самой обёртки после перерисовки (список: строки страницы по порядку) и вернуть
 * размер.
 */
export type ExSetup = Pick<ExOptions, 'get' | 'put' | 'key' | 'label' | 'menu'> &
  ({ rows: number; cols: number } | { number: (wrap: HTMLElement) => ExSize });

type ExSize = { rows: number; cols: number };

/**
 * Подключить таблицу как в Excel: `wrapRef` — на элемент с ячейками, `layer` — внутрь него (или рядом,
 * в общий блок с position: relative), `stat` — над таблицей. `setup` — каждый раз свежий: размер и
 * данные текущей перерисовки. `enabled: false` — без таблицы (вид «Карточки» списка).
 */
export function useExTable(setup: ExSetup, options: { enabled?: boolean; stat?: boolean } = {}) {
  const t = useT();
  const toast = useToast();
  const phone = useMediaQuery(PHONE_QUERY);
  const wrapRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const statRef = useRef<HTMLDivElement>(null);
  const table = useRef<{ ex: ExTable; wrap: HTMLElement } | null>(null);
  const [menu, setMenu] = useState<{
    place: { x: number; y: number };
    items: ActionEntry[];
  } | null>(null);
  const enabled = options.enabled ?? true;

  // Свежие настройки для перерисовки списка внутри обёртки (MutationObserver).
  const latest = useRef<(() => ExOptions) | null>(null);

  const full = (): ExOptions => ({
    get: setup.get,
    put: setup.put,
    key: setup.key,
    label: setup.label,
    menu: setup.menu,
    ...('number' in setup
      ? wrapRef.current
        ? setup.number(wrapRef.current)
        : { rows: 0, cols: 0 }
      : { rows: setup.rows, cols: setup.cols }),
    stat: statRef.current,
    hint: exHint(t, phone),
    toast: (text, o) => toast(text, o),
    openMenu: (place, items) => setMenu({ place, items }),
    texts: exTexts(t),
  });

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const layer = layerRef.current;
    const cur = table.current;
    if (!enabled || !wrap || !layer) {
      if (cur) {
        cur.ex.destroy();
        table.current = null;
      }
      return;
    }
    if (cur && cur.wrap !== wrap) {
      cur.ex.destroy();
      table.current = null;
    }
    latest.current = full;
    if (table.current) table.current.ex.update(full());
    else table.current = { ex: new ExTable(wrap, layer, full()), wrap };
  });

  // Список внутри обёртки перерисовался сам (сортировка, страница, столбцы) — ячейки ищутся заново.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!enabled || !wrap) return;
    const observer = new MutationObserver(() => {
      const cur = table.current;
      if (cur && latest.current) cur.ex.update(latest.current());
    });
    observer.observe(wrap, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled]);

  useEffect(
    () => () => {
      table.current?.ex.destroy();
      table.current = null;
    },
    [],
  );

  const layer: ReactNode = enabled ? (
    <div ref={layerRef} className="absolute top-0 left-0 h-0 w-0" data-ex-layer="" />
  ) : null;
  const stat: ReactNode =
    enabled && (options.stat ?? true) ? (
      <div ref={statRef} className={EX_STAT} data-ex-stat="" />
    ) : null;
  const menuNode: ReactNode = menu ? (
    <ActionMenu
      items={menu.items}
      place={menu.place}
      label={t('kpi.ex.menu.label')}
      onClose={() => setMenu(null)}
    />
  ) : null;

  return { wrapRef, layer, stat, menu: menuNode };
}
