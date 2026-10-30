'use client';

import { formatCount, type ListFilterValue, type UiTextKey } from '@buhuchet/domain';
import { FileLink, FileManagerList, ListValues, type FileManagerRow } from '@buhuchet/shared';
import {
  ConfirmDialog,
  DataGrid,
  EmptyState,
  Plate,
  Plates,
  useToast,
  type ActionEntry,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { api, ApiFailure, apiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useKpiEntry } from '../kpi/kpi-entry';
import { useErrorText, useT } from '../l10n/provider';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useReportActions } from '../reports/report-actions';
import { useTaskActions } from '../tasks/task-actions';
import { taskQuery } from '../tasks/tasks-data';
import {
  FILE_AUDIT,
  FILE_DEFAULT_SORT,
  FILE_DEFAULT_VISIBLE,
  fileColumns,
  fileKindIcon,
} from './file-columns';
import { FileWindow, UploadDialog, type UploadChoice } from './file-window';
import { managerSummaryQuery, pickedFilesProblem, uploadFile, useFilesRefresh } from './files-data';

const GRID_KEY = 'files.list';
const MANUAL = { kind: 'manual', id: null } as const;

/** Фильтр плашки — вид источника (прототип: `g.filters = {kind: …}`). */
const kindFilter = (kind: string): Record<string, ListFilterValue> => ({
  kind: { type: 'enum', vals: [kind] },
});

const plateOn = (filters: Record<string, ListFilterValue>, kind: string) => {
  const f = filters.kind;
  return f?.type === 'enum' && f.vals.length === 1 && f.vals[0] === kind;
};

/** «+ Добавить» → «Загрузить файл» в модуле (прототип `filesAdd`). */
function useUploadRequest(run: () => void) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'files' ? addRequest : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === 'upload') run();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);
}

/**
 * «Файловый менеджер» (задача 2.29; ТЗ «Файловый менеджер»; прототип modules/files.js, `renderFiles`):
 * плашки по видам источника («К задачам», «Загружено вручную»…; нажатие — фильтр «Откуда»), общий
 * список всех видимых файлов с поиском, фильтрами, группировкой и «В Excel». Строка открывает окно
 * файла с просмотром картинок и PDF; в «⋯» — «Открыть», «Скачать», «Перейти к источнику» и «Удалить»
 * (свой файл — в течение суток, чужой — с правом «Удалять файлы»). «Загрузить файл» — из «+ Добавить»
 * и пустого списка.
 */
