'use client';

import {
  excelColumn,
  formatCount,
  formatMomentRu,
  KPI_IMPORT_MAX_BYTES,
  pluralForm,
  type YearMonth,
} from '@buhuchet/domain';
import {
  KpiImportApplied,
  KpiImportHistory,
  KpiImportOptions,
  KpiImportPreview,
  KpiImportTemplatePreview,
  type KpiImportItem,
  type KpiImportRecord,
} from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  EmptyState,
  Field,
  FormGrid,
  Icon,
  inputClass,
  MiniTable,
  miniWide,
  Modal,
  Note,
  Pill,
  Plate,
  Plates,
  Segments,
  useToast,
} from '@buhuchet/ui';
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { exportFailureText, exportFileName, saveFile } from '../lists/export';
import { useKpiRefresh } from './kpi-data';
import { monthName, numberText, valueText } from './kpi-format';
import { OFF_CELL } from './kpi-table';

/*
 * Окно «Ввод из Excel» (задача 2.28; ТЗ «Показатели контрагентов» → «Ввод из Excel»; прототип
 * modules/kpi-excel.js, kxDlg): шаг 1 — период, фильтр и показатели, предпросмотр листа и «Скачать
 * шаблон .xlsx»; шаг 2 — выбор или перетаскивание заполненного шаблона, плашки «Новые», «Изменённые»,
 * «Без изменений», «Ошибки», таблицы и «Применить» (изменения проверенных — с подтверждением);
 * «История загрузок». Файл разбирает сервер: он приходит на предпросмотр, «Применить» и файл ошибок.
 */

type Step = 'tpl' | 'load';

interface Filter {
  from: YearMonth;
  to: YearMonth;
  resp: string;
  reg: string;
  q: string;
  inds: readonly string[];
}

interface Loaded {
  file: File;
  preview: KpiImportPreview;
}

/** Строк предпросмотра листа «Показатели» (прототип: «первые 8 строк»). */
const PREVIEW_ROWS = 8;

const UPLOAD_HEADERS = { 'content-type': 'application/octet-stream' };
const ACCEPT =
  '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';

const optionsQuery = queryOptions({
  queryKey: ['kpi', 'import', 'options'],
  queryFn: async () => {
    const res = await api.api.kpi.import.options.$get();
    if (!res.ok) throw await apiFailure(res);
    return KpiImportOptions.parse(await res.json());
  },
});

const templateQuery = (f: Filter) => {
  const query = {
    from: f.from,
    to: f.to,
    inds: f.inds.join(','),
    ...(f.resp ? { resp: f.resp } : {}),
    ...(f.reg ? { reg: f.reg } : {}),
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
  };
  return queryOptions({
    queryKey: ['kpi', 'import', 'template', query],
    queryFn: async () => {
      const res = await api.api.kpi.import.template.preview.$get({ query });
      if (!res.ok) throw await apiFailure(res);
      return KpiImportTemplatePreview.parse(await res.json());
    },
    placeholderData: keepPreviousData,
  });
};

const historyQuery = queryOptions({
  queryKey: ['kpi', 'import', 'history'],
  queryFn: async () => {
    const res = await api.api.kpi.import.history.$get();
    if (!res.ok) throw await apiFailure(res);
    return KpiImportHistory.parse(await res.json());
  },
});

/** Окно «Ввод из Excel»: данные шага 1 загружаются до открытия — фокус сразу в первом поле. */
export function useKpiImport() {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const [slot, setSlot] = useState<DialogSlot<KpiImportOptions> | null>(null);
  const open = useCallback(async () => {
    try {
      setSlot(openSlot(await client.fetchQuery({ ...optionsQuery, staleTime: 0 })));
    } catch {
      toast(t('err.unknown'), { bad: true });
    }
  }, [client, toast, t]);
  const dialog = slot ? (
    <KpiImportDialog
      key={`kpi-import-${slot.n}`}
      open={slot.open}
      onClose={() => setSlot(closeSlot)}
      options={slot.data}
    />
  ) : null;
  return { open, dialog };
}

/** Текст словаря с вставками-элементами вместо `{имя}` (подсветка «проверенные», «невключённые»). */
function richText(text: string, parts: Readonly<Record<string, ReactNode>>): ReactNode[] {
  return text.split(/\{(\w+)\}/).map((piece, i) => (i % 2 ? (parts[piece] ?? piece) : piece));
}

