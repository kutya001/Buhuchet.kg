'use client';

import {
  bishkekDate,
  formatDateRu,
  formatMomentRu,
  TASK_COMMENT_MAX,
  taskOpen,
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
  DueBit,
  Fold,
  Icon,
  iconButtonClass,
  inputClass,
  KeyValues,
  Modal,
  Note,
  Pill,
  StatusHistory,
  StatusLine,
  StatusPill,
  StatusScale,
  Timeline,
  useToast,
  type ActionEntry,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, callApi } from '../api-client';
import { ContractorLink } from '../contractors/contractor-link';
import { RecordFiles } from '../files/record-files';
import { InfoTip } from '../kpi/kpi-table';
import { ProjectLink } from '../projects/project-link';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { dueWords, MiniScale } from '../status/status-line';
import { historyLabels, historyView, scaleView, statusEvents } from '../status/status-view';
import { taskHistoryItem } from './task-history';
import { taskCardButtons, taskScaleSteps } from './task-menu';
import { taskQuery } from './tasks-data';

const date = (iso: string) => formatDateRu(bishkekDate(new Date(iso)));

/**
 * Строки «подпись — значение» на виду (прототип v136 `openTask`, `.kv`): контрагент и проект или «Общая
 * задача», кто поставил, у закрытой — срок, кто подтвердил, причина. Срок и исполнитель открытой задачи —
 * в строке состояния, «Создал» и «Изменил» — в «Истории».
 */
