import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  type UiTextKey,
} from '@buhuchet/domain';
import type { ContractorHistory } from '@buhuchet/shared';
import type { TimelineItem } from '@buhuchet/ui';
import { pageHistoryActor, pageHistoryText } from '../contractor-page/page-history';
import type { Translate } from '../l10n/translate';
import { reportHistoryText } from '../reports/report-history';

type Entry = ContractorHistory['items'][number];
type Change = Entry['changes'][number];
type Names = ContractorHistory['names'];

/** Подписи полей контрагента в «Изменено: …» — строчными, как в прототипе (editCpDlg, `L`). */
const CONTRACTOR_FIELD: Readonly<Record<string, UiTextKey>> = {
  name: 'cp.hist.field.name',
  inn: 'cp.hist.field.inn',
  phone: 'cp.hist.field.phone',
  formCode: 'cp.hist.field.form',
  taxOfficeCode: 'cp.hist.field.office',
  regimeCode: 'cp.hist.field.regime',
  regime2Code: 'cp.hist.field.regime2',
  benefits: 'cp.hist.field.benefits',
  bases: 'cp.hist.field.bases',
  bizSize: 'cp.hist.field.size',
  gked: 'cp.hist.field.gked',
  gkedExtra: 'cp.hist.field.gked_extra',
  head: 'cp.hist.field.head',
  contact: 'cp.hist.field.contact',
  note: 'cp.hist.field.note',
  contractNo: 'cp.hist.field.contract',
  contractDate: 'cp.hist.field.contract',
  feeDay: 'cp.hist.field.fee_day',
  firstMonthMode: 'cp.hist.field.first_month',
  registration: 'cp.hist.field.registration',
  paysTo: 'cp.hist.field.pays_to',
  startDate: 'cp.hist.field.start',
  socfundFlags: 'cp.hist.field.socfund',
  socfundTariff: 'cp.hist.field.socfund',
};

/** Подписи полей назначения в «Изменено назначение …: …» (прототип asgDlg). */
const ASSIGNMENT_FIELD: Readonly<Record<string, UiTextKey>> = {
  fromMonth: 'cp.hist.asg.field.from',
  untilMonth: 'cp.hist.asg.field.until',
  responsibleEmployeeId: 'cp.hist.asg.field.responsible',
  rate: 'cp.hist.asg.field.rate',
  enRates: 'cp.hist.asg.field.rate',
  rateAdditions: 'cp.hist.asg.field.rate',
  dueDay: 'cp.hist.asg.field.due',
  ownPeriod: 'cp.hist.asg.field.own',
  ownDay: 'cp.hist.asg.field.own',
  ownMonth: 'cp.hist.asg.field.own',
  fixedAmount: 'cp.hist.asg.field.fixed',
  note: 'cp.hist.asg.field.note',
};

/** «Сотрудник А.» по номеру из `names`; пусто — «—». */
const nameOf = (names: Names, v: unknown) => (typeof v === 'string' && v ? (names[v] ?? '—') : '—');

/** «11.2026» по «2026-11-01» или «2026-11». */
const monthOf = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}/.test(v) ? `${v.slice(5, 7)}.${v.slice(0, 4)}` : '';

/** Подписи изменённых полей без повторов: «название, телефон». */
function labelsOf(t: Translate, changes: readonly Change[], map: Record<string, UiTextKey>) {
  const out: string[] = [];
  for (const c of changes) {
    const key = map[c.field];
    if (!key) continue;
    const label = t(key);
    if (!out.includes(label)) out.push(label);
  }
  return out.join(', ');
}

/** Ставка обслуживания словами: «12 000,00 сом в месяц с 01.11.2026». */
function tariffText(t: Translate, v: unknown): string {
  if (typeof v !== 'object' || v === null) return '';
  const x = v as { amount?: unknown; period?: unknown; validFrom?: unknown };
  if (typeof x.amount !== 'number') return '';
  return t('cp.hist.tariff', {
    amount: formatSom(x.amount),
    per: t(x.period === 'Y' ? 'cp.hist.per_year' : 'cp.hist.per_month'),
    from: typeof x.validFrom === 'string' ? formatDateRu(x.validFrom) : '',
  });
}

