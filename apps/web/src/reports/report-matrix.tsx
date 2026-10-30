'use client';

import { AssignmentBulkResult, AssignmentEndPreview, type ReportMatrix } from '@buhuchet/shared';
import { ConfirmDialog, EmptyState, Note, NothingFound, useToast } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { SEARCH_DELAY_MS, useDebounced } from '../lists/use-list-page';
import { useShell } from '../shell/context';
import { useMassAssign } from './mass-assign';
import { useReportActions, useReportAddRequest } from './report-actions';
import { reportMatrixQuery, useReportsRefresh } from './reports-data';

type Row = ReportMatrix['rows'][number];
type Type = ReportMatrix['types'][number];

/** Снять назначение: контрагент, вид и сколько будущих несданных отчётов получат «Не требуется». */
interface Unassign {
  cp: Row['contractor'];
  type: Type;
  assignment: { id: string; version: number };
  n: number;
}

const CELL = 'border-b border-line px-2 py-1.5 text-center whitespace-nowrap';
const HEAD_CELL = `${CELL} sticky top-0 z-[2] min-w-[76px] bg-pane-alt text-[11.5px] font-[650] text-muted`;
const ROW_HEAD = `${CELL} sticky left-0 z-[1] max-w-[240px] overflow-hidden border-r bg-raised text-left font-semibold text-ellipsis`;
const FOOT_CELL = `${CELL} sticky bottom-0 bg-pane-alt text-[12px] font-bold`;
// Заштрихованная клетка: вид не подходит по режиму или форме собственности (`.mx td.na`).
const NA = 'bg-[repeating-linear-gradient(135deg,transparent_0_5px,var(--color-sel)_5px_6px)]';

/**
 * Вкладка «Кто что сдаёт» (ТЗ «Назначение отчётов контрагентам» → «Вкладка «Кто что сдаёт»»; прототип
 * modules/reports.js, `renderMatrix`): сетка контрагенты × подключённые виды с поиском оболочки.
 * Галочка назначает вид контрагенту с периода, за который сегодня должен быть отчёт; снятая — после
 * вопроса «Снять назначение» с числом будущих несданных отчётов завершает назначение. Неподходящие
 * клетки заштрихованы, у отключённого в каталоге вида новое назначение не ставится; без права
 * «Назначать отчёты» галочки только видны. Внизу — сколько контрагентов сдаёт каждый вид.
 */
