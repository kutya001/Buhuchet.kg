'use client';

import { bishkekDate, formatDateRu, type AdminFileState, type ListSort } from '@buhuchet/domain';
import type { AdminStorageFile } from '@buhuchet/shared';
import { Icon, MONO_CLASS, Pill, type GridColumn, type IconName } from '@buhuchet/ui';
import { fileTypeText } from '../files/file-columns';
import { fileSizeText } from '../files/files-data';
import type { Translate } from '../l10n/translate';

/** Цвет и значок «Состояния» (прототип `AF_ST`). */
const ST_PILL: Readonly<
  Record<AdminFileState, { tone: 'ok' | 'info' | 'warn' | 'bad'; icon: IconName }>
> = {
  ready: { tone: 'ok', icon: 'check' },
  new: { tone: 'info', icon: 'clip' },
  rejected: { tone: 'warn', icon: 'ban' },
  trash: { tone: 'bad', icon: 'trash' },
};

export function StoragePill({ t, state }: { t: Translate; state: AdminFileState }) {
  return (
    <Pill tone={ST_PILL[state].tone} icon={ST_PILL[state].icon}>
      {t(`afiles.st.${state}`)}
    </Pill>
  );
}

/** Сначала новые (прототип `sort: {key: 'at', dir: -1}`). */
export const STORAGE_SORT: ListSort = { key: 'at', dir: 'desc' };

/** Видимые по умолчанию: «Запись» и «Примечание» прототип прячет (`hide: true`), ИНН — в фильтре контрагента. */
export const STORAGE_VISIBLE = ['name', 'org', 'cp', 'src', 'by', 'at', 'size', 'type', 'st'];
export const ORG_STORAGE_VISIBLE = STORAGE_VISIBLE.filter((k) => k !== 'org');

const DASH = <span className="text-faint">—</span>;

/**
 * Столбцы «Всех файлов» (прототип `afCols`); ключи — как на сервере. `noOrg` — в карточке организации
 * столбца «Организация» нет.
 */
export function storageColumns(t: Translate, noOrg = false): GridColumn<AdminStorageFile>[] {
  return [
    {
      key: 'name',
      label: t('afiles.col.name'),
      type: 'text',
      width: 300,
      text: (r) => r.name,
      cell: (r) => (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon name="file" size="sm" className="flex-none text-muted" />
          <span className="font-semibold">{r.name}</span>
        </span>
      ),
    },
    ...(noOrg
      ? []
      : [
          {
            key: 'org',
            label: t('afiles.col.org'),
            type: 'enum' as const,
            width: 220,
            text: (r: AdminStorageFile) => r.orgText ?? '',
          },
        ]),
    {
      key: 'cp',
      label: t('afiles.col.cp'),
      type: 'enum',
      width: 210,
      text: (r) => r.cpName ?? '',
      cell: (r) => (r.cpName ? r.cpName : DASH),
    },
    {
      key: 'inn',
      label: t('afiles.col.inn'),
      type: 'text',
      width: 140,
      text: (r) => r.cpInn ?? '',
      className: MONO_CLASS,
    },
    { key: 'src', label: t('afiles.col.src'), type: 'enum', width: 220, text: (r) => r.srcText },
    { key: 'by', label: t('afiles.col.by'), type: 'enum', width: 170, text: (r) => r.byText },
    {
      key: 'at',
      label: t('afiles.col.at'),
      type: 'date',
      width: 110,
      text: (r) => formatDateRu(bishkekDate(new Date(r.at))),
      className: 'tabular-nums',
    },
    {
      key: 'size',
      label: t('afiles.col.size'),
      type: 'int',
      width: 100,
      numeric: true,
      text: (r) => fileSizeText(t, r.sizeBytes),
      total: (n) => fileSizeText(t, n),
    },
    {
      key: 'type',
      label: t('afiles.col.type'),
      type: 'enum',
      width: 80,
      text: (r) => fileTypeText(t, r.name),
    },
    {
      key: 'st',
      label: t('afiles.col.st'),
      type: 'enum',
      width: 190,
      text: (r) => t(`afiles.st.${r.state}`),
      cell: (r) => <StoragePill t={t} state={r.state} />,
    },
    {
      key: 'note',
      label: t('afiles.col.note'),
      type: 'text',
      width: 220,
      text: (r) => r.note ?? '',
    },
  ];
}
