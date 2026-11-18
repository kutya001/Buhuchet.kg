'use client';

import { formatDateRu, formatMomentRu, type IsoDate } from '@buhuchet/domain';
import {
  buttonClass,
  Fold,
  Icon,
  KeyValues,
  linkButtonClass,
  Timeline,
  type TimelineItem,
} from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/*
 * Общие куски окна финансовой операции (прототип v136 modules/fin-op.js `opWin`; решение заказчика
 * 17.11.2026 «Меньше текста, понятнее, плавнее»): контрагент и дата — под названием окна, «Действия» —
 * одной кнопкой слева внизу, «История» свёрнута и хранит, кто создал и изменил. Ими собраны окно операции
 * журнала, окно оплаты за обслуживание и окно оплаты по проекту.
 */

/** Под названием окна: контрагент ссылкой на его карточку и дата операции. */
export function OpWindowSub({
  name,
  date,
  onContractor,
}: {
  name: string;
  date: IsoDate;
  onContractor: () => void;
}) {
  return (
    <>
      <button type="button" data-fin-op-cp="" className={linkButtonClass()} onClick={onContractor}>
        {name}
      </button>{' '}
      · {formatDateRu(date)}
    </>
  );
}

/** «Действия» внизу окна (прототип `.act-more`): на телефоне — только значок. */
export function OpMoreButton({
  t,
  open,
  onClick,
}: {
  t: Translate;
  open: boolean;
  onClick: (anchor: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      data-fin-more=""
      className={`${buttonClass('default')} max-md:min-w-11 max-md:px-2.5`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={t('status.act.more')}
      onClick={(e) => onClick(e.currentTarget)}
    >
      <Icon name="more" size="sm" />
      <span className="max-md:hidden">{t('status.act.more')}</span>
    </button>
  );
}

/** Кто и когда: имя, под ним момент мелким серым (прототип `auditKv`). */
function Audit({ who, at }: { who: string | null; at: string }) {
  return (
    <>
      {who ?? '—'}
      <span className="block text-[11.5px] text-faint">{formatMomentRu(new Date(at))}</span>
    </>
  );
}

/**
 * Свёрнутая «История» окна операции (прототип `details.rc-hist` с `opHistIn`): изменения или «Изменений
 * не было», под ними — кто создал и изменил.
 */
export function OpHistoryFold({
  t,
  items,
  created,
  updated,
}: {
  t: Translate;
  items: TimelineItem[];
  created: { name: string | null; at: string };
  updated: { name: string | null; at: string };
}) {
  return (
    <Fold
      box
      data-fin-op-history=""
      title={<h3 className="m-0 [font:inherit] text-inherit">{t('status.fold.history')}</h3>}
    >
      {items.length ? (
        <Timeline items={items} label={t('status.fold.history')} />
      ) : (
        <span className="text-faint">{t('fin.op.history_empty')}</span>
      )}
      <KeyValues
        items={[
          {
            id: 'created',
            label: t('fin.op.created'),
            value: <Audit who={created.name} at={created.at} />,
          },
          {
            id: 'updated',
            label: t('fin.op.updated'),
            value: <Audit who={updated.name} at={updated.at} />,
          },
        ]}
      />
    </Fold>
  );
}