export function FilesManager() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useFilesRefresh();
  const labels = useGridLabels('files.count');
  const columns = useMemo(() => fileColumns(t), [t]);
  const view = useViewSettings(GRID_KEY);
  const stats = useModuleStats('files');
  const summary = useQuery(managerSummaryQuery);
  const { search, clearSearch, access } = useShell();
  const tasks = useTaskActions();
  const reports = useReportActions();
  const kpi = useKpiEntry();
  const [card, setCard] = useState<DialogSlot<FileManagerRow> | null>(null);
  const [upload, setUpload] = useState<DialogSlot<null> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ask, setAsk] = useState<FileManagerRow | null>(null);

  const fetchPage = useCallback<FetchListPage<FileManagerRow>>(async (params) => {
    const res = await api.api.files.manager.$get({ query: params });
    if (!res.ok) throw await apiFailure(res);
    return FileManagerList.parse(await res.json());
  }, []);
  const loadValues = useCallback(async (col: string, q?: string) => {
    const res = await api.api.files.manager.values.$get({ query: q ? { col, q } : { col } });
    if (!res.ok) throw await apiFailure(res);
    return ListValues.parse(await res.json());
  }, []);
  const list = useListPage({
    gridKey: GRID_KEY,
    columns,
    defaultVisible: FILE_DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: FILE_DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.files.manager.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const canUpload = access.can('filesUpload');
  const startUpload = () => setUpload(openSlot(null));
  useUploadRequest(startUpload);

  const download = async (file: FileManagerRow) => {
    const res = await callApi(() => api.api.files[':id'].link.$get({ param: { id: file.id } }));
    if (!res.ok) return toast(errorText(res.error), { bad: true, icon: 'alert' });
    globalThis.location.assign(FileLink.parse(res.data).url);
  };

  /** «Перейти к источнику» (прототип `f.open`): карточка отчёта или задачи, окно значения показателя. */
  const sourceOf = (file: FileManagerRow): (() => void) | null => {
    if (file.kind === 'report' && file.sourceId) {
      const id = file.sourceId;
      return () => reports.openCard({ id });
    }
    if (file.kind === 'task' && file.sourceId) {
      const id = file.sourceId;
      return () =>
        void client
          .fetchQuery(taskQuery(id))
          .then((task) => tasks.openCard(task))
          .catch((e: unknown) =>
            toast(e instanceof ApiFailure ? errorText(e.error) : t('err.unknown'), { bad: true }),
          );
    }
    if (file.kind === 'indicator_value' && file.contractor && file.sourceRef) {
      const { id } = file.contractor;
      const month = file.sourceRef;
      return () => void kpi.open(id, month);
    }
    return null;
  };

  const actions = (file: FileManagerRow): ActionEntry[] => {
    const source = sourceOf(file);
    return [
      {
        id: 'open',
        label: t('files.act.open'),
        icon: 'eye',
        run: () => setCard(openSlot(file)),
      },
      {
        id: 'download',
        label: t('files.act.download'),
        icon: 'download',
        run: () => void download(file),
      },
      ...(source
        ? [
            {
              id: 'source',
              label: t('files.act.source'),
              icon: fileKindIcon(file.kind),
              run: source,
            },
          ]
        : []),
      { id: 'sep', separator: true as const },
      {
        id: 'delete',
        label: t('files.act.delete'),
        icon: 'trash',
        danger: true,
        disabled: !file.canDelete,
        reason: file.canDelete ? undefined : t('err.file_delete_forbidden'),
        run: () => setAsk(file),
      },
    ];
  };

  const remove = async (file: FileManagerRow) => {
    const res = await callApi(() =>
      api.api.files[':id'].$delete({
        param: { id: file.id },
        query: { version: String(file.version) },
      }),
    );
    await refresh();
    if (res.ok) toast(t('files.deleted'), { icon: 'trash' });
    else toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  const problemOf = (files: File[]): string | null => {
    const problem = pickedFilesProblem(files);
    if (!problem) return null;
    return 'names' in problem
      ? t('files.too_large', { names: problem.names })
      : t('files.upload_failed', {
          name: problem.name,
          error: errorText({ code: problem.code, message: '' }),
        });
  };

  const send = async (choice: UploadChoice) => {
    setUploading(true);
    let done = 0;
    for (const file of choice.files) {
      const res = await uploadFile(MANUAL, file, {
        contractorId: choice.contractorId,
        note: choice.note,
      });
      if (res.ok) done++;
      else
        toast(t('files.upload_failed', { name: file.name, error: errorText(res.error) }), {
          bad: true,
          icon: 'alert',
        });
    }
    await refresh();
    setUploading(false);
    if (done) {
      setUpload(closeSlot);
      toast(t('files.upload.done', { n: done }), { icon: 'upload' });
    }
  };

  const plates = summary.data?.plates ?? [];
  const addAction = canUpload
    ? [
        {
          id: 'add',
          icon: 'plus' as const,
          label: t('files.empty.add'),
          primary: true,
          onClick: startUpload,
        },
      ]
    : [];
  // Файлов нет совсем — пустой модуль с пояснением (ТЗ «Пустые состояния и первый вход»; прототип
  // ui/empty.js, `files`).
  const empty = summary.data?.empty ? (
    <EmptyState
      icon="folder"
      title={t('files.empty.first')}
      text={t('files.empty.first_text')}
      actions={addAction}
    />
  ) : (
    <EmptyState icon="folder" title={t('files.empty')} actions={addAction} />
  );

  return (
    <div className="flex flex-col gap-3.5">
      {plates.length ? (
        <Plates shown={stats.shown}>
          {plates.map((p) => {
            const on = plateOn(list.filters, p.kind);
            return (
              <Plate
                key={p.kind}
                id={p.kind}
                icon={fileKindIcon(p.kind)}
                color={p.kind === 'manual' ? 'purple' : 'blue'}
                label={t(`files.plate.${p.kind}` as UiTextKey)}
                value={formatCount(p.count)}
                on={on}
                onClick={() => list.setFilters(on ? {} : kindFilter(p.kind))}
              />
            );
          })}
        </Plates>
      ) : null}
      <DataGrid
        columns={columns}
        audit={FILE_AUDIT}
        defaultVisible={FILE_DEFAULT_VISIBLE}
        defaultSort={FILE_DEFAULT_SORT}
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
        loadValues={loadValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={empty}
        rowKey={(r) => r.id}
        titleKey="name"
        label={t('nav.files')}
        labels={labels}
        actions={actions}
        onOpen={(r) => setCard(openSlot(r))}
      />
      {card ? (
        <FileWindow
          key={`file-${card.n}`}
          file={card.data}
          open={card.open}
          onClose={() => setCard(closeSlot)}
          onDownload={() => void download(card.data)}
          onSource={sourceOf(card.data)}
        />
      ) : null}
      {upload ? (
        <UploadDialog
          key={`upload-${upload.n}`}
          open={upload.open}
          onClose={() => setUpload(closeSlot)}
          busy={uploading}
          problemOf={problemOf}
          onUpload={(choice) => void send(choice)}
        />
      ) : null}
      <ConfirmDialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={t('files.delete.title', { name: ask?.name ?? '' })}
        text={
          ask?.kind === 'manual'
            ? t('files.delete.manual')
            : t('files.delete.attached', { src: ask?.source ?? '' })
        }
        ok={t('files.delete_ok')}
        danger
        onConfirm={() => ask && void remove(ask)}
      />
      {tasks.dialogs}
      {reports.dialogs}
      {kpi.dialog}
    </div>
  );
}
