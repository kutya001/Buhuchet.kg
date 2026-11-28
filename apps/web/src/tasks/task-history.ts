import { bishkekDate, bishkekTime, formatDateRu, type UiTextKey } from '@buhuchet/domain';
import type { TaskHistoryEntry } from '@buhuchet/shared';
import type { TimelineItem } from '@buhuchet/ui';
import { fileHistoryText } from '../files/file-history';
import type { Translate } from '../l10n/translate';
import { statusName } from '../status/status-view';

type Change = TaskHistoryEntry['changes'][number];

/** Подписи полей задачи в истории «было → стало». */
const FIELD_LABEL: Readonly<Record<string, UiTextKey>> = {
  title: 'task.field.title',
  description: 'task.field.description',
  categoryCode: 'task.field.category',
  contractorId: 'task.field.contractor',
  // Проект задачи (задача 2.26): названия проектов «было → стало» подставляет сервер.
  projectId: 'task.card.project',
  executorEmployeeId: 'task.field.executor',
  term: 'task.field.term',
  dueDate: 'task.field.due_date',
  needFile: 'task.field.need_file',
  status: 'task.field.status',
};

/** Значение поля словами: дата — ДД.ММ.ГГГГ, «Да» / «Нет», вид срока, статус; пустое — «—». */
function valueText(t: Translate, field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'needFile') return t(v ? 'task.yes' : 'task.no');
  if (field === 'term') return t(v === 'month' ? 'task.term.month' : 'task.term.day');
  if (field === 'status') return statusName(t, 'task', String(v));
  if (field === 'dueDate' && typeof v === 'string') return formatDateRu(v);
  return String(v);
}

const scopeName = (t: Translate, contractor: unknown) =>
  t(contractor ? 'task.scope.contractor' : 'task.scope.general');

/**
 * Строки одного изменения (прототип modules/tasks.js, `log('t', …)`): смена вида задачи — «Вид задачи
 * изменён: «Общая» → «По контрагенту»»; «Требуется подтверждение» — «Подтверждение: требуется»;
 * остальные поля — «Поле: было → стало» (прототип пишет только «Задача изменена»; ТЗ «История
 * изменений» — было → стало).
 */
function changeLines(t: Translate, c: Change): string[] {
  if (c.field === 'confirm')
    return [t(c.to ? 'task.hist.confirm_on' : 'task.hist.confirm_off_line')];
  if (c.field === 'contractorId' && !c.from !== !c.to) {
    return [t('task.hist.scope', { from: scopeName(t, c.from), to: scopeName(t, c.to) })];
  }
  const label = FIELD_LABEL[c.field];
  if (!label) return [];
  return [
    t('task.hist.changed', {
      field: t(label),
      from: valueText(t, c.field, c.from),
      to: valueText(t, c.field, c.to),
    }),
  ];
}

/** Что произошло — строкой: поставлена, изменена (по полям), файл прикреплён или удалён. */
export function taskHistoryText(t: Translate, entry: TaskHistoryEntry): string {
  const change = (field: string, key: 'from' | 'to') =>
    String(entry.changes.find((c) => c.field === field)?.[key] ?? '');
  const file = (key: 'from' | 'to') => change('file', key);
  switch (entry.action) {
    case 'create':
      return t('task.hist.created');
    case 'file_attach':
      return fileHistoryText(t, entry) ?? t('task.hist.file_attach', { name: file('to') });
    case 'file_edit':
    case 'file_restore':
      return fileHistoryText(t, entry) ?? '';
    case 'file_delete':
      return t('task.hist.file_delete', { name: file('from') });
    // Серия (доработки 28.11.2026; прототип `tsLog`): запись — на ближайшей задаче серии.
    case 'series_set':
      return t('task.hist.series_set', { rule: change('repeat', 'to') });
    case 'series_edit': {
      const rule = entry.changes.find((c) => c.field === 'repeat');
      return rule
        ? t('task.hist.series_edit', { from: String(rule.from ?? ''), to: String(rule.to ?? '') })
        : t('task.hist.series_edit_tasks');
    }
    case 'series_stop': {
      const why = change('why', 'to');
      return why ? t('task.hist.series_stop_why', { why }) : t('task.hist.series_stop');
    }
    case 'series_resume':
      return t('task.hist.series_resume');
    case 'series_make':
      return t('task.hist.series_make');
    case 'series_end':
      return t('task.hist.series_end');
    default:
      return entry.changes.flatMap((c) => changeLines(t, c)).join('; ');
  }
}

/** Запись «Истории» карточки задачи для ленты: дата и время по Бишкеку, что, кто. */
export function taskHistoryItem(
  t: Translate,
  entry: TaskHistoryEntry,
  index: number,
): TimelineItem {
  const at = new Date(entry.at);
  return {
    id: `${entry.at}-${index}`,
    date: formatDateRu(bishkekDate(at)),
    time: bishkekTime(at),
    text: taskHistoryText(t, entry),
    who: entry.actor ?? t('status.system'),
    via: entry.via === 'telegram' ? t('telegram.via') : null,
  };
}
