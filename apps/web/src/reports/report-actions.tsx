'use client';

import type { ManualReportOptions, ReportRow, DueChangeReason } from '@buhuchet/shared';
import { ConfirmDialog, useToast, type ActionEntry } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { DueChangeDialog, ManualReportDialog } from './report-dialogs';
import { reportMenuEntries } from './report-menu';
import { dueReasonsQuery, manualOptionsQuery, useReportsRefresh } from './reports-data';

/**
 * Действия с отчётом в списке (прототип modules/reports.js, `reportActions`, `repAdd`): кнопкой «⋯»,
 * долгим нажатием и правым кликом — «Изменить срок» (окно), «Создать уточнённый» (после вопроса);
 * «+ Добавить» → «Разовый отчёт» — окно. Данные окна загружаются до открытия: поля сразу на месте.
 * Отказ сервера — уведомлением с текстом из словаря.
 */
export function useReportActions(): {
  actions: (r: ReportRow) => ActionEntry[];
  newReport: () => void;
  dialogs: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useReportsRefresh();
  const { access, reportConfirmOn } = useReportAccess();
  const [due, setDue] = useState<DialogSlot<{
    report: ReportRow;
    reasons: DueChangeReason[];
  }> | null>(null);
  const [manual, setManual] = useState<DialogSlot<{
    options: ManualReportOptions;
    reasons: DueChangeReason[];
  }> | null>(null);
  const [revision, setRevision] = useState<ReportRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async <T,>(fetch: () => Promise<T>): Promise<T | null> => {
    if (busy) return null;
    setBusy(true);
    try {
      return await fetch();
    } catch {
      toast(t('err.unknown'), { bad: true });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const openDue = async (report: ReportRow) => {
    const reasons = await load(() => client.fetchQuery(dueReasonsQuery));
    if (reasons) setDue(openSlot({ report, reasons }));
  };

  const newReport = async () => {
    const data = await load(() =>
      Promise.all([
        client.fetchQuery({ ...manualOptionsQuery, staleTime: 0 }),
        client.fetchQuery(dueReasonsQuery),
      ]),
    );
    if (data) setManual(openSlot({ options: data[0], reasons: data[1] }));
  };

  const createRevision = async (r: ReportRow) => {
    const res = await callApi(() =>
      api.api.reports[':id'].revision.$post({
        param: { id: r.id },
        json: { version: r.version },
      }),
    );
    refresh();
    if (!res.ok) return void toast(errorText(res.error), { bad: true });
    toast(t('report.revision.done', { n: r.revision + 1 }), { icon: 'repeat' });
  };

  const actions = reportMenuEntries({
    t,
    access,
    run: { due: (r) => void openDue(r), revision: setRevision },
  });

  const dialogs = (
    <>
      {due ? (
        <DueChangeDialog
          key={`due-${due.n}`}
          report={due.data.report}
          reasons={due.data.reasons}
          open={due.open}
          onClose={() => setDue(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      {manual ? (
        <ManualReportDialog
          key={`manual-${manual.n}`}
          options={manual.data.options}
          reasons={manual.data.reasons}
          open={manual.open}
          onClose={() => setManual(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      <ConfirmDialog
        open={!!revision}
        onClose={() => setRevision(null)}
        title={t('report.revision.title', { n: (revision?.revision ?? 0) + 1 })}
        text={t(reportConfirmOn ? 'report.revision.text_confirm' : 'report.revision.text', {
          type: revision?.type.shortName ?? '',
          period: revision?.periodFull ?? '',
        })}
        ok={t('report.revision.ok')}
        onConfirm={() => {
          if (revision) void createRevision(revision);
        }}
      />
    </>
  );
  return { actions, newReport: () => void newReport(), dialogs };
}

/** Права пунктов меню и подтверждение сдачи в учётной политике. */
function useReportAccess() {
  const { access } = useShell();
  return {
    access: { repDue: access.can('repDue'), changeStatus: access.can('changeStatus') },
    reportConfirmOn: access.reportConfirm,
  };
}

/** «+ Добавить» модуля (прототип `repAdd`): «Разовый отчёт» — окно; массовое назначение — задача 2.15. */
export function useReportAddRequest(run: () => void) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'reports' ? addRequest : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === 'adhoc') run();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);
}
