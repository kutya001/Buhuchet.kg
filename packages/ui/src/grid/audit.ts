import type { ListColumnType } from '@buhuchet/domain';
import type { GridAudit, GridColumn, GridLabels } from './types';

/** Ключи служебных столбцов — те же у столбцов списка на сервере. */
export const AUDIT_KEYS = ['createdBy', 'updatedBy', 'createdAt', 'updatedAt'] as const;

/** Ключи и типы служебных столбцов — для запроса страницы (поиск по видимым, итоги групп). */
export const AUDIT_COLUMNS: readonly { key: (typeof AUDIT_KEYS)[number]; type: ListColumnType }[] =
  [
    { key: 'createdBy', type: 'enum' },
    { key: 'updatedBy', type: 'enum' },
    { key: 'createdAt', type: 'datetime' },
    { key: 'updatedAt', type: 'datetime' },
  ];

/**
 * Служебные столбцы списка (прототип ui/grid.js, `auditCols`; ТЗ «Списки записей» → «Столбцы»):
 * «Создал», «Изменил», «Создано», «Изменено» — в конце списка, скрыты по умолчанию, в меню «Столбцы»
 * помечены «системный». Их добавляет сам список, чтобы ни один экран их не забыл.
 */
export function auditColumns<Row>(audit: GridAudit<Row>, labels: GridLabels): GridColumn<Row>[] {
  return [
    {
      key: 'createdBy',
      label: labels.createdBy,
      type: 'enum',
      width: 136,
      audit: 'created',
      text: audit.createdBy,
    },
    {
      key: 'updatedBy',
      label: labels.updatedBy,
      type: 'enum',
      width: 136,
      audit: 'updated',
      text: audit.updatedBy,
    },
    {
      key: 'createdAt',
      label: labels.createdAt,
      type: 'datetime',
      width: 146,
      audit: 'created',
      text: audit.createdAt,
    },
    {
      key: 'updatedAt',
      label: labels.updatedAt,
      type: 'datetime',
      width: 146,
      audit: 'updated',
      text: audit.updatedAt,
    },
  ];
}
