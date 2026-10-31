'use client';

import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  formatMomentRu,
  formatSom,
  formatSomWithUnit,
} from '@buhuchet/domain';
import type { ServiceCard, ServicePaymentWindow } from '@buhuchet/shared';
import {
  ActionMenu,
  Box,
  buttonClass,
  Icon,
  iconButtonClass,
  KeyValues,
  linkButtonClass,
  MiniTable,
  miniWide,
  Modal,
  Note,
  Pill,
  StatusPill,
  Tag,
  Timeline,
  TOUCH_AREA,
  type ActionEntry,
  type KeyValueItem,
  type TimelineItem,
  useToast,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';
import { ApiFailure } from '../api-client';
import { openContractorCard } from '../contractors/card-store';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { RecordFiles } from '../files/record-files';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { statusPillView } from '../status/status-view';
import { useFinanceRefresh } from './finance-data';
import { WhyButton } from './finance-dialogs';
import { serviceHistoryText } from './finance-history';
import { serviceCardQuery, servicePaymentQuery } from './service-data';
import {
  ServiceDeleteDialog,
  ServiceDialog,
  ServicePayDialog,
  ServicePaymentEditDialog,
} from './service-dialogs';

/*
 * Карточка разовой услуги и окно её оплаты (задача 2.22; ТЗ «Финансовые операции по контрагентам» →
 * «Ручная операция «Разовая услуга»», «Окно оплаты»; прототип modules/services.js — `serviceCard`,
 * `svcActions`; modules/fin-op.js — `opWin` с `sp`). Карточка: статус оплаты, стоимость, получено,
 * осталось, исполнитель, кто внёс и изменил, описание, оплаты (строка открывает окно оплаты, «⋯» —
 * её действия), файлы, история; «Действия» — «Записать оплату», «Изменить», «Карточка контрагента»,
 * «Удалить» с замком и причиной.
 */

type HistoryRow = ServiceCard['history'][number];

/** Строка истории: файлы — как в карточке отчёта, остальное — `serviceHistoryText`. */
function historyText(t: Translate, h: HistoryRow): string {
  const file = (key: 'from' | 'to') =>
    String(h.changes.find((c) => c.field === 'file')?.[key] ?? '');
  return serviceHistoryText(
    t,
    {
      entity: h.paymentId ? 'one_off_service_payment' : 'one_off_service',
      action: h.action,
      changes: h.changes,
      reason: h.reason,
    },
    () =>
      h.action === 'file_attach'
        ? t('report.hist.file_attach', { name: file('to') })
        : t('report.hist.file_delete', { name: file('from') }),
  );
}

function historyItems(t: Translate, rows: readonly HistoryRow[]): TimelineItem[] {
  return rows.map((h) => {
    const at = new Date(h.at);
    return {
      id: String(h.id),
      date: formatDateRu(bishkekDate(at)),
      time: bishkekTime(at),
      text: historyText(t, h),
      who: h.actor ?? t('status.system'),
    };
  });
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

/** Окна, которые открывает карточка, журнал и меню контрагента. */
export type ServiceAction =
  | { act: 'card'; id: string }
  | { act: 'pay'; service: { id: string; name: string; contractor: string; left: number } }
  | { act: 'edit'; id: string }
  | { act: 'delete'; id: string }
  | { act: 'payment'; id: string }
  | { act: 'payment-edit'; id: string }
  | { act: 'payment-delete'; id: string };

/**
 * Окно по действию строки журнала (прототип finActions → svcActions): карточка, «Записать оплату»,
 * «Изменить», «Удалить» — сразу своё окно; «Изменить» и «Удалить» загружают услугу, замок, который
 * успел появиться, — уведомлением.
 */
export function ServiceActionDialog({
  action,
  open,
  onClose,
}: {
  action: ServiceAction;
  open: boolean;
  onClose: () => void;
}) {
  const refresh = useFinanceRefresh();
  if (action.act === 'card')
    return <ServiceCardDialog id={action.id} open={open} onClose={onClose} />;
  if (action.act === 'payment')
    return <ServicePaymentWindowDialog id={action.id} open={open} onClose={onClose} />;
  if (action.act === 'pay')
    return (
      <ServicePayDialog service={action.service} open={open} onClose={onClose} onDone={refresh} />
    );
  if (action.act === 'payment-edit' || action.act === 'payment-delete')
    return (
      <PaymentById
        id={action.id}
        act={action.act === 'payment-edit' ? 'edit' : 'delete'}
        open={open}
        onClose={onClose}
      />
    );
  return <ServiceById id={action.id} act={action.act} open={open} onClose={onClose} />;
}

/** Замок, появившийся после загрузки строки, — уведомлением, окно не открывается. */
function useLockToast(text: string | null, onClose: () => void) {
  const toast = useToast();
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!text) return;
    toast(text, { icon: 'lock', bad: true });
    close();
  }, [text, toast]);
}

