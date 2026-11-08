'use client';

import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  pluralForm,
  videoTime,
  type ListSort,
} from '@buhuchet/domain';
import {
  ListValues,
  VideoAdminCard,
  VideoAdminList,
  VideoAdminSaved,
  type VideoAdminItem,
} from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  ConfirmDialog,
  DataGrid,
  EmptyState,
  Icon,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  Timeline,
  useToast,
  useWindow,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { fileSizeText } from '../files/files-data';
import { KB_STATE_KEY } from '../kb/kb-data';
import { videoLink } from '../kb/video/kb-video-tab';
import { useCopyText } from '../kb/video/video-copy';
import { refreshVideos } from '../kb/video/video-data';
import { VideoCover, VideoKindPill } from '../kb/video/video-parts';
import { PlayerHost } from '../kb/video/video-window';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { presetHref } from '../lists/preset';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useKbAdmAdd } from './kbadm-add';
import { KbAdmHistory } from './kbadm-history';
import { VideoEditDialog } from './video-form';

/** Недавно изменённые сверху (прототип `sort:{key:'upd',dir:-1}`). */
const DEFAULT_SORT: ListSort = { key: 'updated', dir: 'desc' };
const DEFAULT_VISIBLE = [
  'cover',
  'title',
  'kind',
  'source',
  'module',
  'duration',
  'size',
  'status',
  'landing',
  'viewers',
  'updated',
];
const GRID = 'kbadm.video';

const videos = () => api.api.admin.videos;

type AdminStatus = 'draft' | 'pub' | 'off';
export const adminStatus = (v: Pick<VideoAdminItem, 'status' | 'off'>): AdminStatus =>
  v.status === 'draft' ? 'draft' : v.off ? 'off' : 'pub';
const live = (v: VideoAdminItem) => adminStatus(v) === 'pub';

/** «1/2 Черновик» серым, «2/2 Опубликовано» зелёным, «… · снято» красным (прототип `vidStTxt`). */
export function VideoAdminStatusPill({ video }: { video: Pick<VideoAdminItem, 'status' | 'off'> }) {
  const t = useT();
  const st = adminStatus(video);
  return (
    <Pill size="sm" tone={st === 'draft' ? 'plain' : st === 'off' ? 'bad' : 'ok'}>
      {t(`video.st.${st}`)}
    </Pill>
  );
}

/** Обложка в Админке: своя или кадр — со своего адреса (с версией: после замены — новая). */
export const adminCover = (v: VideoAdminItem) => ({
  id: v.id,
  title: v.title,
  source: v.source,
  ytId: v.ytId,
  duration: v.duration,
  module: v.module,
  cover: v.coverKind !== null,
});

function AdminCover({ video, size }: { video: VideoAdminItem; size: 'xs' | 'sm' }) {
  return (
    <VideoCover
      video={adminCover(video)}
      size={size}
      play={false}
      showDuration={false}
      version={video.version}
    />
  );
}

