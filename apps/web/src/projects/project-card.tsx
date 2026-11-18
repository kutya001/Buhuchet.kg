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
  taskOpen,
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
  Pill,
  StatusHistory,
  StatusLine,
  StatusPill,
  StatusScale,
  Tag,
  Timeline,
  useToast,
  type ActionEntry,
  type CardTab,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiFailure } from '../api-client';
import { ContractorLink } from '../contractors/contractor-link';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { filesQuery } from '../files/files-data';
import { RecordFiles } from '../files/record-files';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useShell } from '../shell/context';
import { MiniScale } from '../status/status-line';
import {
  historyLabels,
  historyView,
  scaleView,
  statusEvents,
  statusPillView,
} from '../status/status-view';
import { projectHistoryItems } from './project-history';
import {
  payAction,
  PaymentsBox,
  ProjectPaymentSlot,
  type ProjectPaymentAction,
} from './project-payments';
import {
  addProjectWork,
  projectCardQuery,
  setProjectWorkDone,
  useProjectsRefresh,
} from './projects-data';

/*
 * Карточка проекта (задача 2.26; ТЗ «Модуль Проекты контрагентов» → «Карточка проекта»; прототип v136
 * modules/projects.js — `openProject`; решение заказчика 17.11.2026 «Меньше текста, понятнее, плавнее»):
 * вкладки «Главное · Работы · Оплаты · Файлы · История» вместо одной ленты. «Главное» — строка состояния
 * (шкала коротко, срок и «срок прошёл», главный ответственный; полная шкала — нажатием: шаг — после
 * вопроса, откат — с причиной), описание, «Деньги» — тому, кто видит деньги, ответственные и коротко
 * «Работы» и «Задачи». «Работы» — «Работы · N из M» с полосой и галочками, строка «Добавить работу»,
 * «Задачи · N» с кнопкой «Задача». «Оплаты» — деньги и оплаты проекта (`./project-payments.tsx`), тому,
 * кто видит деньги. «История» — статусы, изменения, кто создал и изменил. Внизу — «Действия» (меню без
 * «Открыть») и следующий шаг: «Записать оплату», пока есть остаток, иначе «Завершить» или «В работу»;
 * «Готово» нет — окно закрывают крестиком, свайпом или Esc.
 */

/** Вкладки карточки проекта (прототип `openProject`, `tabs`). */
type ProjectTab = 'main' | 'works' | 'pays' | 'files' | 'hist';

const TAB_ICONS = {
  main: 'briefcase',
  works: 'check',
  pays: 'wallet',
  files: 'folder',
  hist: 'history',
} as const;

/** Проект идёт: «Планируется» или «В работе» (прототип `live`). */
const projectLive = (p: Pick<ProjectCard, 'status'>) =>
  p.status === 'planned' || p.status === 'in_progress';

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

/** «Главное»: ответственные, коротко работы и задачи (прототип `openProject`, `T.main`). */
function mainItems(t: Translate, p: ProjectCard): KeyValueItem[] {
  const done = p.works.filter((w) => w.done).length;
  const late = p.works.filter((w) => w.overdue).length;
  const items: KeyValueItem[] = [
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
      id: 'works',
      label: t('proj.card.tab.works'),
      value: p.works.length ? (
        <span className="inline-flex flex-wrap items-center gap-1.5" data-pj-works-short="">
          {t('proj.card.works_count', { done, total: p.works.length })}
          {late ? (
            <Pill tone="bad" size="sm">
              {t('proj.card.works_over', { n: late })}
            </Pill>
          ) : null}
        </span>
      ) : (
        <span className="text-faint">{t('proj.card.works_unset')}</span>
      ),
    },
  ];
  if (p.tasks)
    items.push({
      id: 'tasks',
      label: t('proj.card.tasks_short'),
      value: p.tasks.length ? (
        <span data-pj-tasks-short="">
          {t('proj.card.tasks_open', {
            open: p.tasks.filter((x) => taskOpen(x.status)).length,
            n: p.tasks.length,
          })}
        </span>
      ) : (
        <span className="text-faint">{t('proj.card.tasks_no')}</span>
      ),
    });
  return items;
}