function KpiImportDialog({
  open,
  onClose,
  options,
}: {
  open: boolean;
  onClose: () => void;
  options: KpiImportOptions;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>('tpl');
  const [history, setHistory] = useState(false);
  const [filter, setFilter] = useState<Filter>(() => ({
    from: options.defaultMonth,
    to: options.defaultMonth,
    resp: '',
    reg: '',
    q: '',
    inds: options.indicators.map((i) => i.id),
  }));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [done, setDone] = useState<KpiImportRecord | null>(null);

  const steps = (
    <div className="mb-3" data-kpi-import-steps="">
      <Segments<Step>
        label={t('kpi.import.title')}
        fill="wrap"
        value={step}
        onChange={setStep}
        options={[
          { value: 'tpl', label: t('kpi.import.step.tpl') },
          { value: 'load', label: t('kpi.import.step.load') },
        ]}
      />
    </div>
  );
  const historyButton = (
    <button
      type="button"
      className={buttonClass('ghost')}
      onClick={() => setHistory(true)}
      data-kpi-import-history-open=""
    >
      <Icon name="history" size="sm" />
      {t('kpi.import.history')}
    </button>
  );

  if (history) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        kind="form"
        size="wide"
        title={t('kpi.import.history')}
        sub={t('kpi.import.history_sub')}
        footer={
          <>
            <button
              type="button"
              className={buttonClass('ghost')}
              onClick={() => setHistory(false)}
            >
              <Icon name="left" size="sm" />
              {t('kpi.import.back')}
            </button>
            <div className="flex-1" />
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('btn.done')}
            </button>
          </>
        }
      >
        <ImportHistory />
      </Modal>
    );
  }

  return step === 'tpl' ? (
    <TemplateStep
      open={open}
      onClose={onClose}
      options={options}
      filter={filter}
      onFilter={setFilter}
      steps={steps}
      historyButton={historyButton}
      onDownloaded={() => setStep('load')}
    />
  ) : (
    <LoadStep
      open={open}
      onClose={onClose}
      steps={steps}
      historyButton={historyButton}
      loaded={loaded}
      onLoaded={(l) => {
        setLoaded(l);
        setDone(null);
      }}
      done={done}
      onDone={setDone}
    />
  );
}

/* ───────────── Шаг 1: шаблон ───────────── */

