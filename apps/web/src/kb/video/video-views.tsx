'use client';

import { pluralForm, videoTime, type ListFilterValue, type ListSort } from '@buhuchet/domain';
import { ListValues, VideoViewHistory, VideoViewList, type VideoViewRow } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  DataGrid,
  EmptyState,
  Hint,
  MiniTable,
  Modal,
  Note,
  Plate,
  Plates,
  useWindow,
  type ActionEntry,
  type GridColumn,
  type PlateProps,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api, apiFailure } from '../../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../../dialog-slot';
import { useT } from '../../l10n/provider';
import type { Translate } from '../../l10n/translate';
import { useListExport } from '../../lists/export';
import { useGridLabels } from '../../lists/grid-labels';
import { usePresetFilters } from '../../lists/preset';
import { useModuleStats } from '../../lists/stats';
import { useListPage, type FetchListPage } from '../../lists/use-list-page';
import { useViewSettings } from '../../lists/view-settings';
import { useShell } from '../../shell/context';
import { bishkekDateTime, bishkekDay, VideoStatusPill } from './video-parts';

/** Недавно смотревшие сверху (прототип `sort:{key:'last',dir:-1}`). */
const DEFAULT_SORT: ListSort = { key: 'last', dir: 'desc' };
const ORG_VISIBLE = [
  'fullName',
  'role',
  'video',
  'module',
  'duration',
  'seen',
  'status',
  'opens',
  'first',
  'last',
];
const ADMIN_VISIBLE = ['org', ...ORG_VISIBLE];

type Filters = Readonly<Record<string, ListFilterValue>>;
type ViewStatus = VideoViewRow['status'];

export function viewColumns(t: Translate, admin: boolean): GridColumn<VideoViewRow>[] {
  return [
    ...(admin
      ? [
          {
            key: 'org',
            label: t('video.col.org'),
            type: 'enum',
            width: 230,
            text: (r) => r.orgName,
          } satisfies GridColumn<VideoViewRow>,
        ]
      : []),
    {
      key: 'fullName',
      label: t('video.col.full_name'),
      type: 'text',
      width: 250,
      text: (r) => r.fullName,
      cell: (r) => <span className="truncate font-semibold">{r.fullName}</span>,
    },
    { key: 'role', label: t('video.col.role'), type: 'enum', width: 170, text: (r) => r.role },
    {
      key: 'video',
      label: t('video.col.video'),
      type: 'enum',
      width: 280,
      text: (r) => r.videoTitle,
    },
    {
      key: 'module',
      label: t('video.col.module'),
      type: 'enum',
      width: 200,
      text: (r) => r.moduleTitle,
    },
    {
      key: 'duration',
      label: t('video.col.duration'),
      type: 'text',
      width: 120,
      text: (r) => videoTime(r.duration),
    },
    {
      key: 'seen',
      label: t('video.col.seen_secs'),
      type: 'text',
      width: 150,
      text: (r) => `${videoTime(r.secs)} · ${r.pct} %`,
    },
    {
      key: 'status',
      label: t('video.col.status'),
      type: 'enum',
      width: 150,
      text: (r) => t(`video.view.${r.status}`),
      cell: (r) => <VideoStatusPill status={r.status} />,
    },
    {
      key: 'opens',
      label: t('video.col.opens'),
      type: 'int',
      width: 130,
      text: (r) => String(r.opens),
    },
    {
      key: 'first',
      label: t('video.col.first'),
      type: 'date',
      width: 150,
      text: (r) => (r.firstAt ? bishkekDay(r.firstAt) : ''),
    },
    {
      key: 'last',
      label: t('video.col.last'),
      type: 'text',
      width: 170,
      text: (r) => (r.lastAt ? bishkekDateTime(r.lastAt) : ''),
    },
  ];
}

const fetchOrgViews: FetchListPage<VideoViewRow> = async (params) => {
  const res = await api.api.kb['video-views'].$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return VideoViewList.parse(await res.json());
};

