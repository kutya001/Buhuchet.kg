'use client';

import {
  formatSomWithUnit,
  submitNeedsPayment,
  type TaskAction,
  type TaskActor,
} from '@buhuchet/domain';
import {
  Task,
  type RegularTaskRow,
  type TaskFormOptions,
  type TaskListRow,
  type TaskRow,
} from '@buhuchet/shared';
import { ConfirmDialog, RollbackDialog, useToast, type ActionEntry } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { useReportActions, useReportActor } from '../reports/report-actions';
import { rollbackLabels, rollbackTitle } from '../status/status-view';
import { TaskCard } from './task-card';
import {
  TaskConfirmDialog,
  TaskDoneDialog,
  TaskFailDialog,
  TaskReworkDialog,
} from './task-dialogs';
import { TaskFormDialog } from './task-form';
import type { TaskFormPreset } from './task-form-values';
import { taskMenuEntries } from './task-menu';
import { taskFormOptionsQuery, taskQuery, useTasksRefresh } from './tasks-data';

/** Окно действия с задачей: какое и над какой (свежая карточка с сервера). */
type ActionDialog = { kind: 'done' | 'fail' | 'confirm' | 'rework'; task: Task };

interface FormData {
  task: Task | null;
  preset?: TaskFormPreset;
  options: TaskFormOptions;
}

const ROLLBACK_EFFECT = {
  on_confirm: 'task.rollback.on_confirm',
  in_progress: 'task.rollback.in_progress',
  todo: 'task.rollback.todo',
} as const;

/**
 * Действия с задачей (прототип modules/tasks.js, `taskActions`, `openTask`, `taskDlg` и окна
 * действий): в списке — кнопкой «⋯», долгим нажатием и правым кликом; в карточке — кнопкой «Действия»,
 * кнопками внизу и шагами шкалы. «Взять в работу» — сразу; «Выполнена», «Не выполнена», «Подтвердить»,
 * «На доработку», «Изменить» — окном (по свежей карточке с сервера); «Отменить задачу» — после
 * вопроса; откат — окном с причиной. Отказ сервера — уведомлением с текстом из словаря. Регулярная
 * задача открывает карточку своего отчёта; в меню — «Открыть отчёт», «Отметить отчёт сданным» и когда
 * задача закроется сама (задача 2.24).
 */
