import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  formatSomWithUnit,
  type UiTextKey,
} from '@buhuchet/domain';
import type { ReportHistoryEntry } from '@buhuchet/shared';
import type { TimelineItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

type Change = ReportHistoryEntry['changes'][number];

/** Подписи полей отчёта в истории «было → стало». */
const FIELD_LABEL: Readonly<Record<string, UiTextKey>> = {
  amount: 'report.hist.field.amount',
  dueDate: 'report.hist.field.due_date',
  payDue: 'report.hist.field.pay_due',
  periodStart: 'report.hist.field.period_start',
  eventDate: 'report.hist.field.event_date',
  submittedOn: 'report.hist.field.submitted_on',
  responsibleEmployeeId: 'report.hist.field.responsible',
};

const DATE_FIELDS = new Set(['dueDate', 'payDue', 'periodStart', 'eventDate', 'submittedOn']);

/** Строка суммы в истории: «ЕНС-04 · безналичная выручка, 4 %: выручка 300 000 сом, налог 12 000 сом». */
interface LineValue {
  label: string;
  revenue: number | null;
  tax: number;
}

const isLines = (v: unknown): v is LineValue[] =>
  Array.isArray(v) && v.every((l) => typeof l === 'object' && l !== null && 'label' in l);

/** Строки суммы словами (прототип linesTxt). */
export function linesText(t: Translate, lines: readonly LineValue[]): string {
  return lines
    .map((l) =>
      t('report.hist.line', {
        label: l.label,
        revenue:
          l.revenue === null
            ? ''
            : t('report.hist.line_revenue', { revenue: formatSomWithUnit(l.revenue) }),
        tax: formatSomWithUnit(l.tax),
      }),
    )
    .join('; ');
}

/** Значение поля словами: сумма — «1 250,50 сом», пустая — «не указана»; дата — ДД.ММ.ГГГГ. */
function valueText(t: Translate, field: string, v: unknown): string {
  if (v === null || v === undefined || v === '')
    return field === 'amount' ? t('report.hist.none') : '—';
  if (field === 'amount' && typeof v === 'number') return formatSomWithUnit(v);
  if (DATE_FIELDS.has(field) && typeof v === 'string') return formatDateRu(v);
  return String(v);
}

/**
 * Строки одного изменения (прототип report-card.js, «История изменений»; ТЗ «История изменений» —
 * было → стало): сумма и даты — «Поле: было → стало»; строки суммы — «строки: …» или «строки по ставкам
 * очищены»; файлы, загруженные в окне, — «Прикреплены файлы: …»; прежняя версия — «Создан уточнённый
 * отчёт, версия N».
 */
function changeLines(t: Translate, c: Change, revision: number): string[] {
  if (c.field === 'lines') {
    if (!isLines(c.to) || c.to.length === 0) return [t('report.hist.lines_cleared')];
    return [`${t('report.hist.field.lines')}: ${linesText(t, c.to)}`];
  }
  if (c.field === 'files' && Array.isArray(c.to))
    return [t('report.hist.files', { names: c.to.map(String).join(', ') })];
  if (c.field === 'superseded')
    return c.to ? [t('report.hist.superseded', { n: revision + 1 })] : [];
  const label = FIELD_LABEL[c.field];
  if (!label) return [];
  return [
    t('report.hist.changed', {
      field: t(label),
      from: valueText(t, c.field, c.from),
      to: valueText(t, c.field, c.to),
    }),
  ];
}

/** Что произошло — строкой; причина — в скобках, как в прототипе. */
export function reportHistoryText(
  t: Translate,
  entry: ReportHistoryEntry,
  revision: number,
): string {
  const file = (key: 'from' | 'to') =>
    String(entry.changes.find((c) => c.field === 'file')?.[key] ?? '');
  let text: string;
  switch (entry.action) {
    case 'create': {
      const rev = entry.changes.find((c) => c.field === 'revision')?.to;
      text =
        typeof rev === 'number' && rev > 0
          ? rev > 1
            ? t('report.hist.revision_from', { n: rev - 1 })
            : t('report.hist.revision_from_first')
          : t('report.hist.create');
      // «Разовый отчёт» на нерабочий день: «…; срок 21.11.2026 — нерабочий день, перенесён на 23.11.2026».
      const shift = entry.changes.find((c) => c.field === 'dueShift');
      if (shift && typeof shift.from === 'string' && typeof shift.to === 'string')
        text += `; ${t('report.hist.due_shift', { from: formatDateRu(shift.from), to: formatDateRu(shift.to) })}`;
      break;
    }
    case 'file_attach':
      text = t('report.hist.file_attach', { name: file('to') });
      break;
    case 'file_delete':
      text = t('report.hist.file_delete', { name: file('from') });
      break;
    default:
      text =
        entry.changes.flatMap((c) => changeLines(t, c, revision)).join('; ') ||
        t('report.hist.update');
  }
  return entry.reason ? `${text} (${entry.reason})` : text;
}

/** Запись «Истории изменений» карточки отчёта для ленты: дата и время по Бишкеку, что, кто. */
export function reportHistoryItem(
  t: Translate,
  entry: ReportHistoryEntry,
  index: number,
  revision: number,
): TimelineItem {
  const at = new Date(entry.at);
  return {
    id: `${entry.at}-${index}`,
    date: formatDateRu(bishkekDate(at)),
    time: bishkekTime(at),
    text: reportHistoryText(t, entry, revision),
    who: entry.actor ?? t('status.system'),
  };
}
