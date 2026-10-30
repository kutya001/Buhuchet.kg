'use client';

import {
  bishkekDate,
  formatDateRu,
  formatMomentRu,
  TASK_COMMENT_MAX,
  taskPending,
  taskRollbackTarget,
  type TaskAction,
  type TaskActor,
} from '@buhuchet/domain';
import { Task, type TaskRow } from '@buhuchet/shared';
import {
  ActionMenu,
  Box,
  buttonClass,
  Icon,
  iconButtonClass,
  inputClass,
  KeyValues,
  Modal,
  Note,
  Pill,
  StatusHistory,
  StatusPill,
  StatusScale,
  Timeline,
  useToast,
  type ActionEntry,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { ContractorLink } from '../contractors/contractor-link';
import { RecordFiles } from '../files/record-files';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { historyLabels, historyView, scaleView, statusEvents } from '../status/status-view';
import { taskDueText } from './task-columns';
import { taskHistoryItem } from './task-history';
import { taskCardButtons, taskScaleSteps } from './task-menu';
import { taskQuery } from './tasks-data';

const date = (iso: string) => formatDateRu(bishkekDate(new Date(iso)));

/** Строки «подпись — значение» карточки (прототип `openTask`, `.kv`). */
function cardItems(t: Translate, task: Task): KeyValueItem[] {
  const items: KeyValueItem[] = [];
  if (task.contractor)
    items.push({
      id: 'cp',
      label: t('task.kv.cp'),
      value: <ContractorLink id={task.contractor.id} name={task.contractor.name} />,
    });
  else items.push({ id: 'scope', label: t('task.kv.scope'), value: t('task.kv.general') });
  items.push(
    {
      id: 'created',
      label: t('grid.col.created_by'),
      value: <Audit who={task.audit.createdBy} at={task.audit.createdAt} />,
    },
    {
      id: 'updated',
      label: t('grid.col.updated_by'),
      value: <Audit who={task.audit.updatedBy ?? task.audit.createdBy} at={task.audit.updatedAt} />,
    },
    { id: 'exec', label: t('task.kv.exec'), value: task.executorFullName || '—' },
    {
      id: 'by',
      label: t('task.kv.by'),
      value: t('task.kv.by_value', {
        name: task.author.shortName,
        date: date(task.audit.createdAt),
      }),
    },
    {
      id: 'date',
      label: t('task.kv.date'),
      value:
        task.term === 'month'
          ? t('task.kv.date_month', { date: formatDateRu(task.dueDate) })
          : taskDueText(t, task),
    },
  );
  if (task.doneAt)
    items.push({ id: 'done', label: t('task.kv.done_at'), value: date(task.doneAt) });
  items.push({
    id: 'confirm',
    label: t('task.kv.confirm'),
    value: t(task.confirm ? 'task.confirm.required' : 'task.confirm.not_required'),
  });
  if (task.status === 'confirmed' && task.confirmedBy) {
    const name = task.confirmedByFullName ?? task.confirmedBy.shortName;
    const who = task.confirmedBy.id !== task.author.id ? t('task.kv.instead', { name }) : name;
    items.push({
      id: 'confirmed',
      label: t('task.kv.confirmed_by'),
      value: task.confirmedAt ? `${who}, ${formatMomentRu(new Date(task.confirmedAt))}` : who,
    });
    if (task.confirmNote)
      items.push({ id: 'note', label: t('task.kv.comment'), value: task.confirmNote });
  }
  if (task.failReason && task.status === 'failed')
    items.push({ id: 'reason', label: t('task.kv.reason'), value: task.failReason });
  return items;
}

/** Кто и когда: имя, под ним момент мелким серым (прототип `auditKv`, `.aud`). */
function Audit({ who, at }: { who: string | null; at: string }) {
  return (
    <>
      {who ?? '—'}
      <span className="block text-[11.5px] text-faint">{formatMomentRu(new Date(at))}</span>
    </>
  );
}

/**
 * «Ждёт подтверждения: <постановщик> или сотрудник с правом «Подтверждать задачи»»; если исполнитель —
 * сам постановщик, его имени нет (свою задачу он не подтверждает); исполнителю — «Свою задачу
 * подтвердить нельзя».
 */
function pendingText(t: Translate, task: TaskRow, employeeId: string | null): string {
  const self = task.author.id === task.executor.id;
  const mine = task.executor.id === employeeId;
  if (self) return t(mine ? 'task.card.pending.self_mine' : 'task.card.pending.self');
  return t(mine ? 'task.card.pending.mine' : 'task.card.pending', { name: task.author.shortName });
}

/** Метки под шкалой: просрочена, подтверждение, файл при выполнении. */
function CardPills({ t, task }: { t: Translate; task: Task }) {
  const pills: ReactNode[] = [];
  if (task.overdue)
    pills.push(
      <Pill key="over" tone="bad" icon="alert">
        {t('task.pill.overdue')}
      </Pill>,
    );
  if (task.confirm) {
    const ok = task.status === 'confirmed';
    pills.push(
      <Pill key="confirm" tone={ok ? 'ok' : 'violet'} icon={ok ? 'check' : 'hourglass'}>
        {t(ok ? 'task.pill.confirmed' : 'task.pill.confirm_required')}
      </Pill>,
    );
  }
  // Без «Файлов в карточках» «Требуется файл» не действует (docs/deviations.md п. Б-1).
  if (task.needFile && task.filesOn)
    pills.push(
      <Pill key="file" tone={task.hasFile ? 'ok' : 'plain'} icon="clip">
        {t(task.hasFile ? 'task.pill.file_attached' : 'task.pill.file_needed')}
      </Pill>,
    );
  return pills.length ? <div className="flex flex-wrap items-center gap-2">{pills}</div> : null;
}

/** Комментарии задачи и поле «Написать комментарий» (Enter или кнопка — отправить). */
function Comments({ t, task, onTask }: { t: Translate; task: Task; onTask: (task: Task) => void }) {
  const toast = useToast();
  const errorText = useErrorText();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.tasks[':id'].comments.$post({ param: { id: task.id }, json: { text: value } }),
    );
    setBusy(false);
    const next = res.ok ? Task.safeParse(res.data) : null;
    if (next?.success) {
      setText('');
      return onTask(next.data);
    }
    toast(res.ok ? t('err.unknown') : errorText(res.error), { bad: true });
  };
  return (
    <Box title={t('task.comments', { n: task.comments.length })}>
      {task.comments.map((c) => (
        <div key={c.id} data-task-comment="" className="text-[13px]">
          <b>{c.author ?? t('status.system')}</b>{' '}
          <span className="text-faint">{formatMomentRu(new Date(c.at))}</span>
          <div className="[overflow-wrap:anywhere] whitespace-pre-line">{c.text}</div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          data-task-comment-input=""
          aria-label={t('task.comment.placeholder')}
          placeholder={t('task.comment.placeholder')}
          maxLength={TASK_COMMENT_MAX}
          className={inputClass()}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className={iconButtonClass()}
          title={t('task.comment.send')}
          aria-label={t('task.comment.send')}
          disabled={busy}
          onClick={() => void send()}
        >
          <Icon name="send" size="sm" />
        </button>
      </div>
    </Box>
  );
}

/**
 * Карточка задачи (ТЗ «Ручные задачи», «Подтверждение выполнения»; прототип modules/tasks.js,
 * `openTask`): шкала статусов (следующий шаг — нажатием, по правам; шаг отката — с правом «Откат
 * статусов»), причина возврата на доработку, кто подтверждает, метки, контрагент или «Общая задача»,
 * исполнитель, постановщик, срок, подтверждение («Подтвердил: <ФИО> вместо постановщика»), описание,
 * блок «Файлы», комментарии, «История статусов» и «История». Внизу — «Действия», «Выполнена»
 * исполнителю, «На доработку» и «Подтвердить» тому, кто подтверждает.
 */
export function TaskCard({
  id,
  initial,
  open,
  onClose,
  actor,
  actions,
  onAction,
  onRollback,
}: {
  id: string;
  /** Строка списка — показывается, пока карточка не загрузилась. */
  initial: TaskRow | null;
  open: boolean;
  onClose: () => void;
  actor: TaskActor | null;
  /** Пункты «Действия» (без «Открыть»). */
  actions: (task: TaskRow) => ActionEntry[];
  /** Кнопка или шаг шкалы: действие над задачей. */
  onAction: (action: TaskAction, task: Task) => void;
  /** Шаг отката на шкале. */
  onRollback: (task: Task, to: string) => void;
}) {
  const t = useT();
  const client = useQueryClient();
  const query = useQuery(taskQuery(id));
  const task = query.data ?? null;
  const shown = task ?? initial;
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const items = shown ? actions(shown) : [];
  const buttons = task && actor ? taskCardButtons(task, actor) : [];
  const setTask = (next: Task) => client.setQueryData(taskQuery(id).queryKey, next);

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={shown?.title ?? ''}
      sub={shown?.category.name}
      footer={
        <>
          {items.length > 0 ? (
            <button
              type="button"
              className={buttonClass('default')}
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              onClick={(e) => setMenu(menu ? null : e.currentTarget)}
            >
              <Icon name="more" size="sm" />
              {t('task.action.more')}
            </button>
          ) : null}
          <div className="flex-1" />
          {task && buttons.includes('done') ? (
            <button
              type="button"
              data-task-button="done"
              className={buttonClass('ok')}
              onClick={() => onAction('done', task)}
            >
              <Icon name="ok" size="sm" />
              {t('task.action.done')}
            </button>
          ) : null}
          {task && buttons.includes('rework') ? (
            <button
              type="button"
              data-task-button="rework"
              className={buttonClass('default')}
              onClick={() => onAction('rework', task)}
            >
              <Icon name="refresh" size="sm" />
              {t('task.action.rework')}
            </button>
          ) : null}
          {task && buttons.includes('confirm') ? (
            <button
              type="button"
              data-task-button="confirm"
              className={buttonClass('ok')}
              onClick={() => onAction('confirm', task)}
            >
              <Icon name="check" size="sm" />
              {t('task.action.confirm')}
            </button>
          ) : null}
        </>
      }
    >
      <div data-task-card={id} className="flex flex-col gap-3.5">
        {query.isError && !shown ? <Note tone="bad">{t('task.card.load_error')}</Note> : null}
        {task ? (
          <CardBody
            t={t}
            task={task}
            actor={actor}
            onStep={(action) => onAction(action, task)}
            onBack={(to) => onRollback(task, to)}
            onTask={setTask}
          />
        ) : null}
      </div>
      {menu && shown ? (
        <ActionMenu
          items={items}
          place={{ anchor: menu }}
          label={t('task.action.more')}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </Modal>
  );
}

function CardBody({
  t,
  task,
  actor,
  onStep,
  onBack,
  onTask,
}: {
  t: Translate;
  task: Task;
  actor: TaskActor | null;
  onStep: (action: TaskAction) => void;
  onBack: (to: string) => void;
  onTask: (task: Task) => void;
}) {
  const events = statusEvents(task.statusHistory);
  const steps = actor ? taskScaleSteps(task, actor) : {};
  const view = scaleView(t, {
    scale: 'task',
    status: task.status,
    history: events,
    confirm: task.confirm,
    next: Object.keys(steps),
    back: actor?.canRollback ? taskRollbackTarget(task.status) : null,
  });
  const history = historyView(t, 'task', events, new Date());
  const timeline = task.history.map((h, i) => taskHistoryItem(t, h, i));

  return (
    <>
      <Box>
        {view.kind === 'scale' ? (
          <StatusScale
            {...view.props}
            onStep={(to) => {
              const action = steps[to];
              if (action) onStep(action);
            }}
            onBack={onBack}
          />
        ) : view.kind === 'pill' ? (
          <StatusPill {...view.pill} />
        ) : null}
      </Box>
      {task.status === 'rework' && task.reworkReason ? (
        <Note tone="warn" icon="refresh">
          <b>{t('task.card.rework')}</b>
          {task.reworkBy ? ` · ${task.reworkBy.shortName}` : ''}: {task.reworkReason}
        </Note>
      ) : null}
      {taskPending(task.status) ? (
        <Note icon="hourglass">{pendingText(t, task, actor?.employeeId ?? null)}</Note>
      ) : null}
      <CardPills t={t} task={task} />
      <Box>
        <KeyValues items={cardItems(t, task)} />
        {task.description ? (
          <p className="m-0 [overflow-wrap:anywhere] whitespace-pre-line">{task.description}</p>
        ) : null}
      </Box>
      {task.filesOn ? <RecordFiles source={{ kind: 'task', id: task.id }} /> : null}
      <Comments t={t} task={task} onTask={onTask} />
      <Box title={t('status.history')}>
        <StatusHistory rows={history.rows} totals={history.totals} labels={historyLabels(t)} />
      </Box>
      {timeline.length > 0 ? (
        <Box title={t('task.history')}>
          <Timeline items={timeline} label={t('task.history')} />
        </Box>
      ) : null}
    </>
  );
}