function PaymentById({
  id,
  act,
  open,
  onClose,
}: {
  id: string;
  act: 'edit' | 'delete';
  open: boolean;
  onClose: () => void;
}) {
  const refresh = useFinanceRefresh();
  const query = useQuery(servicePaymentQuery(id));
  const p = query.data;
  const lock = p ? ((act === 'edit' ? p.locks.edit : p.locks.del)?.text ?? null) : null;
  useLockToast(lock, onClose);
  if (!p || lock) return null;
  if (act === 'edit')
    return <ServicePaymentEditDialog payment={p} open={open} onClose={onClose} onDone={refresh} />;
  return (
    <ServiceDeleteDialog
      target={{ kind: 'sp', payment: p }}
      open={open}
      onClose={onClose}
      onDone={refresh}
    />
  );
}

function ServiceById({
  id,
  act,
  open,
  onClose,
}: {
  id: string;
  act: 'edit' | 'delete';
  open: boolean;
  onClose: () => void;
}) {
  const refresh = useFinanceRefresh();
  const query = useQuery(serviceCardQuery(id));
  const s = query.data;
  const lock = s ? ((act === 'edit' ? s.locks.edit : s.locks.del)?.text ?? null) : null;
  useLockToast(lock, onClose);
  if (!s || lock) return null;
  if (act === 'edit')
    return (
      <ServiceDialog contractor={null} edit={s} open={open} onClose={onClose} onDone={refresh} />
    );
  return (
    <ServiceDeleteDialog
      target={{ kind: 'svc', service: s }}
      open={open}
      onClose={onClose}
      onDone={refresh}
    />
  );
}

/** Пункты «Действий» услуги (прототип svcActions без «Открыть»). */
export function serviceMenu(
  t: Translate,
  s: {
    contractorId: string;
    deleted: boolean;
    locks: {
      edit: { code?: string; text: string } | null;
      del: { text: string } | null;
      pay: { text: string } | null;
    };
  },
  run: { pay: () => void; edit: () => void; del: () => void; card: () => void },
): ActionEntry[] {
  const card: ActionEntry = {
    id: 'card',
    label: t('fin.op.card'),
    icon: 'building',
    run: run.card,
  };
  if (s.deleted) return [card];
  return [
    {
      id: 'pay',
      label: t('fin.svc.pay'),
      icon: 'wallet',
      disabled: !!s.locks.pay,
      reason: s.locks.pay?.text,
      run: run.pay,
    },
    {
      id: 'edit',
      label: t('fin.op.edit'),
      icon: 'edit',
      disabled: !!s.locks.edit,
      // Прототип svcActions: «Изменить» без права — неактивна без подсказки.
      reason: s.locks.edit?.code === 'op_view_only' ? undefined : s.locks.edit?.text,
      run: run.edit,
    },
    card,
    { id: 's1', separator: true },
    {
      id: 'delete',
      label: t('fin.del.ok'),
      icon: 'trash',
      danger: true,
      disabled: !!s.locks.del,
      reason: s.locks.del?.text,
      run: run.del,
    },
  ];
}

