'use client';

import { OPEN_REPORT_STATUSES } from '@buhuchet/domain';
import {
  ReportSaved,
  type DueChangeReason,
  type ManualReportOptions,
  type ReportCard,
  type ReportRow,
} from '@buhuchet/shared';
import {
  ConfirmDialog,
  RollbackDialog,
  useToast,
  type ActionEntry,
  type GridBulkAction,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { rollbackLabels, rollbackTitle, statusName } from '../status/status-view';
import { ReportCardWindow, reportToday } from './report-card';
import { DueChangeDialog, ManualReportDialog } from './report-dialogs';
import {
  confirmRefusal,
  reportBackOf,
  reportMenuEntries,
  reportRollbackEffect,
  reportSub,
  type ReportActor,
  type ReportMenuRun,
} from './report-menu';
import {
  ReportAmountDialog,
  ReportBatchConfirmDialog,
  ReportBatchSubmitDialog,
  ReportConfirmDialog,
  ReportFileDialog,
  ReportFixDialog,
  ReportSubmitDialog,
} from './report-status-dialogs';
import {
  dueReasonsQuery,
  manualOptionsQuery,
  reportQuery,
  useReportsRefresh,
} from './reports-data';
import type { ReportListTab } from './reports-data';

/** Окно действия по свежей карточке с сервера. */
type CardDialog = { kind: 'submit' | 'confirm' | 'fix' | 'amount'; card: ReportCard };

/** Массовое окно: отмеченные строки и как снять галочки после действия. */
type BatchDialog =
  | { kind: 'submit'; rows: ReportRow[]; done: () => void }
  | { kind: 'confirm'; rows: ReportRow[]; skipped: number; total: number; done: () => void };

/** Шаг без окна: «Взять в работу», «Требует исправления», «Не требуется». */
const STEP = {
  start: { path: 'start', to: 'in_progress', icon: 'clock' },
  reject: { path: 'reject', to: 'needs_fix', icon: 'alert' },
  not_required: { path: 'not-required', to: 'not_required', icon: 'ban' },
} as const;

/**
 * Действия с отчётом (прототип modules/reports.js, `reportActions`, `repAdd`, массовые действия
 * списка; modules/report-card.js, `openReport`; ui/status-scale.js — окна сдачи, подтверждения, отката):
 * в списке — нажатием на строку (карточка), кнопкой «⋯», долгим нажатием и правым кликом; в карточке —
 * «Ещё действия», кнопками внизу и шагами шкалы. «Взять в работу» и «Требует исправления» — сразу, «Не
 * требуется» и «Создать уточнённый» — после вопроса, остальное — окном по свежей карточке. «+ Добавить»
 * → «Разовый отчёт» — окно; созданный отчёт открывается карточкой. Отказ сервера — уведомлением.
 */
export function useReportActions(): {
  actions: (r: ReportRow) => ActionEntry[];
  openCard: (r: ReportRow | { id: string }) => void;
  bulk: (tab: ReportListTab) => GridBulkAction<ReportRow>[];
  newReport: () => void;
  dialogs: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useReportsRefresh();
  const actor = useReportActor();
  const [card, setCard] = useState<DialogSlot<{ id: string; row: ReportRow | null }> | null>(null);
  const [dialog, setDialog] = useState<DialogSlot<CardDialog> | null>(null);
  const [batch, setBatch] = useState<DialogSlot<BatchDialog> | null>(null);
  const [file, setFile] = useState<DialogSlot<ReportRow> | null>(null);
  const [due, setDue] = useState<DialogSlot<{
    report: ReportRow;
    reasons: DueChangeReason[];
  }> | null>(null);
  const [manual, setManual] = useState<DialogSlot<{
    options: ManualReportOptions;
    reasons: DueChangeReason[];
  }> | null>(null);
  const [revision, setRevision] = useState<ReportRow | null>(null);
  const [notRequired, setNotRequired] = useState<ReportRow | null>(null);
  const [back, setBack] = useState<DialogSlot<{ report: ReportRow; to: string }> | null>(null);
  const [backBusy, setBackBusy] = useState(false);
  const [backError, setBackError] = useState<string | undefined>();
  // Отчёты, по которым запрос ещё идёт: повторное нажатие не шлёт второй запрос.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const once = async <T,>(key: string, send: () => Promise<T>): Promise<T | null> => {
    if (pending.has(key)) return null;
    setPending((p) => new Set(p).add(key));
    try {
      return await send();
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  };
  /** Данные окна — до открытия: поля сразу на месте. */
  const load = async <T,>(key: string, fetch: () => Promise<T>): Promise<T | null> => {
    try {
      return await once(key, fetch);
    } catch {
      toast(t('err.unknown'), { bad: true });
      return null;
    }
  };
  const fresh = (id: string) => client.fetchQuery({ ...reportQuery(id), staleTime: 0 });

  const openCard = (r: ReportRow | { id: string }) =>
    setCard(openSlot({ id: r.id, row: 'contractor' in r ? r : null }));

  const openDialog = async (r: ReportRow, kind: CardDialog['kind']) => {
    const full = await load(r.id, () => fresh(r.id));
    if (full) setDialog(openSlot({ kind, card: full }));
  };

  const openDue = async (report: ReportRow) => {
    const reasons = await load('due', () => client.fetchQuery(dueReasonsQuery));
    if (reasons) setDue(openSlot({ report, reasons }));
  };

  const newReport = async () => {
    const data = await load('manual', () =>
      Promise.all([
        client.fetchQuery({ ...manualOptionsQuery, staleTime: 0 }),
        client.fetchQuery(dueReasonsQuery),
      ]),
    );
    if (data) setManual(openSlot({ options: data[0], reasons: data[1] }));
  };

  const step = async (r: ReportRow, kind: keyof typeof STEP) => {
    const s = STEP[kind];
    const res = await once(r.id, () =>
      callApi(() =>
        api.api.reports[':id'][s.path].$post({ param: { id: r.id }, json: { version: r.version } }),
      ),
    );
    if (!res) return;
    refresh();
    if (!res.ok) return void toast(errorText(res.error), { bad: true });
    toast(t('report.act.status_done', { name: statusName(t, 'report', s.to) }), { icon: s.icon });
  };

  const createRevision = async (r: ReportRow) => {
    const res = await once(r.id, () =>
      callApi(() =>
        api.api.reports[':id'].revision.$post({
          param: { id: r.id },
          json: { version: r.version },
        }),
      ),
    );
    if (!res) return;
    refresh();
    if (!res.ok) return void toast(errorText(res.error), { bad: true });
    toast(t('report.revision.done', { n: r.revision + 1 }), { icon: 'repeat' });
    // Новая версия — сразу карточкой (прототип: `openReport(n)`).
    const saved = ReportSaved.safeParse(res.data);
    if (saved.success) openCard({ id: saved.data.id });
  };

  const askBack = (r: ReportRow, to?: string) => {
    if (!actor) return;
    const target = reportBackOf(r, actor);
    if (target && 'refusal' in target)
      return void toast(t(`err.${target.refusal}`), { bad: true, icon: 'alert' });
    const goal = to ?? target?.to;
    if (!goal) return;
    setBackError(undefined);
    setBack(openSlot({ report: r, to: goal }));
  };

  const rollback = async (reason: string) => {
    if (!back) return;
    const { report, to } = back.data;
    setBackBusy(true);
    const res = await callApi(() =>
      api.api.reports[':id'].rollback.$post({
        param: { id: report.id },
        json: { to, reason, version: report.version },
      }),
    );
    setBackBusy(false);
    if (!res.ok) return setBackError(errorText(res.error));
    refresh();
    setBack(closeSlot);
    toast(t('status.rollback_done'), { icon: 'history' });
  };

  const run: ReportMenuRun = {
    open: openCard,
    submit: (r) => void openDialog(r, 'submit'),
    start: (r) => void step(r, 'start'),
    confirm: (r) => void openDialog(r, 'confirm'),
    fix: (r) => void openDialog(r, 'fix'),
    reject: (r) => void step(r, 'reject'),
    due: (r) => void openDue(r),
    amount: (r) => void openDialog(r, 'amount'),
    file: (r) => setFile(openSlot(r)),
    revision: setRevision,
    rollback: (r) => askBack(r),
    not_required: setNotRequired,
  };
  const actions = actor ? reportMenuEntries({ t, actor, run }) : () => [];
  const cardActions = actor ? reportMenuEntries({ t, actor, run, card: true }) : () => [];

  /**
   * Массовые действия списка (прототип repGrid `bulk`): «Отметить сданными» — с правом «Менять статус
   * сдачи»; во вкладке «Ожидают подтверждения» вместо него — «Подтвердить» с правом «Подтверждать сдачу
   * отчётов». Один подходящий отчёт — обычным окном по его карточке.
   */
  const bulk = (tab: ReportListTab): GridBulkAction<ReportRow>[] => {
    if (!actor) return [];
    if (tab === 'waiting') {
      if (!actor.can.repConfirm) return [];
      return [
        {
          id: 'confirm',
          label: t('report.act.confirm'),
          icon: 'check',
          run: (rows, done) => {
            const ok = rows.filter((r) => !confirmRefusal(r, actor));
            if (!ok.length) {
              const why = rows[0] ? confirmRefusal(rows[0], actor) : null;
              return void toast(t(why ? `err.${why}` : 'report.confirm.none'), {
                bad: true,
                icon: 'alert',
              });
            }
            if (ok.length === 1 && rows.length === 1) return void openDialog(ok[0]!, 'confirm');
            setBatch(
              openSlot<BatchDialog>({
                kind: 'confirm',
                rows: ok,
                skipped: rows.length - ok.length,
                total: rows.length,
                done,
              }),
            );
          },
        },
      ];
    }
    if (!actor.can.changeStatus) return [];
    return [
      {
        id: 'submit',
        label: t('report.act.submit_many'),
        icon: 'send',
        run: (rows, done) => {
          const ok = rows.filter((r) => r.act !== 'pay' && OPEN_REPORT_STATUSES.has(r.status));
          if (!ok.length) return void toast(t('report.submit.none'), { bad: true, icon: 'alert' });
          if (ok.length === 1) return void openDialog(ok[0]!, 'submit');
          setBatch(openSlot<BatchDialog>({ kind: 'submit', rows: ok, done }));
        },
      },
    ];
  };

  const cardProps = (d: DialogSlot<CardDialog>) => ({
    key: `${d.data.kind}-${d.n}`,
    card: d.data.card,
    open: d.open,
    onClose: () => setDialog(closeSlot),
    onDone: refresh,
  });

  const dialogs = (
    <>
      {card ? (
        <ReportCardWindow
          key={`card-${card.n}`}
          id={card.data.id}
          initial={card.data.row}
          open={card.open}
          onClose={() => setCard(closeSlot)}
          actor={actor}
          actions={cardActions}
          onAction={(action, r) => run[action](r)}
          onBack={(r, to) => askBack(r, to)}
          onVersion={(id) => openCard({ id })}
        />
      ) : null}
      {dialog?.data.kind === 'submit' ? (
        <ReportSubmitDialog {...cardProps(dialog)} confirmOn={actor?.confirmOn ?? false} />
      ) : null}
      {dialog?.data.kind === 'confirm' ? <ReportConfirmDialog {...cardProps(dialog)} /> : null}
      {dialog?.data.kind === 'fix' ? <ReportFixDialog {...cardProps(dialog)} /> : null}
      {dialog?.data.kind === 'amount' ? <ReportAmountDialog {...cardProps(dialog)} /> : null}
      {batch?.data.kind === 'submit' ? (
        <ReportBatchSubmitDialog
          key={`batch-${batch.n}`}
          rows={batch.data.rows}
          confirmOn={actor?.confirmOn ?? false}
          filesOn={actor?.filesOn ?? false}
          open={batch.open}
          onClose={() => setBatch(closeSlot)}
          onDone={() => {
            batch.data.done();
            refresh();
          }}
        />
      ) : null}
      {batch?.data.kind === 'confirm' ? (
        <ReportBatchConfirmDialog
          key={`batch-${batch.n}`}
          rows={batch.data.rows}
          skipped={batch.data.skipped}
          total={batch.data.total}
          filesOn={actor?.filesOn ?? false}
          open={batch.open}
          onClose={() => setBatch(closeSlot)}
          onDone={() => {
            batch.data.done();
            refresh();
          }}
        />
      ) : null}
      {file ? (
        <ReportFileDialog
          key={`file-${file.n}`}
          report={file.data}
          open={file.open}
          onClose={() => setFile(closeSlot)}
          onDone={refresh}
        />
      ) : null}
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
          onDone={(id) => {
            refresh();
            if (id) openCard({ id });
          }}
        />
      ) : null}
      <ConfirmDialog
        open={!!revision}
        onClose={() => setRevision(null)}
        title={t('report.revision.title', { n: (revision?.revision ?? 0) + 1 })}
        text={t(actor?.confirmOn ? 'report.revision.text_confirm' : 'report.revision.text', {
          type: revision?.type.shortName ?? '',
          period: revision?.periodFull ?? '',
        })}
        ok={t('report.revision.ok')}
        onConfirm={() => {
          if (revision) void createRevision(revision);
        }}
      />
      <ConfirmDialog
        open={!!notRequired}
        onClose={() => setNotRequired(null)}
        title={t('report.not_required.title')}
        text={t('report.not_required.text')}
        ok={t('report.not_required.ok')}
        onConfirm={() => {
          if (notRequired) void step(notRequired, 'not_required');
        }}
      />
      {back ? (
        <RollbackDialog
          key={`back-${back.n}`}
          open={back.open}
          onClose={() => setBack(closeSlot)}
          title={
            back.data.to === 'waiting'
              ? t('status.unconfirm_title')
              : rollbackTitle(t, 'report', back.data.report.status, back.data.to)
          }
          sub={reportSub(back.data.report)}
          consequences={reportRollbackEffect(t, back.data.report, back.data.to, {
            confirmOn: actor?.confirmOn ?? false,
            today: reportToday(),
          })}
          busy={backBusy}
          error={backError}
          labels={rollbackLabels(t)}
          onConfirm={(reason) => void rollback(reason)}
        />
      ) : null}
    </>
  );
  return { actions, openCard, bulk, newReport: () => void newReport(), dialogs };
}

/** Кто действует: права, подтверждение сдачи и «Файлы в карточках» учётной политики. */
export function useReportActor(): ReportActor | null {
  const { access, employeeId, editor } = useShell();
  if (!employeeId) return null;
  return {
    employeeId,
    isOwner: editor?.isOwner ?? false,
    confirmOn: access.reportConfirm,
    filesOn: access.feature('files'),
    can: {
      changeStatus: access.can('changeStatus'),
      repDue: access.can('repDue'),
      repConfirm: access.can('repConfirm'),
      changeSum: access.can('changeSum'),
      rollback: access.can('rollback'),
      filesUpload: access.can('filesUpload'),
    },
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
