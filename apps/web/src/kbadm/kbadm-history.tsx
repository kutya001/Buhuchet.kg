'use client';

import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  kbHistoryLine,
  type KbHistorySection,
} from '@buhuchet/domain';
import { Box, Timeline } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../l10n/provider';
import { kbAdminHistoryQuery, kbAdminMetaQuery } from './kbadm-data';

/**
 * «История изменений · N» под вкладкой (прототип pdHistHtml('steps' | 'arts' | 'levels')): последние
 * записи, сначала новые — словами прототипа и кто. Пока изменений нет, блока нет.
 */
export function KbAdmHistory({ section }: { section: KbHistorySection }) {
  const t = useT();
  const history = useQuery(kbAdminHistoryQuery(section));
  const meta = useQuery({ ...kbAdminMetaQuery, enabled: section === 'kbsteps' }).data;
  if (!history.data?.total) return null;
  const admin = new Set((meta?.groups ?? []).filter((g) => g.adm).map((g) => g.id));
  const title = t('pdicts.hist.title', { n: history.data.total });
  const items = history.data.items.map((h) => {
    const at = new Date(h.at);
    const line = kbHistoryLine(h, t, (g) => admin.has(g));
    return {
      id: h.id,
      date: formatDateRu(bishkekDate(at)),
      time: bishkekTime(at),
      text: t(line.key, line.params),
      who: h.actor ?? t('org.history.system'),
    };
  });
  return (
    <div data-kbadm-history={section}>
      <Box title={title}>
        <Timeline items={items} label={title} />
      </Box>
    </div>
  );
}
