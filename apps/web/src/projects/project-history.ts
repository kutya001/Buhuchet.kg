import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
} from '@buhuchet/domain';
import type { TimelineItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Запись истории проекта: что сделано и поля «было → стало»; `paymentId` — запись о транше. */
export interface ProjectHistoryEntry {
  action: string;
  paymentId?: string | null;
  changes: readonly { field: string; from?: unknown; to?: unknown }[];
  reason: string | null;
}

const valueOf = (e: ProjectHistoryEntry, field: string, key: 'from' | 'to'): unknown =>
  e.changes.find((c) => c.field === field)?.[key];

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0);

/**
 * Запись о транше (прототип: `log('p', p.id, 'Оплата 5 000 сом (аванс)', …, {sub})` при записи, fin-op.js
 * `opLog` при изменении и удалении): «Оплата 5 000 сом (аванс)», «Изменено: сумма 50 000,00 → 45 000,00
 * сом; дата …; примечание «…» → «…». Причина: …», «Операция удалена: оплата по проекту на 45 000 сом от
 * 15.10.2026. Причина: …». Файлы — как в карточке отчёта.
 */
export function projectPaymentHistoryText(t: Translate, e: ProjectHistoryEntry): string {
  if (e.action === 'file_attach')
    return t('report.hist.file_attach', { name: str(valueOf(e, 'file', 'to')) });
  if (e.action === 'file_delete')
    return t('report.hist.file_delete', { name: str(valueOf(e, 'file', 'from')) });
  if (e.action === 'create') {
    const amount = formatSomWithUnit(num(valueOf(e, 'amount', 'to')));
    const note = str(valueOf(e, 'note', 'to'));
    return note ? t('proj.hist.pay_note', { amount, note }) : t('proj.hist.pay', { amount });
  }
  if (e.action === 'delete') {
    const date = str(valueOf(e, 'paidOn', 'from'));
    const params = {
      done: t('fin.del.done'),
      kind: t('fin.pt.kind').toLowerCase(),
      amount: formatSomWithUnit(num(valueOf(e, 'amount', 'from'))),
      date: date ? formatDateRu(date) : '—',
    };
    return e.reason
      ? t('fin.hist.deleted_why', { ...params, reason: e.reason })
      : t('fin.hist.deleted', params);
  }
  const parts: string[] = [];
  const amount = e.changes.find((c) => c.field === 'amount');
  if (amount)
    parts.push(
      t('fin.hist.ch.amount', { from: formatSom(num(amount.from)), to: formatSom(num(amount.to)) }),
    );
  const date = e.changes.find((c) => c.field === 'paidOn');
  if (date && typeof date.from === 'string' && typeof date.to === 'string')
    parts.push(t('fin.hist.ch.date', { from: formatDateRu(date.from), to: formatDateRu(date.to) }));
  const note = e.changes.find((c) => c.field === 'note');
  if (note)
    parts.push(t('fin.hist.ch.note', { from: str(note.from) || '—', to: str(note.to) || '—' }));
  if (!parts.length) return t('fin.edit.same');
  const what = parts.join('; ');
  return e.reason
    ? t('fin.hist.edited_why', { what, reason: e.reason })
    : t('fin.hist.edited', { what });
}

/**
 * Что произошло с проектом — строкой, как в прототипе (modules/projects.js, `log('p', …)`): «Проект «…»
 * создан», «Проект изменён», «Сделано: …», «Снова в работе: …», «Добавлена работа: … (исполнитель, до
 * даты)», «Прикреплён файл «…»», «Удалён файл «…»»; записи траншей — `projectPaymentHistoryText`. Смены
 * статуса — в «Истории статусов». Имена сотрудников — из `names` ответа.
 */
export function projectHistoryText(
  t: Translate,
  e: ProjectHistoryEntry,
  names: Readonly<Record<string, string>>,
): string {
  if (e.paymentId) return projectPaymentHistoryText(t, e);
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
