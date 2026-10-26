'use client';

import { pluralForm } from '@buhuchet/domain';
import type { GridLabels } from '@buhuchet/ui';
import { useMemo } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';

/** Ключи числа записей в трёх формах: `grid.count` — «записей», `staff.count` — «сотрудников». */
export type CountKey = 'grid.count' | 'staff.count';

/** Тексты списка из словаря; число записей — в форме для числа (1 сотрудник, 2 сотрудника, 5 сотрудников). */
export function gridLabels(t: Translate, count: CountKey): GridLabels {
  return {
    count: (n) => t(`${count}.${pluralForm(n)}`, { n }),
    view: t('grid.view'),
    table: t('grid.table'),
    cards: t('grid.cards'),
    viewTo: (name) => t('grid.view_to', { name }),
    columns: t('grid.columns'),
    columnsHint: t('grid.columns_hint'),
    system: t('grid.system'),
    moveUp: t('grid.move_up'),
    moveDown: t('grid.move_down'),
    dragHint: t('grid.drag_hint'),
    viewOptions: t('grid.view_options'),
    viewOptionsHint: t('grid.view_options_hint'),
    densityNormal: t('grid.density_normal'),
    densityCompact: t('grid.density_compact'),
    widthFull: t('grid.width_full'),
    widthCenter: t('grid.width_center'),
    resetView: t('grid.reset_view'),
    resetViewSub: t('grid.reset_view_sub'),
    sortBy: (label) => t('grid.sort_by', { label }),
    columnWidth: t('grid.column_width'),
    actions: t('grid.actions'),
    shown: (from, to, total) => t('grid.shown', { from, to, total }),
    perPage: t('grid.per_page'),
    allRows: t('grid.all_rows'),
    prev: t('grid.prev'),
    next: t('grid.next'),
    loadError: t('grid.load_error'),
    loadErrorText: t('grid.load_error_text'),
    retry: t('grid.retry'),
    totalByFilter: (n) => t('grid.total_by_filter', { n }),
    selected: (n) => t('grid.selected', { n }),
    clearSelection: t('grid.clear_selection'),
    selectAll: t('grid.select_all'),
    selectRow: t('grid.select_row'),
    selectCard: t('grid.select_card'),
    createdBy: t('grid.col.created_by'),
    updatedBy: t('grid.col.updated_by'),
    createdAt: t('grid.col.created_at'),
    updatedAt: t('grid.col.updated_at'),
    createdLine: (text) => t('grid.created_line', { text }),
    updatedLine: (text) => t('grid.updated_line', { text }),
  };
}

export function useGridLabels(count: CountKey = 'grid.count'): GridLabels {
  const t = useT();
  return useMemo(() => gridLabels(t, count), [t, count]);
}
