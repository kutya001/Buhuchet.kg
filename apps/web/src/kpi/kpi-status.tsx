'use client';

import type { FillStatus } from '@buhuchet/domain';
import { StatusMini, StatusMiniNone, StatusPill } from '@buhuchet/ui';
import { useT } from '../l10n/provider';
import { miniView, type StatusEvent } from '../status/status-view';

/**
 * Статус заполнения месяца компактной шкалой (прототип `scaleMini('ind', …)`): «1/3 Не заполнено», под
 * ним — когда поставлен. Месяца ещё нет в базе, а показатели нужны — «Не заполнено» без даты; не нужны —
 * «—».
 */
export function MonthMini({
  status,
  needed,
}: {
  status: { code: FillStatus; at: string; actor: string | null } | null;
  needed: boolean;
}) {
  const t = useT();
  if (!status && !needed) return <span className="text-faint">—</span>;
  const code = status?.code ?? 'empty';
  const history: StatusEvent[] = status
    ? [
        {
          at: new Date(status.at),
          from: null,
          to: code,
          rollback: false,
          reason: null,
          actor: status.actor,
        },
      ]
    : [];
  const view = miniView(t, { scale: 'indicator', status: code, history });
  if (view.kind === 'none') return <StatusMiniNone label={view.label} title={view.title} />;
  if (view.kind === 'pill') return <StatusPill {...view.pill} size="sm" />;
  return <StatusMini {...view.props} />;
}
