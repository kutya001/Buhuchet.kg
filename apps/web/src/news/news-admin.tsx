'use client';

import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  formatMomentRu,
  type ListSort,
} from '@buhuchet/domain';
import { AdminNewsRecord, type AdminNews } from '@buhuchet/shared';
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
  pillClass,
  Timeline,
  useToast,
  useWindow,
  type ActionEntry,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { api, ApiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import {
  ADMIN_NEWS_GRID,
  adminNewsQuery,
  fetchAdminNews,
  fetchAdminNewsValues,
  newsHistoryQuery,
  refreshNews,
} from './news-data';
import { NewsEditDialog, newsStateText } from './news-editor';
import { momentDate, NewsTypePill } from './news-parts';
import { NewsBody } from './news-provider';

/** Как во всех списках — от новых к старым по «Создано» (прототип defSort). */
const DEFAULT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/** Видимые по умолчанию (прототип admin/news.js, `hide` у «Кода», «Закреплено», «Изменено», «Прочитали»). */
const DEFAULT_VISIBLE = ['date', 'release', 'type', 'title', 'status', 'audience'];

/** Цвет состояния (прототип: faint, red, green, yellow). */
const STATE_TONE: Record<AdminNews['state'], string> = {
  draft: 'bg-faint-pill-bg text-muted',
  off: 'bg-danger-bg text-danger-label',
  live: 'bg-ok-bg text-ok',
  scheduled: 'bg-warn-bg text-warn-label',
};

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');

/** Столбцы списка новостей — как в прототипе (renderNewsAdm), ключи — как на сервере. */
export function newsColumns(t: Translate): GridColumn<AdminNews>[] {
  return [
    {
      key: 'id',
      label: t('news.col.id'),
      type: 'text',
      width: 90,
      text: (n) => n.id,
      className: MONO_CLASS,
    },
    {
      key: 'date',
      label: t('news.col.date'),
      type: 'date',
      width: 140,
      text: (n) => formatDateRu(n.date),
    },
    {
      key: 'release',
      label: t('news.col.release'),
      type: 'enum',
      width: 100,
      text: (n) => n.release || '—',
    },
    {
      key: 'type',
      label: t('news.col.type'),
      type: 'enum',
      width: 150,
      text: (n) => t(`news.type.${n.type}`),
      cell: (n) => <NewsTypePill type={n.type} t={t} />,
    },
    {
      key: 'title',
      label: t('news.col.title'),
      type: 'text',
      width: 330,
      text: (n) => n.title,
      cell: (n) => (
        <span className="inline-flex min-w-0 items-center gap-1">
          {n.pinned ? <Icon name="star" size="sm" className="flex-none" /> : null}
          <span className="truncate font-semibold">{n.title}</span>
        </span>
      ),
    },
    {
      key: 'status',
      label: t('news.col.status'),
      type: 'enum',
      width: 230,
      text: (n) => newsStateText(t, n),
      cell: (n) => (
        <span className={`${pillClass('sm')} ${STATE_TONE[n.state]}`}>{newsStateText(t, n)}</span>
      ),
    },
    {
      key: 'audience',
      label: t('news.col.audience'),
      type: 'enum',
      width: 170,
      text: (n) => t(`news.aud.${n.audience}`),
    },
    {
      key: 'pinned',
      label: t('news.col.pinned'),
      type: 'enum',
      width: 110,
      text: (n) => t(n.pinned ? 'news.yes' : 'news.no'),
    },
    {
      key: 'edited',
      label: t('news.col.edited'),
      type: 'date',
      width: 120,
      text: (n) => (n.editedAt ? momentDate(n.editedAt) : ''),
    },
    {
      key: 'reads',
      label: t('news.col.reads'),
      type: 'int',
      width: 110,
      text: (n) => String(n.reads),
    },
  ];
}

const NEWS_AUDIT: GridAudit<AdminNews> = {
  createdBy: (n) => n.audit.createdBy ?? '',
  updatedBy: (n) => n.audit.updatedBy ?? n.audit.createdBy ?? '',
  createdAt: (n) => moment(n.audit.createdAt),
  updatedAt: (n) => moment(n.audit.updatedAt),
};

/** Что делают пункты меню новости. */
export interface NewsMenuRun {
  edit: (n: AdminNews) => void;
  preview: (n: AdminNews) => void;
  publish: (n: AdminNews) => void;
  restore: (n: AdminNews) => void;
  takeOff: (n: AdminNews) => void;
  remove: (n: AdminNews) => void;
}

/**
 * Меню новости (прототип newsActs): «Изменить», «Предпросмотр», черта; у черновика — «Опубликовать», у
 * снятой — «Вернуть в публикацию», у опубликованной — «Снять с публикации» (после вопроса); «Удалить» —
 * только черновик, у опубликованной пункт недоступен с причиной.
 */
export function newsMenu(t: Translate, run: NewsMenuRun): (n: AdminNews) => ActionEntry[] {
  return (n) => [
    { id: 'edit', label: t('news.act.edit'), icon: 'edit', run: () => run.edit(n) },
    { id: 'preview', label: t('news.act.preview'), icon: 'eye', run: () => run.preview(n) },
    { id: 'sep', separator: true },
    n.status === 'draft'
      ? { id: 'publish', label: t('news.act.publish'), icon: 'send', run: () => run.publish(n) }
      : n.off
        ? {
            id: 'restore',
            label: t('news.act.restore'),
            icon: 'refresh',
            run: () => run.restore(n),
          }
        : {
            id: 'off',
            label: t('news.act.off'),
            icon: 'ban',
            sub: t('news.act.off_sub'),
            run: () => run.takeOff(n),
          },
    {
      id: 'delete',
      label: t('news.act.delete'),
      icon: 'trash',
      danger: true,
      disabled: n.status !== 'draft',
      reason: n.status !== 'draft' ? t('news.act.delete_reason') : undefined,
      run: () => run.remove(n),
    },
  ];
}

/** «+ Добавить» → «Новость» (прототип kbAdmAdd). */
function useNewsAddRequest(run: () => void) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'kbadm' ? addRequest : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === 'news') run();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);
}

