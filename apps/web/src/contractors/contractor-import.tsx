'use client';

import {
  CP_IMPORT_COLUMNS,
  formatCount,
  importRequestRows,
  parseImportText,
  pluralForm,
  type CpImportColumn,
} from '@buhuchet/domain';
import {
  ContractorImportCheck,
  ContractorImportResult,
  ContractorImportTemplate,
  type ContractorImportRow,
} from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  Icon,
  inputClass,
  MONO_CLASS,
  Modal,
  Pill,
  TOUCH_AREA,
  useToast,
} from '@buhuchet/ui';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useId, useState, type ReactNode } from 'react';
import { ApiFailure, api, apiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { exportFailureText, saveFile } from '../lists/export';
import { useShell } from '../shell/context';
import { useContractorsRefresh } from './contractor-data';

/*
 * Загрузка контрагентов вставкой из Excel (задача 2.16; ТЗ «Загрузка текущих контрагентов при переходе на
 * систему»; прототип modules/contractor-import.js — importDlg, impTemplate). Шаг 1 — поле «Данные» и
 * «Выгрузить шаблон»; шаг 2 — таблица с выбором колонки над каждым столбцом, правкой ячеек, «Проверить» и
 * «ОК, создать N». Строки проверяет и создаёт сервер; строки с ошибками остаются в окне.
 */

/** Строка вставки: ячейки (правятся в таблице) и итог последней проверки; null — «не проверено». */
interface ImportRow {
  cells: string[];
  check: ContractorImportRow | null;
}

interface ImportTable {
  delimiter: '\t' | ';';
  hasHeader: boolean;
  map: CpImportColumn[];
  rows: ImportRow[];
}

/** Шапка и ячейки таблиц окна — как `.mini` прототипа (css/cards.css). */
const TH =
  'border-b border-line px-2 py-1.5 text-left align-middle text-[11.5px] font-[650] text-faint';
const TD = 'border-b border-line px-2 py-[7px] align-middle';
const SEC = 'm-0 text-[11.5px] font-bold tracking-[.08em] text-faint uppercase';

const templateQuery = queryOptions({
  queryKey: ['contractors', 'import', 'template'],
  queryFn: async () => {
    const res = await api.api.contractors.import.template.preview.$get();
    if (!res.ok) throw await apiFailure(res);
    return ContractorImportTemplate.parse(await res.json());
  },
});

/** Окно «Загрузка контрагентов из Excel»: `open` — открыть заново с пустым полем. */
export function useContractorImport(): { open: () => void; dialog: ReactNode } {
  const [slot, setSlot] = useState<DialogSlot<null> | null>(null);
  const open = useCallback(() => setSlot(openSlot(null)), []);
  const dialog = slot ? (
    <ImportDialog key={`cp-import-${slot.n}`} open={slot.open} onClose={() => setSlot(closeSlot)} />
  ) : null;
  return { open, dialog };
}

/** Ячейка строки с новым значением; недостающие слева досоздаются пустыми. */
function withCell(cells: readonly string[], index: number, value: string): string[] {
  const next = [...cells];
  while (next.length < index) next.push('');
  next[index] = value;
  return next;
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useContractorsRefresh();
  const client = useQueryClient();
  const { access } = useShell();
  const fee = access.feature('fee') && access.can('fee');
  const id = useId();
  const [text, setText] = useState('');
  const [textError, setTextError] = useState('');
  const [table, setTable] = useState<ImportTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState<DialogSlot<ContractorImportTemplate> | null>(null);

  // Готово к загрузке — только когда проверены все строки (прототип: `rows.every(r => r.errs)`).
  const ready =
    table && table.rows.every((r) => r.check)
      ? table.rows.filter((r) => !r.check!.errors.length).length
      : 0;

  const parse = () => {
    const parsed = parseImportText(text);
    if (!parsed?.rows.length) {
      setTextError(t('cp.import.empty'));
      return;
    }
    setTable({ ...parsed, rows: parsed.rows.map((cells) => ({ cells, check: null })) });
  };

  const setColumn = useCallback((index: number, col: CpImportColumn) => {
    // Другая колонка меняет смысл ячеек — все строки снова «не проверено».
    setTable(
      (tb) =>
        tb && {
          ...tb,
          map: tb.map.map((c, i) => (i === index ? col : c)),
          rows: tb.rows.map((r) => ({ cells: r.cells, check: null })),
        },
    );
  }, []);
  const setCell = useCallback((row: number, cell: number, value: string) => {
    setTable(
      (tb) =>
        tb && {
          ...tb,
          rows: tb.rows.map((r, i) =>
            i === row ? { cells: withCell(r.cells, cell, value), check: null } : r,
          ),
        },
    );
  }, []);

  const request = (tb: ImportTable) => ({
    map: tb.map,
    rows: importRequestRows(
      tb.map,
      tb.rows.map((r) => r.cells),
    ),
  });

  const check = async () => {
    if (!table || busy) return;
    const sent = table;
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors.import.check.$post({ json: request(sent) }),
    );
    setBusy(false);
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      return;
    }
    const data = ContractorImportCheck.parse(res.data);
    setTable((tb) =>
      tb === sent
        ? { ...tb, rows: tb.rows.map((r, i) => ({ cells: r.cells, check: data.rows[i] ?? null })) }
        : tb,
    );
  };

  const create = async () => {
    if (!table || busy || !ready) return;
    const sent = table;
    setBusy(true);
    const res = await callApi(() => api.api.contractors.import.$post({ json: request(sent) }));
    setBusy(false);
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      return;
    }
    const data = ContractorImportResult.parse(res.data);
    if (data.created) refresh();
    // Созданные строки уходят из таблицы, строки с ошибками остаются со своими ошибками.
    const left = sent.rows
      .map((r, i) => ({ cells: r.cells, check: data.rows[i] ?? null }))
      .filter((r) => r.check?.errors.length);
    toast(t('cp.import.done', { n: formatCount(data.created), m: formatCount(data.skipped) }), {
      icon: 'building',
    });
    if (!left.length) onClose();
    else setTable({ ...sent, rows: left });
  };

  const openTemplate = async () => {
    try {
      setTemplate(openSlot(await client.fetchQuery({ ...templateQuery, staleTime: 0 })));
    } catch (e) {
      toast(e instanceof ApiFailure ? errorText(e.error) : t('err.unknown'), { bad: true });
    }
  };

  const templateDialog = template ? (
    <TemplateDialog
      key={`cp-import-tpl-${template.n}`}
      open={template.open}
      onClose={() => setTemplate(closeSlot)}
      data={template.data}
    />
  ) : null;

  if (!table) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        kind="form"
        size="wide"
        dirty={!!text.trim()}
        title={t('cp.import.title')}
        sub={t('cp.import.sub')}
        footer={
          <>
            <button type="button" className={buttonClass('ghost')} onClick={onClose}>
              {t('btn.cancel')}
            </button>
            <button
              type="button"
              className={buttonClass('cta')}
              onClick={parse}
              data-cp-import-parse=""
            >
              {t('cp.import.parse')}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3" data-cp-import="text">
          <Field
            id={`${id}-text`}
            label={t('cp.import.data')}
            full
            hint={t('cp.import.columns_hint', {
              fee: fee ? '' : t('cp.import.columns_hint_no_fee'),
            })}
            error={textError || undefined}
          >
            {(control) => (
              <textarea
                {...control}
                className={`${inputClass({ mono: true, multiline: true })} min-h-[220px] text-[12.5px]!`}
                placeholder={t('cp.import.placeholder')}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setTextError('');
                }}
              />
            )}
          </Field>
          <div className="flex">
            <button
              type="button"
              className={`${buttonClass('default', 'sm')} ${TOUCH_AREA}`}
              onClick={() => void openTemplate()}
              data-cp-import-template=""
            >
              <Icon name="download" size="sm" />
              {t('cp.import.template')}
            </button>
          </div>
        </div>
        {templateDialog}
      </Modal>
    );
  }

  const columns = table.map.length;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      dirty
      title={t('cp.import.title')}
      sub={t('cp.import.sub')}
      footer={
        <>
          <span className="text-muted" data-cp-import-ready={ready}>
            {t('cp.import.ready')} <b>{formatCount(ready)}</b>{' '}
            {t('cp.import.ready_of', { total: formatCount(table.rows.length) })}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            className={buttonClass()}
            disabled={busy}
            onClick={() => void check()}
            data-cp-import-check=""
          >
            <Icon name="check" size="sm" />
            {t('cp.import.check')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy || !ready}
            onClick={() => void create()}
            data-cp-import-ok=""
          >
            {ready ? t('cp.import.ok', { n: formatCount(ready) }) : t('cp.import.ok_none')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-cp-import="table">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">
            {t('cp.import.info', {
              delim: t(
                table.delimiter === '\t' ? 'cp.import.delim_tab' : 'cp.import.delim_semicolon',
              ),
              n: formatCount(table.rows.length),
              head: t(table.hasHeader ? 'cp.import.head_found' : 'cp.import.head_none'),
            })}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            className={`${buttonClass('ghost', 'sm')} ${TOUCH_AREA}`}
            onClick={() => setTable(null)}
            data-cp-import-back=""
          >
            <Icon name="left" size="sm" />
            {t('cp.import.again')}
          </button>
        </div>
        <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
          <div className="overflow-x-auto rounded-xl border border-line bg-raised">
            <table className="w-full border-collapse text-[13px]" aria-label={t('cp.import.title')}>
              <thead>
                <tr>
                  <th scope="col" className={`${TH} whitespace-nowrap`} style={{ width: 110 }}>
                    {t('cp.import.check_col')}
                  </th>
                  {table.map.map((col, i) => (
                    <th key={i} scope="col" className={TH}>
                      <select
                        aria-label={t('cp.import.col_label', { n: i + 1 })}
                        className={`${inputClass()} min-h-[28px]! min-w-[120px] px-1.5! py-0.5! text-[12px]!`}
                        value={col}
                        onChange={(e) => setColumn(i, e.target.value as CpImportColumn)}
                        data-cp-import-col={i}
                      >
                        {CP_IMPORT_COLUMNS.map((c) => (
                          <option key={c} value={c}>
                            {t(`cp.import.col.${c}`)}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ri) => (
                  <ImportRowView
                    key={ri}
                    row={row}
                    index={ri}
                    map={table.map}
                    columns={columns}
                    onCell={setCell}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
        <div className="text-[11.5px] leading-[1.4] text-faint">{t('cp.import.table_hint')}</div>
      </div>
    </Modal>
  );
}

/**
 * Строка таблицы: итог проверки и ячейки-поля (в прототипе — `contenteditable`). Перерисовывается только
 * изменённая строка: в таблице до 500 строк.
 */
const ImportRowView = memo(function ImportRowView({
  row,
  index,
  map,
  columns,
  onCell,
}: {
  row: ImportRow;
  index: number;
  map: readonly CpImportColumn[];
  columns: number;
  onCell: (row: number, cell: number, value: string) => void;
}) {
  const t = useT();
  return (
    <tr data-cp-import-row={index}>
      <td className={TD}>
        <CheckCell check={row.check} />
      </td>
      {Array.from({ length: columns }, (_, ci) => {
        const value = row.cells[ci] ?? '';
        return (
          <td key={ci} className="border-b border-line p-0 align-middle">
            {/* Ширина ячейки — по тексту, как у ячейки прототипа: невидимая копия текста под полем. */}
            <div className="grid min-w-[90px]">
              <span
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 px-2 py-[7px] whitespace-pre"
              >
                {value || ' '}
              </span>
              <input
                aria-label={t('cp.import.cell', {
                  col: t(`cp.import.col.${map[ci] ?? 'skip'}`),
                  n: index + 1,
                })}
                className="col-start-1 row-start-1 w-full min-w-0 bg-transparent px-2 py-[7px] text-ink outline-none focus:bg-field focus:shadow-[inset_0_0_0_2px_var(--bu-sel)]"
                value={value}
                onChange={(e) => onCell(index, ci, e.target.value)}
              />
            </div>
          </td>
        );
      })}
    </tr>
  );
});

/**
 * «не проверено», «N ошибок» с причинами или «готова» с предупреждениями. Причины и предупреждения —
 * бледным мелким текстом, как их показывает прототип (у `.hint.red` и `.hint.yellow` цвет берёт `.hint`).
 */
function CheckCell({ check }: { check: ContractorImportRow | null }) {
  const t = useT();
  if (!check)
    return <span className="whitespace-nowrap text-faint">{t('cp.import.unchecked')}</span>;
  const n = check.errors.length;
  if (n) {
    const why = check.errors.join('; ');
    return (
      <div className="flex flex-col items-start gap-0.5" data-cp-import-errors={n}>
        <span title={why}>
          <Pill tone="bad" size="sm" icon="alert">
            {t(`cp.import.errors.${pluralForm(n)}`, { n: formatCount(n) })}
          </Pill>
        </span>
        <div className="max-w-[220px] text-[11.5px] leading-[1.4] whitespace-normal text-faint">
          {why}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-0.5" data-cp-import-ok-row="">
      <Pill tone="ok" size="sm" icon="check">
        {t('cp.import.row_ready')}
      </Pill>
      {check.warnings.length ? (
        <div className="max-w-[220px] text-[11.5px] leading-[1.4] whitespace-normal text-faint">
          {check.warnings.join('; ')}
        </div>
      ) : null}
    </div>
  );
}

/**
 * «Шаблон загрузки контрагентов» (прототип impTemplate): лист 1 — колонки (обязательные со звёздочкой) и
 * строка-пример, лист 2 — подсказки, лист 3 — действующие коды ГКЭД; «Скачать .xlsx» — тот же файл.
 */
function TemplateDialog({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: ContractorImportTemplate;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const res = await api.api.contractors.import.template.$get();
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        toast(exportFailureText(body, t, errorText, t('grid.export_failed')), {
          icon: 'alert',
          bad: true,
        });
        return;
      }
      saveFile(await res.blob(), `${t('cp.import.tpl.file')}.xlsx`);
      toast(t('cp.import.tpl.downloaded'), { icon: 'download' });
      onClose();
    } catch {
      toast(t('grid.export_failed'), { icon: 'alert', bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="wide"
      title={t('cp.import.tpl.title')}
      sub={t('cp.import.tpl.sub')}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.close')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy}
            onClick={() => void download()}
            data-cp-import-template-download=""
          >
            <Icon name="download" size="sm" />
            {t('cp.import.tpl.download')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-cp-import-template="">
        <section className="flex flex-col gap-2">
          <h3 className={SEC}>{t('cp.import.tpl.sheet1')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {data.columns.map((c) => (
                    <th key={c.key} scope="col" className={TH}>
                      {c.required ? `${c.title} *` : c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {data.columns.map((c) => (
                    <td key={c.key} className={TD}>
                      {c.example}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className={SEC}>{t('cp.import.tpl.sheet2')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    {t('cp.import.tpl.col')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('cp.import.tpl.required')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('cp.import.tpl.format')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.columns.map((c) => (
                  <tr key={c.key}>
                    <td className={TD}>{c.title}</td>
                    <td className={TD}>
                      {t(c.required ? 'cp.import.tpl.yes' : 'cp.import.tpl.no')}
                    </td>
                    <td className={TD}>{c.hint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className={SEC}>{t('cp.import.tpl.sheet3')}</h3>
          <div className="max-h-[260px] overflow-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    {t('cp.import.tpl.code')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('cp.import.tpl.activity')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('cp.import.tpl.section')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.gked.map((g) => (
                  <tr key={g.code}>
                    <td className={`${TD} whitespace-nowrap ${MONO_CLASS}`}>{g.code}</td>
                    <td className={TD}>{g.name}</td>
                    <td className={TD}>{g.section}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="text-[11.5px] leading-[1.4] text-faint">{t('cp.import.tpl.hint')}</div>
      </div>
    </Modal>
  );
}
