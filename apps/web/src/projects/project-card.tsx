'use client';

import {
  formatDateRu,
  formatMomentRu,
  formatSomWithUnit,
  projectLeft,
  projectPercent,
  projectWorkExecutor,
  scaleBack,
  scaleNext,
} from '@buhuchet/domain';
import type { ProjectCard } from '@buhuchet/shared';
import {
  ActionMenu,
  Box,
  buttonClass,
  Icon,
  inputClass,
  KeyValues,
  MiniTable,
  Modal,
  Note,
  StatusHistory,
  StatusPill,
  StatusScale,
  Tag,
  Timeline,
  useToast,
  type ActionEntry,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiFailure } from '../api-client';
import { ContractorLink } from '../contractors/contractor-link';
import { RecordFiles } from '../files/record-files';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useShell } from '../shell/context';
import {
  historyLabels,
  historyView,
  scaleView,
  statusEvents,
  statusPillView,
} from '../status/status-view';
import { ProjectOverPill } from './project-columns';
import { projectHistoryItems } from './project-history';
import {
  addProjectWork,
  projectCardQuery,
  setProjectWorkDone,
  useProjectsRefresh,
} from './projects-data';

/*
 * Карточка проекта (задача 2.26; ТЗ «Модуль Проекты контрагентов» → «Карточка проекта»; прототип
 * modules/projects.js — `openProject`): шкала статусов (шаг — после вопроса, откат — с причиной) и
 * «срок окончания прошёл», «История статусов», контрагент, срок, главный и ответственные, кто создал и
 * изменил, описание; «Деньги по проекту» — тому, кто видит деньги; «Работы · N из M» с полосой и
 * галочками, строка «Добавить работу»; «Задачи · N» с кнопкой «Задача»; файлы; история. Внизу —
 * «Действия» (меню без «Открыть») и «Готово». Оплаты (транши) добавит вторая часть задачи.
 */

/** Кто и когда: имя, под ним момент мелким серым (прототип `auditKv`). */
function Audit({ who, at }: { who: string | null; at: string }) {
  return (
    <>
      {who ?? '—'}
      <span className="block text-[11.5px] text-faint">{formatMomentRu(new Date(at))}</span>
    </>
  );
}

/** Полоса «сделано из» (прототип `.bar`). */
function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = projectPercent(value, max);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-2 overflow-hidden rounded-full bg-pane-alt shadow-[inset_0_0_0_1px_var(--bu-border)]"
    >
      <i className="block h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
    </div>
  );
}

function cardItems(t: Translate, p: ProjectCard): KeyValueItem[] {
  return [
    {
      id: 'cp',
      label: t('proj.card.cp'),
      value: <ContractorLink id={p.contractor.id} name={p.contractor.name} tab="projects" />,
    },
    {
      id: 'term',
      label: t('proj.card.term'),
      value: `${formatDateRu(p.startsOn)} – ${formatDateRu(p.endsOn)}`,
    },
    { id: 'lead', label: t('proj.card.lead'), value: p.lead.name },
    {
      id: 'members',
      label: t('proj.card.members'),
      value: (
        <span>
          {p.members.map((m, i) => (
            <span key={m.id}>
              {i ? ', ' : ''}
              {m.name}
              {m.id === p.lead.id ? (
                <>
                  {' '}
                  <Tag>{t('proj.card.lead_tag')}</Tag>
                </>
              ) : null}
            </span>
          ))}
        </span>
      ),
    },
    {
      id: 'created',
      label: t('grid.col.created_by'),
      value: <Audit who={p.audit.createdBy} at={p.audit.createdAt} />,
    },
    {
      id: 'updated',
      label: t('grid.col.updated_by'),
      value: <Audit who={p.audit.updatedBy ?? p.audit.createdBy} at={p.audit.updatedAt} />,
    },
  ];
}

function MoneyBox({ t, money }: { t: Translate; money: NonNullable<ProjectCard['money']> }) {
  const left = projectLeft(money.plan, money.paid);
  return (
    <Box title={t('proj.card.money')}>
      <KeyValues
        items={[
          {
            id: 'plan',
            label: t('proj.card.planned'),
            value: money.plan ? (
              <b className="tabular-nums">{formatSomWithUnit(money.plan)}</b>
            ) : (
              <span className="text-faint">{t('proj.card.plan_none')}</span>
            ),
          },
          {
            id: 'paid',
            label: t('proj.card.paid'),
            value: <span className="tabular-nums">{formatSomWithUnit(money.paid)}</span>,
          },
          {
            id: 'left',
            label: t('proj.card.left'),
            value: money.plan ? (
              <span className={`tabular-nums ${left > 0 ? 'font-semibold' : ''}`}>
                {formatSomWithUnit(left)}
              </span>
            ) : (
              '—'
            ),
          },
        ]}
      />
      {money.plan ? <Bar value={money.paid} max={money.plan} label={t('proj.card.paid')} /> : null}
    </Box>
  );
}

