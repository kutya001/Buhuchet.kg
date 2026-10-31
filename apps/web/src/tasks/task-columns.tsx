'use client';

import {
  bishkekDate,
  formatDateRu,
  formatMomentRu,
  taskConfirmMark,
  taskFileMark,
  type ListSort,
} from '@buhuchet/domain';
import type { RegularTaskRow, TaskListRow, TaskRow } from '@buhuchet/shared';
import {
  Icon,
  Pill,
  StatusMini,
  StatusMiniNone,
  StatusPill,
  Tag,
  type GridAudit,
  type GridColumn,
  type GridRowStripe,
  type GridRowTone,
} from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { miniView, statusName, type StatusEvent } from '../status/status-view';

/** Сортировка по умолчанию во всех списках — от новых к старым по «Создано» (прототип defSort). */
export const TASK_DEFAULT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/**
 * Видимые по умолчанию — как в прототипе (`taskCols`, решение заказчика 30.10.2026, docs/deviations.md
 * п. Б-2): задача, категория, исполнитель, срок, статус, файл, поставил; «Контрагент» и остальные — в
 * меню «Столбцы».
 */
export const TASK_DEFAULT_VISIBLE = ['title', 'cat', 'exec', 'date', 'status', 'file', 'by'];

/** Срок строкой: «до 31.10.2026» у задачи на месяц (прототип `taskCols`, столбец «Срок»). */
export function taskDueText(t: Translate, task: Pick<TaskRow, 'term' | 'dueDate'>): string {
  const date = formatDateRu(task.dueDate);
  return task.term === 'month' ? t('task.date.month', { date }) : date;
}

/** Метка вида срока «День» синим или «Месяц» фиолетовым (ТЗ: цвет всегда дополнен текстом). */
export function TaskTermTag({ t, term }: { t: Translate; term: TaskRow['term'] }) {
  return term === 'month' ? (
    <Tag tone="violet">{t('task.kind.month')}</Tag>
  ) : (
    <Tag tone="info">{t('task.kind.day')}</Tag>
  );
}

/**
 * Компактная шкала статуса в строке (прототип `scaleMini('task', …)`): под ней — когда статус
 * поставлен и кем (последняя смена из строки списка).
 */
export function TaskStatusMini({ t, task }: { t: Translate; task: TaskRow }) {
  const history: StatusEvent[] = task.lastStatus
    ? [
        {
          at: new Date(task.lastStatus.at),
          from: null,
          to: task.status,
          rollback: false,
          reason: null,
          actor: task.lastStatus.by,
        },
      ]
    : [];
  const view = miniView(t, { scale: 'task', status: task.status, history, confirm: task.confirm });
  if (view.kind === 'none') return <StatusMiniNone label={view.label} title={view.title} />;
  if (view.kind === 'pill') return <StatusPill {...view.pill} size="sm" />;
  return <StatusMini {...view.props} />;
}

/** «Подтверждение» строкой (прототип `taskConfTxt`): «Не требуется», «Подтвердил …», «Требуется». */
export function taskConfirmText(t: Translate, task: TaskRow): string {
  const mark = taskConfirmMark({
    confirm: task.confirm,
    status: task.status,
    confirmedBy: task.confirmedBy?.id ?? null,
  });
  if (mark === 'confirmed')
    return t('task.confirm.confirmed', { name: task.confirmedBy!.shortName });
  return t(mark === 'required' ? 'task.confirm.required' : 'task.confirm.not_required');
}

/** Вид срока строки: регулярная задача — всегда «На день» (ТЗ «Регулярные задачи»). */
export const taskTermOf = (r: TaskListRow): TaskRow['term'] =>
  r.kind === 'regular' ? 'day' : r.term;

/**
 * Шкала отчёта в строке регулярной задачи (прототип `scaleMini('rep', …)` и метка «отчёт» — «Статус
 * берётся из отчёта»): у сданного — отметка «Ждёт подтверждения» или «Подтверждено».
 */
