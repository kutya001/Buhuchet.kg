'use client';

import type { AdminValueDict } from '@buhuchet/domain';
import { Box, Timeline } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useT } from '../l10n/provider';
import { dictHistoryItem } from './dict-history';
import {
  pdictsBasesQuery,
  pdictsHistoryQuery,
  pdictsOrgansQuery,
  pdictsRegimesQuery,
} from './pdicts-data';

/**
 * «История изменений · N» под списком справочника (прототип pdHistHtml): последние записи, сначала
 * новые — что изменено словами и кто. Пока изменений нет, блока нет. У видов отчётов коды органов,
 * режимов и оснований — названиями.
 */
export function DictHistory({ dict }: { dict: AdminValueDict | 'calendar' }) {
  const t = useT();
  const history = useQuery(pdictsHistoryQuery(dict));
  const types = dict === 'types';
  const organs = useQuery({ ...pdictsOrgansQuery, enabled: types });
  const regimes = useQuery({ ...pdictsRegimesQuery, enabled: types });
  const bases = useQuery({ ...pdictsBasesQuery, enabled: types });
  const names = useMemo(
    () =>
      new Map(
        [...(organs.data ?? []), ...(regimes.data ?? []), ...(bases.data ?? [])].map((x) => [
          x.code,
          x.name,
        ]),
      ),
    [organs.data, regimes.data, bases.data],
  );
  if (!history.data?.total) return null;
  const title = t('pdicts.hist.title', { n: history.data.total });
  return (
    <div data-pdicts-history>
      <Box title={title}>
        <Timeline
          items={history.data.items.map((h) => dictHistoryItem(dict, h, t, names))}
          label={title}
        />
      </Box>
    </div>
  );
}
