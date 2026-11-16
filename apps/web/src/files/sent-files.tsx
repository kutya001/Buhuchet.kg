'use client';

import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  SENT_FILE_REASON_MAX,
  type ListSort,
} from '@buhuchet/domain';
import {
  FileLink,
  ListValues,
  SentFileListPage,
  SentUploadState,
  type SentFileItem,
  type SentFileRow,
} from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CHECKBOX_CLASS,
  CountBadge,
  DataGrid,
  EmptyState,
  Field,
  FormGrid,
  Hint,
  Icon,
  inputClass,
  KeyValues,
  MiniTable,
  Modal,
  Pill,
  useToast,
  type ActionEntry,
  type GridColumn,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { contractorPageQuery } from '../contractor-page/page-data';
import { useReceiptMoney } from '../contractor-page/receipt-money';
import { openContractorCard } from '../contractors/card-store';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { FileViewer } from './file-viewer';
import { fileMeta } from './files-data';
import {
  acceptSent,
  contractorSentQuery,
  rejectSent,
  SENT_GRID_KEY,
  sentInText,
  sentLeftText,
  sentSourceText,
  sentStatusText,
  sentDownloadHref,
  sentUploadQuery,
  sentViewSrc,
  sentWhoText,
  useSentRefresh,
} from './sent-data';

/*
 * Файлы от контрагентов (доработки 14.11.2026, блок 2; прототип v112 `modules/cp-sent.js`): вкладка
 * «Файлы от контрагентов» Файлового менеджера (`renderSent`), раздел «Отправленные файлы» вкладки
 * «Файлы» карточки контрагента (`sntBox`), окно файла (`sntOpen`) и «Отклонить файл» (`sntRejectDlg`).
 */

const PILL = {
  new: { tone: 'info', icon: 'clip' },
  accepted: { tone: 'ok', icon: 'check' },
  rejected: { tone: 'bad', icon: 'ban' },
} as const;

/** Статус: «Новый» синим, «Принят» зелёным, «Отклонён» красным (прототип `SNT_PILL`). */
export function SentStatusPill({ status }: { status: SentFileItem['status'] }) {
  const t = useT();
  return (
    <Pill tone={PILL[status].tone} icon={PILL[status].icon}>
      {sentStatusText(t, status)}
    </Pill>
  );
}

/** Статус и под ним причина отказа (прототип: `pill(...) + <div class="hint">why</div>`). */
function StatusCell({ file }: { file: Pick<SentFileItem, 'status' | 'rejectReason'> }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <SentStatusPill status={file.status} />
      {file.status === 'rejected' && file.rejectReason ? (
        <span data-sent-reason="" className="text-xs text-muted [overflow-wrap:anywhere]">
          {file.rejectReason}
        </span>
      ) : null}
    </span>
  );
}

const momentText = (iso: string) => {
  const at = new Date(iso);
  return `${formatDateRu(bishkekDate(at))} ${bishkekTime(at)}`;
};