function cardItems(t: Translate, task: Task, closed: boolean): KeyValueItem[] {
  const items: KeyValueItem[] = [];
  if (task.contractor) {
    items.push({
      id: 'cp',
      label: t('task.kv.cp'),
      value: <ContractorLink id={task.contractor.id} name={task.contractor.name} />,
    });
    // Проект задачи (задача 2.26; прототип `openTask`: «Проект» ссылкой на карточку проекта).
    if (task.project)
      items.push({
        id: 'project',
        label: t('task.card.project'),
        value: <ProjectLink id={task.project.id} name={task.project.name} />,
      });
  } else items.push({ id: 'scope', label: t('task.kv.scope'), value: t('task.kv.general') });
  items.push({
    id: 'by',
    label: t('task.kv.by'),
    value: t('task.kv.by_value', {
      name: task.author.shortName,
      date: date(task.audit.createdAt),
    }),
  });
  if (closed)
    items.push({ id: 'date', label: t('task.kv.date'), value: formatDateRu(task.dueDate) });
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

/** «Создал» и «Изменил» — внизу «Истории» (прототип v136 `auditKv` в `details.rc-hist`). */
function auditItems(t: Translate, task: Task): KeyValueItem[] {
  return [
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
  ];
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
 * Кто подтверждает (прототип v136): на виду — «Подтверждает <постановщик>», кто ещё может — под «?».
 * Если исполнитель — сам постановщик, его имени нет (свою задачу он не подтверждает); исполнителю в
 * пояснении — «Свою задачу подтвердить нельзя».
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-83
function PendingNote({
  t,
  task,
  employeeId,
}: {
  t: Translate;
  task: TaskRow;
  employeeId: string | null;
}) {
  const self = task.author.id === task.executor.id;
  const mine = task.executor.id === employeeId;
  return (
    <div data-task-pending="">
      <Note icon="hourglass">
        {self
          ? t('task.card.pending.self')
          : t('task.card.pending', { name: task.author.shortName })}{' '}
        <InfoTip
          label={t('task.card.pending.label')}
          text={t(
            self
              ? 'task.card.pending.tip_self'
              : mine
                ? 'task.card.pending.tip_mine'
                : 'task.card.pending.tip',
          )}
        />
      </Note>
    </div>
  );
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
 * Карточка задачи (ТЗ «Ручные задачи», «Подтверждение выполнения»; прототип v136 modules/tasks.js,
 * `openTask`; решение заказчика 17.11.2026 «Меньше текста, понятнее, плавнее»): описание — сразу под
 * шапкой; строка состояния — шкала коротко, срок с «осталось N дн.» или «выполнена <дата>», исполнитель;
 * полная шкала (следующий шаг — нажатием, по правам; откат — с правом «Откат статусов») раскрывается
 * нажатием на короткую. Дальше — причина возврата на доработку, кто подтверждает (подробности под «?»),
 * «нужен файл», контрагент и проект или «Общая задача», постановщик, блок «Файлы», комментарии и свёрнутая
 * «История» (статусы, «Изменения», кто создал и изменил). Внизу один ряд: «Действия», «Выполнена»
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
              data-task-more=""
              className={`${buttonClass('default')} max-md:min-w-11 max-md:px-2.5`}
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              aria-label={t('task.action.more')}
              onClick={(e) => setMenu(menu ? null : e.currentTarget)}
            >
              <Icon name="more" size="sm" />
              <span className="max-md:hidden">{t('task.action.more')}</span>
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
              className={buttonClass('dangerOutline')}
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
  const today = bishkekDate(new Date());
  // Закрытая задача: срок уже не ведёт — в строке состояния «выполнена <дата>», срок — строкой ниже.
  const closed = !taskOpen(task.status) && !taskPending(task.status);
  const full =
    view.kind === 'scale' ? (
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
    ) : undefined;

  return (
    <>
      {task.description ? (
        <p
          data-task-desc=""
          className="m-0 text-[14.5px] leading-[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap"
        >
          {task.description}
        </p>
      ) : null}
      <StatusLine
        id={`t${task.id}`}
        label={t('status.line.scale')}
        minis={
          <MiniScale
            t={t}
            input={{ scale: 'task', status: task.status, history: [], confirm: task.confirm }}
          />
        }
        parts={[
          closed ? (
            task.doneAt ? (
              <>
                <Icon name="ok" size="sm" />
                <span>{t('task.line.done', { date: date(task.doneAt) })}</span>
              </>
            ) : null
          ) : (
            <DueBit
              text={t('status.line.due', { date: formatDateRu(task.dueDate) })}
              {...dueWords(t, task.dueDate, task.overdue, today)}
              note={task.term === 'month' ? t('task.line.month') : null}
            />
          ),
          <>
            <Icon name="user" size="sm" />
            <span>{task.executor.shortName}</span>
          </>,
        ]}
        full={full}
      />
      {task.status === 'rework' && task.reworkReason ? (
        <Note tone="warn" icon="refresh">
          <b>{t('task.card.rework')}</b>
          {task.reworkBy ? ` · ${task.reworkBy.shortName}` : ''}: {task.reworkReason}
        </Note>
      ) : null}
      {taskPending(task.status) ? (
        <PendingNote t={t} task={task} employeeId={actor?.employeeId ?? null} />
      ) : null}
      {/* Без «Файлов в карточках» «Требуется файл» не действует (docs/deviations.md п. Б-1). */}
      {task.needFile && task.filesOn ? (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={task.hasFile ? 'ok' : 'plain'} icon="clip">
            {t(task.hasFile ? 'task.pill.file_attached' : 'task.pill.file_needed')}
          </Pill>
        </div>
      ) : null}
      <Box>
        <KeyValues items={cardItems(t, task, closed)} />
      </Box>
      {task.filesOn ? <RecordFiles source={{ kind: 'task', id: task.id }} /> : null}
      <Comments t={t} task={task} onTask={onTask} />
      <Fold
        box
        data-task-history=""
        title={<h3 className="m-0 [font:inherit] text-inherit">{t('status.fold.history')}</h3>}
      >
        <StatusHistory rows={history.rows} totals={history.totals} labels={historyLabels(t)} />
        {timeline.length > 0 ? (
          <>
            <h4 className="m-0 mt-1 text-[12.5px] font-semibold text-muted">
              {t('status.fold.changes')}
            </h4>
            <Timeline items={timeline} label={t('status.fold.changes')} />
          </>
        ) : null}
        <KeyValues items={auditItems(t, task)} />
      </Fold>
    </>
  );
}