const fetchAdminViews: FetchListPage<VideoViewRow> = async (params) => {
  const res = await api.api.admin['video-views'].$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return VideoViewList.parse(await res.json());
};

const fetchOrgValues = async (col: string, q?: string) => {
  const res = await api.api.kb['video-views'].values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

const fetchAdminValues = async (col: string, q?: string) => {
  const res = await api.api.admin['video-views'].values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

const PLATES: readonly {
  status: ViewStatus;
  icon: PlateProps['icon'];
  color: PlateProps['color'];
}[] = [
  { status: 'none', icon: 'eyeoff', color: 'red' },
  { status: 'started', icon: 'half', color: 'yellow' },
  { status: 'done', icon: 'ok', color: 'green' },
];

/**
 * «Просмотры видео» (прототип v79 `renderKbVViews`): строка — сотрудник и доступная ему
 * видеоинструкция, в том числе ещё не открытая; сводка над списком и плашки «Не смотрел», «Начал»,
 * «Просмотрено» (ставят фильтр по статусу); строка открывает «Историю просмотров». В Базе знаний —
 * своя организация (владелец и право «Видеть уровни сотрудников»), в Админке — все организации,
 * «Сводка по видео» и «Гости лендинга».
 */
export function VideoViewsTab({ admin }: { admin: boolean }) {
  const t = useT();
  const labels = useGridLabels('video.views.count');
  const gridKey = admin ? 'kbadm.vviews' : 'kb.vviews';
  const view = useViewSettings(gridKey);
  const stats = useModuleStats(admin ? 'kbadm' : 'kb');
  const { search, clearSearch, access } = useShell();
  const allowed = admin || access.can('kbLevels');
  const preset = usePresetFilters(admin ? 'kbadm' : 'kb', 'vviews');
  const columns = useMemo(() => viewColumns(t, admin), [t, admin]);
  const visibleByDefault = admin ? ADMIN_VISIBLE : ORG_VISIBLE;
  const list = useListPage({
    gridKey,
    columns,
    audit: false,
    defaultVisible: visibleByDefault,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready && allowed,
    fetchPage: admin ? fetchAdminViews : fetchOrgViews,
    ...(preset ? { initialFilters: preset } : {}),
  });
  const { params, visible, filters, setFilters } = list;
  const sendExport = useCallback(
    () =>
      admin
        ? api.api.admin['video-views'].export.$get({
            query: { ...params, cols: visible.join(',') },
          })
        : api.api.kb['video-views'].export.$get({
            query: { ...params, cols: visible.join(',') },
          }),
    [admin, params, visible],
  );
  const exporter = useListExport(sendExport);
  const [history, setHistory] = useState<DialogSlot<VideoViewRow> | null>(null);
  const actions = useCallback(
    (r: VideoViewRow): ActionEntry[] => [
      {
        id: 'history',
        label: t('video.views.history'),
        icon: 'history',
        run: () => setHistory(openSlot(r)),
      },
    ],
    [t],
  );

  if (!allowed) {
    return (
      <EmptyState
        icon="lock"
        title={t('video.views.no_access')}
        text={t('video.views.no_access_text')}
      />
    );
  }
  const data = list.data as VideoViewList | undefined;
  const s = data?.stats;
  const statusVal = (status: ViewStatus) => t(`video.view.${status}`);
  const plateOn = (f: Filters, status: ViewStatus) => {
    const x = f.status;
    return x?.type === 'enum' && x.vals.length === 1 && x.vals[0] === statusVal(status);
  };

  return (
    <div className="flex flex-col gap-3.5" data-video-views={admin ? 'admin' : 'org'}>
      {admin ? <Note>{t('video.views.admin_note')}</Note> : null}
      {s ? (
        <div className="vv-st">
          <span>
            {t('video.views.videos')} <b>{s.videos}</b>
          </span>
          <span>
            {t('video.views.done_pct')} <b>{s.donePct} %</b>
          </span>
          <span>
            {t('video.views.idle')} <b>{s.idle}</b> {t(`video.views.idle.${pluralForm(s.idle)}`)}
          </span>
        </div>
      ) : null}
      {s && stats.shown ? (
        <Plates>
          {PLATES.map((p) => {
            const on = plateOn(filters, p.status);
            return (
              <Plate
                key={p.status}
                id={`vv-${p.status}`}
                icon={p.icon}
                color={p.color}
                label={statusVal(p.status)}
                value={String(s[p.status])}
                sub={t(`video.views.${p.status}_sub`)}
                on={on}
                onClick={() =>
                  setFilters(on ? {} : { status: { type: 'enum', vals: [statusVal(p.status)] } })
                }
              />
            );
          })}
        </Plates>
      ) : null}
      <DataGrid
        columns={columns}
        defaultVisible={visibleByDefault}
        defaultSort={DEFAULT_SORT}
        settings={view.settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? list.data : undefined}
        onPageChange={list.setPage}
        error={list.error}
        errorText={list.errorText}
        errorTextOf={list.errorTextOf}
        onRetry={list.retry}
        filters={filters}
        onFiltersChange={setFilters}
        loadValues={admin ? fetchAdminValues : fetchOrgValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={admin || access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={<EmptyState icon="film" title={t('grid.empty')} />}
        rowKey={(r) => r.id}
        titleKey="fullName"
        label={t(admin ? 'tab.kbadm.vviews' : 'tab.kb.vviews')}
        labels={labels}
        actions={actions}
        onOpen={(r) => setHistory(openSlot(r))}
      />
      {admin && data ? <AdminSummary list={data} /> : null}
      {history ? (
        <ViewHistoryDialog
          key={`video-history-${history.n}`}
          row={history.data}
          admin={admin}
          open={history.open}
          onClose={() => setHistory(closeSlot)}
        />
      ) : null}
    </div>
  );
}

/** «Сводка по видео» и «Гости лендинга» под списком Админки (прототип `vidAdmSum`). */
function AdminSummary({ list }: { list: VideoViewList }) {
  const t = useT();
  const summary = list.summary ?? [];
  const guests = (list.guests ?? []).filter((g) => g.starts > 0);
  if (!summary.length && !guests.length) return null;
  return (
    <>
      {summary.length ? (
        <Box title={t('video.sum.title')}>
          <MiniTable
            label={t('video.sum.title')}
            empty=""
            phoneCards={false}
            columns={[
              { key: 'video', label: t('video.sum.col.video') },
              { key: 'kind', label: t('video.sum.col.kind') },
              { key: 'orgs', label: t('video.sum.col.orgs'), numeric: true },
              { key: 'viewers', label: t('video.sum.col.viewers'), numeric: true },
              { key: 'done', label: t('video.sum.col.done'), numeric: true },
              { key: 'avg', label: t('video.sum.col.avg'), numeric: true },
            ]}
            rows={summary.map((x) => ({
              key: x.videoId,
              cells: {
                video: (
                  <>
                    {x.title}
                    {x.deleted ? <span className="text-faint">{t('video.deleted')}</span> : null}
                  </>
                ),
                kind: t(`video.kind.${x.kind}`),
                orgs: x.orgs,
                viewers: x.viewers,
                done: x.done,
                avg: `${x.avgPct} %`,
              },
            }))}
          />
          <Hint>{t('video.sum.hint')}</Hint>
        </Box>
      ) : null}
      {guests.length ? (
        <Box title={t('video.guests.title')}>
          <MiniTable
            label={t('video.guests.title')}
            empty=""
            phoneCards={false}
            columns={[
              { key: 'video', label: t('video.sum.col.video') },
              { key: 'starts', label: t('video.guests.col.starts'), numeric: true },
              { key: 'avg', label: t('video.guests.col.avg'), numeric: true },
            ]}
            rows={guests.map((g) => ({
              key: g.videoId,
              cells: { video: g.title, starts: g.starts, avg: `${g.avgPct} %` },
            }))}
          />
          <Hint>{t('video.guests.hint')}</Hint>
        </Box>
      ) : null}
    </>
  );
}

async function fetchHistory(admin: boolean, userId: string, videoId: string) {
  const param = { param: { userId, videoId } };
  const res = admin
    ? await api.api.admin['video-views'][':userId'][':videoId'].$get(param)
    : await api.api.kb['video-views'][':userId'][':videoId'].$get(param);
  if (!res.ok) throw await apiFailure(res);
  return VideoViewHistory.parse(await res.json());
}

/**
 * «История просмотров» сотрудника по видео (прототип `vidHistDlg`, только просмотр): полоса
 * просмотренных секунд и открытия — когда, с какой по какую секунду, сколько проигралось.
 */
function ViewHistoryDialog({
  row,
  admin,
  open,
  onClose,
}: {
  row: VideoViewRow;
  admin: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const query = useQuery({
    queryKey: ['kb', 'video-views', admin ? 'admin' : 'org', row.userId, row.videoId],
    queryFn: () => fetchHistory(admin, row.userId, row.videoId),
  });
  const h = query.data;
  const dur = h?.duration ?? row.duration;
  const sub = `${row.videoTitle} · ${videoTime(dur)}${row.orgName ? ` · ${row.orgName}` : ''}`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={row.fullName}
      sub={sub}
      footer={<HistoryFooter />}
    >
      {h ? (
        <>
          <Box>
            <div className="flex flex-wrap items-center gap-2.5">
              <VideoStatusPill status={h.status} />
              <span className="min-w-0 flex-1 text-muted">
                {t('video.views.seen_of', {
                  secs: videoTime(h.secs),
                  dur: videoTime(dur),
                  pct: h.pct,
                })}
                {h.doneAt ? t('video.views.done_at', { at: bishkekDateTime(h.doneAt) }) : ''}
              </span>
            </div>
            <span className="vprog wide">
              <span className="bar vbar" aria-hidden="true">
                {h.segs.map((s, i) => (
                  <i
                    key={i}
                    style={{
                      left: `${((s[0] / (dur || 1)) * 100).toFixed(2)}%`,
                      width: `${(((s[1] - s[0]) / (dur || 1)) * 100).toFixed(2)}%`,
                    }}
                  />
                ))}
              </span>
            </span>
            <Hint>{t('video.views.bar_hint')}</Hint>
          </Box>
          {h.sessions.length ? (
            <>
              <MiniTable
                label={t('video.views.history')}
                empty=""
                columns={[
                  { key: 'at', label: t('video.views.col.at') },
                  { key: 'range', label: t('video.views.col.range') },
                  { key: 'played', label: t('video.views.col.played'), numeric: true },
                ]}
                rows={h.sessions.map((x, i) => ({
                  key: `${x.at}-${i}`,
                  cells: {
                    at: bishkekDateTime(x.at),
                    range: x.segs.length ? (
                      x.segs.map((p) => `${videoTime(p[0])}–${videoTime(p[1])}`).join(', ')
                    ) : (
                      <span className="text-faint">{t('video.views.no_play')}</span>
                    ),
                    played: videoTime(x.secs),
                  },
                }))}
              />
              <Hint>{t('video.views.many_hint')}</Hint>
            </>
          ) : (
            <EmptyState
              icon="film"
              title={t('video.views.never.title')}
              text={t('video.views.never.text')}
            />
          )}
        </>
      ) : null}
    </Modal>
  );
}

function HistoryFooter() {
  const t = useT();
  const { close } = useWindow();
  return (
    <>
      <div className="flex-1" />
      <button type="button" className={buttonClass('cta')} onClick={close}>
        {t('video.views.done')}
      </button>
    </>
  );
}
