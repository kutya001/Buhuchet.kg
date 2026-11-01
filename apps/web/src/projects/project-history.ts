import { bishkekDate, bishkekTime, formatDateRu } from '@buhuchet/domain';
import type { TimelineItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Запись истории проекта: что сделано и поля «было → стало». */
export interface ProjectHistoryEntry {
  action: string;
  changes: readonly { field: string; from?: unknown; to?: unknown }[];
  reason: string | null;
}

const valueOf = (e: ProjectHistoryEntry, field: string, key: 'from' | 'to'): unknown =>
  e.changes.find((c) => c.field === field)?.[key];

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Что произошло с проектом — строкой, как в прототипе (modules/projects.js, `log('p', …)`): «Проект «…»
 * создан», «Проект изменён», «Сделано: …», «Снова в работе: …», «Добавлена работа: … (исполнитель, до
 * даты)», «Прикреплён файл «…»», «Удалён файл «…»». Смены статуса — в «Истории статусов». Имена
 * сотрудников — из `names` ответа.
 */
export function projectHistoryText(
  t: Translate,
  e: ProjectHistoryEntry,
  names: Readonly<Record<string, string>>,
): string {
  let text: string;
  switch (e.action) {
    case 'create':
      text = t('proj.hist.created', { name: str(valueOf(e, 'name', 'to')) });
      break;
    case 'work_done':
      text = t('proj.hist.work_done', { name: str(valueOf(e, 'work', 'to')) });
      break;
    case 'work_undone':
      text = t('proj.hist.work_undone', { name: str(valueOf(e, 'work', 'to')) });
      break;
    case 'work_add': {
      const exec = names[str(valueOf(e, 'executor', 'to'))] ?? '';
      const due = str(valueOf(e, 'due', 'to'));
      const name = str(valueOf(e, 'work', 'to'));
      text = due
        ? t('proj.hist.work_add_due', { name, exec, date: formatDateRu(due) })
        : t('proj.hist.work_add', { name, exec });
      break;
    }
    case 'file_attach':
      text = t('report.hist.file_attach', { name: str(valueOf(e, 'file', 'to')) });
      break;
    case 'file_delete':
      text = t('report.hist.file_delete', { name: str(valueOf(e, 'file', 'from')) });
      break;
    default:
      text = t('proj.hist.updated');
  }
  return e.reason ? `${text} (${e.reason})` : text;
}

/** Лента «История» карточки проекта: сверху новые. */
export function projectHistoryItems(
  t: Translate,
  rows: readonly (ProjectHistoryEntry & { id: number; at: string; actor: string | null })[],
  names: Readonly<Record<string, string>>,
): TimelineItem[] {
  return rows.map((h) => {
    const at = new Date(h.at);
    return {
      id: String(h.id),
      date: formatDateRu(bishkekDate(at)),
      time: bishkekTime(at),
      text: projectHistoryText(t, h, names),
      who: h.actor ?? t('status.system'),
    };
  });
}