export function useTaskActions(): {
  actions: (task: TaskListRow) => ActionEntry[];
  /** Карточка: ручной задачи (строка списка или карточка с сервера) или отчёта регулярной задачи. */
  openCard: (task: TaskListRow | TaskRow) => void;
  newTask: (preset?: TaskFormPreset) => void;
  dialogs: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useTasksRefresh();
  const { access, employeeId, editor } = useShell();
  const actor: TaskActor | null = employeeId
    ? {
        employeeId,
        isOwner: editor?.isOwner ?? false,
        canConfirm: access.can('tasksConfirm'),
        canRollback: access.can('rollback'),
        canCreate: access.can('tasksCreate'),
      }
    : null;
  const [card, setCard] = useState<DialogSlot<TaskRow> | null>(null);
  const [form, setForm] = useState<DialogSlot<FormData> | null>(null);
  const [dialog, setDialog] = useState<DialogSlot<ActionDialog> | null>(null);
  const [askCancel, setAskCancel] = useState<TaskRow | null>(null);
  const [back, setBack] = useState<DialogSlot<{ task: Task; to: string }> | null>(null);
  const [backBusy, setBackBusy] = useState(false);
  const [backError, setBackError] = useState<string | undefined>();
  // Задачи, по которым запрос ещё идёт: повторное нажатие не шлёт второй запрос.
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
  /** Свежая карточка и значения формы — до открытия окна: поля сразу на месте. */
  const load = async <T,>(key: string, fetch: () => Promise<T>): Promise<T | null> => {
    try {
      return await once(key, fetch);
    } catch {
      toast(t('err.unknown'), { bad: true });
      return null;
    }
  };
  const fresh = (id: string) => client.fetchQuery({ ...taskQuery(id), staleTime: 0 });

  /** После действия: новая карточка — в окно, списки и счётчики — перечитать. */
  const applied = (task: Task) => {
    client.setQueryData(taskQuery(task.id).queryKey, task);
    refresh();
  };

  const simple = async (task: TaskRow, action: 'start' | 'cancel') => {
    const res = await once(task.id, () =>
      callApi(() => api.api.tasks[':id'][action].$post({ param: { id: task.id } })),
    );
    if (!res) return;
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const next = Task.safeParse(res.data);
    if (next.success) client.setQueryData(taskQuery(task.id).queryKey, next.data);
    toast(t(action === 'start' ? 'task.started' : 'task.cancelled.toast'), {
      icon: action === 'start' ? 'clock' : 'ban',
    });
  };

  const openDialog = async (task: TaskRow, kind: ActionDialog['kind']) => {
    const full = await load(task.id, () => fresh(task.id));
    if (full) setDialog(openSlot({ kind, task: full }));
  };

  const edit = async (task: TaskRow) => {
    const data = await load(task.id, () =>
      Promise.all([fresh(task.id), client.fetchQuery(taskFormOptionsQuery)]),
    );
    if (data) setForm(openSlot<FormData>({ task: data[0], options: data[1] }));
  };

  const newTask = async (preset?: TaskFormPreset) => {
    const options = await load('new', () => client.fetchQuery(taskFormOptionsQuery));
    if (options)
      setForm(openSlot<FormData>({ task: null, ...(preset ? { preset } : {}), options }));
  };

  const run: Record<'open' | TaskAction, (task: TaskRow) => void> = {
    open: (task) => setCard(openSlot(task)),
    start: (task) => void simple(task, 'start'),
    done: (task) => void openDialog(task, 'done'),
    fail: (task) => void openDialog(task, 'fail'),
    confirm: (task) => void openDialog(task, 'confirm'),
    rework: (task) => void openDialog(task, 'rework'),
    edit: (task) => void edit(task),
    cancel: setAskCancel,
  };
  const manualActions = actor ? taskMenuEntries({ actor, t, run }) : () => [];
  const cardActions = actor ? taskMenuEntries({ actor, t, run, card: true }) : () => [];

  const reports = useReportActions();
  const reportActor = useReportActor();
  /** Меню регулярной задачи (прототип `taskActions`, `t.reg`). */
  const regularActions = (task: RegularTaskRow): ActionEntry[] => {
    const r = task.report;
    const open = r.status === 'todo' || r.status === 'in_progress' || r.status === 'needs_fix';
    const payWhy = submitNeedsPayment(
      { act: r.act, status: r.status, sum: r.amount, paid: r.paid, superseded: false },
      !!reportActor?.taxpay && !!reportActor.payFirst,
    )
      ? t('report.pay_first.why', {
          amount: formatSomWithUnit(r.amount ?? 0),
          paid: formatSomWithUnit(r.paid),
        })
      : '';
    const why = !access.can('changeStatus') ? t('task.reg.no_status_right') : payWhy;
    const closes =
      r.mark === 'waiting'
        ? 'task.reg.closes_wait'
        : access.reportConfirm && r.act !== 'pay'
          ? 'task.reg.closes_confirm'
          : 'task.reg.closes';
    return [
      {
        id: 'report',
        label: t('task.reg.open_report'),
        icon: 'file',
        run: () => reports.openCard({ id: task.id }),
      },
      ...(open && r.act !== 'pay'
        ? [
            {
              id: 'submit',
              label: t('task.reg.submit'),
              icon: 'send' as const,
              ...(why ? { disabled: true, reason: why } : {}),
              run: () => reports.submit({ id: task.id }),
            },
          ]
        : []),
      { id: 'closes', label: t(closes), icon: 'info', disabled: true, run: () => {} },
    ];
  };
  const actions = (task: TaskListRow) =>
    task.kind === 'regular' ? regularActions(task) : manualActions(task);
  const openCard = (task: TaskListRow | TaskRow) =>
    'kind' in task && task.kind === 'regular' ? reports.openCard({ id: task.id }) : run.open(task);

  const rollback = async (reason: string) => {
    if (!back) return;
    const { task, to } = back.data;
    setBackBusy(true);
    const res = await callApi(() =>
      api.api.tasks[':id'].rollback.$post({ param: { id: task.id }, json: { to, reason } }),
    );
    setBackBusy(false);
    if (!res.ok) return setBackError(errorText(res.error));
    const next = Task.safeParse(res.data);
    if (next.success) applied(next.data);
    else refresh();
    setBack(closeSlot);
    toast(t('status.rollback_done'), { icon: 'history' });
  };

  const dialogProps = (d: DialogSlot<ActionDialog>) => ({
    key: `${d.data.kind}-${d.n}`,
    task: d.data.task,
    open: d.open,
    onClose: () => setDialog(closeSlot),
    onDone: applied,
  });

  const dialogs = (
    <>
      {card ? (
        <TaskCard
          key={`card-${card.n}`}
          id={card.data.id}
          initial={card.data}
          open={card.open}
          onClose={() => setCard(closeSlot)}
          actor={actor}
          actions={cardActions}
          onAction={(action, task) => run[action](task)}
          onRollback={(task, to) => {
            setBackError(undefined);
            setBack(openSlot({ task, to }));
          }}
        />
      ) : null}
      {form && employeeId ? (
        <TaskFormDialog
          key={`form-${form.n}`}
          task={form.data.task}
          {...(form.data.preset ? { preset: form.data.preset } : {})}
          options={form.data.options}
          employeeId={employeeId}
          open={form.open}
          onClose={() => setForm(closeSlot)}
          onDone={applied}
        />
      ) : null}
      {dialog?.data.kind === 'done' ? (
        <TaskDoneDialog {...dialogProps(dialog)} filesOn={dialog.data.task.filesOn} />
      ) : null}
      {dialog?.data.kind === 'fail' ? <TaskFailDialog {...dialogProps(dialog)} /> : null}
      {dialog?.data.kind === 'rework' ? <TaskReworkDialog {...dialogProps(dialog)} /> : null}
      {dialog?.data.kind === 'confirm' ? (
        <TaskConfirmDialog
          {...dialogProps(dialog)}
          employeeId={employeeId}
          filesOn={dialog.data.task.filesOn}
        />
      ) : null}
      <ConfirmDialog
        open={askCancel !== null}
        onClose={() => setAskCancel(null)}
        title={t('task.cancel.title')}
        text={t('task.cancel.text', { title: askCancel?.title ?? '' })}
        ok={t('task.action.cancel')}
        danger
        onConfirm={() => askCancel && void simple(askCancel, 'cancel')}
      />
      {back ? (
        <RollbackDialog
          key={`back-${back.n}`}
          open={back.open}
          onClose={() => setBack(closeSlot)}
          title={rollbackTitle(t, 'task', back.data.task.status, back.data.to)}
          sub={back.data.task.title}
          consequences={t(
            ROLLBACK_EFFECT[back.data.to as keyof typeof ROLLBACK_EFFECT] ??
              'status.rollback_effect.task',
          )}
          busy={backBusy}
          error={backError}
          labels={rollbackLabels(t)}
          onConfirm={(reason) => void rollback(reason)}
        />
      ) : null}
    </>
  );

  return {
    actions,
    openCard,
    newTask: (preset) => void newTask(preset),
    dialogs: (
      <>
        {dialogs}
        {reports.dialogs}
      </>
    ),
  };
}