/**
 * Админка → «База знаний (содержимое)» → «Новости» (ТЗ; прототип admin/news.js, renderNewsAdm): все
 * новости с поиском, фильтрами и «В Excel»; черновики и снятые — приглушённо; строка открывает окно
 * «Новость», меню — действия. «+ Добавить» → «Новость». Выгрузка и загрузка Excel справочником — задача
 * 2.39.
 */
export function NewsAdminList() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const labels = useGridLabels('news.count');
  const columns = useMemo(() => newsColumns(t), [t]);
  const view = useViewSettings(ADMIN_NEWS_GRID);
  const { search, clearSearch } = useShell();
  const list = useListPage({
    gridKey: ADMIN_NEWS_GRID,
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchAdminNews,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.admin.news.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [editor, setEditor] = useState<DialogSlot<AdminNewsRecord | null> | null>(null);
  const [preview, setPreview] = useState<DialogSlot<AdminNewsRecord> | null>(null);
  const [askOff, setAskOff] = useState<AdminNews | null>(null);
  const [askDelete, setAskDelete] = useState<AdminNews | null>(null);

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['list', ADMIN_NEWS_GRID] });
    refreshNews(client);
  }, [client]);

  // Окно с полями открывается, когда новость загружена: фокус сразу в первом поле.
  const load = useCallback(
    async (n: AdminNews) => {
      try {
        return await client.fetchQuery(adminNewsQuery(n.id));
      } catch (e) {
        toast(errorText(e instanceof ApiFailure ? e.error : { code: 'network', message: '' }), {
          bad: true,
        });
        return null;
      }
    },
    [client, toast, errorText],
  );
  const edit = useCallback(
    async (n: AdminNews) => {
      const record = await load(n);
      if (record) setEditor(openSlot<AdminNewsRecord | null>(record));
    },
    [load],
  );

  useNewsAddRequest(() => setEditor(openSlot<AdminNewsRecord | null>(null)));

  const act = async (
    n: AdminNews,
    send: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
    // Без `done` — без уведомления (прототип: «Вернуть в публикацию» только обновляет список).
    done?: (saved: AdminNewsRecord | null) => string,
  ) => {
    const res = await callApi(send);
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    if (!done) return;
    const saved = AdminNewsRecord.safeParse(res.data);
    toast(done(saved.success ? saved.data : null), { icon: 'bell' });
  };

  const run: NewsMenuRun = {
    edit: (n) => void edit(n),
    preview: (n) => void load(n).then((record) => record && setPreview(openSlot(record))),
    publish: (n) =>
      void act(
        n,
        () =>
          api.api.admin.news[':id'].publish.$post({
            param: { id: n.id },
            json: { version: n.version },
          }),
        (saved) =>
          saved?.state === 'scheduled'
            ? t('news.published_later', { date: formatDateRu(saved.date) })
            : t('news.published'),
      ),
    restore: (n) =>
      void act(n, () =>
        api.api.admin.news[':id'].off.$post({
          param: { id: n.id },
          json: { version: n.version, off: false },
        }),
      ),
    takeOff: setAskOff,
    remove: setAskDelete,
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="info">{t('news.adm.note')}</Note>
      <DataGrid
        columns={columns}
        audit={NEWS_AUDIT}
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
        loadValues={fetchAdminNewsValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="bell" title={t('news.empty')} />}
        rowKey={(n) => n.id}
        titleKey="title"
        rowTone={(n) => (n.status === 'draft' || n.off ? 'muted' : undefined)}
        label={t('news.title')}
        labels={labels}
        actions={newsMenu(t, run)}
        onOpen={(n) => void edit(n)}
      />
      <NewsHistory />
      {editor ? (
        <NewsEditDialog
          key={`form-${editor.n}`}
          record={editor.data}
          open={editor.open}
          onClose={() => setEditor(closeSlot)}
          onSaved={refresh}
        />
      ) : null}
      {preview ? (
        <NewsPreviewDialog
          key={`preview-${preview.n}`}
          record={preview.data}
          open={preview.open}
          onClose={() => setPreview(closeSlot)}
        />
      ) : null}
      <ConfirmDialog
        open={askOff !== null}
        onClose={() => setAskOff(null)}
        title={t('news.off.title', { title: askOff?.title ?? '' })}
        text={t('news.off.text')}
        ok={t('news.act.off')}
        danger
        onConfirm={() => {
          const n = askOff;
          if (!n) return;
          void act(
            n,
            () =>
              api.api.admin.news[':id'].off.$post({
                param: { id: n.id },
                json: { version: n.version, off: true },
              }),
            () => t('news.off.done'),
          );
        }}
      />
      <ConfirmDialog
        open={askDelete !== null}
        onClose={() => setAskDelete(null)}
        title={t('news.delete.title', { title: askDelete?.title ?? '' })}
        text={t('news.delete.text')}
        ok={t('news.act.delete')}
        danger
        onConfirm={() => {
          const n = askDelete;
          if (!n) return;
          void act(
            n,
            () =>
              api.api.admin.news[':id'].$delete({
                param: { id: n.id },
                query: { version: String(n.version) },
              }),
            () => t('news.delete.done'),
          );
        }}
      />
    </div>
  );
}