export function RegularStatusMini({ t, task }: { t: Translate; task: RegularTaskRow }) {
  const history: StatusEvent[] = task.lastStatus
    ? [
        {
          at: new Date(task.lastStatus.at),
          from: null,
          to: task.report.status,
          rollback: false,
          reason: null,
          actor: task.lastStatus.by,
        },
      ]
    : [];
  const mark = task.report.mark;
  const view = miniView(t, {
    scale: 'report',
    status: task.report.status,
    history,
    ...(mark ? { mark, markLabel: regularConfirmText(t, task) } : {}),
  });
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      {view.kind === 'none' ? (
        <StatusMiniNone label={view.label} title={view.title} />
      ) : view.kind === 'pill' ? (
        <StatusPill {...view.pill} size="sm" />
      ) : (
        <StatusMini {...view.props} />
      )}
      <Tag title={t('task.reg.status_tag_title')}>{t('task.reg.status_tag')}</Tag>
    </span>
  );
}

/**
 * «Подтверждение» регулярной задачи — отметка её отчёта (прототип `repConfTxt`): «Ждёт подтверждения ·
 * 3 дн.», «Подтвердил Алишер Т.», «Подтверждено»; без отметки — пусто.
 */
export function regularConfirmText(t: Translate, task: RegularTaskRow): string {
  const mark = task.report.mark;
  if (!mark) return '';
  const name = statusName(t, 'report', mark);
  if (mark === 'waiting') return t('status.mark_waiting_days', { name, n: task.report.waitDays });
  return task.report.confirmedBy
    ? t('status.mark_confirmed_by', { who: task.report.confirmedBy })
    : name;
}

function RegularConfirmCell({ t, task }: { t: Translate; task: RegularTaskRow }) {
  const text = regularConfirmText(t, task);
  if (!text) return <span className="text-faint">—</span>;
  return task.report.mark === 'waiting' ? (
    <Pill tone="warn" icon="hourglass" size="sm">
      {text}
    </Pill>
  ) : (
    <Pill tone="ok" icon="check" size="sm">
      {text}
    </Pill>
  );
}

function ConfirmCell({ t, task }: { t: Translate; task: TaskRow }) {
  if (!task.confirm) return <span className="text-faint">{t('task.confirm.not_required')}</span>;
  if (task.status === 'confirmed') {
    return (
      <Pill tone="ok" icon="check" size="sm">
        {taskConfirmText(t, task)}
      </Pill>
    );
  }
  if (task.status === 'on_confirm') {
    return (
      <Pill tone="violet" icon="hourglass" size="sm">
        {t('task.confirm.waiting')}
      </Pill>
    );
  }
  return <>{t('task.confirm.required')}</>;
}

function FileCell({ t, task }: { t: Translate; task: TaskListRow }) {
  const mark = taskFileMark(task);
  if (mark === 'none') return <span className="text-faint">—</span>;
  return mark === 'attached' ? (
    <Pill tone="ok" icon="clip" size="sm">
      {t('task.file.attached_pill')}
    </Pill>
  ) : (
    <Pill icon="clip" size="sm">
      {t('task.file.needed_pill')}
    </Pill>
  );
}

/**
 * Столбцы списка задач — как в прототипе (modules/tasks.js, `taskCols`), ключи — как на сервере.
 * «Контрагент» у общей задачи — серым «Общая» (ТЗ «Общие задачи в списке»). У регулярной задачи —
 * метка «регулярная», шкала её отчёта с меткой «отчёт», «Поставил» — «Система» (задача 2.24). «Проект»
 * добавит задача 2.26. Служебные «Создал», «Изменил», «Создано», «Изменено» добавляет сам список
 * (`TASK_AUDIT`).
 */
