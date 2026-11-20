'use client';

import { formatCount } from '@buhuchet/domain';
import type { AdminStorageFile } from '@buhuchet/shared';
import { Box, DataGrid, EmptyState, Hint, MiniTable, Note } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useCardList } from '../admin/org-card-lists';
import type { Translate } from '../l10n/translate';
import { useGridLabels } from '../lists/grid-labels';
import { useStorageFileActions } from './afiles-actions';
import { ORG_STORAGE_VISIBLE, STORAGE_SORT, storageColumns } from './afiles-columns';
import {
  fetchStorageFiles,
  fetchStorageFileValues,
  ORG_FILES_GRID_KEY,
  orgFilesQuery,
  sendStorageFilesExport,
} from './afiles-data';
import { categoryRows, mbText, memoryBar, pctClass, viewerIdOf } from './afiles-model';

/**
 * Вкладка «Файлы» карточки организации в Админке (пакет 2, блок 4; прототип `ocFilesTab`,
 * `afMemBar`, `ocFilesGrids`; этап 1, П5, поток И): «Память организации» (занято из предела подписки),
 * «Объём по категориям» и все файлы организации с удалёнными до стирания — только просмотр и
 * скачивание: файлы меняет сама организация.
 */
export function OrgFilesTab({ t, orgId }: { t: Translate; orgId: string }) {
  const usage = useQuery(orgFilesQuery(orgId));
  const labels = useGridLabels('afiles.count');
  const columns = useMemo(() => storageColumns(t, true), [t]);
  const fetchPage = useMemo(() => fetchStorageFiles(orgId), [orgId]);
  const loadValues = useMemo(() => fetchStorageFileValues(orgId), [orgId]);
  const sendExport = useCallback(
    (query: Record<string, string>) => sendStorageFilesExport(orgId, query),
    [orgId],
  );
  const grid = useCardList<AdminStorageFile>({
    gridKey: ORG_FILES_GRID_KEY,
    columns,
    defaultVisible: ORG_STORAGE_VISIBLE,
    defaultSort: STORAGE_SORT,
    fetchPage,
    sendExport,
  });
  const files = useStorageFileActions({ inCard: true });
  const rows = grid.data?.items ?? [];
  const u = usage.data;
  const bar = u ? memoryBar(t, u) : null;
  return (
    <>
      {usage.isError ? <Note tone="bad">{t('afiles.load_error')}</Note> : null}
      {u && bar ? (
        <div data-org-files-mem="">
          <Box>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="m-0 text-[13.5px] font-[650] text-muted">{t('afiles.mem.title')}</h3>
              <span className="font-semibold text-ink">{bar.used}</span>
              {bar.pct ? <span className={pctClass(u.pct) || 'text-muted'}>{bar.pct}</span> : null}
            </div>
            {bar.width !== null ? (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(bar.width)}
                aria-label={t('afiles.mem.title')}
                className="mt-2 mb-1 h-2 overflow-hidden rounded-full bg-pane-alt shadow-[inset_0_0_0_1px_var(--bu-border)]"
              >
                <i
                  className={`block h-full rounded-full ${u.pct !== null && u.pct >= 100 ? 'bg-danger' : u.pct !== null && u.pct >= 80 ? 'bg-warn' : 'bg-ok'}`}
                  style={{ width: `${bar.width}%` }}
                />
              </div>
            ) : null}
            <Hint>{bar.hint}</Hint>
          </Box>
        </div>
      ) : null}
      <Box title={t('afiles.cats.title')}>
        <div data-org-files-cats="">
          {u ? (
            <MiniTable
              label={t('afiles.cats.title')}
              columns={[
                { key: 'src', label: t('afiles.cats.col.src') },
                { key: 'n', label: t('afiles.cats.col.n'), numeric: true, width: 110 },
                { key: 'mb', label: t('afiles.cats.col.mb'), numeric: true, width: 130 },
              ]}
              rows={categoryRows(u.categories).map((k) => ({
                key: k.src,
                cells: {
                  src: t(`afiles.src.${k.src}` as 'afiles.src.card'),
                  n: formatCount(k.n),
                  mb: mbText(k.bytes),
                },
              }))}
              empty={t('afiles.empty')}
            />
          ) : null}
        </div>
      </Box>
      <Box title={t('afiles.org.list', { n: formatCount(grid.data?.total ?? 0) })}>
        <div data-org-files="">
          <DataGrid<AdminStorageFile>
            {...grid}
            loadValues={loadValues}
            empty={<EmptyState icon="folder" title={t('afiles.empty')} />}
            rowKey={viewerIdOf}
            titleKey="name"
            label={t('orgs.card.tab.files')}
            labels={labels}
            actions={(r) => files.actions(r, rows)}
            onOpen={(r) => files.open(r, rows)}
          />
        </div>
        <Hint>{t('afiles.org.hint')}</Hint>
      </Box>
      {files.node}
    </>
  );
}