/** «Создал» и «Изменил» — внизу «Истории» (прототип v136 `auditKv`). */
function auditItems(t: Translate, p: ProjectCard): KeyValueItem[] {
  return [
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
  // Галочка «Сделано» меняется сразу, как в прототипе, а не после ответа сервера: отметка держится,
  // пока карточка не перечитана; ошибка возвращает прежнее.
  const [marks, setMarks] = useState<Readonly<Record<string, boolean>>>({});
  const [shownWorks, setShownWorks] = useState(p.works);
  if (shownWorks !== p.works) {
    setShownWorks(p.works);
    setMarks({});
  }
  const works = p.works.map((w) => (w.id in marks ? { ...w, done: marks[w.id]! } : w));
  const done = works.filter((w) => w.done).length;
  const title = t('proj.card.works', { done, total: works.length });

  const toggle = async (workId: string, value: boolean) => {
    setMarks((m) => ({ ...m, [workId]: value }));
    setBusy(true);
    const res = await setProjectWorkDone(p.id, workId, value);
    setBusy(false);
    if (!res.ok) {
      setMarks((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== workId)));
      toast(errorText(res.error), { bad: true });
    }
    refresh();
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
      {works.length ? <Bar value={done} max={works.length} label={title} /> : null}
      {works.length ? (
        <MiniTable
          label={title}
          empty=""
          columns={[
            { key: 'done', label: t('proj.card.work.done'), width: 36 },
            { key: 'name', label: t('proj.card.work.name') },
            { key: 'exec', label: t('proj.card.work.exec') },
            { key: 'due', label: t('proj.card.work.due') },
          ]}
          rows={works.map((w) => ({
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
      {p.can.works ? (
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
  onNext,
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
  /** Следующий шаг кнопкой внизу — сразу, как пункт «Действий» (прототип `pj-next`, `setProjStatus`). */
  onNext: (p: ProjectCard, to: string) => void;
  /** Откат на шаг — окно с причиной. */
  onBack: (p: ProjectCard, to: string) => void;
  /** «Задача» в блоке «Задачи». */
  onTask: (p: ProjectCard) => void;
  /** Строка блока «Задачи» — карточка задачи. */
  onOpenTask: (taskId: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const toast = useToast();
  const { employeeId } = useShell();
  const query = useQuery(projectCardQuery(id));
  const [more, setMore] = useState<HTMLElement | null>(null);
  const [pay, setPay] = useState<DialogSlot<ProjectPaymentAction> | null>(null);
  const [picked, setTab] = useState<ProjectTab>('main');
  const p = query.data;
  const fileList = useQuery({ ...filesQuery({ kind: 'project', id }), enabled: !!p?.files });
  const failed =
    query.isError && !p
      ? errorText(
          query.error instanceof ApiFailure ? query.error.error : { code: 'unknown', message: '' },
        )
      : null;

  const tabs: CardTab[] = [];
  if (p) {
    const done = p.works.filter((w) => w.done).length;
    const files = fileList.data?.items.length ?? 0;
    tabs.push({ id: 'main', label: t('proj.card.tab.main'), icon: TAB_ICONS.main });
    tabs.push({
      id: 'works',
      label: t('proj.card.tab.works'),
      icon: TAB_ICONS.works,
      ...(p.works.length
        ? {
            count: {
              value: `${done}/${p.works.length}`,
              tone: p.works.some((w) => w.overdue) ? ('red' as const) : ('yellow' as const),
            },
          }
        : {}),
    });
    if (p.money && p.payments)
      tabs.push({
        id: 'pays',
        label: t('proj.card.tab.pays'),
        icon: TAB_ICONS.pays,
        count: { value: p.payments.length, tone: 'yellow' },
      });
    if (p.files)
      tabs.push({
        id: 'files',
        label: t('proj.card.tab.files'),
        icon: TAB_ICONS.files,
        count: { value: files, tone: 'yellow' },
      });
    tabs.push({ id: 'hist', label: t('proj.card.tab.hist'), icon: TAB_ICONS.hist });
  }
  const tab: ProjectTab = tabs.some((x) => x.id === picked) ? picked : 'main';

  // Следующий шаг (прототип `main`): «Записать оплату», пока у идущего проекта есть остаток; иначе
  // шаг шкалы вперёд — «В работу» или «Завершить» (отмена — только в «Действиях»).
  const live = !!p && projectLive(p);
  const payOk =
    !!p && p.can.pay && live && !!p.money?.plan && projectLeft(p.money.plan, p.money.paid) > 0;
  const next =
    p && p.can.keep && live
      ? (scaleNext('project', p.status).find((x) => x !== 'cancelled') ?? null)
      : null;

  const footer = (
    <>
      {p ? (
        <button
          type="button"
          data-pj-more=""
          className={`${buttonClass('default')} max-md:min-w-11 max-md:px-2.5`}
          aria-haspopup="menu"
          aria-expanded={more !== null}
          aria-label={t('proj.card.actions')}
          onClick={(e) => setMore(e.currentTarget)}
        >
          <Icon name="more" size="sm" />
          <span className="max-md:hidden">{t('proj.card.actions')}</span>
        </button>
      ) : null}
      <div className="flex-1" />
      {p && payOk ? (
        <button
          type="button"
          data-pj-main="pay"
          className={buttonClass('cta')}
          onClick={() => setPay(openSlot(payAction(p)))}
        >
          <Icon name="wallet" size="sm" />
          {t('proj.act.pay')}
        </button>
      ) : p && next ? (
        <button
          type="button"
          data-pj-main={next}
          className={buttonClass('cta')}
          onClick={() => onNext(p, next)}
        >
          <Icon name={statusPillView(t, 'project', next).icon} size="sm" />
          {t(next === 'done' ? 'proj.act.finish' : 'proj.act.start')}
        </button>
      ) : null}
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
        p ? (
          <>
            <ContractorLink id={p.contractor.id} name={p.contractor.name} tab="projects" /> ·{' '}
            {formatDateRu(p.startsOn)} – {formatDateRu(p.endsOn)}
          </>
        ) : undefined
      }
      footer={footer}
      {...(p
        ? {
            tabs: {
              items: tabs,
              active: tab,
              onSelect: (x: string) => setTab(x as ProjectTab),
              label: t('proj.card.tabs'),
            },
          }
        : {})}
    >
      <div className="flex flex-col gap-3.5" data-project-card={id} data-project-tab={tab}>
        {failed ? <Note tone="bad">{failed}</Note> : null}
        {p ? (
          <CardBody
            t={t}
            p={p}
            tab={tab}
            me={employeeId}
            onStep={(to) =>
              p.can.keep
                ? onStep(p, to)
                : toast(t('proj.status.no_right'), { bad: true, icon: 'alert' })
            }
            onBack={(to) => onBack(p, to)}
            onTask={() => onTask(p)}
            onOpenTask={onOpenTask}
            onPay={(a) => setPay(openSlot(a))}
          />
        ) : null}
      </div>
      <ProjectPaymentSlot slot={pay} onClose={() => setPay(closeSlot)} />
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
  tab,
  me,
  onStep,
  onBack,
  onTask,
  onOpenTask,
  onPay,
}: {
  t: Translate;
  p: ProjectCard;
  tab: ProjectTab;
  me: string | null;
  onStep: (to: string) => void;
  onBack: (to: string) => void;
  onTask: () => void;
  onOpenTask: (taskId: string) => void;
  onPay: (a: ProjectPaymentAction) => void;
}) {
  const events = statusEvents(p.statusHistory);
  const view = scaleView(t, {
    scale: 'project',
    status: p.status,
    history: events,
    // Прототип (`scaleFull`, `stepTo`): шаг вперёд нажимается всегда, без права — уведомление.
    next: scaleNext('project', p.status),
    // ОТКЛОНЕНИЕ: docs/deviations.md#Г-10 — откат со шкалы с «Вести проекты» и «Откатом статусов».
    back: p.can.keep && p.can.rollback ? scaleBack('project', p.status) : null,
  });
  const history = historyView(t, 'project', events, new Date());
  const timeline = projectHistoryItems(t, p.history, p.names);
  const tasks = p.tasks;

  const full =
    view.kind === 'scale' ? (
      <StatusScale {...view.props} onStep={onStep} onBack={onBack} />
    ) : view.kind === 'pill' ? (
      <StatusPill {...view.pill} />
    ) : undefined;

  if (tab === 'main')
    return (
      <>
        <StatusLine
          id={`p${p.id}`}
          label={t('status.line.scale')}
          minis={<MiniScale t={t} input={{ scale: 'project', status: p.status, history: [] }} />}
          parts={[
            <>
              <Icon name="calendar" size="sm" />
              <span>
                {formatDateRu(p.startsOn)} – {formatDateRu(p.endsOn)}
              </span>
              {p.overdue ? (
                <b className="text-danger" data-pj-over="">
                  {t('proj.over')}
                </b>
              ) : null}
            </>,
            <>
              <Icon name="user" size="sm" />
              <span>{p.lead.name}</span>
            </>,
          ]}
          full={full}
        />
        {p.description ? (
          <p
            data-pj-desc=""
            className="m-0 text-[14.5px] leading-[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap"
          >
            {p.description}
          </p>
        ) : null}
        <div className="grid gap-3.5 md:grid-cols-2">
          {p.money ? <MoneyBox t={t} money={p.money} /> : null}
          <Box>
            <KeyValues items={mainItems(t, p)} />
          </Box>
        </div>
      </>
    );

  if (tab === 'pays')
    return p.money && p.payments ? (
      <>
        <MoneyBox t={t} money={p.money} />
        <PaymentsBox t={t} p={p} onAction={onPay} />
      </>
    ) : null;

  if (tab === 'files')
    return p.files ? <RecordFiles source={{ kind: 'project', id: p.id }} /> : null;

  if (tab === 'hist')
    return (
      <>
        {events.length ? (
          <Box title={t('proj.card.status_hist')}>
            <StatusHistory rows={history.rows} totals={history.totals} labels={historyLabels(t)} />
          </Box>
        ) : null}
        <Box title={t('proj.card.hist')}>
          {timeline.length ? (
            <Timeline items={timeline} label={t('proj.card.hist')} />
          ) : (
            <span className="text-faint">{t('proj.hist.none')}</span>
          )}
        </Box>
        <Box>
          <KeyValues items={auditItems(t, p)} />
        </Box>
      </>
    );

  return (
    <>
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
    </>
  );
}