/** Строки изменения контрагента (прототип: «Ответственный: А → Б», «Изменено: …», статус и периоды). */
function contractorLines(t: Translate, e: Entry, names: Names): string[] {
  // Созданный загрузкой (из Excel, из свидетельства и выписки) — одной строкой-причиной, как в
  // прототипе: «Создан загрузкой из Excel».
  if (e.action === 'create' && e.reason) return [];
  if (e.action === 'create') {
    const oneoff = e.changes.some((c) => c.field === 'kind' && c.to === 'oneoff');
    return [t(oneoff ? 'cp.hist.created_oneoff' : 'cp.hist.created')];
  }
  if (e.action === 'delete') return [t('cp.hist.deleted')];
  const lines: string[] = [];
  const rest: Change[] = [];
  for (const c of e.changes) {
    switch (c.field) {
      case 'responsibleEmployeeId':
        lines.push(
          t('cp.hist.responsible', { from: nameOf(names, c.from), to: nameOf(names, c.to) }),
        );
        break;
      case 'serviceStatus':
        lines.push(
          t('cp.hist.service_status', {
            from: t(`status.service.${String(c.from)}` as UiTextKey),
            to: t(`status.service.${String(c.to)}` as UiTextKey),
          }),
        );
        break;
      case 'servicePeriods':
        lines.push(
          t('cp.hist.periods', {
            from: typeof c.from === 'string' ? c.from : '—',
            to: typeof c.to === 'string' ? c.to : '—',
          }),
        );
        break;
      case 'pause': {
        const p = (c.to ?? {}) as { from?: unknown; resume?: unknown };
        lines.push(
          p.resume
            ? t('cp.hist.pause_resume', { from: monthOf(p.from), resume: monthOf(p.resume) })
            : t('cp.hist.pause', { from: monthOf(p.from) }),
        );
        break;
      }
      case 'pauseCancelled':
        lines.push(t('cp.hist.pause_cancelled'));
        break;
      case 'serviceFill':
        lines.push(
          t('cp.hist.fill', {
            months: Array.isArray(c.to) ? c.to.map(monthOf).join(', ') : '',
          }),
        );
        break;
      case 'tariff':
        lines.push(tariffText(t, c.to));
        break;
      case 'kind':
        lines.push(
          t('cp.hist.kind', {
            from: t(c.from === 'oneoff' ? 'cp.kind.oneoff' : 'cp.kind.regular'),
            to: t(c.to === 'oneoff' ? 'cp.kind.oneoff' : 'cp.kind.regular'),
          }),
        );
        break;
      case 'needReceiptFile':
        lines.push(t(c.to ? 'cp.hist.need_file_on' : 'cp.hist.need_file_off'));
        break;
      case 'paysTo':
        lines.push(
          t('cp.hist.pays_to', {
            to: t(c.to === 'org' ? 'money.cp.pays_to.org' : 'money.cp.pays_to.emp'),
          }),
        );
        break;
      case 'gkedConfirmation': {
        const ask = (c.to as { ask?: unknown } | null)?.ask;
        lines.push(
          c.to
            ? typeof ask === 'string' && ask
              ? t('cp.hist.gked_confirmed_ask', { ask })
              : t('cp.hist.gked_confirmed')
            : t('cp.hist.gked_unconfirmed'),
        );
        break;
      }
      default:
        rest.push(c);
    }
  }
  const changed = labelsOf(t, rest, CONTRACTOR_FIELD);
  if (changed) lines.push(t('cp.hist.changed', { fields: changed }));
  return lines;
}

/** Строки изменения назначения: «Назначен отчёт: НДС», «Снят отчёт: НДС», «Изменено назначение …». */
function assignmentLines(t: Translate, e: Entry): string[] {
  const name = e.subject ?? '';
  if (e.action === 'create') return [t('cp.hist.asg.create', { name })];
  if (e.action === 'delete') return [t('cp.hist.asg.delete', { name })];
  if (e.changes.some((c) => c.field === 'endedOn' && c.to)) return [t('cp.hist.asg.end', { name })];
  const fields = labelsOf(t, e.changes, ASSIGNMENT_FIELD);
  return [
    fields ? t('cp.hist.asg.update', { name, fields }) : t('cp.hist.asg.update_any', { name }),
  ];
}

