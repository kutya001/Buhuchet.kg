import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  LEAD_DOCS_KEEP_DAYS,
  LEAD_DOCS_KEEP_REJECTED_DAYS,
  type LeadStatus,
} from '@buhuchet/domain';
import type { AdminLeadCard, AdminLeadEvent } from '@buhuchet/shared';
import type { TimelineItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { statusName } from '../status/status-view';

// «История» окна заявки (прототип admin/leads.js — тексты `leadLog`, modules/landing.js — заявка и
// повтор с того же телефона).

/** Что произошло — строкой «Истории» (прототип: тексты `leadLog`). */
export function leadEventText(
  t: Translate,
  e: AdminLeadEvent,
  fromStand: boolean,
  /** Заявка с документами: организацию по ней создаёт «Одобрить» (прототип v114: «Одобрена: …»). */
  approved = false,
): string {
  const name = (code: LeadStatus | null) => (code ? statusName(t, 'lead', code) : '—');
  const from = name(e.from);
  const to = name(e.to);
  switch (e.kind) {
    case 'created':
      return t(fromStand ? 'leads.hist.created_stand' : 'leads.hist.created');
    case 'repeat':
      return t(e.text ? 'leads.hist.repeat_note' : 'leads.hist.repeat');
    case 'note':
      return t('leads.hist.note');
    case 'rollback':
      return t('leads.hist.rollback', { from, to, reason: e.text ?? '' });
    case 'org':
      return e.from && e.from !== e.to
        ? t(approved ? 'leads.hist.approved_status' : 'leads.hist.org_status', {
            from,
            to,
            name: e.text ?? '',
          })
        : t(approved ? 'leads.hist.approved' : 'leads.hist.org', { name: e.text ?? '' });
    // Файлы заявки удалены по сроку (прототип v114 ldPurge): после отказа или без решения.
    case 'docs':
      return e.text === 'rejected'
        ? t('leads.hist.docs_rejected', { days: LEAD_DOCS_KEEP_REJECTED_DAYS })
        : t('leads.hist.docs_kept', { days: LEAD_DOCS_KEEP_DAYS });
    case 'status':
      return e.text
        ? t('leads.hist.status_reason', { from, to, reason: e.text })
        : t('leads.hist.status', { from, to });
  }
}

/** «История» — сверху новые (прототип: `o.hist.slice().reverse()`). */
export function leadHistoryItems(t: Translate, l: AdminLeadCard): TimelineItem[] {
  return l.history
    .map((e, i) => {
      const at = new Date(e.at);
      return {
        id: `${e.at}-${i}`,
        date: formatDateRu(bishkekDate(at)),
        time: bishkekTime(at),
        text: leadEventText(t, e, l.fromStand, l.legalForm !== null),
        who: e.actor,
        via: e.via === 'telegram' ? t('telegram.via') : null,
      };
    })
    .reverse();
}