function TemplateStep({
  open,
  onClose,
  options,
  filter,
  onFilter,
  steps,
  historyButton,
  onDownloaded,
}: {
  open: boolean;
  onClose: () => void;
  options: KpiImportOptions;
  filter: Filter;
  onFilter: (f: Filter) => void;
  steps: ReactNode;
  historyButton: ReactNode;
  onDownloaded: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  // Поиск уходит на сервер через 300 мс после последней буквы.
  const [q, setQ] = useState(filter.q);
  useEffect(() => {
    if (q === filter.q) return;
    const timer = setTimeout(() => onFilter({ ...filter, q }), 300);
    return () => clearTimeout(timer);
  }, [q, filter, onFilter]);
  const preview = useQuery(templateQuery(filter));
  const [busy, setBusy] = useState(false);
  const data = preview.data;
  const ready = !!data && !data.tooMany && data.contractors > 0 && data.columns > 0;

  const setPeriod = (from: string, to: string) => {
    if (!from || !to) return;
    const [a, b] = from <= to ? [from, to] : [to, from];
    onFilter({ ...filter, from: a as YearMonth, to: b as YearMonth });
  };
  const toggle = (indicatorId: string, on: boolean) =>
    onFilter({
      ...filter,
      inds: options.indicators
        .map((i) => i.id)
        .filter((i) => (i === indicatorId ? on : filter.inds.includes(i))),
    });

  const download = async () => {
    setBusy(true);
    try {
      const query = {
        from: filter.from,
        to: filter.to,
        inds: filter.inds.join(','),
        ...(filter.resp ? { resp: filter.resp } : {}),
        ...(filter.reg ? { reg: filter.reg } : {}),
        ...(filter.q.trim() ? { q: filter.q.trim() } : {}),
      };
      const res = await api.api.kpi.import.template.$get({ query });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        toast(exportFailureText(body, t, errorText, t('grid.export_failed')), {
          icon: 'alert',
          bad: true,
        });
        return;
      }
      const name = exportFileName(res.headers.get('content-disposition'));
      saveFile(await res.blob(), name);
      toast(t('kpi.import.downloaded', { name }), { icon: 'download' });
      onDownloaded();
    } catch {
      toast(t('grid.export_failed'), { icon: 'alert', bad: true });
    } finally {
      setBusy(false);
    }
  };

  const month = `${inputClass()} min-h-[35px]`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      title={t('kpi.import.title')}
      sub={t('kpi.import.sub')}
      footer={
        <>
          {historyButton}
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.close')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={!ready || busy}
            onClick={() => void download()}
            data-kpi-import-download=""
          >
            <Icon name="download" size="sm" />
            {t('kpi.import.download')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-kpi-import="tpl">
        {steps}
        <FormGrid>
          <Field id={`${id}-f`} label={t('kpi.import.from')}>
            <input
              id={`${id}-f`}
              type="month"
              className={month}
              value={filter.from}
              max={options.currentMonth}
              onChange={(e) => setPeriod(e.target.value, filter.to)}
            />
          </Field>
          <Field id={`${id}-t`} label={t('kpi.import.to')} hint={t('kpi.import.to_hint')}>
            <input
              id={`${id}-t`}
              type="month"
              className={month}
              value={filter.to}
              max={options.currentMonth}
              onChange={(e) => setPeriod(filter.from, e.target.value)}
            />
          </Field>
          <Field id={`${id}-resp`} label={t('kpi.import.resp')}>
            <select
              id={`${id}-resp`}
              className={inputClass()}
              value={filter.resp}
              onChange={(e) => onFilter({ ...filter, resp: e.target.value })}
            >
              <option value="">{t('kpi.import.resp_all')}</option>
              {options.responsibles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-reg`} label={t('kpi.import.reg')}>
            <select
              id={`${id}-reg`}
              className={inputClass()}
              value={filter.reg}
              onChange={(e) => onFilter({ ...filter, reg: e.target.value })}
            >
              <option value="">{t('kpi.import.reg_all')}</option>
              {options.regimes.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-q`} label={t('kpi.import.contractor')} full>
            <input
              id={`${id}-q`}
              type="search"
              className={inputClass()}
              value={q}
              placeholder={t('kpi.import.q_placeholder')}
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
          <div data-field="" data-full="" className="col-span-full flex min-w-0 flex-col gap-[5px]">
            <span className="text-[12px] font-semibold tracking-[.01em] text-muted">
              {t('kpi.import.inds')}
            </span>
            <div className="flex flex-wrap gap-1.5" data-kpi-import-inds="">
              {options.indicators.length ? (
                options.indicators.map((i) => {
                  const on = filter.inds.includes(i.id);
                  return (
                    <label
                      key={i.id}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-raised px-[11px] py-1 text-[12.5px] ${on ? 'border-accent text-ink' : 'border-line text-muted'}`}
                    >
                      <input
                        type="checkbox"
                        className="m-0 accent-accent"
                        checked={on}
                        onChange={(e) => toggle(i.id, e.target.checked)}
                      />
                      {i.name}
                    </label>
                  );
                })
              ) : (
                <span className="text-faint">{t('kpi.no_indicators')}</span>
              )}
            </div>
          </div>
        </FormGrid>
        {data?.tooMany ? (
          <Note tone="warn">
            {t(
              data.tooMany === 'months'
                ? 'err.import_too_many_months'
                : 'err.import_too_many_contractors',
            )}
          </Note>
        ) : null}
        {/* Период длиннее 72 месяцев шаблон не считает — только предупреждение. */}
        {data && !(data.tooMany === 'months' && data.contractors === 0) ? (
          <TemplateSummary data={data} />
        ) : null}
        {data && data.contractors > 0 && data.columns > 0 ? (
          <TemplateTable data={data} />
        ) : data && !data.tooMany ? (
          <EmptyState
            icon="gauge"
            title={t('kpi.import.empty.title')}
            text={t('kpi.import.empty.text')}
          />
        ) : null}
      </div>
    </Modal>
  );
}

/** «В шаблоне N контрагентов и M столбцов показателей…» с подсветкой, как ячейки в файле. */
function TemplateSummary({ data }: { data: KpiImportTemplatePreview }) {
  const t = useT();
  const text = t('kpi.import.summary', {
    cps: t(`kpi.import.cps.${pluralForm(data.contractors)}`, { n: formatCount(data.contractors) }),
    cols: t(`kpi.import.cols.${pluralForm(data.columns)}`, { n: formatCount(data.columns) }),
    checked: '{checked}',
    off: '{off}',
  });
  return (
    <Note>
      {richText(text, {
        checked: (
          <span key="checked" className="rounded px-1 bg-ok-bg text-ok">
            {t('kpi.import.summary.checked')}
          </span>
        ),
        off: (
          <span key="off" className={`rounded px-1 ${OFF_CELL}`}>
            {t('kpi.import.summary.off')}
          </span>
        ),
      })}
    </Note>
  );
}

/** Предпросмотр листа «Показатели»: первые строки как в Excel — буквы столбцов и номера строк. */
function TemplateTable({ data }: { data: KpiImportTemplatePreview }) {
  const t = useT();
  const th =
    'border-b border-line px-2 py-1.5 text-left text-[11.5px] font-[650] whitespace-nowrap text-faint';
  const td = 'border-b border-line px-2 py-[7px] whitespace-nowrap';
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-[11.5px] font-bold tracking-[.08em] text-faint uppercase">
        {t('kpi.import.preview')}
        {data.contractors > PREVIEW_ROWS
          ? ` · ${t('kpi.import.preview_first', { shown: PREVIEW_ROWS, n: formatCount(data.contractors) })}`
          : ''}
      </h3>
      <div
        className="max-h-[330px] overflow-auto rounded-lg border border-line"
        data-kpi-import-preview=""
      >
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead className="sticky top-0 bg-pane">
            <tr>
              <th className={`${th} w-7 text-right`}>#</th>
              <th className={th}>A · {t('kpi.import.inn')}</th>
              <th className={th}>B · {t('kpi.import.contractor')}</th>
              {data.head.map((h, j) => (
                <th key={`${h.indicatorId}-${h.month}`} className={th}>
                  {excelColumn(j + 2)} · {h.title}
                  <small className="block font-[450] text-faint">{h.unit}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, k) => (
              <tr key={row.inn}>
                <td className={`${td} text-right text-faint`}>{k + 2}</td>
                <td className={`${td} bg-info-bg font-mono text-[.92em]`}>{row.inn}</td>
                <td className={`${td} bg-info-bg font-mono text-[.92em]`}>{row.name}</td>
                {row.cells.map((cell, j) => {
                  const type = data.head[j]!.type;
                  return (
                    <td
                      key={j}
                      data-cell={cell.kind}
                      className={`${td} text-right ${cell.kind === 'off' ? OFF_CELL : cell.kind === 'checked' ? 'bg-ok-bg text-ok' : ''}`}
                    >
                      {cell.kind === 'off' ? '' : numberText(type, cell.value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ───────────── Шаг 2: загрузка ───────────── */

function LoadStep({
  open,
  onClose,
  steps,
  historyButton,
  loaded,
  onLoaded,
  done,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  steps: ReactNode;
  historyButton: ReactNode;
  loaded: Loaded | null;
  onLoaded: (l: Loaded | null) => void;
  done: KpiImportRecord | null;
  onDone: (r: KpiImportRecord) => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useKpiRefresh();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState('');
  const [over, setOver] = useState(false);
  const [asking, setAsking] = useState(false);
  const p = loaded?.preview;
  const count = p && !done ? p.added + p.changed : 0;

  const read = async (file: File | undefined) => {
    if (!file) return;
    setReadError('');
    const fail = (error: string) =>
      setReadError(t('kpi.import.read_error', { name: file.name, error }));
    if (file.size > KPI_IMPORT_MAX_BYTES) return fail(t('err.import_file_too_big'));
    setBusy(true);
    const res = await callApi(() =>
      api.api.kpi.import.preview.$post(
        { query: { file: file.name } },
        { headers: UPLOAD_HEADERS, init: { body: file } },
      ),
    );
    setBusy(false);
    if (input.current) input.current.value = '';
    if (!res.ok) return fail(errorText(res.error));
    onLoaded({ file, preview: KpiImportPreview.parse(res.data) });
  };

  const apply = async (withChecked: boolean) => {
    if (!loaded) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.kpi.import.apply.$post(
        { query: { file: loaded.file.name, withChecked: String(withChecked) as 'true' | 'false' } },
        { headers: UPLOAD_HEADERS, init: { body: loaded.file } },
      ),
    );
    setBusy(false);
    if (!res.ok) {
      toast(errorText(res.error), { icon: 'alert', bad: true });
      return;
    }
    const applied = KpiImportApplied.parse(res.data);
    onLoaded({ file: loaded.file, preview: applied.preview });
    onDone(applied.record);
    const n = applied.record.added + applied.record.changed;
    const errors = applied.record.errors;
    toast(
      errors
        ? t('kpi.import.applied_errors', { n: formatCount(n), errors: formatCount(errors) })
        : t('kpi.import.applied', { n: formatCount(n) }),
      { icon: 'upload' },
    );
    void refresh();
    void client.invalidateQueries({ queryKey: historyQuery.queryKey });
  };

  const downloadErrors = async () => {
    if (!loaded) return;
    try {
      const res = await api.api.kpi.import.errors.$post(
        { query: { file: loaded.file.name } },
        { headers: UPLOAD_HEADERS, init: { body: loaded.file } },
      );
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        toast(exportFailureText(body, t, errorText, t('grid.export_failed')), {
          icon: 'alert',
          bad: true,
        });
        return;
      }
      const name = exportFileName(res.headers.get('content-disposition'));
      saveFile(await res.blob(), name);
      toast(t('kpi.import.errors_downloaded', { name }), { icon: 'download' });
    } catch {
      toast(t('grid.export_failed'), { icon: 'alert', bad: true });
    }
  };

  const drop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    void read(e.dataTransfer.files[0]);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      dirty={!!p && !done && count > 0}
      title={t('kpi.import.title')}
      sub={t('kpi.import.sub')}
      footer={
        <>
          {historyButton}
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t(done ? 'btn.done' : 'btn.close')}
          </button>
          {p && !done ? (
            <button
              type="button"
              className={buttonClass('cta')}
              disabled={!count || busy}
              onClick={() => (p.changedChecked ? setAsking(true) : void apply(true))}
              data-kpi-import-apply=""
            >
              <Icon name="check" size="sm" />
              {count ? t('kpi.import.apply_n', { n: formatCount(count) }) : t('kpi.import.apply')}
            </button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-3" data-kpi-import="load">
        {steps}
        {!loaded || !p ? (
          <>
            <label
              className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center text-muted ${over ? 'border-accent bg-info-bg' : 'border-line-strong bg-pane-alt'}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={drop}
              data-kpi-import-drop=""
            >
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                hidden
                onChange={(e) => void read(e.target.files?.[0])}
              />
              <Icon name="upload" size="lg" />
              <b className="text-ink">
                {busy ? t('kpi.import.drop.busy') : t('kpi.import.drop.title')}
              </b>
              <span className="max-w-[560px]">{t('kpi.import.drop.text')}</span>
            </label>
            {readError ? (
              <Note tone="warn" alert>
                {readError}
              </Note>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon name="file" size="sm" />
                <b className="truncate" data-kpi-import-file="">
                  {loaded.file.name}
                </b>
              </span>
              <div className="flex-1" />
              {done ? null : (
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => onLoaded(null)}
                >
                  <Icon name="refresh" size="sm" />
                  {t('kpi.import.again')}
                </button>
              )}
            </div>
            {done ? (
              <Note tone="ok">
                {t('kpi.import.done', {
                  added: formatCount(done.added),
                  changed: formatCount(done.changed),
                  skipped: done.skippedChecked
                    ? t('kpi.import.done.skipped', { n: formatCount(done.skippedChecked) })
                    : '',
                })}{' '}
                {p.errorCount ? t('kpi.import.done.errors') : ''}
              </Note>
            ) : null}
            <ImportPlates preview={p} />
            {p.errorCount ? (
              <ErrorsBox preview={p} onDownload={() => void downloadErrors()} />
            ) : null}
            {p.changed ? (
              <ItemsBox
                kind="changed"
                title={t('kpi.import.box.changed', { n: formatCount(p.changed) })}
                items={p.changedItems}
                total={p.changed}
              />
            ) : null}
            {p.added ? (
              <ItemsBox
                kind="added"
                title={t('kpi.import.box.added', { n: formatCount(p.added) })}
                items={p.addedItems}
                total={p.added}
              />
            ) : null}
          </>
        )}
        {p ? (
          <CheckedConfirm
            open={asking}
            n={p.changedChecked}
            onClose={() => setAsking(false)}
            onApply={(withChecked) => {
              setAsking(false);
              void apply(withChecked);
            }}
          />
        ) : null}
      </div>
    </Modal>
  );
}

/** Плашки шага 2 (прототип: `kxn`, `kxc`, `kxs`, `kxe`). */
function ImportPlates({ preview: p }: { preview: KpiImportPreview }) {
  const t = useT();
  return (
    <Plates static>
      <Plate
        id="kxn"
        icon="plus"
        color="blue"
        label={t('kpi.import.plate.added')}
        value={formatCount(p.added)}
        sub={t('kpi.import.plate.added_sub')}
      />
      <Plate
        id="kxc"
        icon="edit"
        color="orange"
        label={t('kpi.import.plate.changed')}
        value={formatCount(p.changed)}
        sub={
          p.changedChecked
            ? t('kpi.import.plate.changed_checked', { n: formatCount(p.changedChecked) })
            : t('kpi.import.plate.changed_sub')
        }
      />
      <Plate
        id="kxs"
        icon="ok"
        color="gray"
        label={t('kpi.import.plate.same')}
        value={formatCount(p.same)}
        sub={t('kpi.import.plate.same_sub')}
      />
      <Plate
        id="kxe"
        icon="alert"
        color={p.errorCount ? 'red' : 'green'}
        label={t('kpi.import.plate.errors')}
        value={formatCount(p.errorCount)}
        sub={
          !p.errorCount
            ? t('kpi.import.plate.errors_none')
            : p.skipped
              ? t('kpi.import.plate.errors_skipped', { n: formatCount(p.skipped) })
              : t('kpi.import.plate.errors_sub')
        }
      />
    </Plates>
  );
}

/** Показаны не все строки (сервер отдаёт первые 500 значений и 1 000 ошибок). */
function Shown({ shown, total }: { shown: number; total: number }) {
  const t = useT();
  if (shown >= total) return null;
  return (
    <span className="text-[12px] text-faint">
      {t('kpi.import.shown', { shown: formatCount(shown), n: formatCount(total) })}
    </span>
  );
}

const SCROLL = 'max-h-[240px] overflow-auto';

function ErrorsBox({
  preview: p,
  onDownload,
}: {
  preview: KpiImportPreview;
  onDownload: () => void;
}) {
  const t = useT();
  const columns = [
    { key: 'ref', label: t('kpi.import.errors.ref') },
    { key: 'row', label: t('kpi.import.errors.row'), numeric: true },
    { key: 'col', label: t('kpi.import.errors.col') },
    { key: 'cp', label: t('kpi.import.contractor') },
    { key: 'value', label: t('kpi.import.errors.value') },
    { key: 'problem', label: t('kpi.import.errors.problem') },
  ];
  return (
    <Box
      title={t('kpi.import.plate.errors')}
      actions={
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={onDownload}
          data-kpi-import-errors-download=""
        >
          <Icon name="download" size="sm" />
          {t('kpi.import.errors_download')}
        </button>
      }
    >
      <div className={SCROLL} data-kpi-import-errors="">
        <MiniTable
          label={t('kpi.import.plate.errors')}
          empty=""
          columns={columns}
          rows={p.errors.map((e) => {
            const problem = t(`kpi.import.problem.${e.problem}`);
            return {
              key: `${e.ref}-${e.problem}`,
              cells: {
                ref: <b className="font-mono">{e.ref}</b>,
                row: e.row,
                col: e.col,
                cp: e.contractor ?? '—',
                value: <span className="font-mono">{e.value}</span>,
                problem: <span className="text-danger">{problem}</span>,
              },
              wide: miniWide({ cp: e.contractor ?? '', value: e.value, problem }),
            };
          })}
        />
      </div>
      <Shown shown={p.errors.length} total={p.errorCount} />
    </Box>
  );
}

function ItemsBox({
  kind,
  title,
  items,
  total,
}: {
  kind: 'changed' | 'added';
  title: string;
  items: readonly KpiImportItem[];
  total: number;
}) {
  const t = useT();
  const columns =
    kind === 'changed'
      ? [
          { key: 'ref', label: t('kpi.import.errors.ref') },
          { key: 'cp', label: t('kpi.import.contractor') },
          { key: 'ind', label: t('kpi.import.col.indicator') },
          { key: 'month', label: t('kpi.import.col.month') },
          { key: 'old', label: t('kpi.import.col.old'), numeric: true },
          { key: 'value', label: t('kpi.import.col.new'), numeric: true },
          { key: 'chk', label: '' },
        ]
      : [
          { key: 'ref', label: t('kpi.import.errors.ref') },
          { key: 'cp', label: t('kpi.import.contractor') },
          { key: 'ind', label: t('kpi.import.col.indicator') },
          { key: 'month', label: t('kpi.import.col.month') },
          { key: 'value', label: t('kpi.import.errors.value'), numeric: true },
        ];
  return (
    <Box title={title}>
      <div className={SCROLL} data-kpi-import-items={kind}>
        <MiniTable
          label={title}
          empty=""
          columns={columns}
          rows={items.map((x) => ({
            key: x.ref,
            cells: {
              ref: <span className="font-mono">{x.ref}</span>,
              cp: x.contractor,
              ind: x.indicator,
              month: monthName(t, x.month),
              old: <span className="text-faint">{numberText(x.type, x.old)}</span>,
              value: (
                <b>{kind === 'changed' ? numberText(x.type, x.value) : valueText(x, x.value)}</b>
              ),
              chk: x.checked ? (
                <Pill tone="ok" size="sm">
                  {t('kpi.import.checked')}
                </Pill>
              ) : null,
            },
            wide: miniWide({ cp: x.contractor }),
          }))}
        />
      </div>
      <Shown shown={items.length} total={total} />
    </Box>
  );
}

/** «Изменить N проверенных значений?» (прототип: «Отмена», «Применить без них», «Изменить N»). */
function CheckedConfirm({
  open,
  n,
  onClose,
  onApply,
}: {
  open: boolean;
  n: number;
  onClose: () => void;
  onApply: (withChecked: boolean) => void;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="message"
      title={t(`kpi.import.confirm.${pluralForm(n)}`, { n: formatCount(n) })}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass()}
            onClick={() => onApply(false)}
            data-kpi-import-without=""
          >
            {t('kpi.import.confirm.without')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            onClick={() => onApply(true)}
            data-kpi-import-with=""
          >
            {t('kpi.import.confirm.with', { n: formatCount(n) })}
          </button>
        </>
      }
    >
      <p className="m-0 leading-[1.55] text-muted">{t('kpi.import.confirm.text')}</p>
    </Modal>
  );
}

/** Период загрузки: «сентябрь 2026» или «август 2026 — сентябрь 2026»; без значений — «—». */
function periodText(t: Translate, r: Pick<KpiImportRecord, 'from' | 'to'>): string {
  if (!r.from || !r.to) return '—';
  return r.from === r.to ? monthName(t, r.from) : `${monthName(t, r.from)} — ${monthName(t, r.to)}`;
}

/** «История загрузок» (прототип `kxHistHtml`): кто, когда, какой файл, сколько новых, изменённых, ошибок. */
function ImportHistory() {
  const t = useT();
  const q = useQuery(historyQuery);
  if (!q.data) return null;
  if (!q.data.items.length) {
    return (
      <EmptyState
        icon="history"
        title={t('kpi.import.history_empty.title')}
        text={t('kpi.import.history_empty.text')}
      />
    );
  }
  return (
    <div data-kpi-import-history="">
      <MiniTable
        label={t('kpi.import.history')}
        empty=""
        columns={[
          { key: 'at', label: t('kpi.import.hist.at') },
          { key: 'actor', label: t('kpi.import.hist.actor') },
          { key: 'file', label: t('kpi.import.hist.file') },
          { key: 'period', label: t('kpi.import.hist.period') },
          { key: 'added', label: t('kpi.import.hist.added'), numeric: true },
          { key: 'changed', label: t('kpi.import.hist.changed'), numeric: true },
          { key: 'errors', label: t('kpi.import.hist.errors'), numeric: true },
        ]}
        rows={q.data.items.map((r) => ({
          key: r.id,
          cells: {
            at: formatMomentRu(new Date(r.at)),
            actor: r.actor ?? '—',
            file: (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Icon name="file" size="sm" />
                <span className="[overflow-wrap:anywhere]">{r.fileName}</span>
              </span>
            ),
            period: periodText(t, r),
            added: formatCount(r.added),
            changed: (
              <>
                {formatCount(r.changed)}
                {r.skippedChecked ? (
                  <small className="ml-1 text-faint">
                    {t('kpi.import.hist.skipped', { n: formatCount(r.skippedChecked) })}
                  </small>
                ) : null}
              </>
            ),
            errors: (
              <span className={r.errors ? 'font-semibold text-danger' : ''}>
                {formatCount(r.errors)}
              </span>
            ),
          },
          wide: miniWide({ file: r.fileName }),
        }))}
      />
    </div>
  );
}
