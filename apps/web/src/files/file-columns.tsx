'use client';

import {
  bishkekDate,
  FILE_KIND_ICONS,
  fileTypeLabel,
  formatDateRu,
  formatMomentRu,
  isFileSourceKind,
  type ListSort,
  type UiTextKey,
} from '@buhuchet/domain';
import type { FileManagerRow } from '@buhuchet/shared';
import { Icon, Tag, type GridAudit, type GridColumn, type IconName } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { fileSizeText } from './files-data';

/** По умолчанию — новые сверху по дате загрузки (прототип: `sort: {key: 'date', dir: -1}`). */
export const FILE_DEFAULT_SORT: ListSort = { key: 'date', dir: 'desc' };

/**
 * Видимые по умолчанию — как в ТЗ «Столбцы, видимые по умолчанию»: название, контрагент, источник, кто
 * загрузил, дата; тип, размер, описание и «Откуда» — в меню «Столбцы».
 */
export const FILE_DEFAULT_VISIBLE = ['name', 'src', 'cp', 'date', 'by'];

/** Вид источника словами: «Задача», «Загружен вручную». */
export function fileKindText(t: Translate, kind: string): string {
  return isFileSourceKind(kind) ? t(`files.kind.${kind}` as UiTextKey) : kind;
}

/** Значок вида источника (прототип `FKIND`). */
export function fileKindIcon(kind: string): IconName {
  return (isFileSourceKind(kind) ? FILE_KIND_ICONS[kind] : 'file') as IconName;
}

/** «Тип» файла: «PDF», без расширения — «ФАЙЛ». */
export const fileTypeText = (t: Translate, name: string) =>
  fileTypeLabel(name) ?? t('files.no_ext');

const dateOf = (iso: string) => formatDateRu(bishkekDate(new Date(iso)));

/**
 * Столбцы Файлового менеджера — как в прототипе (modules/files.js, `renderFiles`), ключи — как на
 * сервере. У общего файла «Контрагент» — серым «общий файл».
 */
export function fileColumns(t: Translate): GridColumn<FileManagerRow>[] {
  return [
    {
      key: 'name',
      label: t('files.col.name'),
      type: 'text',
      width: 320,
      text: (r) => r.name,
      cell: (r) => (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon name="file" size="sm" className="shrink-0 text-muted" />
          <span className="truncate font-semibold">{r.name}</span>
        </span>
      ),
    },
    {
      key: 'ext',
      label: t('files.col.ext'),
      type: 'enum',
      width: 80,
      text: (r) => fileTypeText(t, r.name),
    },
    {
      key: 'kind',
      label: t('files.col.kind'),
      type: 'enum',
      width: 170,
      text: (r) => fileKindText(t, r.kind),
      cell: (r) => <Tag icon={fileKindIcon(r.kind)}>{fileKindText(t, r.kind)}</Tag>,
    },
    { key: 'src', label: t('files.col.src'), type: 'text', width: 280, text: (r) => r.source },
    {
      key: 'cp',
      label: t('files.col.cp'),
      type: 'enum',
      width: 210,
      text: (r) => r.contractor?.name ?? t('files.cp.general'),
      cell: (r) =>
        r.contractor ? (
          r.contractor.name
        ) : (
          <span className="text-faint">{t('files.cp.general')}</span>
        ),
    },
    {
      key: 'date',
      label: t('files.col.date'),
      type: 'date',
      width: 110,
      text: (r) => dateOf(r.uploadedAt),
    },
    {
      key: 'size',
      label: t('files.col.size'),
      type: 'int',
      width: 100,
      text: (r) => fileSizeText(t, r.size),
      total: (value) => fileSizeText(t, value),
    },
    {
      key: 'by',
      label: t('files.col.by'),
      type: 'enum',
      width: 130,
      text: (r) => r.uploadedBy ?? '',
    },
    {
      key: 'desc',
      label: t('files.col.desc'),
      type: 'text',
      width: 220,
      text: (r) => r.note ?? '',
    },
  ];
}

const moment = (iso: string) => formatMomentRu(new Date(iso));

/** Служебные столбцы: «Создал» и «Изменил» — кто загрузил (прототип: `audit: x => … _cb: x.by`). */
export const FILE_AUDIT: GridAudit<FileManagerRow> = {
  createdBy: (r) => r.audit.createdBy ?? '',
  updatedBy: (r) => r.audit.updatedBy ?? r.audit.createdBy ?? '',
  createdAt: (r) => moment(r.audit.createdAt),
  updatedAt: (r) => moment(r.audit.updatedAt),
};