/**
 * Поступление от контрагента (задача 2.19; прототип inDlg, `log('cp', …)`, allocText): «Поступление
 * 6 000 сом: НДС 09.2026 — 3 000, ЕН III кв. 2026 — 2 000, аванс — 1 000».
 */
function moneyLines(t: Translate, e: Entry): string[] {
  if (e.action === 'file_attach' || e.action === 'file_delete')
    return [t('cp.hist.receipt_file', { text: reportHistoryText(t, { ...e, reason: null }, 0) })];
  if (e.action !== 'create') return [];
  const total = e.changes.find((c) => c.field === 'total')?.to;
  if (typeof total !== 'number') return [];
  const allocs = e.changes.find((c) => c.field === 'allocations')?.to;
  const parts = (Array.isArray(allocs) ? allocs : []).filter(
    (a): a is { report: string; amount: number } =>
      typeof a === 'object' &&
      a !== null &&
      typeof a.report === 'string' &&
      typeof a.amount === 'number',
  );
  const rest = total - parts.reduce((sum, a) => sum + a.amount, 0);
  const list = parts.map((a) => `${a.report} — ${formatSom(a.amount, 'auto')}`);
  if (list.length && rest > 0)
    list.push(t('cp.hist.receipt_advance', { amount: formatSom(rest, 'auto') }));
  const amount = formatSomWithUnit(total);
  return [
    list.length
      ? t('cp.hist.receipt_for', { amount, list: list.join(', ') })
      : t('cp.hist.receipt', { amount }),
  ];
}

/**
 * Что произошло — строкой (прототип contractor-card.js, вкладка «История»: у отчёта перед текстом —
 * «вид период ·»; ТЗ «История изменений»: какие поля изменены, кто и когда). Причина — в скобках;
 * запись только с причиной (уведомление «по УГНС», тариф Соцфонда, «не назначен отчёт») — сама причина.
 */
export function contractorHistoryText(t: Translate, e: Entry, names: Names): string {
  let lines: string[];
  switch (e.entity) {
    case 'contractor':
      lines = e.changes.length || e.action !== 'update' ? contractorLines(t, e, names) : [];
      break;
    case 'assignment':
      lines = assignmentLines(t, e);
      break;
    case 'report': {
      const text = reportHistoryText(t, { ...e, reason: null }, 0);
      lines = [e.subject ? `${e.subject} · ${text}` : text];
      break;
    }
    case 'task':
      lines = [
        t(
          e.action === 'create'
            ? 'cp.hist.task.create'
            : e.action === 'delete'
              ? 'cp.hist.task.delete'
              : 'cp.hist.task.update',
          { title: e.subject ?? '' },
        ),
      ];
      break;
    case 'contractor_page':
      lines = [pageHistoryText(t, e)];
      break;
    // Файл контрагента — загруженный вручную или из свидетельства и выписки: «Прикреплён файл «…»»,
    // «Удалён файл «…»», как в карточке отчёта.
    case 'file':
      lines = [reportHistoryText(t, { ...e, reason: null }, 0)];
      break;
    case 'money_operation':
      lines = moneyLines(t, e);
      break;
    default:
      lines = [];
  }
  const text = lines.filter(Boolean).join('; ');
  if (!e.reason) return text || t('cp.hist.update');
  return text ? `${text} (${e.reason})` : e.reason;
}

/** Запись ленты «История»: дата и время по Бишкеку, что произошло, кто. */
export function contractorHistoryItem(t: Translate, e: Entry, names: Names): TimelineItem {
  const at = new Date(e.at);
  return {
    id: String(e.id),
    date: formatDateRu(bishkekDate(at)),
    time: bishkekTime(at),
    text: contractorHistoryText(t, e, names),
    who:
      e.entity === 'contractor_page'
        ? pageHistoryActor(t, e.actor)
        : (e.actor ?? t('status.system')),
  };
}
