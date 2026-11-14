'use client';

import { SearchSelect, type SearchSelectOption, type SearchSelectProps } from '@buhuchet/ui';
import { useMemo } from 'react';
import { useT } from '../l10n/provider';

/** Контрагент в списке формы: название (или своя подпись — «… · разовый») и ИНН для поиска. */
export interface ContractorOption {
  id: string;
  name: string;
  inn: string;
  /** Подпись строки вместо названия. */
  label?: string;
}

/**
 * Поле «Контрагент» всех форм (доработки 13.11, задача И3; прототип v93, `cpSel`): общий список с
 * поиском по названию и ИНН. Тексты — из словаря; остальные свойства (id и aria от `Field`,
 * data-атрибуты формы) уходят кнопке поля.
 */
export function ContractorSelect({
  contractors,
  ...rest
}: Omit<SearchSelectProps, 'options' | 'labels'> & { contractors: readonly ContractorOption[] }) {
  const t = useT();
  const options = useMemo<SearchSelectOption[]>(
    () => contractors.map((c) => ({ value: c.id, label: c.label ?? c.name, hint: c.inn })),
    [contractors],
  );
  const labels = useMemo(
    () => ({
      placeholder: t('cpsel.placeholder'),
      search: t('cpsel.search'),
      nothing: t('cpsel.nothing'),
      more: (shown: number, total: number) => t('cpsel.more', { shown, total }),
    }),
    [t],
  );
  return <SearchSelect {...rest} options={options} labels={labels} />;
}