/** Окно «Отклонить файл»: причина обязательна, контрагент увидит её на своей странице. */
function RejectDialog({
  file,
  open,
  onClose,
  onDone,
}: {
  file: SentFileItem;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useSentRefresh();
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    // Как прототип: пробелы и переводы строк — один пробел; пустая причина — «Укажите причину».
    const why = reason.replace(/\s+/g, ' ').trim();
    if (!why) return setError(t('err.sent_reason_empty'));
    setBusy(true);
    const res = await rejectSent(file, why);
    setBusy(false);
    if (!res.ok) {
      if (res.error.code === 'sent_reason_empty' || res.error.code === 'sent_reason_long')
        return setError(errorText(res.error));
      onClose();
      await refresh();
      return toast(errorText(res.error), { bad: true, icon: 'alert' });
    }
    onClose();
    await refresh();
    onDone();
    toast(t('files.sent.rejected'), { icon: 'ban' });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('files.sent.reject.title')}
      sub={file.name}
      kind="form"
      noMax
      dirty={reason !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-sent-reject-ok=""
            className={buttonClass('danger')}
            disabled={busy}
            onClick={() => void submit()}
          >
            {t('files.sent.reject')}
          </button>
        </>
      }
    >
      <FormGrid>
        <Field
          id={`${id}-why`}
          label={t('files.sent.reject.reason')}
          required
          full
          hint={t('files.sent.reject.hint')}
          error={error}
        >
          {(control) => (
            <textarea
              {...control}
              data-sent-reason-input=""
              maxLength={SENT_FILE_REASON_MAX}
              placeholder={t('files.sent.reject.placeholder')}
              className={`${inputClass()} min-h-[72px] resize-y leading-normal`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
      </FormGrid>
    </Modal>
  );
}

/**
 * Окно отправленного файла (прототип v126 `sntOpen` → `fileView`): окно просмотра с «‹ ›» по файлам того
 * же списка, под просмотром — откуда и кто прислал, статус, срок удаления; у нового — «Отклонить»,
 * «Принять только файл» (чек с оплатой) и «Принять» для файла, который сейчас в окне.
 */
function SentFileViewer({
  files,
  index,
  onClose,
  onAccept,
  onAcceptFile,
  onReject,
}: {
  files: readonly SentFileItem[];
  index: number;
  onClose: () => void;
  onAccept: (file: SentFileItem) => void;
  onAcceptFile: (file: SentFileItem) => void;
  onReject: (file: SentFileItem) => void;
}) {
  const t = useT();
  const byId = new Map(files.map((f) => [f.id, f]));
  const itemsOf = (file: SentFileItem): KeyValueItem[] => {
    const decided = file.decidedAt
      ? t('files.sent.view.decided', { who: file.decidedBy ?? '—', at: momentText(file.decidedAt) })
      : null;
    return [
      { id: 'cp', label: t('files.sent.col.cp'), value: file.contractor.name },
      { id: 'src', label: t('files.sent.col.src'), value: sentSourceText(t, file.source) },
      { id: 'who', label: t('files.sent.col.who'), value: sentWhoText(t, file) },
      { id: 'at', label: t('files.sent.col.at'), value: momentText(file.sentAt) },
      ...(file.comment
        ? [{ id: 'note', label: t('files.sent.col.note'), value: file.comment }]
        : []),
      {
        id: 'st',
        label: t('files.sent.col.st'),
        value: (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <SentStatusPill status={file.status} />
            {file.status === 'rejected' && file.rejectReason ? (
              <span className="text-xs text-muted">{file.rejectReason}</span>
            ) : null}
            {decided ? <span className="text-xs text-muted">· {decided}</span> : null}
          </span>
        ),
      },
      ...(file.daysLeft !== null
        ? [
            {
              id: 'purge',
              label: t('files.sent.view.purge'),
              value: sentLeftText(t, file.daysLeft),
            },
          ]
        : []),
    ];
  };
  const buttons = (file: SentFileItem) => {
    // Решённый файл — только «Закрыть» (прототип v127 `sntOpen`): своя кнопка места заменяет «Закрыть» окна.
    if (file.status !== 'new') {
      return (
        <button
          type="button"
          data-sent-window-close=""
          className={buttonClass('cta')}
          onClick={onClose}
        >
          {t('btn.close')}
        </button>
      );
    }
    const why = file.canDecide ? undefined : t('files.sent.why');
    return (
      <>
        <button
          type="button"
          data-sent-window-reject=""
          className={buttonClass('danger')}
          disabled={!file.canDecide}
          title={why}
          onClick={() => onReject(file)}
        >
          <Icon name="ban" size="sm" />
          {t('files.sent.reject')}
        </button>
        {file.pay ? (
          <button
            type="button"
            data-sent-window-accept-file=""
            className={buttonClass('default')}
            disabled={!file.canDecide}
            title={why ?? t('files.sent.accept_only.title')}
            onClick={() => onAcceptFile(file)}
          >
            <Icon name="file" size="sm" />
            {t('files.sent.accept_only')}
          </button>
        ) : null}
        <button
          type="button"
          data-sent-window-accept=""
          className={buttonClass('cta')}
          disabled={!file.canDecide}
          title={why}
          onClick={() => onAccept(file)}
        >
          <Icon name="check" size="sm" />
          {t('files.sent.accept')}
        </button>
      </>
    );
  };
  return (
    <FileViewer
      files={files.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        contentType: f.contentType,
      }))}
      index={index}
      src={sentViewSrc}
      download={sentDownloadHref}
      onClose={onClose}
      sub={(f) => {
        const file = byId.get(f.id);
        return file ? t('files.sent.view.sub', { src: sentSourceText(t, file.source) }) : null;
      }}
      info={(f) => {
        const file = byId.get(f.id);
        return file ? (
          <Box>
            <div data-sent-window={file.id}>
              <KeyValues items={itemsOf(file)} />
            </div>
          </Box>
        ) : null;
      }}
      footer={(f) => {
        const file = byId.get(f.id);
        return file ? buttons(file) : null;
      }}
    />
  );
}

