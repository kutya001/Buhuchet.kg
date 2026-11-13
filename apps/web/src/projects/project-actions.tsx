'use client';

import { projectCancelable, scaleBack, scaleNext, type ProjectStatus } from '@buhuchet/domain';
import { ProjectCard } from '@buhuchet/shared';
import {
  ConfirmDialog,
  RollbackDialog,
  useToast,
  type ActionEntry,
  type BoardValue,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiFailure } from '../api-client';
import { openContractorCard } from '../contractors/card-store';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { rollbackLabels, rollbackTitle, statusName, statusPillView } from '../status/status-view';
import { useTaskActions } from '../tasks/task-actions';
import { taskQuery } from '../tasks/tasks-data';
import { leadChangeBody, leadChangeRefusal, projectMove } from './project-board';
import { ProjectCardDialog } from './project-card';
import { closeProjectCard, openProjectCard, useProjectCardRequest } from './project-card-store';
import { ProjectDialog, type ProjectContractorPreset } from './project-dialog';
import { payAction, ProjectPaymentSlot, type ProjectPaymentAction } from './project-payments';
import {
  editProject,
  projectCardQuery,
  projectFormQuery,
  setProjectStatus,
  useProjectsRefresh,
} from './projects-data';

/** Что нужно меню о проекте: строка списка или карточка. */
export interface ProjectRef {
  id: string;
  name: string;
  status: ProjectStatus;
  version: number;
  contractor: { id: string; name: string };
  lead: { id: string };
  /** Деньги проекта: у карточки — `money`, у строки списка — `plan` и `paid` (null — не видны). */
  money?: { plan: number | null; paid: number } | null;
  plan?: number | null;
  paid?: number | null;
}

/** Стоимость и «получено» проекта меню (строка списка или карточка); null — денег не видно. */
const moneyOf = (p: ProjectRef): { plan: number | null; paid: number } | null =>
  p.money !== undefined
    ? p.money
    : p.paid === undefined || p.paid === null
      ? null
      : { plan: p.plan ?? null, paid: p.paid };

/** Окно проекта: контрагент из его карточки или изменяемый проект. */
interface FormSlot {
  contractor: ProjectContractorPreset | null;
  edit: ProjectCard | null;
}

const ROLLBACK_EFFECT = {
  in_progress: 'proj.rollback.to_work',
  planned: 'proj.rollback.to_plan',
} as const;

/**
 * Действия с проектом (прототип modules/projects.js — `projActions`, `setProjStatus`, `stepTo` для
 * `proj`, `rollbackDlg`): в списке — «⋯», долгим нажатием и правым кликом; в карточке — «Действия» и
 * шкала. «Изменить» — окном по свежей карточке; «В работу» и «Завершить» из меню — сразу, со шкалы —
 * после вопроса; «Отменить проект» — после вопроса; откат — окном с причиной (кнопка видна и без
 * права «Откат статусов», но неактивна с подсказкой). «Задача по проекту» — форма задачи с
 * контрагентом, проектом и главным ответственным. Отказ сервера — уведомлением. Перенос карточки на
 * доске (прототип v85 `projKanban.drop`) — `drop`: шаг статуса сразу, «Отменён» — после вопроса,
 * столбец сотрудника — он становится главным.
 */
