import {
  INDICATOR_SCOPES,
  INDICATOR_TOTALS,
  INDICATOR_TYPES,
  monthText,
  type UiTextKey,
} from '@buhuchet/domain';
import type { IndicatorHistoryItem } from '@buhuchet/shared';
import type { Translate } from '../l10n/translate';

/*
 * «История показателя» словами (прототип modules/kpi.js: записи `log('kind', …)`): создан, изменённые
 * поля «было → стало», архив, порядок, «Ведётся» → «Не ведётся» и «вести с» у контрагента.
 */

const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

function valueOf(t: Translate, field: string, v: unknown): string {
  if (typeof v === 'boolean') return t(v ? 'kpi.yes' : 'kpi.no');
  if (field === 'type' && INDICATOR_TYPES.includes(v as never)) {
    return t(`kpi.type.${v as (typeof INDICATOR_TYPES)[number]}`);
  }
  if (field === 'total' && INDICATOR_TOTALS.includes(v as never)) {
    return t(`kpi.total.${v as (typeof INDICATOR_TOTALS)[number]}`);
  }
  if (field === 'scope' && INDICATOR_SCOPES.includes(v as never)) {
    return t(`kpi.scope.${v as (typeof INDICATOR_SCOPES)[number]}`);
  }
  if ((field === 'startMonth' || field === 'fromMonth') && typeof v === 'string') {
    return monthText(v);
  }
  return text(v);
}

/** Поле показателя в истории → ключ словаря с его названием. */
const FIELD_KEYS = {
  name: 'kpi.field.name',
  unit: 'kpi.field.unit',
  type: 'kpi.field.type',
  total: 'kpi.field.total',
  description: 'kpi.field.description',
  required: 'kpi.field.required',
  dueDay: 'kpi.field.due_day',
  startMonth: 'kpi.field.start_month',
  scope: 'kpi.field.scope',
  autoNew: 'kpi.field.auto_new',
} as const satisfies Record<string, UiTextKey>;

/** Что изменилось — строками, как в истории прототипа. */
export function indicatorHistoryText(t: Translate, item: IndicatorHistoryItem): string {
  if (item.action === 'create') {
    return t('kpi.hist.created', { name: text(item.changes[0]?.to) });
  }
  const cp = item.contractor ?? '';
  return item.changes
    .map((c) => {
      if (c.field === 'enabled') {
        return t('kpi.hist.enabled', {
          cp,
          from: t(c.from ? 'kpi.on' : 'kpi.off'),
          to: t(c.to ? 'kpi.on' : 'kpi.off'),
        });
      }
      if (c.field === 'fromMonth') {
        return t('kpi.hist.from', {
          cp,
          from: valueOf(t, c.field, c.from),
          to: valueOf(t, c.field, c.to),
        });
      }
      if (c.field === 'archived') return t(c.to ? 'kpi.hist.archived' : 'kpi.hist.restored');
      if (c.field === 'sortOrder') {
        return t('kpi.hist.order', { from: text(c.from), to: text(c.to) });
      }
      const key = Object.hasOwn(FIELD_KEYS, c.field)
        ? FIELD_KEYS[c.field as keyof typeof FIELD_KEYS]
        : null;
      const label = key ? t(key) : c.field;
      return t('kpi.hist.field', {
        field: label,
        from: valueOf(t, c.field, c.from),
        to: valueOf(t, c.field, c.to),
      });
    })
    .join('; ');
}
