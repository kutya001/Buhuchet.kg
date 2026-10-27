'use client';

import { formatCount, pluralForm } from '@buhuchet/domain';
import type { GridLabels } from '@buhuchet/ui';
import { useMemo } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';

/** Ключи числа записей в трёх формах: `grid.count` — «записей», `staff.count` — «сотрудников». */
export type CountKey =
  | 'grid.count'
  | 'staff.count'
  | 'roles.count'
  | 'accounts.count'
  | 'orgs.count'
  | 'locale.count'
  | 'dicts.count'
  | 'dicts.platform.count'
  | 'pdicts.count'
  | 'pdicts.ugns_count'
  | 'pdicts.req.count';

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
    // «Показано 1 – 5 000 из 8 200» — с разрядами (прототип ui/grid.js `.gfoot`, ТЗ «Все записи»).
    shown: (from, to, total) =>
      t('grid.shown', { from: formatCount(from), to: formatCount(to), total: formatCount(total) }),
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
    notFound: t('grid.not_found'),
    notFoundText: t('grid.not_found_text'),
    resetFilters: t('grid.reset_filters'),
    filter: t('grid.filter'),
    filterOf: (label) => t('grid.filter_of', { label }),
    filterContains: t('grid.filter_contains'),
    filterFrom: t('grid.filter_from'),
    filterTo: t('grid.filter_to'),
    filterBounds: t('grid.filter_bounds'),
    filterSince: t('grid.filter_since'),
    filterUntil: t('grid.filter_until'),
    filterBadNumber: t('grid.filter_bad_number'),
    filterFind: t('grid.filter_find'),
    filterAll: t('grid.filter_all'),
    empty: t('grid.filter_empty'),
    filterLoading: t('grid.filter_loading'),
    filterLoadError: t('grid.filter_load_error'),
    filterMore: (n, total) =>
      t('grid.filter_more', { n: formatCount(n), total: formatCount(total) }),
    filterTooMany: t('grid.filter_too_many'),
    clear: t('grid.clear'),
    apply: t('grid.apply'),
    groupByColumn: t('grid.group_by_column'),
    ungroupColumn: t('grid.ungroup_column'),
    groupReplaced: t('grid.group_replaced'),
    group: t('grid.group'),
    groupN: (n) => t('grid.group_n', { n }),
    groupButtonHint: t('grid.group_button_hint'),
    groupLevel1: t('grid.group_level1'),
    groupLevel2: t('grid.group_level2'),
    groupNone: t('grid.group_none'),
    groupAggs: t('grid.group_aggs'),
    groupHint: t('grid.group_hint'),
    groupRemove: t('grid.group_remove'),
    aggNone: t('grid.agg.none'),
    agg: {
      sum: t('grid.agg.sum'),
      avg: t('grid.agg.avg'),
      min: t('grid.agg.min'),
      max: t('grid.agg.max'),
      count: t('grid.agg.count'),
    },
    groupsShown: (groups, total) => t('grid.groups_shown', { groups, total }),
    expandAll: t('grid.expand_all'),
    collapseAll: t('grid.collapse_all'),
    chipGroup: t('grid.chip_group'),
    chipSearch: t('grid.chip_search'),
    chipFrom: (v) => t('grid.chip_from', { v }),
    chipTo: (v) => t('grid.chip_to', { v }),
    chipSince: (v) => t('grid.chip_since', { v }),
    chipUntil: (v) => t('grid.chip_until', { v }),
    chipMore: (n) => t('grid.chip_more', { n }),
    chipAll: t('grid.chip_all'),
    chipMatch: (q) => t('grid.chip_match', { q }),
    chipExcept: (v) => t('grid.chip_except', { v }),
    chipExceptMatch: (q) => t('grid.chip_except_match', { q }),
    ungroup: t('grid.ungroup'),
    clearSearch: t('grid.clear_search'),
    removeFilter: t('grid.remove_filter'),
    resetAll: t('grid.reset_all'),
    excel: t('grid.excel'),
    excelHint: t('grid.excel_hint'),
  };
}

export function useGridLabels(count: CountKey = 'grid.count'): GridLabels {
  const t = useT();
  return useMemo(() => gridLabels(t, count), [t, count]);
}