/** «Работы · N из M»: полоса, галочки «Сделано», строка «Добавить работу». */
function WorksBox({ t, p, me }: { t: Translate; p: ProjectCard; me: string | null }) {
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useProjectsRefresh();
  const [name, setName] = useState('');
  const [exec, setExec] = useState(() =>
    projectWorkExecutor({ members: p.members.map((m) => m.id), lead: p.lead.id }, me),
  );
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const done = p.works.filter((w) => w.done).length;
  const title = t('proj.card.works', { done, total: p.works.length });

  const toggle = async (workId: string, value: boolean) => {
    setBusy(true);
    const res = await setProjectWorkDone(p.id, workId, value);
    setBusy(false);
    refresh();
    if (!res.ok) toast(errorText(res.error), { bad: true });
  };
  const add = async () => {
    const text = name.trim();
    if (!text || busy) return;
    setBusy(true);
    const res = await addProjectWork(p.id, { name: text, executorId: exec, due: due || null });
    setBusy(false);
    if (!res.ok) return void toast(errorText(res.error), { bad: true });
    setName('');
    setDue('');
    refresh();
  };

  return (
    <Box title={title}>
      {p.works.length ? <Bar value={done} max={p.works.length} label={title} /> : null}
      {p.works.length ? (
        <MiniTable
          label={title}
          empty=""
          columns={[
            { key: 'done', label: t('proj.card.work.done'), width: 36 },
            { key: 'name', label: t('proj.card.work.name') },
            { key: 'exec', label: t('proj.card.work.exec') },
            { key: 'due', label: t('proj.card.work.due') },
          ]}
          rows={p.works.map((w) => ({
            key: w.id,
            blank: w.due ? [] : ['due'],
            cells: {
              done: (
                <input
                  type="checkbox"
                  data-pj-work={w.id}
                  className="size-4 cursor-pointer accent-[var(--bu-accent)] disabled:cursor-default"
                  checked={w.done}
                  disabled={!p.can.works || busy}
                  aria-label={t('proj.card.work.done_of', { name: w.name })}
                  onChange={(e) => void toggle(w.id, e.target.checked)}
                />
              ),
              name: <span className={w.done ? 'text-muted line-through' : ''}>{w.name}</span>,
              exec: w.executor.name,
              due: w.due ? (
                <span className={w.overdue ? 'font-semibold text-danger' : ''}>
                  {formatDateRu(w.due)}
                </span>
              ) : (
                <span className="text-faint">—</span>
              ),
            },
          }))}
        />
      ) : (
        <span className="text-faint">{t('proj.card.works_none')}</span>
      )}
      {p.can.works && p.status !== 'cancelled' ? (
        <div className="flex flex-nowrap items-center gap-2 max-md:flex-wrap" data-pj-work-add="">
          <input
            type="text"
            data-pj-work-name=""
            maxLength={300}
            className={`${inputClass()} min-w-0 flex-1`}
            placeholder={t('proj.card.work.add')}
            aria-label={t('proj.card.work.add')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add();
            }}
          />
          <select
            data-pj-work-exec=""
            aria-label={t('proj.card.work.exec_label')}
            className={`${inputClass({ full: false })} cursor-pointer`}
            value={exec}
            onChange={(e) => setExec(e.target.value)}
          >
            {p.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            data-pj-work-due=""
            aria-label={t('proj.card.work.due_label')}
            className={inputClass({ full: false })}
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <button
            type="button"
            data-pj-work-add-btn=""
            aria-label={t('proj.card.work.add_btn')}
            className={buttonClass('default', 'sm')}
            disabled={busy || !name.trim()}
            onClick={() => void add()}
          >
            <Icon name="plus" size="sm" />
          </button>
        </div>
      ) : null}
    </Box>
  );
}

