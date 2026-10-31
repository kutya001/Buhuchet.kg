'use client';

import { formatDateRu } from '@buhuchet/domain';
import {
  Box,
  buttonClass,
  EmptyState,
  Hint,
  Icon,
  linkButtonClass,
  MiniTable,
  Note,
  StatusPill,
  Tag,
  type MiniRow,
} from '@buhuchet/ui';
import type { TaskListRow } from '@buhuchet/shared';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { statusPillView } from '../status/status-view';
import { useTaskActions } from './task-actions';
import { contractorTasksQuery } from './tasks-data';

/** Сколько последних задач во вкладке (ТЗ «Карточка контрагента»: последние 40). */
const SHOWN = 40;

/**
 * Вкладка «Задачи» карточки контрагента (ТЗ «Карточка контрагента»; прототип modules/contractor-card.js,
 * `st.tab === 'tasks'`): «Задач: N · открытых M», кнопка «Задача» — новая задача «По контрагенту» с
 * этим контрагентом (у кого есть право ставить задачи, не у архивного); последние 40 задач — задача,
 * исполнитель, срок (просроченный — красным), статус; задача открывает свою карточку, регулярная (с
 * меткой «регулярная», без имени контрагента в названии) — карточку отчёта. Пустая — «Задач
 * по контрагенту пока нет». Карточку контрагента делает задача 2.11 — она и ставит сюда эту вкладку
 * (правило стыков); счётчик открытых задач у названия вкладки — `open` того же ответа.
 */
export function ContractorTasksTab({
  contractorId,
  archived,
}: {
  contractorId: string;
  archived: boolean;
}) {
  const t = useT();
  const { access } = useShell();
  const query = useQuery(contractorTasksQuery(contractorId));
  const tasks = useTaskActions();
  const add = access.can('tasksCreate') && !archived;
  const newTask = () => tasks.newTask({ contractorId });
  const addButton = add ? (
    <button type="button" className={buttonClass('cta', 'sm')} onClick={newTask}>
      <Icon name="plus" size="sm" />
      {t('task.cp_tab.add')}
    </button>
  ) : null;

  if (query.isError) return <Note tone="bad">{t('task.card.load_error')}</Note>;
  const data = query.data;
  if (!data) return null;
  if (data.total === 0) {
    return (
      <>
        <EmptyState
          icon="task"
          title={t('task.cp_tab.empty')}
          text={t('task.cp_tab.empty_text')}
          actions={
            add
              ? [
                  {
                    id: 'add',
                    icon: 'plus',
                    label: t('task.cp_tab.add'),
                    primary: true,
                    onClick: newTask,
                  },
                ]
              : []
          }
        />
        {tasks.dialogs}
      </>
    );
  }
  // В названии регулярной задачи имя контрагента не повторяется (ТЗ «Карточка контрагента»).
  const titleOf = (r: TaskListRow) => {
    const tail = r.contractor ? ` — ${r.contractor.name}` : '';
    return r.kind === 'regular' && tail && r.title.endsWith(tail)
      ? r.title.slice(0, -tail.length)
      : r.title;
  };
  const rows: MiniRow[] = data.items.slice(0, SHOWN).map((r) => ({
    key: r.id,
    cells: {
      title: (
        <span>
          {r.kind === 'regular' ? (
            <>
              <Tag title={t('task.reg.tag_title')}>{t('task.reg.tag')}</Tag>{' '}
            </>
          ) : null}
          <button
            type="button"
            data-cp-task={r.id}
            className={`${linkButtonClass()} text-left`}
            onClick={() => tasks.openCard(r)}
          >
            {titleOf(r)}
          </button>
        </span>
      ),
      exec: r.executor?.shortName ?? '',
      date: (
        <span className={r.overdue ? 'font-semibold text-danger' : ''}>
          {formatDateRu(r.dueDate)}
        </span>
      ),
      status: (
        <StatusPill
          {...(r.kind === 'regular'
            ? statusPillView(t, 'report', r.report.status)
            : statusPillView(t, 'task', r.status))}
          size="sm"
        />
      ),
    },
  }));
  return (
    <div data-cp-tasks={contractorId} className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-muted">
          {data.open
            ? t('task.cp_tab.summary', { n: data.total, m: data.open })
            : t('task.cp_tab.summary_none', { n: data.total })}
        </span>
        <div className="flex-1" />
        {addButton}
      </div>
      <Box>
        <MiniTable
          label={t('nav.tasks')}
          columns={[
            { key: 'title', label: t('task.col.title') },
            { key: 'exec', label: t('task.col.exec') },
            { key: 'date', label: t('task.col.date') },
            { key: 'status', label: t('task.col.status') },
          ]}
          rows={rows}
          empty={t('task.cp_tab.empty')}
        />
        {data.total > rows.length ? <Hint>{t('task.cp_tab.more', { n: rows.length })}</Hint> : null}
      </Box>
      {tasks.dialogs}
    </div>
  );
}