/**
 * Действия над отправленным файлом — общие для вкладки и раздела карточки (прототип `sntActs`):
 * «Открыть», «Скачать», у нового — «Принять», у чека с оплатой — ещё «Принять только файл» (прототип
 * v121), «Отклонить» (без права «Загружать файлы» — недоступны с причиной), «Открыть контрагента». Окна —
 * `dialogs` в разметку экрана.
 */
export function useSentActions(o: {
  withContractor: boolean;
  /** Файлы списка на экране — по ним листает окно просмотра. */
  list?: readonly SentFileItem[];
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useSentRefresh();
  const [card, setCard] = useState<DialogSlot<{
    files: readonly SentFileItem[];
    index: number;
  }> | null>(null);
  const [reject, setReject] = useState<DialogSlot<SentFileItem> | null>(null);

  const download = useCallback(
    async (file: SentFileItem) => {
      const res = await callApi(() =>
        api.api.files.sent[':id'].link.$get({ param: { id: file.id }, query: { download: '1' } }),
      );
      if (!res.ok) return toast(errorText(res.error), { bad: true, icon: 'alert' });
      globalThis.location.assign(FileLink.parse(res.data).url);
    },
    [toast, errorText],
  );

  // Чек с оплатой (прототип v121 `sntAccept`): «Принять» открывает «Принять деньги» или «Принять оплату
  // за обслуживание» с чеком в поле файлов — чек «Новый», пока деньги не сохранены. Деньги месяца уже
  // получены, нет права на деньги, обычный файл — принят сразу; «Принять только файл» — без окна денег.
  const money = useReceiptMoney(() => void refresh());
  const takeMoney = money.take;
  const acceptNow = useCallback(
    async (file: SentFileItem, done: string, icon: 'check' | 'info') => {
      const res = await acceptSent(file);
      await refresh();
      if (!res.ok) return toast(errorText(res.error), { bad: true, icon: 'alert' });
      toast(done, { icon });
    },
    [refresh, toast, errorText],
  );
  const accept = useCallback(
    async (file: SentFileItem) => {
      if (file.pay) {
        const taken = await takeMoney(file.contractor.id, file.pay, {
          sentId: file.id,
          name: file.name,
          version: file.version,
        });
        if (taken.kind === 'opened') return;
        if (taken.kind === 'failed') return toast(t('err.unknown'), { bad: true, icon: 'alert' });
        if (taken.kind === 'received') {
          return acceptNow(file, t('files.sent.accepted_got', { got: taken.text }), 'info');
        }
      }
      return acceptNow(file, t('files.sent.accepted'), 'check');
    },
    [acceptNow, takeMoney, toast, t],
  );
  const acceptFile = useCallback(
    (file: SentFileItem) => acceptNow(file, t('files.sent.accepted_only'), 'check'),
    [acceptNow, t],
  );

  // Окно просмотра листает по файлам того же списка (`o.list` — строки на экране, в их порядке); файла
  // в списке нет — только этот файл.
  const open = (file: SentFileItem, list = o.list) => {
    const index = list?.findIndex((f) => f.id === file.id) ?? -1;
    setCard(openSlot(index < 0 ? { files: [file], index: 0 } : { files: list!, index }));
  };
  const askReject = useCallback((file: SentFileItem) => setReject(openSlot(file)), []);

  const actions = (file: SentFileItem): ActionEntry[] => {
    const fresh = file.status === 'new';
    const why = file.canDecide ? undefined : t('files.sent.why');
    return [
      { id: 'open', label: t('files.act.open'), icon: 'eye', run: () => open(file) },
      {
        id: 'download',
        label: t('files.act.download'),
        icon: 'download',
        run: () => void download(file),
      },
      ...(fresh
        ? [
            {
              id: 'accept',
              label: t('files.sent.accept'),
              icon: 'check' as const,
              disabled: !file.canDecide,
              reason: why,
              run: () => void accept(file),
            },
            ...(file.pay
              ? [
                  {
                    id: 'accept-file',
                    label: t('files.sent.accept_only'),
                    icon: 'file' as const,
                    disabled: !file.canDecide,
                    reason: why,
                    run: () => void acceptFile(file),
                  },
                ]
              : []),
            {
              id: 'reject',
              label: t('files.sent.reject'),
              icon: 'ban' as const,
              danger: true,
              disabled: !file.canDecide,
              reason: why,
              run: () => askReject(file),
            },
          ]
        : []),
      ...(o.withContractor
        ? [
            { id: 'sep', separator: true as const },
            {
              id: 'cp',
              label: t('files.sent.open_cp'),
              icon: 'building' as const,
              run: () => openContractorCard({ id: file.contractor.id }, 'files'),
            },
          ]
        : []),
    ];
  };

  const dialogs: ReactNode = (
    <>
      {card?.open ? (
        <SentFileViewer
          key={`sent-${card.n}`}
          files={card.data.files}
          index={card.data.index}
          onClose={() => setCard(closeSlot)}
          onAccept={(file) => {
            setCard(closeSlot);
            void accept(file);
          }}
          onAcceptFile={(file) => {
            setCard(closeSlot);
            void acceptFile(file);
          }}
          onReject={(file) => {
            setCard(closeSlot);
            askReject(file);
          }}
        />
      ) : null}
      {reject ? (
        <RejectDialog
          key={`sent-reject-${reject.n}`}
          file={reject.data}
          open={reject.open}
          onClose={() => setReject(closeSlot)}
          onDone={() => {}}
        />
      ) : null}
      {money.dialogs}
    </>
  );

  return { actions, open, accept, askReject, dialogs };
}

/** По умолчанию — сначала «Новые», внутри — от новых к старым (прототип `sort: {key: 'ord', dir: -1}`). */
export const SENT_DEFAULT_SORT: ListSort = { key: 'ord', dir: 'desc' };
/** Видимые по умолчанию — все, кроме служебного «Порядок» (прототип `hide: true`). */
export const SENT_DEFAULT_VISIBLE = [
  'name',
  'cp',
  'st',
  'src',
  'who',
  'at',
  'note',
  'resp',
  'left',
];

/** Столбцы вкладки «Файлы от контрагентов» — как в прототипе (`renderSent`), ключи — как на сервере. */
export function sentColumns(t: Translate): GridColumn<SentFileRow>[] {
  return [
    {
      key: 'name',
      label: t('files.sent.col.name'),
      type: 'text',
      width: 280,
      text: (r) => r.name,
      cell: (r) => (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon name="file" size="sm" className="shrink-0 text-muted" />
          <span className="truncate font-semibold">{r.name}</span>
        </span>
      ),
    },
    {
      key: 'cp',
      label: t('files.sent.col.cp'),
      type: 'enum',
      width: 210,
      text: (r) => r.contractor.name,
    },
    {
      key: 'st',
      label: t('files.sent.col.st'),
      type: 'enum',
      width: 130,
      text: (r) => sentStatusText(t, r.status),
      cell: (r) => <StatusCell file={r} />,
    },
    {
      key: 'src',
      label: t('files.sent.col.src'),
      type: 'enum',
      width: 110,
      text: (r) => sentSourceText(t, r.source),
    },
    {
      key: 'who',
      label: t('files.sent.col.who'),
      type: 'text',
      width: 170,
      text: (r) => sentWhoText(t, r),
    },
    {
      key: 'at',
      label: t('files.sent.col.at'),
      type: 'date',
      width: 110,
      text: (r) => formatDateRu(r.sentDate),
    },
    {
      key: 'note',
      label: t('files.sent.col.note'),
      type: 'text',
      width: 220,
      text: (r) => r.comment ?? '',
    },
    {
      key: 'resp',
      label: t('files.sent.col.resp'),
      type: 'enum',
      width: 150,
      text: (r) => r.responsible ?? '',
    },
    {
      key: 'left',
      label: t('files.sent.col.left'),
      type: 'int',
      width: 150,
      text: (r) => (r.daysLeft === null ? '' : String(r.daysLeft)),
      cell: (r) =>
        r.daysLeft === null ? <span className="text-faint">—</span> : String(r.daysLeft),
    },
    {
      key: 'ord',
      label: t('files.sent.col.ord'),
      type: 'text',
      width: 120,
      text: (r) => `${r.status === 'new' ? '2' : '1'}${r.sentAt}`,
    },
  ];
}

/**
 * Вкладка «Файлы от контрагентов» Файлового менеджера (прототип `renderSent`): файлы всех контрагентов
 * в области «Файлового менеджера», сначала «Новые»; строка открывает окно файла, в «⋯» — `sntActs`.
 */
export function SentFilesTab({ after }: { after?: ReactNode }) {
  const t = useT();
  const labels = useGridLabels('files.sent.count');
  const { search, clearSearch, access } = useShell();
  const columns = useMemo(() => sentColumns(t), [t]);
  const view = useViewSettings(SENT_GRID_KEY);

  const fetchPage = useCallback<FetchListPage<SentFileRow>>(async (params) => {
    const res = await api.api.files.sent.$get({ query: params });
    if (!res.ok) throw await apiFailure(res);
    return SentFileListPage.parse(await res.json());
  }, []);
  const loadValues = useCallback(async (col: string, q?: string) => {
    const res = await api.api.files.sent.values.$get({ query: q ? { col, q } : { col } });
    if (!res.ok) throw await apiFailure(res);
    return ListValues.parse(await res.json());
  }, []);
  const list = useListPage({
    gridKey: SENT_GRID_KEY,
    columns,
    defaultVisible: SENT_DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: SENT_DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage,
  });
  const sent = useSentActions({ withContractor: true, list: list.data?.items });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.files.sent.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);

  return (
    <div data-files-sent="" className="flex flex-col gap-3.5">
      <DataGrid
        columns={columns}
        defaultVisible={SENT_DEFAULT_VISIBLE}
        defaultSort={SENT_DEFAULT_SORT}
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
        empty={
          <EmptyState
            icon="upload"
            title={t('files.sent.empty.title')}
            text={t('files.sent.empty.text')}
          />
        }
        rowKey={(r) => r.id}
        titleKey="name"
        label={t('files.tab.sent')}
        labels={labels}
        actions={sent.actions}
        onOpen={(r) => sent.open(r)}
      />
      {sent.dialogs}
      {after}
    </div>
  );
}