export function ProjectCardDialog({
  id,
  open,
  onClose,
  menu,
  onStep,
  onBack,
  onTask,
  onOpenTask,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  /** Пункты «Действий» (прототип `projActions` без «Открыть»). */
  menu: (p: ProjectCard) => ActionEntry[];
  /** Шаг вперёд по шкале — после вопроса. */
  onStep: (p: ProjectCard, to: string) => void;
  /** Откат на шаг — окно с причиной. */
  onBack: (p: ProjectCard, to: string) => void;
  /** «Задача» в блоке «Задачи». */
  onTask: (p: ProjectCard) => void;
  /** Строка блока «Задачи» — карточка задачи. */
  onOpenTask: (taskId: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const { employeeId } = useShell();
  const query = useQuery(projectCardQuery(id));
  const [more, setMore] = useState<HTMLElement | null>(null);
  const p = query.data;
  const failed =
    query.isError && !p
      ? errorText(
          query.error instanceof ApiFailure ? query.error.error : { code: 'unknown', message: '' },
        )
      : null;

  const footer = (
    <>
      {p ? (
        <button
          type="button"
          data-pj-more=""
          className={buttonClass('default')}
          onClick={(e) => setMore(e.currentTarget)}
        >
          <Icon name="more" size="sm" />
          {t('proj.card.actions')}
        </button>
      ) : null}
      <div className="flex-1" />
      <button type="button" className={buttonClass('cta')} onClick={onClose}>
        {t('proj.card.done')}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={p ? p.name : ''}
      label={p ? undefined : t('proj.act.open')}
      sub={
        p
          ? `${p.contractor.name} · ${formatDateRu(p.startsOn)} – ${formatDateRu(p.endsOn)}`
          : undefined
      }
      footer={footer}
    >
      <div className="flex flex-col gap-3.5" data-project-card={id}>
        {failed ? <Note tone="bad">{failed}</Note> : null}
        {p ? (
          <CardBody
            t={t}
            p={p}
            me={employeeId}
            onStep={(to) => onStep(p, to)}
            onBack={(to) => onBack(p, to)}
            onTask={() => onTask(p)}
            onOpenTask={onOpenTask}
          />
        ) : null}
      </div>
      {more && p ? (
        <ActionMenu
          items={menu(p)}
          place={{ anchor: more }}
          label={t('proj.card.actions')}
          onClose={() => setMore(null)}
        />
      ) : null}
    </Modal>
  );
}

function CardBody({
  t,
  p,
  me,
  onStep,
  onBack,
  onTask,
  onOpenTask,
}: {
  t: Translate;
  p: ProjectCard;
  me: string | null;
  onStep: (to: string) => void;
  onBack: (to: string) => void;
  onTask: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const events = statusEvents(p.statusHistory);
  const view = scaleView(t, {
    scale: 'project',
    status: p.status,
    history: events,
    next: p.can.keep ? scaleNext('project', p.status) : [],
    back: p.can.keep && p.can.rollback ? scaleBack('project', p.status) : null,
  });
  const history = historyView(t, 'project', events, new Date());
  const timeline = projectHistoryItems(t, p.history, p.names);
  const tasks = p.tasks;

  return (
    <>
      <Box>
        <div className="flex flex-wrap items-center gap-2.5">
          {view.kind === 'scale' ? (
            <StatusScale {...view.props} onStep={onStep} onBack={onBack} />
          ) : view.kind === 'pill' ? (
            <StatusPill {...view.pill} />
          ) : null}
          {p.overdue ? <ProjectOverPill t={t} card /> : null}
        </div>
      </Box>
      {events.length ? (
        <Box title={t('proj.card.status_hist')}>
          <StatusHistory rows={history.rows} totals={history.totals} labels={historyLabels(t)} />
        </Box>
      ) : null}
      <div className="grid gap-3.5 md:grid-cols-2">
        <Box>
          <KeyValues items={cardItems(t, p)} />
          {p.description ? (
            <p className="m-0 [overflow-wrap:anywhere] whitespace-pre-line">{p.description}</p>
          ) : null}
        </Box>
        {p.money ? <MoneyBox t={t} money={p.money} /> : null}
      </div>
      <WorksBox key={`${p.id}-${p.version}`} t={t} p={p} me={me} />
      {tasks ? (
        <Box
          title={t('proj.card.tasks', { n: tasks.length })}
          actions={
            p.can.task && p.status !== 'cancelled' ? (
              <button
                type="button"
                data-pj-task=""
                className={buttonClass('default', 'sm')}
                onClick={onTask}
              >
                <Icon name="plus" size="sm" />
                {t('proj.card.task_add')}
              </button>
            ) : undefined
          }
        >
          {tasks.length ? (
            <MiniTable
              label={t('proj.card.tasks', { n: tasks.length })}
              empty=""
              headless
              onOpen={onOpenTask}
              columns={[
                { key: 'title', label: t('task.col.title') },
                { key: 'exec', label: t('task.col.exec') },
                { key: 'date', label: t('task.col.date') },
                { key: 'status', label: t('task.col.status') },
              ]}
              rows={tasks.map((x) => ({
                key: x.id,
                cells: {
                  title: <span data-pj-task-row={x.id}>{x.title}</span>,
                  exec: x.executorName,
                  date: (
                    <span className={x.overdue ? 'font-semibold text-danger' : ''}>
                      {formatDateRu(x.dueDate)}
                    </span>
                  ),
                  status: <StatusPill {...statusPillView(t, 'task', x.status)} size="sm" />,
                },
              }))}
            />
          ) : (
            <span className="text-faint">{t('proj.card.tasks_none')}</span>
          )}
        </Box>
      ) : null}
      {p.files ? <RecordFiles source={{ kind: 'project', id: p.id }} /> : null}
      <Box title={t('proj.card.hist')}>
        {timeline.length ? (
          <Timeline items={timeline} label={t('proj.card.hist')} />
        ) : (
          <span className="text-faint">{t('proj.hist.none')}</span>
        )}
      </Box>
    </>
  );
}