/**
 * «История изменений · N» под списком (прототип pdHistHtml('news')): последние 12 записей, новые сверху;
 * записей нет — блока нет.
 */
function NewsHistory() {
  const t = useT();
  const history = useQuery(newsHistoryQuery);
  if (!history.data?.items.length) return null;
  const title = t('news.hist.title', { n: history.data.total });
  const items = history.data.items.map((h) => {
    const at = new Date(h.at);
    return {
      // У сразу опубликованной новости одна запись истории даёт две строки: ключ — запись и вид.
      id: `${h.id}-${h.kind}`,
      date: formatDateRu(bishkekDate(at)),
      time: bishkekTime(at),
      text: t(`news.hist.${h.kind}`, { title: h.title }),
      who: h.actor,
    };
  });
  return (
    <Box title={title}>
      <Timeline items={items} label={title} />
    </Box>
  );
}

/** «Предпросмотр» (прототип newsActs): как у пользователя — тип, краткое и подробное описание. */
function NewsPreviewDialog({
  record,
  open,
  onClose,
}: {
  record: AdminNewsRecord;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={record.title}
      sub={formatDateRu(record.date)}
      label={record.title}
      footer={<PreviewFooter />}
    >
      <div className="flex flex-col items-start gap-2.5">
        <NewsTypePill type={record.type} t={t} />
        <p className="m-0 text-muted">{record.short}</p>
        <div className="w-full">
          <NewsBody source={record.md} />
        </div>
      </div>
    </Modal>
  );
}

function PreviewFooter() {
  const t = useT();
  const { close } = useWindow();
  return (
    <>
      <div className="flex-1" />
      <button type="button" onClick={close} className={buttonClass('cta')}>
        {t('news.close')}
      </button>
    </>
  );
}
