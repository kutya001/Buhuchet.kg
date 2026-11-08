'use client';

import { videoTime, type GridViewSettings, type ListSort } from '@buhuchet/domain';
import { ListValues, VideoList, type VideoItem } from '@buhuchet/shared';
import {
  DataGrid,
  EmptyState,
  Icon,
  Pill,
  Plate,
  Plates,
  Tag,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { api, apiFailure } from '../../api-client';
import { useT } from '../../l10n/provider';
import type { Translate } from '../../l10n/translate';
import { useListExport } from '../../lists/export';
import { useGridLabels } from '../../lists/grid-labels';
import { usePresetFilters } from '../../lists/preset';
import { useModuleStats } from '../../lists/stats';
import { useListPage, type FetchListPage } from '../../lists/use-list-page';
import { useViewSettings } from '../../lists/view-settings';
import { useShell } from '../../shell/context';
import { tabHref } from '../../shell/modules';
import { useCopyText } from './video-copy';
import { bishkekDay, ItemProgress, VideoCover, VideoKindPill } from './video-parts';
import { useVideo } from './video-window';

/** По порядку видео внутри групп модулей (прототип `sort:{key:'ord',dir:1}`). */
const DEFAULT_SORT: ListSort = { key: 'ord', dir: 'asc' };
const DEFAULT_VISIBLE = ['title', 'kind', 'module', 'duration', 'pct', 'published'];
/** Карточками по группам модулей (прототип `defView:'cards', defGroup:['mod']`). */
const DEFAULT_VIEW: GridViewSettings = { view: 'cards', group: ['module'] };

/** Параметр адреса «Скопировать ссылку»: `/app/kb/video?video=<код>` открывает окно видео. */
export const VIDEO_PARAM = 'video';

/** Ссылка на видео: вкладка «Видео» Базы знаний с окном видео (прототип `#video/<код>`). */
export function videoLink(id: string): string {
  return `${window.location.origin}${tabHref('kb', 'video')}?${VIDEO_PARAM}=${encodeURIComponent(id)}`;
}

export function videoTabColumns(t: Translate, tracked: boolean): GridColumn<VideoItem>[] {
  return [
    {
      key: 'title',
      label: t('video.col.title'),
      type: 'text',
      width: 320,
      text: (v) => v.title,
      cell: (v) => (
        <span className="truncate">
          <b className="font-semibold">{v.title}</b>
          {v.isNew ? (
            <>
              {' '}
              <Pill size="sm" tone="bad">
                {t('video.new')}
              </Pill>
            </>
          ) : null}
        </span>
      ),
    },
    {
      key: 'kind',
      label: t('video.col.kind'),
      type: 'enum',
      width: 170,
      text: (v) => t(`video.kind.${v.kind}`),
      cell: (v) => <VideoKindPill kind={v.kind} />,
    },
    {
      key: 'module',
      label: t('video.col.module'),
      type: 'enum',
      width: 230,
      text: (v) => v.moduleTitle,
    },
    {
      key: 'duration',
      label: t('video.col.duration'),
      type: 'text',
      width: 130,
      text: (v) => videoTime(v.duration),
    },
    {
      key: 'pct',
      label: t('video.col.pct'),
      type: 'int',
      width: 150,
      text: (v) => (tracked && v.view ? String(v.view.pct) : ''),
      cell: (v) =>
        !tracked || !v.view ? (
          '—'
        ) : v.view.doneAt ? (
          <span className="inline-flex items-center gap-1 text-ok">
            <Icon name="ok" size="sm" /> {v.view.pct}
          </span>
        ) : (
          String(v.view.pct)
        ),
    },
    {
      key: 'seen',
      label: t('video.col.seen'),
      type: 'enum',
      width: 150,
      text: (v) => (tracked && v.view ? t(`video.view.${v.view.status}`) : '—'),
    },
    {
      key: 'ord',
      label: t('video.col.ord'),
      type: 'int',
      width: 100,
      text: (v) => String(v.ord),
    },
    {
      key: 'published',
      label: t('video.col.published'),
      type: 'date',
      width: 140,
      text: (v) => (v.publishedAt ? bishkekDay(v.publishedAt) : ''),
    },
  ];
}

/** Карточка видео (прототип `vidCardHtml`): обложка во всю ширину, название, вид, модуль, просмотр. */
export function VideoCard({ video: v }: { video: VideoItem }) {
  return (
    <>
      <VideoCover video={v} isNew={v.isNew} className="rounded-none" />
      <span className="vcard-b">
        <b className="vcard-t">{v.title}</b>
        <span className="vcard-m">
          <VideoKindPill kind={v.kind} />
          <Tag>{v.moduleTitle}</Tag>
        </span>
        <ItemProgress video={v} />
      </span>
    </>
  );
}

const fetchVideos: FetchListPage<VideoItem> = async (params) => {
  const res = await api.api.kb.videos.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return VideoList.parse(await res.json());
};

const fetchVideoValues = async (col: string, q?: string) => {
  const res = await api.api.kb.videos.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

/**
 * Ссылка «Скопировать ссылку» (`?video=<код>`): окно видео открывается один раз, адрес — без
 * параметра (прототип `vidRoute`: `#video/<код>` → `#kb.video` и окно видео).
 */
function useVideoLinkParam(open: (id: string) => void) {
  const router = useRouter();
  const href = tabHref('kb', 'video');
  const active = usePathname() === href;
  const id = useSearchParams().get(VIDEO_PARAM);
  const done = useRef(false);
  useEffect(() => {
    if (!active || !id || done.current) return;
    done.current = true;
    router.replace(href, { scroll: false });
    open(id);
  }, [active, id, open, router, href]);
}

/**
 * «База знаний» → «Видео» (прототип v79 `renderKbVideo`): все доступные видео карточками по группам
 * модулей, плашка «Не просмотренные», окно видео по нажатию; «Скопировать ссылку» открывает эту
 * вкладку с окном видео.
 */
export function KbVideoTab() {
  const t = useT();
  const video = useVideo();
  const labels = useGridLabels('video.count');
  const view = useViewSettings('kb.video');
  const stats = useModuleStats('kb');
  const { search, clearSearch, access } = useShell();
  const preset = usePresetFilters('kb', 'video');
  // Своего вида ещё нет — карточками по группам модулей; первая правка сохраняет его целиком.
  const settings = useMemo(
    () => (Object.keys(view.settings).length ? view.settings : { ...DEFAULT_VIEW }),
    [view.settings],
  );
  const draft = useMemo(() => videoTabColumns(t, true), [t]);
  const list = useListPage({
    gridKey: 'kb.video',
    columns: draft,
    audit: false,
    defaultVisible: DEFAULT_VISIBLE,
    settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchVideos,
    ...(preset ? { initialFilters: preset } : {}),
  });
  const data = list.data as VideoList | undefined;
  const tracked = data?.tracked ?? true;
  const columns = useMemo(() => videoTabColumns(t, tracked), [t, tracked]);
  const { params, visible, filters, setFilters } = list;
  const sendExport = useCallback(
    () => api.api.kb.videos.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  useVideoLinkParam(video.open);

  const copier = useCopyText();
  const copyText = copier.copy;
  const copy = useCallback(
    (v: VideoItem) => void copyText(videoLink(v.id), t('video.copied')),
    [copyText, t],
  );
  const actions = useCallback(
    (v: VideoItem): ActionEntry[] => [
      { id: 'watch', label: t('video.watch'), icon: 'play', run: () => video.open(v.id) },
      {
        id: 'copy',
        label: t('video.copy_link'),
        icon: 'link',
        sub: t('video.copy_link_sub'),
        run: () => void copy(v),
      },
    ],
    [t, video, copy],
  );

  // «Не просмотренные» (прототип `vk-un`): нажатие ставит фильтр «Не смотрел, Начал», ещё раз — снимает.
  const unseenVals = [t('video.view.none'), t('video.view.started')];
  const seen = filters.seen;
  const unseenOn =
    seen?.type === 'enum' &&
    seen.vals.length === unseenVals.length &&
    unseenVals.every((x) => seen.vals.includes(x));
  const unseen = data?.unseen ?? 0;
  const noVideos = !!data && data.total === 0 && !search.trim() && !Object.keys(filters).length;

  if (noVideos) {
    return <EmptyState icon="film" title={t('video.empty.title')} text={t('video.empty.text')} />;
  }
  return (
    <div className="flex flex-col gap-3.5" data-kb-video="">
      {data && tracked && stats.shown ? (
        <div className="vk-pl">
          <Plates>
            <Plate
              id="vk-un"
              icon="film"
              color={unseen ? 'blue' : 'green'}
              label={t('video.unseen')}
              value={String(unseen)}
              sub={t(unseen ? 'video.unseen.sub' : 'video.unseen.none')}
              on={unseenOn}
              onClick={() =>
                setFilters(unseenOn ? {} : { seen: { type: 'enum', vals: unseenVals } })
              }
            />
          </Plates>
        </div>
      ) : null}
      <DataGrid
        columns={columns}
        defaultVisible={DEFAULT_VISIBLE}
        defaultSort={DEFAULT_SORT}
        settings={settings}
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
        loadValues={fetchVideoValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={<EmptyState icon="film" title={t('grid.empty')} />}
        rowKey={(v) => v.id}
        titleKey="title"
        label={t('tab.kb.video')}
        labels={labels}
        actions={actions}
        onOpen={(v) => video.open(v.id)}
        cardRender={(v) => <VideoCard video={v} />}
      />
      {copier.node}
    </div>
  );
}