export function ReportMatrixTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const { search, clearSearch, access } = useShell();
  const refresh = useReportsRefresh();
  const q = useDebounced(search.trim(), SEARCH_DELAY_MS);
  const query = useQuery(reportMatrixQuery(q));
  const reports = useReportActions();
  const mass = useMassAssign();
  useReportAddRequest({ adhoc: reports.newReport, mass: mass.open });
  const can = access.can('assign');
  // Клетки, по которым запрос ещё идёт: повторное нажатие не шлёт второй запрос.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [unassign, setUnassign] = useState<Unassign | null>(null);

  const once = async (key: string, send: () => Promise<void>) => {
    if (pending.has(key)) return;
    setPending((p) => new Set(p).add(key));
    try {
      await send();
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  };

  const assign = (cp: Row['contractor'], type: Type) =>
    once(`${cp.id}|${type.code}`, async () => {
      const res = await callApi(() =>
        api.api.assignments.bulk.$post({
          json: { reportTypeCode: type.code, contractorIds: [cp.id], rate: type.defaultRate },
        }),
      );
      refresh();
      if (!res.ok) return void toast(errorText(res.error), { bad: true });
      const result = AssignmentBulkResult.parse(res.data);
      if (!result.done)
        return void toast(t('report.matrix.skipped', { type: type.shortName }), {
          bad: true,
          icon: 'alert',
        });
      toast(t('report.matrix.assigned', { type: type.shortName, cp: cp.name }), {
        icon: 'matrix',
      });
    });

  const askEnd = (cp: Row['contractor'], type: Type, assignment: Unassign['assignment']) =>
    once(`${cp.id}|${type.code}`, async () => {
      const res = await callApi(() =>
        api.api.assignments[':id']['end-preview'].$get({ param: { id: assignment.id } }),
      );
      if (!res.ok) {
        refresh();
        return void toast(errorText(res.error), { bad: true });
      }
      const { notRequired } = AssignmentEndPreview.parse(res.data);
      setUnassign({ cp, type, assignment, n: notRequired });
    });

  // ОТКЛОНЕНИЕ: docs/deviations.md#Б-9
  const end = (u: Unassign) =>
    once(`${u.cp.id}|${u.type.code}`, async () => {
      const res = await callApi(() =>
        api.api.assignments[':id'].end.$post({
          param: { id: u.assignment.id },
          json: { version: u.assignment.version },
        }),
      );
      refresh();
      if (!res.ok) return void toast(errorText(res.error), { bad: true });
      toast(t('report.unassign.done'), { icon: 'ban' });
    });

  const onCell = (row: Row, type: Type, cell: Row['cells'][number], on: boolean) => {
    if (on && !type.active)
      return void toast(t('report.matrix.inactive'), { bad: true, icon: 'alert' });
    if (on) return void assign(row.contractor, type);
    if (cell.assignment) void askEnd(row.contractor, type, cell.assignment);
  };

  const data = query.data;
  return (
    <div className="flex flex-col gap-3.5" data-report-matrix="">
      <Note>
        {t('report.matrix.note')}
        {can ? null : (
          <>
            {' '}
            <b>{t('report.matrix.no_right')}</b>
          </>
        )}
      </Note>
      {query.isError && !data ? (
        <Note tone="bad">
          {query.error instanceof ApiFailure ? errorText(query.error.error) : t('err.unknown')}
        </Note>
      ) : null}
      {data && !data.rows.length && q ? (
        <NothingFound
          title={t('grid.not_found')}
          resetLabel={t('grid.reset_filters')}
          onReset={clearSearch}
        />
      ) : null}
      {data && !data.rows.length && !q ? (
        <EmptyState
          icon="building"
          title={t('report.matrix.empty')}
          text={t('report.matrix.empty_text')}
        />
      ) : null}
      {data?.rows.length ? (
        <div
          data-matrix=""
          className="max-h-[max(360px,calc(100dvh_-_300px))] overflow-auto rounded-xl border border-line bg-raised"
        >
          <table className="border-separate border-spacing-0 text-[13px] [&_tbody_tr:hover>*]:bg-row-hover">
            <thead>
              <tr>
                <th className={`${ROW_HEAD} top-0 z-[3] bg-pane-alt text-[11.5px] text-muted`}>
                  {t('report.matrix.cp')}
                </th>
                {data.types.map((x) => (
                  <th key={x.code} title={x.name} className={HEAD_CELL}>
                    {x.shortName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.contractor.id} data-matrix-cp={row.contractor.id}>
                  <th title={row.contractor.name} className={ROW_HEAD}>
                    <div className="max-w-[230px] overflow-hidden text-ellipsis">
                      {row.contractor.name}
                    </div>
                    <div className="text-[11.5px] font-[450] text-faint">
                      {row.contractor.regime || t('report.matrix.no_regime')}
                    </div>
                  </th>
                  {data.types.map((type, i) => {
                    const cell = row.cells[i] ?? { assignment: null, why: null };
                    const na = !!cell.why && !cell.assignment;
                    const key = `${row.contractor.id}|${type.code}`;
                    return (
                      <td
                        key={type.code}
                        title={cell.why ?? type.name}
                        className={`${CELL} ${na ? NA : ''}`}
                      >
                        <input
                          type="checkbox"
                          data-matrix-cell={type.code}
                          className="m-0 h-4 w-4 cursor-pointer accent-accent disabled:cursor-default"
                          checked={!!cell.assignment}
                          disabled={!can || na || pending.has(key)}
                          aria-label={t('report.matrix.cell', {
                            type: type.shortName,
                            cp: row.contractor.name,
                          })}
                          onChange={(e) => onCell(row, type, cell, e.target.checked)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th className={`${FOOT_CELL} left-0 z-[3]`}>{t('report.matrix.total')}</th>
                {data.types.map((x, i) => (
                  <td key={x.code} className={FOOT_CELL} data-matrix-total={x.code}>
                    {data.rows.filter((r) => r.cells[i]?.assignment).length}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
      <ConfirmDialog
        open={!!unassign}
        onClose={() => setUnassign(null)}
        title={t('report.unassign.title', { types: unassign?.type.shortName ?? '' })}
        text={t('report.unassign.text', {
          cp: unassign?.cp.name ?? '',
          types: unassign?.type.shortName ?? '',
          n: unassign?.n ?? 0,
        })}
        ok={t('report.unassign.ok')}
        danger
        onConfirm={() => {
          if (unassign) void end(unassign);
        }}
      />
      {mass.dialog}
      {reports.dialogs}
    </div>
  );
}