export function useProjectActions(): {
  actions: (p: ProjectRef) => ActionEntry[];
  openCard: (id: string) => void;
  /** Перенос карточки проекта в столбец доски. */
  drop: (p: ProjectRef, key: string, to: BoardValue) => void;
  newProject: (contractor?: ProjectContractorPreset | null) => void;
  /** Что нужно карточке проекта (её рисует `ProjectCardHost`). */
  card: CardHandlers;
  dialogs: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useProjectsRefresh();
  const { access } = useShell();
  const tasks = useTaskActions();
  const keep = access.can('projects');
  const canRollback = access.can('rollback');
  const canTask = access.feature('tasks') && access.can('tasksCreate');
  const [form, setForm] = useState<DialogSlot<FormSlot> | null>(null);
  const [askCancel, setAskCancel] = useState<ProjectRef | null>(null);
  const [askStep, setAskStep] = useState<{ p: ProjectRef; to: ProjectStatus } | null>(null);
  const [back, setBack] = useState<DialogSlot<{ p: ProjectRef; to: ProjectStatus }> | null>(null);
  const [backBusy, setBackBusy] = useState(false);
  const [backError, setBackError] = useState<string | undefined>();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [pay, setPay] = useState<DialogSlot<ProjectPaymentAction> | null>(null);

  const once = async <T,>(key: string, send: () => Promise<T>): Promise<T | null> => {
    if (pending.has(key)) return null;
    setPending((x) => new Set(x).add(key));
    try {
      return await send();
    } finally {
      setPending((x) => {
        const next = new Set(x);
        next.delete(key);
        return next;
      });
    }
  };

  /** Смена статуса; новая карточка — в окно, списки и числа — перечитать. */
  const move = async (p: ProjectRef, to: ProjectStatus, reason?: string) => {
    const res = await once(p.id, () =>
      setProjectStatus(p.id, { to, version: p.version, ...(reason ? { reason } : {}) }),
    );
    if (!res) return false;
    refresh();
    if (!res.ok) {
      if (reason !== undefined) setBackError(errorText(res.error));
      else toast(errorText(res.error), { bad: true });
      return false;
    }
    const next = ProjectCard.safeParse(res.data);
    if (next.success) client.setQueryData(projectCardQuery(p.id).queryKey, next.data);
    if (reason !== undefined) toast(t('status.rollback_done'), { icon: 'history' });
    else
      toast(t('proj.status.toast', { status: statusName(t, 'project', to) }), {
        icon: 'briefcase',
      });
    return true;
  };

  const edit = async (p: ProjectRef) => {
    try {
      const fresh = await once(p.id, () =>
        client.fetchQuery({ ...projectCardQuery(p.id), staleTime: 0 }),
      );
      if (fresh) setForm(openSlot<FormSlot>({ contractor: null, edit: fresh }));
    } catch (e) {
      toast(e instanceof ApiFailure ? errorText(e.error) : t('err.unknown'), { bad: true });
    }
  };

  /**
   * Главный — другой сотрудник: остальные поля и работы — из свежей карточки проекта, версия — записи
   * на доске; действующие сотрудники — из данных окна проекта.
   */
  const setLead = async (p: ProjectRef, to: BoardValue) => {
    try {
      const res = await once(p.id, async () => {
        const [fresh, form] = await Promise.all([
          client.fetchQuery({ ...projectCardQuery(p.id), staleTime: 0 }),
          client.fetchQuery(projectFormQuery(null)),
        ]);
        const refusal = leadChangeRefusal(
          fresh,
          form.employees.map((e) => e.id),
          to.key,
        );
        if (refusal) return { refusal };
        return editProject(p.id, leadChangeBody(fresh, to.key, p.version));
      });
      if (!res) return;
      if ('refusal' in res) {
        if (res.refusal === 'proj.board.lead_open') refresh();
        return void toast(t(res.refusal), { bad: true });
      }
      refresh();
      if (!res.ok) return void toast(errorText(res.error), { bad: true });
      toast(t('proj.board.lead_done', { name: to.label }), { icon: 'user' });
    } catch (e) {
      toast(e instanceof ApiFailure ? errorText(e.error) : t('err.unknown'), { bad: true });
    }
  };

  const drop = (p: ProjectRef, key: string, to: BoardValue) => {
    const m = projectMove(p, keep, key, to.key);
    if (m.kind === 'none') return;
    if (m.kind === 'refusal')
      return void toast(t(m.key, { from: statusName(t, 'project', p.status), to: to.label }), {
        bad: true,
      });
    if (m.kind === 'status') return void move(p, m.to);
    if (m.kind === 'cancel') return setAskCancel(p);
    void setLead(p, to);
  };

  const taskFor = (p: ProjectRef) =>
    tasks.newTask({
      contractorId: p.contractor.id,
      projectId: p.id,
      executorEmployeeId: p.lead.id,
    });

  const openTask = (id: string) =>
    void client
      .fetchQuery(taskQuery(id))
      .then((task) => tasks.openCard(task))
      .catch((e: unknown) =>
        toast(e instanceof ApiFailure ? errorText(e.error) : t('err.unknown'), { bad: true }),
      );

  const startBack = (p: ProjectRef, to: ProjectStatus) => {
    setBackError(undefined);
    setBack(openSlot({ p, to }));
  };

  /** Пункты меню (прототип `projActions`); в карточке — без «Открыть». */
  const entries = (p: ProjectRef, inCard: boolean): ActionEntry[] => {
    const items: ActionEntry[] = [];
    if (!inCard)
      items.push({
        id: 'open',
        label: t('proj.act.open'),
        icon: 'briefcase',
        run: () => openProjectCard(p.id),
      });
    if (keep)
      items.push({ id: 'edit', label: t('proj.act.edit'), icon: 'edit', run: () => void edit(p) });
    // «Записать оплату» (прототип `projActions`: `ed && moneyVis() && p.status !== 'Отменён'`; право
    // «Вести проекты» само открывает деньги проектов). Получена вся стоимость — пункт неактивен.
    const money = moneyOf(p);
    if (keep && money && p.status !== 'cancelled')
      items.push({
        id: 'pay',
        label: t('proj.act.pay'),
        icon: 'wallet',
        disabled: !!money.plan && money.plan - money.paid <= 0,
        reason: t('err.project_paid_full'),
        run: () => setPay(openSlot(payAction({ ...p, money }))),
      });
    if (canTask && p.status !== 'cancelled')
      items.push({ id: 'task', label: t('proj.act.task'), icon: 'task', run: () => taskFor(p) });
    if (keep) {
      items.push({ id: 's1', separator: true });
      for (const to of scaleNext('project', p.status) as ProjectStatus[])
        items.push({
          id: `to-${to}`,
          label: t(to === 'done' ? 'proj.act.finish' : 'proj.act.start'),
          icon: statusPillView(t, 'project', to).icon,
          run: () => void move(p, to),
        });
      if (projectCancelable(p.status))
        items.push({
          id: 'cancel',
          label: t('proj.act.cancel'),
          icon: statusPillView(t, 'project', 'cancelled').icon,
          danger: true,
          run: () => setAskCancel(p),
        });
      const bk = scaleBack('project', p.status) as ProjectStatus | null;
      if (bk)
        items.push({
          id: 'rollback',
          label: t('proj.act.rollback', { status: statusName(t, 'project', bk) }),
          icon: 'history',
          disabled: !canRollback,
          reason: t('proj.act.rollback_right'),
          run: () => startBack(p, bk),
        });
    }
    items.push({
      id: 'cp',
      label: t('proj.act.cp'),
      icon: 'building',
      run: () => openContractorCard({ id: p.contractor.id }, 'projects'),
    });
    return items;
  };

  const dialogs = (
    <>
      {form ? (
        <ProjectDialog
          key={`form-${form.n}`}
          contractor={form.data.contractor}
          edit={form.data.edit}
          open={form.open}
          onClose={() => setForm(closeSlot)}
          onDone={(id, created) => {
            refresh();
            // Прототип: созданный проект сразу открывается.
            if (created) openProjectCard(id);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={askCancel !== null}
        onClose={() => setAskCancel(null)}
        title={t('proj.cancel.title')}
        text={t('proj.cancel.text', { name: askCancel?.name ?? '' })}
        ok={t('proj.cancel.ok')}
        danger
        onConfirm={() => askCancel && void move(askCancel, 'cancelled')}
      />
      <ConfirmDialog
        open={askStep !== null}
        onClose={() => setAskStep(null)}
        title={t('proj.step.title', {
          status: askStep ? statusName(t, 'project', askStep.to) : '',
        })}
        text={
          askStep
            ? t('proj.step.text', {
                name: askStep.p.name,
                from: statusName(t, 'project', askStep.p.status),
                to: statusName(t, 'project', askStep.to),
              })
            : ''
        }
        ok={t(askStep?.to === 'done' ? 'proj.act.finish' : 'proj.act.start')}
        onConfirm={() => askStep && void move(askStep.p, askStep.to)}
      />
      {back ? (
        <RollbackDialog
          key={`back-${back.n}`}
          open={back.open}
          onClose={() => setBack(closeSlot)}
          title={rollbackTitle(t, 'project', back.data.p.status, back.data.to)}
          sub={back.data.p.name}
          consequences={t(
            ROLLBACK_EFFECT[back.data.to as keyof typeof ROLLBACK_EFFECT] ??
              'proj.rollback.to_work',
          )}
          busy={backBusy}
          error={backError}
          labels={rollbackLabels(t)}
          onConfirm={(reason) => {
            setBackBusy(true);
            void move(back.data.p, back.data.to, reason).then((ok) => {
              setBackBusy(false);
              if (ok) setBack(closeSlot);
            });
          }}
        />
      ) : null}
      <ProjectPaymentSlot slot={pay} onClose={() => setPay(closeSlot)} />
      {tasks.dialogs}
    </>
  );

  return {
    actions: (p) => entries(p, false),
    openCard: openProjectCard,
    drop,
    newProject: (contractor) =>
      setForm(openSlot<FormSlot>({ contractor: contractor ?? null, edit: null })),
    card: {
      menu: (p) => entries(p, true),
      onStep: (p, to) => setAskStep({ p, to: to as ProjectStatus }),
      onBack: (p, to) => startBack(p, to as ProjectStatus),
      onTask: taskFor,
      onOpenTask: openTask,
    },
    dialogs,
  };
}

/** Обработчики карточки проекта: меню «Действия», шаги и откат шкалы, задачи. */
interface CardHandlers {
  menu: (p: ProjectCard) => ActionEntry[];
  onStep: (p: ProjectCard, to: string) => void;
  onBack: (p: ProjectCard, to: string) => void;
  onTask: (p: ProjectCard) => void;
  onOpenTask: (taskId: string) => void;
}

/**
 * Карточка проекта для всего сайта (прототип `openProject`): одна в оболочке, открывается
 * `openProjectCard` из списка, вкладки «Проекты» контрагента, карточки задачи, «Файлового менеджера» и
 * истории. Без «Проектов контрагентов» или права «Просматривать проекты» её нет.
 */
export function ProjectCardHost() {
  const { access } = useShell();
  if (!access.feature('projects') || !access.can('projView')) return null;
  return <CardHost />;
}

function CardHost() {
  const request = useProjectCardRequest();
  const projects = useProjectActions();
  return (
    <>
      {request ? (
        <ProjectCardDialog
          key={`project-card-${request.n}`}
          id={request.id}
          open={request.open}
          onClose={closeProjectCard}
          {...projects.card}
        />
      ) : null}
      {projects.dialogs}
    </>
  );
}