export function taskColumns(t: Translate): GridColumn<TaskListRow>[] {
  const yesNo = (v: boolean) => t(v ? 'task.yes' : 'task.no');
  return [
    {
      key: 'title',
      label: t('task.col.title'),
      type: 'text',
      width: 330,
      text: (r) => r.title,
      cell: (r) => (
        <>
          {r.kind === 'regular' ? (
            <>
              <Tag title={t('task.reg.tag_title')}>{t('task.reg.tag')}</Tag>{' '}
            </>
          ) : null}
          <span className="font-semibold">{r.title}</span>
        </>
      ),
    },
    {
      key: 'cp',
      label: t('task.col.cp'),
      type: 'enum',
      width: 190,
      text: (r) => r.contractor?.name ?? t('task.cp.general'),
      cell: (r) =>
        r.contractor ? (
          r.contractor.name
        ) : (
          <span className="text-faint">{t('task.cp.general')}</span>
        ),
    },
    {
      key: 'cat',
      label: t('task.col.cat'),
      type: 'enum',
      width: 150,
      text: (r) => r.category.name,
    },
    {
      key: 'exec',
      label: t('task.col.exec'),
      type: 'enum',
      width: 130,
      text: (r) => r.executor?.shortName ?? '',
    },
    {
      key: 'date',
      label: t('task.col.date'),
      type: 'date',
      width: 150,
      text: (r) => taskDueText(t, { term: taskTermOf(r), dueDate: r.dueDate }),
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span
            data-overdue={r.overdue ? '' : undefined}
            className={r.overdue ? 'inline-flex items-center gap-1 font-semibold text-danger' : ''}
          >
            {r.overdue ? <Icon name="alert" size="sm" /> : null}
            {taskDueText(t, { term: taskTermOf(r), dueDate: r.dueDate })}
          </span>
          <TaskTermTag t={t} term={taskTermOf(r)} />
        </span>
      ),
    },
    {
      key: 'status',
      label: t('task.col.status'),
      type: 'enum',
      width: 220,
      text: (r) =>
        r.kind === 'regular'
          ? statusName(t, 'report', r.report.status)
          : statusName(t, 'task', r.status),
      cell: (r) =>
        r.kind === 'regular' ? <RegularStatusMini t={t} task={r} /> : <TaskStatusMini t={t} task={r} />,
    },
    {
      key: 'needFile',
      label: t('task.col.need_file'),
      type: 'enum',
      width: 110,
      text: (r) => yesNo(r.needFile),
    },
    {
      key: 'doneAt',
      label: t('task.col.done_at'),
      type: 'date',
      width: 130,
      text: (r) =>
        r.kind === 'manual' && r.doneAt ? formatDateRu(bishkekDate(new Date(r.doneAt))) : '',
    },
    {
      key: 'file',
      label: t('task.col.file'),
      type: 'enum',
      width: 110,
      text: (r) => {
        const mark = taskFileMark(r);
        return mark === 'none'
          ? ''
          : t(mark === 'attached' ? 'task.file.attached' : 'task.file.needed');
      },
      cell: (r) => <FileCell t={t} task={r} />,
    },
    {
      key: 'by',
      label: t('task.col.by'),
      type: 'enum',
      width: 120,
      text: (r) => (r.kind === 'regular' ? t('task.reg.system') : r.author.shortName),
    },
    {
      key: 'confirm',
      label: t('task.col.confirm'),
      type: 'enum',
      width: 170,
      text: (r) => (r.kind === 'regular' ? regularConfirmText(t, r) : taskConfirmText(t, r)),
      cell: (r) =>
        r.kind === 'regular' ? (
          <RegularConfirmCell t={t} task={r} />
        ) : (
          <ConfirmCell t={t} task={r} />
        ),
    },
    {
      key: 'scope',
      label: t('task.col.scope'),
      type: 'enum',
      width: 140,
      text: (r) => t(r.contractor ? 'task.scope.contractor' : 'task.scope.general'),
    },
    {
      key: 'tkind',
      label: t('task.col.tkind'),
      type: 'enum',
      width: 120,
      text: (r) => t(r.kind === 'regular' ? 'task.tkind.regular' : 'task.tkind.manual'),
    },
    {
      key: 'term',
      label: t('task.col.term'),
      type: 'enum',
      width: 120,
      text: (r) => t(taskTermOf(r) === 'month' ? 'task.term.month' : 'task.term.day'),
    },
    {
      key: 'open',
      label: t('task.col.open'),
      type: 'enum',
      width: 100,
      text: (r) => yesNo(r.open),
    },
  ];
}

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');

/** Значения служебных столбцов; «Изменил» у записи без правок — тот, кто создал (прототип `_ub || _cb`). */
export const TASK_AUDIT: GridAudit<TaskListRow> = {
  createdBy: (r) => r.audit.createdBy ?? '',
  updatedBy: (r) => r.audit.updatedBy ?? r.audit.createdBy ?? '',
  createdAt: (r) => moment(r.audit.createdAt),
  updatedAt: (r) => moment(r.audit.updatedAt),
};

/** Полоска вида срока слева у строки и плитки (ТЗ: «На день» — синяя, «На месяц» — фиолетовая). */
export const taskStripe = (r: TaskListRow): GridRowStripe =>
  taskTermOf(r) === 'month' ? 'violet' : 'info';

/** Подсветка строки (прототип `rowClass`): просроченная — красным, закрытая — приглушённо. */
export function taskTone(r: TaskListRow): GridRowTone | undefined {
  if (r.overdue) return 'overdue';
  return r.open ? undefined : 'muted';
}