/**
 * Раздел «Отправленные файлы» вкладки «Файлы» карточки контрагента (прототип `sntBox`): над документами
 * и только когда в нём есть строки; от новых к старым, у нового — «Принять» и «Отклонить».
 */
export function ContractorSentBox({ contractorId }: { contractorId: string }) {
  const t = useT();
  const { access } = useShell();
  const sent = useQuery({
    ...contractorSentQuery(contractorId),
    enabled: access.feature('cppage'),
  });
  const acts = useSentActions({ withContractor: false, list: sent.data?.items });
  const data = sent.data;
  if (!data?.items.length) return null;
  const why = (f: SentFileItem) => (f.canDecide ? undefined : t('files.sent.why'));
  return (
    <Box>
      <div data-cp-sent="">
        <h3 className="m-0 mb-2 flex items-center gap-1.5 text-[14px] font-semibold text-ink">
          <Icon name="upload" size="sm" />
          {t('files.sent.title')}
          {data.newCount ? (
            <span data-cp-sent-new="">
              <CountBadge count={{ value: data.newCount, title: t('files.sent.new') }} />
            </span>
          ) : null}
        </h3>
        <MiniTable
          label={t('files.sent.title')}
          empty=""
          columns={[
            { key: 'name', label: t('files.sent.col.name') },
            { key: 'src', label: t('files.sent.col.src') },
            { key: 'who', label: t('files.sent.col.who') },
            { key: 'at', label: t('files.sent.col.at') },
            { key: 'note', label: t('files.sent.col.note') },
            { key: 'st', label: t('files.sent.col.st') },
            { key: 'left', label: t('files.sent.col.left_short') },
            // Кнопки с подписями — обычная ячейка и на телефоне (прототип: `.snt-acts`, не `m-act`).
            { key: 'acts', label: '', numeric: true },
          ]}
          rows={data.items.map((f) => ({
            key: f.id,
            cells: {
              name: (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="file" size="sm" />
                    {f.name}
                  </span>
                  <div className="text-xs text-faint">{fileMeta(t, f.name, f.size)}</div>
                </>
              ),
              src: <span className="text-muted">{sentSourceText(t, f.source)}</span>,
              who: <span className="text-muted">{sentWhoText(t, f)}</span>,
              at: <span className="whitespace-nowrap text-muted">{momentText(f.sentAt)}</span>,
              note: <span className="text-muted [overflow-wrap:anywhere]">{f.comment ?? ''}</span>,
              st: <StatusCell file={f} />,
              left: (
                <span className="whitespace-nowrap text-muted">
                  {f.daysLeft === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    sentInText(t, f.daysLeft)
                  )}
                </span>
              ),
              acts:
                f.status === 'new' ? (
                  <span className="inline-flex flex-col items-stretch gap-1">
                    <button
                      type="button"
                      data-sent-accept=""
                      className={buttonClass('default', 'sm')}
                      disabled={!f.canDecide}
                      title={why(f)}
                      onClick={(e) => {
                        e.stopPropagation();
                        void acts.accept(f);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Icon name="check" size="sm" />
                      {t('files.sent.accept')}
                    </button>
                    <button
                      type="button"
                      data-sent-reject=""
                      className={buttonClass('ghost', 'sm')}
                      disabled={!f.canDecide}
                      title={why(f)}
                      onClick={(e) => {
                        e.stopPropagation();
                        acts.askReject(f);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Icon name="ban" size="sm" />
                      {t('files.sent.reject')}
                    </button>
                  </span>
                ) : null,
            },
            wide: ['name', 'note'],
            // На телефоне пустые значения не показываются (прототип: `m-empty`).
            blank: [
              ...(f.comment ? [] : ['note']),
              ...(f.daysLeft === null ? ['left'] : []),
              ...(f.status === 'new' ? [] : ['acts']),
            ],
          }))}
          onOpen={(key) => {
            const file = data.items.find((f) => f.id === key);
            if (file) acts.open(file);
          }}
        />
        <Hint>{t('files.sent.hint')}</Hint>
      </div>
      {acts.dialogs}
    </Box>
  );
}

/**
 * Строка «Файлы от контрагента» блока «Страница контрагента» карточки (прототип v112 `pgBox`,
 * `data-pg-up`): галочка «Контрагент может отправлять файлы»; выключена в учётной политике — галочка
 * недоступна с пояснением. Видна, когда страница включена и раздел «Файлы» есть у организации.
 */
export function SentUploadRow({
  contractorId,
  pageVersion,
}: {
  contractorId: string;
  pageVersion: number | null;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const state = useQuery(sentUploadQuery(contractorId, pageVersion)).data;
  const [busy, setBusy] = useState(false);
  if (!state?.shown) return null;
  const toggle = async (on: boolean) => {
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors[':id'].page['sent-upload'].$post({
        param: { id: contractorId },
        json: { on, version: state.version! },
      }),
    );
    setBusy(false);
    if (!res.ok) {
      toast(errorText(res.error), { bad: true, icon: 'alert' });
    } else {
      const next = SentUploadState.parse(res.data);
      client.setQueryData(sentUploadQuery(contractorId, next.version).queryKey, next);
      toast(t(on ? 'files.sent.upload.on' : 'files.sent.upload.off'));
    }
    // Страница сменила версию — блок «Страница контрагента» перечитывает её, история — новую запись.
    await Promise.all([
      client.invalidateQueries({ queryKey: contractorPageQuery(contractorId).queryKey }),
      client.invalidateQueries({ queryKey: ['files', 'sent', 'upload', contractorId] }),
      client.invalidateQueries({ queryKey: ['contractors', 'history', contractorId] }),
    ]);
  };
  return (
    <div data-cp-sent-upload="" className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-faint">{t('files.sent.upload.label')}</span>
      <label className="inline-flex items-center gap-1.5 text-[13px]">
        <input
          type="checkbox"
          className={CHECKBOX_CLASS}
          data-cp-sent-upload-check=""
          checked={state.on && state.orgOn}
          disabled={busy || state.manage !== null || !state.orgOn}
          title={state.manage ? t(`err.${state.manage}`) : undefined}
          onChange={(e) => void toggle(e.target.checked)}
        />
        {t('files.sent.upload')}
      </label>
      <Hint>{t(state.orgOn ? 'files.sent.upload.hint' : 'files.sent.upload.org_off')}</Hint>
    </div>
  );
}