export function adminVideoColumns(t: Translate): GridColumn<VideoAdminItem>[] {
  return [
    {
      key: 'cover',
      label: t('video.col.cover'),
      type: 'enum',
      width: 120,
      text: (v) => t(`video.cv.${v.coverKind ?? 'none'}`),
      cell: (v) => (
        <span className="block w-[86px]">
          <AdminCover video={v} size="xs" />
        </span>
      ),
    },
    {
      key: 'title',
      label: t('video.col.title'),
      type: 'text',
      width: 300,
      text: (v) => v.title,
      cell: (v) => (
        <span className="truncate">
          <b className="font-semibold">{v.title}</b>
          {v.ytBad ? (
            <>
              {' '}
              <Pill size="sm" tone="bad">
                {t('video.yt_bad')}
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
      key: 'source',
      label: t('video.col.source'),
      type: 'enum',
      width: 110,
      text: (v) => t(`video.src.${v.source}`),
    },
    {
      key: 'module',
      label: t('video.col.module'),
      type: 'enum',
      width: 220,
      text: (v) => v.moduleTitle,
    },
    {
      key: 'duration',
      label: t('video.col.duration'),
      type: 'text',
      width: 120,
      text: (v) => (v.duration ? videoTime(v.duration) : '—'),
    },
    {
      key: 'size',
      label: t('video.col.size'),
      type: 'int',
      width: 110,
      text: (v) => (v.source === 'file' && v.fileSize ? fileSizeText(t, v.fileSize) : '—'),
    },
    {
      key: 'status',
      label: t('video.col.status'),
      type: 'enum',
      width: 220,
      text: (v) => t(`video.st.${adminStatus(v)}`),
      cell: (v) => <VideoAdminStatusPill video={v} />,
    },
    {
      key: 'landing',
      label: t('video.col.landing'),
      type: 'enum',
      width: 130,
      text: (v) =>
        v.landing && live(v) ? t('video.land.yes', { n: v.landingOrd }) : t('video.land.no'),
    },
    {
      key: 'viewers',
      label: t('video.col.viewers'),
      type: 'int',
      width: 110,
      text: (v) => String(v.viewers),
    },
    {
      key: 'audience',
      label: t('video.col.audience'),
      type: 'enum',
      width: 170,
      text: (v) => t(`video.aud.${v.audience}`),
    },
    { key: 'ord', label: t('video.col.ord'), type: 'int', width: 100, text: (v) => String(v.ord) },
    {
      key: 'code',
      label: t('video.col.code'),
      type: 'text',
      width: 110,
      className: MONO_CLASS,
      text: (v) => v.id,
    },
    {
      key: 'updated',
      label: t('video.col.updated'),
      type: 'date',
      width: 140,
      text: (v) => formatDateRu(bishkekDate(new Date(v.updatedAt))),
    },
  ];
}

const fetchAdminVideos: FetchListPage<VideoAdminItem> = async (params) => {
  const res = await videos().$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return VideoAdminList.parse(await res.json());
};

const fetchAdminVideoValues = async (col: string, q?: string) => {
  const res = await videos().values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

export const adminVideoCardQuery = (id: string) =>
  queryOptions({
    queryKey: ['kbadm', 'video', id],
    queryFn: async () => {
      const res = await videos()[':id'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return VideoAdminCard.parse(await res.json());
    },
    staleTime: 0,
  });

/** После правки видео: список, карточка, история, «Видео» Базы знаний, «?» и лендинг. */
export function refreshAdminVideos(client: QueryClient) {
  void client.invalidateQueries({ queryKey: ['list', GRID] });
  void client.invalidateQueries({ queryKey: ['kbadm'] });
  void client.invalidateQueries({ queryKey: ['list', 'kb.video'] });
  void client.invalidateQueries({ queryKey: KB_STATE_KEY });
  refreshVideos(client);
}

/** Действия с видео — общие для меню строки и карточки (прототип `vidAdmActs`, `vidPub`, `vidDel`). */
function useVideoActions() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const router = useRouter();
  const [ask, setAsk] = useState<{ kind: 'off' | 'delete'; video: VideoAdminItem } | null>(null);

  const done = useCallback(
    (text: string) => {
      refreshAdminVideos(client);
      toast(text, { icon: 'film' });
    },
    [client, toast],
  );
  const failed = useCallback(
    (error: { code: string; message: string }) => {
      refreshAdminVideos(client);
      toast(errorText(error), { bad: true, icon: 'alert' });
    },
    [client, toast, errorText],
  );

  const publish = useCallback(
    async (v: VideoAdminItem) => {
      const res = await callApi(() =>
        videos()[':id'].publish.$post({ param: { id: v.id }, json: { version: v.version } }),
      );
      if (!res.ok) return failed(res.error);
      VideoAdminSaved.parse(res.data);
      done(
        t(
          v.kind === 'instr' && v.module
            ? 'video.adm.published_toast_mod'
            : 'video.adm.published_toast',
        ),
      );
    },
    [done, failed, t],
  );
  const setOff = useCallback(
    async (v: VideoAdminItem, off: boolean) => {
      const res = await callApi(() =>
        videos()[':id'].off.$post({ param: { id: v.id }, json: { version: v.version, off } }),
      );
      if (!res.ok) return failed(res.error);
      done(t(off ? 'video.adm.off_toast' : 'video.adm.on_toast'));
    },
    [done, failed, t],
  );
  const remove = useCallback(
    async (v: VideoAdminItem) => {
      const res = await callApi(() =>
        videos()[':id'].$delete({ param: { id: v.id }, query: { version: String(v.version) } }),
      );
      if (!res.ok) return failed(res.error);
      done(t('video.adm.del_toast'));
    },
    [done, failed, t],
  );
  const copier = useCopyText();
  const copyText = copier.copy;
  const copy = useCallback(
    (v: VideoAdminItem) => void copyText(videoLink(v.id), t('video.copied')),
    [copyText, t],
  );
  /** «Кто смотрел» (прототип `vidWho`): «Просмотры видео» с фильтром по этому видео. */
  const who = useCallback(
    (v: VideoAdminItem) =>
      router.push(presetHref('kbadm', 'vviews', { video: { type: 'enum', vals: [v.title] } })),
    [router],
  );

  const confirm = ask ? (
    <ConfirmDialog
      open
      onClose={() => setAsk(null)}
      title={t(ask.kind === 'off' ? 'video.adm.off.title' : 'video.adm.del.title', {
        title: ask.video.title,
      })}
      text={t(ask.kind === 'off' ? 'video.adm.off.text' : 'video.adm.del.text')}
      ok={t(ask.kind === 'off' ? 'video.adm.unpublish' : 'video.adm.delete')}
      danger
      onConfirm={() => {
        const { kind, video } = ask;
        setAsk(null);
        void (kind === 'off' ? setOff(video, true) : remove(video));
      }}
    />
  ) : null;
  const dialogs = (
    <>
      {confirm}
      {copier.node}
    </>
  );

  return {
    publish,
    on: (v: VideoAdminItem) => void setOff(v, false),
    off: (v: VideoAdminItem) => setAsk({ kind: 'off', video: v }),
    remove: (v: VideoAdminItem) => setAsk({ kind: 'delete', video: v }),
    copy,
    who,
    dialogs,
  };
}

interface FormSlot {
  video: VideoAdminItem | null;
  replace: boolean;
}

/**
 * Админка → «База знаний (содержимое)» → «Видео» (решение заказчика 08.11.2026, прототип v79
 * `renderVidAdm`): видео платформы — файлы и ссылки YouTube; загружает, меняет и удаляет их только
 * администратор платформы. Строка открывает карточку с плеером; «+ Добавить» → «Видео».
 */
export function KbAdmVideoTab() {
  const t = useT();
  const labels = useGridLabels('video.count');
  const columns = useMemo(() => adminVideoColumns(t), [t]);
  const view = useViewSettings(GRID);
  const { search, clearSearch } = useShell();
  const list = useListPage({
    gridKey: GRID,
    columns,
    audit: false,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchAdminVideos,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => videos().export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const acts = useVideoActions();
  const [card, setCard] = useState<DialogSlot<string> | null>(null);
  const [form, setForm] = useState<DialogSlot<FormSlot> | null>(null);
  useKbAdmAdd('video', () => setForm(openSlot<FormSlot>({ video: null, replace: false })));
  const edit = useCallback(
    (v: VideoAdminItem, replace = false) => setForm(openSlot<FormSlot>({ video: v, replace })),
    [],
  );

  const actions = useCallback(
    (v: VideoAdminItem): ActionEntry[] => {
      const st = adminStatus(v);
      return [
        {
          id: 'open',
          label: t('video.adm.open'),
          icon: 'film',
          run: () => setCard(openSlot(v.id)),
        },
        { id: 'edit', label: t('video.adm.edit'), icon: 'edit', run: () => edit(v) },
        {
          id: 'replace',
          label: t(v.source === 'yt' ? 'video.adm.replace_link' : 'video.adm.replace_file'),
          icon: 'refresh',
          sub: t('video.adm.replace_sub'),
          run: () => edit(v, true),
        },
        { id: 'sep1', separator: true },
        st === 'draft'
          ? {
              id: 'publish',
              label: t('video.adm.publish'),
              icon: 'send',
              run: () => void acts.publish(v),
            }
          : st === 'off'
            ? {
                id: 'on',
                label: t('video.adm.republish'),
                icon: 'refresh',
                run: () => acts.on(v),
              }
            : {
                id: 'off',
                label: t('video.adm.unpublish'),
                icon: 'ban',
                sub: t('video.adm.unpublish_sub'),
                run: () => acts.off(v),
              },
        {
          id: 'copy',
          label: t('video.copy_link'),
          icon: 'link',
          run: () => void acts.copy(v),
        },
        { id: 'who', label: t('video.adm.who'), icon: 'eye', run: () => acts.who(v) },
        { id: 'sep2', separator: true },
        {
          id: 'delete',
          label: t('video.adm.delete'),
          icon: 'trash',
          danger: true,
          disabled: st === 'pub',
          reason: t('video.adm.delete_reason'),
          run: () => acts.remove(v),
        },
      ];
    },
    [t, acts, edit],
  );

  const data = list.data as VideoAdminList | undefined;
  const s = data?.summary;
  return (
    <div className="flex flex-col gap-3.5" data-kbadm-video="">
      <Note icon="info">{t('video.adm.note')}</Note>
      <DataGrid
        caption={
          s ? (
            <>
              <span>
                {t('video.adm.cap.count')} <b>{s.count}</b>
              </span>
              <span>
                {t('video.adm.cap.pub')} <b>{s.published}</b>
              </span>
              <span>
                {t('video.adm.cap.size')} <b>{gb(t, s.bytes)}</b>
              </span>
            </>
          ) : undefined
        }
        columns={columns}
        defaultVisible={DEFAULT_VISIBLE}
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
        filters={list.filters}
        onFiltersChange={list.setFilters}
        loadValues={fetchAdminVideoValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="film" title={t('grid.empty')} />}
        rowKey={(v) => v.id}
        titleKey="title"
        rowTone={(v) => (live(v) ? undefined : 'muted')}
        label={t('tab.kbadm.video')}
        labels={labels}
        actions={actions}
        onOpen={(v) => setCard(openSlot(v.id))}
      />
      <KbAdmHistory section="video" />
      {acts.dialogs}
      {card ? (
        <VideoAdminCardDialog
          key={`video-card-${card.n}`}
          id={card.data}
          open={card.open}
          onClose={() => setCard(closeSlot)}
          onEdit={(v, replace) => edit(v, replace)}
          onCopy={(v) => void acts.copy(v)}
          onWho={acts.who}
        />
      ) : null}
      {form ? (
        <VideoEditDialog
          key={`video-form-${form.n}`}
          video={form.data.video}
          replace={form.data.replace}
          open={form.open}
          onClose={() => setForm(closeSlot)}
        />
      ) : null}
    </div>
  );
}

/** «0,4 ГБ» — занято файлами видео (прототип `vidGB`). */
function gb(t: Translate, bytes: number): string {
  return t('video.adm.gb', { n: (bytes / 1073741824).toFixed(1).replace('.', ',') });
}

/**
 * Карточка видео (прототип `vidAdmCard`): плеер для проверки (просмотры администратора не
 * записываются), поля, история; «Скопировать ссылку», «Кто смотрел», «Заменить», «Изменить».
 */
function VideoAdminCardDialog({
  id,
  open,
  onClose,
  onEdit,
  onCopy,
  onWho,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onEdit: (video: VideoAdminItem, replace: boolean) => void;
  onCopy: (video: VideoAdminItem) => void;
  onWho: (video: VideoAdminItem) => void;
}) {
  const t = useT();
  const query = useQuery(adminVideoCardQuery(id));
  const card = query.data;
  if (!card) return null;
  const v = card.video;
  const row = (label: string, value: ReactNode) => (
    <div className="contents">
      <dt className="text-faint">{label}</dt>
      <dd className="m-0 min-w-0">{value}</dd>
    </div>
  );
  const historyItems = card.history.map((h, i) => {
    const at = new Date(h.at);
    return {
      id: `${h.at}-${i}`,
      date: formatDateRu(bishkekDate(at)),
      time: bishkekTime(at),
      text: t(`video.hist.${h.kind}` as 'video.hist.edit'),
      who: h.actor ?? t('video.adm.admin_actor'),
    };
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      sticky
      noMax
      swipeHead
      title={v.title}
      label={v.title}
      sub={
        <>
          {t(`video.kind.${v.kind}`)} · <VideoAdminStatusPill video={v} />
          {v.ytBad ? (
            <>
              {' '}
              <Pill size="sm" tone="bad">
                {t('video.yt_bad')}
              </Pill>
            </>
          ) : null}
        </>
      }
      footer={<CardFooter video={v} onEdit={onEdit} onCopy={onCopy} onWho={onWho} />}
    >
      <div className="vid-w vid-m">
        {card.play ? (
          <PlayerHost
            video={{
              id: v.id,
              title: v.title,
              kind: v.kind,
              source: v.source,
              ytId: v.ytId,
              duration: v.duration,
              description: v.description,
            }}
            play={card.play}
            track={null}
            view={null}
            auto={false}
          />
        ) : (
          <div className="vid-p">
            <AdminCover video={v} size="sm" />
          </div>
        )}
      </div>
      <Box>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
          {row(
            t('video.adm.source'),
            v.source === 'yt' ? (
              <>
                {t('video.src.yt')} · <span className={MONO_CLASS}>{v.ytId}</span>
              </>
            ) : (
              `${t('video.src.file')} · ${v.fileName ?? ''}${v.fileSize ? ` · ${fileSizeText(t, v.fileSize)}` : ''}`
            ),
          )}
          {row(
            t('video.col.duration'),
            v.duration ? videoTime(v.duration) : t('video.adm.duration_later'),
          )}
          {row(t('video.col.module'), v.moduleTitle)}
          {row(t('video.adm.article'), card.articleTitle ?? '—')}
          {row(t('video.col.ord'), v.ord)}
          {row(t('video.col.audience'), t(`video.aud.${v.audience}`))}
          {row(
            t('video.col.landing'),
            v.landing && live(v)
              ? t('video.adm.landing_yes', { n: v.landingOrd })
              : t('video.land.no'),
          )}
          {row(
            t('video.col.viewers'),
            `${v.viewers}${card.guests ? `${t('video.adm.guests', { n: card.guests })} ${t(`video.adm.guests_n.${pluralForm(card.guests)}`)}` : ''}`,
          )}
          {v.description ? row(t('video.adm.description'), v.description) : null}
        </dl>
      </Box>
      <Box title={t('video.hist.title')}>
        {historyItems.length ? (
          <Timeline items={historyItems} label={t('video.hist.title')} />
        ) : (
          <span className="text-muted">{t('video.hist.empty')}</span>
        )}
      </Box>
    </Modal>
  );
}

function CardFooter({
  video: v,
  onEdit,
  onCopy,
  onWho,
}: {
  video: VideoAdminItem;
  onEdit: (video: VideoAdminItem, replace: boolean) => void;
  onCopy: (video: VideoAdminItem) => void;
  onWho: (video: VideoAdminItem) => void;
}) {
  const t = useT();
  const { close, leave } = useWindow();
  return (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={() => onCopy(v)}>
        <Icon name="link" size="sm" />
        {t('video.copy_link')}
      </button>
      <button
        type="button"
        className={buttonClass('ghost')}
        onClick={() => {
          leave();
          onWho(v);
        }}
      >
        <Icon name="eye" size="sm" />
        {t('video.adm.who')}
      </button>
      <div className="flex-1" />
      <button
        type="button"
        className={buttonClass()}
        onClick={() => {
          close();
          onEdit(v, true);
        }}
      >
        <Icon name="refresh" size="sm" />
        {t(v.source === 'yt' ? 'video.adm.replace_link' : 'video.adm.replace_file')}
      </button>
      <button
        type="button"
        className={buttonClass()}
        onClick={() => {
          close();
          onEdit(v, false);
        }}
      >
        <Icon name="edit" size="sm" />
        {t('video.adm.edit')}
      </button>
      <button type="button" className={buttonClass('cta')} onClick={close}>
        {t('video.close')}
      </button>
    </>
  );
}
