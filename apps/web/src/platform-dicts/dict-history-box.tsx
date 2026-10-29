'use client';

import type { AdminValueDict } from '@buhuchet/domain';
import { Box, Timeline } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../l10n/provider';
import { dictHistoryItem } from './dict-history';
import { pdictsHistoryQuery } from './pdicts-data';

/**
 * «История изменений · N» под списком справочника (прототип pdHistHtml): последние записи, сначала
 * новые — что изменено словами и кто. Пока изменений нет, блока нет.
 */
export function DictHistory({ dict }: { dict: AdminValueDict }) {
  const t = useT();
  const history = useQuery(pdictsHistoryQuery(dict));
  if (!history.data?.total) return null;
  const title = t('pdicts.hist.title', { n: history.data.total });
  return (
    <div data-pdicts-history>
      <Box title={title}>
        <Timeline
          items={history.data.items.map((h) => dictHistoryItem(dict, h, t))}
          label={title}
        />
      </Box>
    </div>
  );
}