export function ServiceCardDialog({
  id,
  open,
  onClose,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const query = useQuery(serviceCardQuery(id));
  const [child, setChild] = useState<DialogSlot<ServiceAction> | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; items: ActionEntry[] } | null>(null);
  const s = query.data;
  const failed =
    query.isError && !s
      ? errorText(
          query.error instanceof ApiFailure ? query.error.error : { code: 'unknown', message: '' },
        )
      : null;
  const left = s ? s.amount - s.paid : 0;
  const open1 = (a: ServiceAction) => setChild(openSlot(a));
  const openContractor = () => {
    if (!s) return;
    onClose();
    openContractorCard({ id: s.contractor.id });
  };
  const pay = () =>
    s &&
    open1({
      act: 'pay',
      service: { id: s.id, name: s.name, contractor: s.contractor.name, left },
    });

  const items: KeyValueItem[] = s
    ? [
        {
          id: 'amount',
          label: t('fin.svc.cost'),
          value: <b className="tabular-nums">{formatSomWithUnit(s.amount)}</b>,
        },
        {
          id: 'paid',
          label: t('fin.svc.received'),
          value: <span className="tabular-nums">{formatSomWithUnit(s.paid)}</span>,
        },
        {
          id: 'left',
          label: t('fin.svc.left'),
          value: (
            <span className={`tabular-nums ${left > 0 ? 'font-semibold text-danger' : ''}`}>
              {formatSomWithUnit(left)}
            </span>
          ),
        },
        { id: 'performer', label: t('fin.svc.performer'), value: s.performer?.name ?? '—' },
        {
          id: 'created',
          label: t('fin.op.created'),
          value: <Audit who={s.created.name} at={s.created.at} />,
        },
        {
          id: 'updated',
          label: t('fin.op.updated'),
          value: <Audit who={s.updated.name} at={s.updated.at} />,
        },
      ]
    : [];

  // Меню «⋯» оплаты (прототип opMenuBtn → opActs с `sp`): «Открыть», «Изменить», «Открыть источник»
  // («Разовая услуга «…»» — эта же карточка), «Удалить»; у оплат удалённой услуги — «Открыть» и
  // «Открыть источник».
  const paymentMenu = (p: ServiceCard['payments'][number]): ActionEntry[] => {
    const openEntry: ActionEntry = {
      id: 'open',
      label: t('fin.op.act_open'),
      icon: 'list',
      run: () => open1({ act: 'payment', id: p.id }),
    };
    const source: ActionEntry = {
      id: 'source',
      label: t('fin.op.source'),
      icon: 'link',
      sub: t('fin.sp.source', { name: s?.name ?? '' }),
      run: () => s && open1({ act: 'card', id: s.id }),
    };
    if (s?.deleted) return [openEntry, source];
    return [
      openEntry,
      {
        id: 'edit',
        label: t('fin.op.edit'),
        icon: 'edit',
        disabled: !!p.locks.edit,
        reason: p.locks.edit?.text,
        run: () => open1({ act: 'payment-edit', id: p.id }),
      },
      source,
      { id: 's1', separator: true },
      {
        id: 'delete',
        label: t('fin.del.ok'),
        icon: 'trash',
        danger: true,
        disabled: !!p.locks.del,
        reason: p.locks.del?.text,
        run: () => open1({ act: 'payment-delete', id: p.id }),
      },
    ];
  };

  const footer = (
    <>
      {s && !s.deleted ? (
        <button
          type="button"
          className={buttonClass('default')}
          data-svc-more=""
          onClick={(e) =>
            setMenu({
              el: e.currentTarget,
              items: serviceMenu(
                t,
                { contractorId: s.contractor.id, deleted: !!s.deleted, locks: s.locks },
                {
                  pay,
                  edit: () => open1({ act: 'edit', id: s.id }),
                  del: () => open1({ act: 'delete', id: s.id }),
                  card: openContractor,
                },
              ),
            })
          }
        >
          <Icon name="more" size="sm" />
          {t('fin.svc.actions')}
        </button>
      ) : null}
      <div className="flex-1" />
      <button type="button" className={buttonClass('cta')} onClick={onClose}>
        {t('btn.done')}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={s ? s.name : ''}
      label={s ? undefined : t('fin.svc.open')}
      sub={
        s
          ? t('fin.svc.card_sub', { name: s.contractor.name, date: formatDateRu(s.date) })
          : undefined
      }
      footer={footer}
    >
      <div className="flex flex-col gap-3.5" data-svc-card={id}>
        {failed ? <Note tone="bad">{failed}</Note> : null}
        {s ? (
          <div className="flex flex-wrap gap-1.5">
            <StatusPill {...statusPillView(t, 'payment', s.status)} />
            {s.deleted ? (
              <Pill tone="bad" icon="trash">
                {t('fin.op.deleted_pill')}
              </Pill>
            ) : s.edited ? (
              <Pill tone="warn" icon="edit">
                {t('fin.op.edited_pill')}
              </Pill>
            ) : null}
          </div>
        ) : null}
        {s?.deleted ? (
          <Note tone="bad" icon="trash">
            <b>{t('fin.op.deleted_pill')}</b>
            {' · '}
            {t('fin.svc.deleted', {
              name: s.deleted.name ?? '—',
              at: formatMomentRu(new Date(s.deleted.at)),
              reason: s.deleted.reason,
            })}
          </Note>
        ) : null}
        {s ? (
          <Box>
            <KeyValues items={items} />
            {s.description ? <p className="m-0 [overflow-wrap:anywhere]">{s.description}</p> : null}
          </Box>
        ) : null}
        {s ? (
          <Box
            title={t('fin.svc.pays', { n: s.payments.length })}
            actions={
              !s.deleted && !s.locks.pay ? (
                <button
                  type="button"
                  data-svc-pay-btn=""
                  className={buttonClass('cta', 'sm')}
                  onClick={pay}
                >
                  <Icon name="wallet" size="sm" />
                  {t('fin.svc.pay')}
                </button>
              ) : undefined
            }
          >
            {s.payments.length ? (
              <MiniTable
                label={t('fin.svc.pays', { n: s.payments.length })}
                empty=""
                onOpen={(key) => open1({ act: 'payment', id: key })}
                columns={[
                  { key: 'date', label: t('fin.svc.pay_col.date') },
                  { key: 'by', label: t('fin.svc.pay_col.by') },
                  { key: 'files', label: t('fin.svc.pay_col.files') },
                  { key: 'amount', label: t('fin.svc.pay_col.amount'), numeric: true },
                  { key: 'menu', label: '', actions: true, width: 36 },
                ]}
                rows={s.payments.map((p) => ({
                  key: p.id,
                  blank: p.files.length ? [] : ['files'],
                  wide: miniWide({ files: p.files.join(', ') }),
                  cells: {
                    date: (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {formatDateRu(p.date)}
                        {p.edited ? <Tag tone="warn">{t('fin.j.edited_tag')}</Tag> : null}
                      </span>
                    ),
                    by: p.by ?? '—',
                    files: p.files.length ? (
                      p.files.join(', ')
                    ) : (
                      <span className="text-faint">—</span>
                    ),
                    amount: <span className="tabular-nums">{formatSom(p.amount)}</span>,
                    menu: (
                      <button
                        type="button"
                        aria-label={t('grid.actions')}
                        className={`${iconButtonClass('sm')} ${TOUCH_AREA}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenu({ el: e.currentTarget, items: paymentMenu(p) });
                        }}
                      >
                        <Icon name="more" size="sm" />
                      </button>
                    ),
                  },
                }))}
              />
            ) : (
              <span className="text-faint">{t('fin.svc.pays_empty')}</span>
            )}
          </Box>
        ) : null}
        {s?.files ? <RecordFiles source={{ kind: 'one_off_service', id: s.id }} /> : null}
        {s && s.history.length ? (
          <Box title={t('fin.svc.history')}>
            <Timeline items={historyItems(t, s.history)} label={t('fin.svc.history')} />
          </Box>
        ) : null}
      </div>
      {menu ? (
        <ActionMenu
          items={menu.items}
          place={{ anchor: menu.el }}
          label={t('fin.svc.actions')}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {child ? (
        <ServiceActionDialog
          key={`svc-${child.n}`}
          action={child.data}
          open={child.open}
          onClose={() => setChild(closeSlot)}
        />
      ) : null}
    </Modal>
  );
}

/* ───────────── Окно оплаты разовой услуги ───────────── */

/**
 * Окно оплаты (прототип opWin с `sp`): тип, контрагент, дата, сумма, «За что» — услуга, «Услуга:
 * получено X из Y», счёт организации, примечание, кто внёс и изменил, отметки, файлы и история;
 * «Удалить», «Изменить» с замком; «Открыть источник» — карточка услуги. Оплата удалённой услуги —
 * «Удалена» с отметкой удаления услуги, без «Удалить» и «Изменить» (прототип `opDelOf`).
 */
export function ServicePaymentWindowDialog({
  id,
  open,
  onClose,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const refresh = useFinanceRefresh();
  const query = useQuery(servicePaymentQuery(id));
  const [del, setDel] = useState<DialogSlot<ServicePaymentWindow> | null>(null);
  const [edit, setEdit] = useState<DialogSlot<ServicePaymentWindow> | null>(null);
  const [card, setCard] = useState<DialogSlot<string> | null>(null);
  const p = query.data;
  const failed =
    query.isError && !p
      ? errorText(
          query.error instanceof ApiFailure ? query.error.error : { code: 'unknown', message: '' },
        )
      : null;
  const lock = p && !p.deleted ? (p.locks.edit ?? p.locks.del) : null;

  const items: KeyValueItem[] = [];
  if (p) {
    items.push(
      {
        id: 'kind',
        label: t('fin.op.kind'),
        value: (
          <Pill tone="caution" size="sm">
            {t('fin.sp.kind')}
          </Pill>
        ),
      },
      {
        id: 'cp',
        label: t('fin.op.contractor'),
        value: (
          <button
            type="button"
            className={linkButtonClass()}
            onClick={() => {
              onClose();
              openContractorCard({ id: p.contractor.id }, 'money');
            }}
          >
            {p.contractor.name}
          </button>
        ),
      },
      { id: 'date', label: t('fin.op.date'), value: formatDateRu(p.date) },
      {
        id: 'amount',
        label: t('fin.op.amount'),
        value: <b className="tabular-nums">{formatSomWithUnit(p.amount)}</b>,
      },
      { id: 'what', label: t('fin.op.what'), value: p.service.name },
      {
        id: 'svc',
        label: t('fin.sp.received'),
        value: (
          <span className="tabular-nums">
            {t('fin.sp.received_of', {
              paid: formatSomWithUnit(p.service.paid),
              amount: formatSomWithUnit(p.service.amount),
            })}
          </span>
        ),
      },
      {
        id: 'acc',
        label: t('fin.op.account'),
        value: (
          <span className="inline-flex items-center gap-1">
            <Icon name="building" size="sm" />
            {t('fin.op.acc_org')}
          </span>
        ),
      },
    );
    if (p.note && p.note !== p.service.name)
      items.push({ id: 'note', label: t('fin.op.note'), value: p.note });
    items.push(
      {
        id: 'created',
        label: t('fin.op.created'),
        value: <Audit who={p.created.name} at={p.created.at} />,
      },
      {
        id: 'updated',
        label: t('fin.op.updated'),
        value: <Audit who={p.updated.name} at={p.updated.at} />,
      },
    );
  }

  const footer = (
    <>
      {p && !p.deleted ? (
        <>
          <WhyButton
            icon="trash"
            label={t('fin.op.delete')}
            why={p.locks.del?.text ?? null}
            data="delete"
            onClick={() => setDel(openSlot(p))}
          />
          <WhyButton
            icon="edit"
            label={t('fin.op.edit')}
            why={p.locks.edit?.text ?? null}
            data="edit"
            onClick={() => setEdit(openSlot(p))}
          />
        </>
      ) : null}
      <div className="flex-1" />
      {p ? (
        <button
          type="button"
          className={buttonClass('default')}
          data-fin-source=""
          title={t('fin.sp.source', { name: p.service.name })}
          onClick={() => setCard(openSlot(p.service.id))}
        >
          <Icon name="link" size="sm" />
          {t('fin.op.source')}
        </button>
      ) : null}
      <button type="button" className={buttonClass('cta')} onClick={onClose}>
        {t('btn.done')}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={
        p ? t('fin.op.title', { kind: t('fin.sp.kind'), amount: formatSomWithUnit(p.amount) }) : ''
      }
      label={p ? undefined : t('fin.sp.open')}
      sub={p ? `${p.contractor.name} · ${formatDateRu(p.date)}` : undefined}
      footer={footer}
    >
      <div className="flex flex-col gap-3.5" data-svc-payment-window={id}>
        {failed ? <Note tone="bad">{failed}</Note> : null}
        {p && (p.deleted || p.edited) ? (
          <div className="flex flex-wrap gap-1.5">
            {p.deleted ? (
              <Pill tone="bad" icon="trash">
                {t('fin.op.deleted_pill')}
              </Pill>
            ) : null}
            {p.edited ? (
              <Pill tone="warn" icon="edit">
                {t('fin.op.edited_pill')}
              </Pill>
            ) : null}
          </div>
        ) : null}
        {p?.deleted ? (
          <Note tone="bad" icon="trash">
            <b>{t('fin.op.deleted_pill')}</b>
            {' · '}
            {t('fin.op.deleted', {
              name: p.deleted.name ?? '—',
              at: formatMomentRu(new Date(p.deleted.at)),
              reason: p.deleted.reason,
            })}
          </Note>
        ) : lock ? (
          <Note icon="lock">{lock.text}</Note>
        ) : null}
        {p ? (
          <Box>
            <KeyValues items={items} />
          </Box>
        ) : null}
        {p && p.files !== null ? (
          <RecordFiles source={{ kind: 'one_off_service_payment', id: p.id }} />
        ) : null}
        {p ? (
          <Box title={t('fin.op.history')}>
            {p.history.length ? (
              <Timeline items={historyItems(t, p.history)} label={t('fin.op.history')} />
            ) : (
              <span className="text-faint">{t('fin.op.history_empty')}</span>
            )}
          </Box>
        ) : null}
      </div>
      {del ? (
        <ServiceDeleteDialog
          key={`del-${del.n}`}
          target={{ kind: 'sp', payment: del.data }}
          open={del.open}
          onClose={() => setDel(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      {edit ? (
        <ServicePaymentEditDialog
          key={`edit-${edit.n}`}
          payment={edit.data}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      {card ? (
        <ServiceCardDialog
          key={`card-${card.n}`}
          id={card.data}
          open={card.open}
          onClose={() => setCard(closeSlot)}
        />
      ) : null}
    </Modal>
  );
}
