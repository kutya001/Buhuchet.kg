'use client';

import { Box, Timeline } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useT } from '../l10n/provider';
import { dictHistoryItem } from './dict-history';
import {
  pdictsBasesQuery,
  pdictsHistoryQuery,
  pdictsOrgansQuery,
  pdictsPermissionsQuery,
  pdictsRegimesQuery,
  type HistoryDict,
} from './pdicts-data';

/**
 * «История изменений · N» под списком справочника (прототип pdHistHtml): последние записи, сначала
 * новые — что изменено словами и кто. Пока изменений нет, блока нет. У видов отчётов коды органов,
 * режимов и оснований — названиями, у шаблонов ролей — права.
 */
export function DictHistory({ dict }: { dict: HistoryDict }) {
  const t = useT();
  const history = useQuery(pdictsHistoryQuery(dict));
  const types = dict === 'types';
  const organs = useQuery({ ...pdictsOrgansQuery, enabled: types });
  const regimes = useQuery({ ...pdictsRegimesQuery, enabled: types });
  const bases = useQuery({ ...pdictsBasesQuery, enabled: types });
  const perms = useQuery({ ...pdictsPermissionsQuery, enabled: dict === 'roletpl' });
  const names = useMemo(
    () =>
      new Map([
        ...[...(organs.data ?? []), ...(regimes.data ?? []), ...(bases.data ?? [])].map(
          (x) => [x.code, x.name] as const,
        ),
        ...(perms.data ?? []).map((p) => [p.id, p.name] as const),
      ]),
    [organs.data, regimes.data, bases.data, perms.data],
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
