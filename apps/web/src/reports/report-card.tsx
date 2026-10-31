'use client';

import {
  bishkekDate,
  formatDateRu,
  OPEN_REPORT_STATUSES,
  formatMomentRu,
  formatSom,
  formatSomWithUnit,
  pluralForm,
  reportHasAmount,
} from '@buhuchet/domain';
import type { ReportCard as Card, ReportRow } from '@buhuchet/shared';
import {
  ActPill,
  ActionMenu,
  Box,
  buttonClass,
  Icon,
  KeyValues,
  linkButtonClass,
  MiniTable,
  Modal,
  Note,
  Pill,
  StatusHistory,
  StatusNone,
  StatusPill,
  StatusScale,
  Tag,
  Timeline,
  useToast,
  type ActionEntry,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ContractorLink } from '../contractors/contractor-link';
import { RecordFiles } from '../files/record-files';
import {
  FundsCell,
  PayFirstNote,
  PaymentScale,
  payFirstWhy,
  paymentEvents,
  ScheduleBox,
  SumsBox,
} from '../money/report-money';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import {
  confirmMarkLabel,
  historyLabels,
  historyView,
  scaleView,
  statusEvents,
  statusName,
  statusPillView,
} from '../status/status-view';
import { dueMovedTitle } from './report-columns';
import { reportHistoryItem } from './report-history';
import {
  confirmRefusal,
  reportCardButtons,
  reportScaleBack,
  reportScaleSteps,
  type ReportActor,
} from './report-menu';
import { reportQuery, responsibleOptionsQuery } from './reports-data';

/** Кто и когда: имя, под ним момент мелким серым (прототип `auditKv`). */
function Audit({ who, at }: { who: string | null; at: string }) {
  return (
    <>
      {who ?? '—'}
      <span className="block text-[11.5px] text-faint">{formatMomentRu(new Date(at))}</span>
    </>
  );
}

/** Тариф Соцфонда меткой (прототип sfPill): ЛЬГ — зелёная, ПВТ/ПКИ — синяя, не определён — жёлтая. */
function SocfundTariff({ t, s }: { t: Translate; s: NonNullable<Card['socfund']> }) {
  const tariff = s.tariff;
  return (
    <>
      {tariff ? (
        <Pill
          tone={tariff.id === 'spino' ? 'ok' : tariff.id === 'pvtpki' ? 'info' : 'plain'}
          size="sm"
          icon="shield"
        >
          {tariff.total ? `${tariff.short} · ${tariff.total}` : tariff.short}
        </Pill>
      ) : (
        <Pill tone="caution" size="sm" icon="alert">
          {t('cp.socfund.none')}
        </Pill>
      )}
      {s.capHint ? <span className="block text-[11.5px] text-faint">{s.capHint}</span> : null}
    </>
  );
}

/** Строки суммы в карточке (прототип linesKv): ставка, выручка и налог. */
function LinesValue({ t, lines }: { t: Translate; lines: Card['lines'] }) {
  return (
    <span className="flex flex-col gap-0.5">
      {lines.map((l) => (
        <span key={l.key} className="flex flex-wrap justify-between gap-x-3">
          <span>{l.label}</span>
          <span className="tabular-nums">
            {l.revenue !== null
              ? t('report.lines.kv_row', {
                  revenue: formatSomWithUnit(l.revenue),
                  tax: formatSomWithUnit(l.tax),
                })
              : t('report.lines.kv_tax', { tax: formatSomWithUnit(l.tax) })}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Строки «подпись — значение» (прототип openReport, `.kv`). У ответственного с правом «Назначать
 * отчёты» — «сменить» (у прежней версии нет: она только для просмотра, решение Б-7).
 */
function cardItems(
  t: Translate,
  r: Card,
  onResponsible: ((anchor: HTMLElement) => void) | null,
  money: { sums: boolean; onReceive: (() => void) | null },
): KeyValueItem[] {
  const items: KeyValueItem[] = [
    {
      id: 'created',
      label: t('grid.col.created_by'),
      value: <Audit who={r.audit.createdBy} at={r.audit.createdAt} />,
    },
    {
      id: 'updated',
      label: t('grid.col.updated_by'),
      value: <Audit who={r.audit.updatedBy ?? r.audit.createdBy} at={r.audit.updatedAt} />,
    },
    {
      id: 'cp',
      label: t('report.card.cp'),
      value: <ContractorLink id={r.contractor.id} name={r.contractor.name} />,
    },
    { id: 'inn', label: t('report.card.inn'), value: r.contractor.inn, mono: true },
    {
      id: 'form',
      label: t('report.card.form'),
      value: `${r.formCode} · ${t(
        r.eventDate ? 'report.period.oneoff' : `report.period.${periodKey(r.period)}`,
      ).toLowerCase()}`,
    },
  ];
  // Ставка полностью, как прототип rateOf: «ЕНС-04 · 4 % безнал + 6 % нал» (в списке — коротко).
  const rate = r.assignment?.rateText || r.rate;
  if (rate) items.push({ id: 'rate', label: t('report.card.rate'), value: rate });
  if (r.socfund)
    items.push({
      id: 'socfund',
      label: t('cp.socfund.title'),
      value: <SocfundTariff t={t} s={r.socfund} />,
    });
  if (r.taxOffice)
    items.push({ id: 'ugns', label: t('report.card.tax_office'), value: r.taxOffice });
  if (r.act !== 'pay')
    items.push({
      id: 'due',
      label: t('report.card.due'),
      value: (
        <>
          <span className={r.overdue ? 'font-semibold text-danger' : undefined}>
            {formatDateRu(r.dueDate)}
          </span>
          {r.dueDate !== r.dueBase ? (
            <span className="block text-[11.5px] text-faint">{dueMovedTitle(t, r)}</span>
          ) : null}
        </>
      ),
    });
  items.push({
    id: 'responsible',
    label: t('report.card.responsible'),
    value: (
      <>
        {r.responsible?.shortName ?? '—'}
        {onResponsible ? (
          <>
            {' '}
            <button
              type="button"
              data-report-responsible=""
              aria-haspopup="menu"
              className={`${linkButtonClass()} text-[12px]`}
              onClick={(e) => onResponsible(e.currentTarget)}
            >
              {t('report.card.change_responsible')}
            </button>
          </>
        ) : null}
      </>
    ),
  });
  if (r.act !== 'pay')
    items.push({
      id: 'submitted',
      label: t('report.card.submitted'),
      value: (
        <>
          {r.submittedOn ? formatDateRu(r.submittedOn) : '—'}
          {r.submittedOn && r.submittedBy ? (
            <span className="text-faint">
              {' '}
              {t('report.card.submitted_by', { name: r.submittedBy.shortName })}
            </span>
          ) : null}
        </>
      ),
    });
  if (reportHasAmount(r.act)) {
    // С блоком сумм вверху карточки «Сумма к уплате» здесь не повторяется (прототип `sums`).
    if (!money.sums)
      items.push({
        id: 'amount',
        label: t('report.card.amount'),
        value: (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {r.amount === null ? (
              <span className="text-faint">{t('report.amount.none')}</span>
            ) : (
              <b className="tabular-nums">{formatSomWithUnit(r.amount)}</b>
            )}
            {r.amountAuto ? (
              <Tag icon="repeat" title={t('report.amount.repeat')}>
                {t('report.repeat.tag')}
              </Tag>
            ) : null}
          </span>
        ),
      });
    if (r.lines.length)
      items.push({
        id: 'lines',
        label: t('report.lines.kv'),
        value: <LinesValue t={t} lines={r.lines} />,
        wide: true,
      });
    if (r.taxpay) {
      items.push(
        {
          id: 'payDue',
          label: t('report.money.pay_due'),
          value: (
            <span className={r.payOverdue ? 'font-semibold text-danger' : undefined}>
              {r.payDue ? formatDateRu(r.payDue) : '—'}
            </span>
          ),
        },
        {
          id: 'funds',
          label: t('report.money.funds'),
          value: <FundsCell t={t} r={r} onReceive={money.onReceive} />,
        },
      );
    }
  } else {
    items.push({
      id: 'amount',
      label: t('report.card.amount'),
      value: <span className="text-faint">{t('report.card.no_amount')}</span>,
    });
  }
  return items;
}

const periodKey = (p: Card['period']) => p.toLowerCase() as 'm' | 'q' | 'h' | 'y';

/**
 * Блок «Подтверждение сдачи» (прототип repConfBox): возвращён на исправление — кто, когда, причина;
 * подтверждено — кто, когда, комментарий; ждёт — сколько дней и что делать.
 */
function ConfirmBox({ t, r, actor }: { t: Translate; r: Card; actor: ReportActor | null }) {
  if (r.status === 'needs_fix' && r.fix?.reason) {
    return (
      <Note tone="warn" icon="refresh">
        <b>{t('report.card.fix')}</b>
        {r.fix.actor ? ` · ${r.fix.actor}` : ''}
        {`, ${formatMomentRu(new Date(r.fix.at))}`}
        <br />
        {r.fix.reason}
      </Note>
    );
  }
  if (!r.mark) return null;
  if (r.mark === 'confirmed') {
    return (
      <Note tone="ok" icon="check">
        <b>{statusName(t, 'report', 'confirmed')}</b>
        {r.confirmedBy ? ` · ${r.confirmedBy.shortName}` : ''}
        {r.confirmedAt ? `, ${formatMomentRu(new Date(r.confirmedAt))}` : ''}
        {r.confirmNote ? (
          <>
            <br />
            {r.confirmNote}
          </>
        ) : null}
      </Note>
    );
  }
  const why = actor ? confirmRefusal(r, actor) : null;
  return (
    <Note icon="hourglass">
      <b>
        {t('status.mark_waiting_days', {
          name: statusName(t, 'report', 'waiting'),
          n: r.waitDays ?? 0,
        })}
      </b>
      <br />
      {why && why !== 'report_not_waiting'
        ? t(`err.${why}`)
        : t(actor?.can.repConfirm ? 'report.card.wait_can' : 'report.card.wait_other')}
    </Note>
  );
}

/** Шкала «Сдача» (прототип scaleFull): шаги нажатием по правам, откат — с правом «Откат статусов». */
function ScaleBox({
  t,
  r,
  actor,
  onStep,
  onBack,
}: {
  t: Translate;
  r: Card;
  actor: ReportActor | null;
  onStep: (action: 'start' | 'submit') => void;
  onBack: (to: string) => void;
}) {
  const toast = useToast();
  const events = statusEvents(r.statusHistory);
  const steps = actor ? reportScaleSteps(r) : {};
  const back = actor ? reportScaleBack(r, actor) : null;
  const view = scaleView(t, {
    scale: 'report',
    status: r.status,
    history: events,
    mark: r.mark,
    markLabel: r.mark ? confirmMarkLabel(t, events, r.mark, new Date()) : null,
    next: Object.keys(steps),
    back,
  });
  if (view.kind === 'none')
    return (
      <StatusNone
        title={view.title}
        text={view.text}
        since={view.since}
        undo={view.undo && back ? { label: view.undo, onClick: () => onBack(back) } : null}
      />
    );
  if (view.kind === 'pill') return <StatusPill {...view.pill} />;
  return (
    <StatusScale
      {...view.props}
      onStep={(to) => {
        const action = steps[to];
        if (!action) return;
        // Без права шаг нажимается, но статус не меняет (прототип status-scale.js).
        if (!actor?.can.changeStatus) return void toast(t('report.menu.no_status'), { bad: true });
        onStep(action);
      }}
      onBack={onBack}
    />
  );
}

/**
 * Карточка отчёта (ТЗ «Отчеты для сдачи» → «Карточка отчёта», «Подтверждение сдачи»; прототип
 * modules/report-card.js, `openReport`): в заголовке — вид, «Что нужно сделать», «уточнённый N»; под
 * ним — контрагент, период, орган и «Что уплачивается». Шкала «Сдача» с отметкой подтверждения,
 * просрочка, подтверждение или возврат на исправление, реквизиты и сумма со строками, «Версии» (строка
 * открывает другую версию), «Файлы», «История статусов» и «История изменений». Внизу — «Ещё
 * действия», «На исправление» и главное действие: «Отметить сданным» или «Подтвердить». С «Учётом
 * оплаты налогов» (задача 2.19) — шкала «Оплата», блок сумм, при «Сдаче только после оплаты» — причина
 * с «Принять деньги» и «Отметить оплаченным», «Срок оплаты», «Деньги контрагента», график оплаты,
 * «История статусов» оплаты; внизу — «Принять деньги» и «Отметить оплаченным».
 */
export function ReportCardWindow({
  id,
  initial,
  open,
  onClose,
  actor,
  actions,
  onAction,
  onBack,
  onVersion,
  onResponsible,
}: {
  id: string;
  /** Строка списка — показывается, пока карточка не загрузилась. */
  initial: ReportRow | null;
  open: boolean;
  onClose: () => void;
  actor: ReportActor | null;
  /** Пункты «Ещё действия» (без «Открыть карточку»). */
  actions: (r: Card) => ActionEntry[];
  onAction: (
    action: 'submit' | 'start' | 'confirm' | 'fix' | 'receive' | 'pay' | 'cancelPay',
    r: Card,
  ) => void;
  onBack: (r: Card, to: string) => void;
  /** Открыть другую версию отчёта. */
  onVersion: (id: string) => void;
  /** «сменить» ответственного: выбран сотрудник. */
  onResponsible: (r: Card, employeeId: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const query = useQuery(reportQuery(id));
  const r = query.data ?? null;
  const shown = r ?? initial;
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [people, setPeople] = useState<{
    anchor: HTMLElement;
    items: ActionEntry[];
  } | null>(null);
  // Меню действующих сотрудников (прототип `#rc-resp`): текущий ответственный отмечен.
  const openPeople = async (anchor: HTMLElement) => {
    if (!r) return;
    const list = await client.fetchQuery(responsibleOptionsQuery).catch(() => null);
    if (!list) return void toast(t('err.unknown'), { bad: true });
    setPeople({
      anchor,
      items: list.employees.map((e) => ({
        id: e.id,
        label: e.shortName,
        icon: 'user',
        on: e.id === r.responsible?.id,
        run: () => onResponsible(r, e.id),
      })),
    });
  };
  const changeResponsible =
    r && actor?.can.assign && !r.superseded ? (a: HTMLElement) => void openPeople(a) : null;
  const items = r ? actions(r) : [];
  const buttons = r && actor ? reportCardButtons(r, actor, t) : null;
  const canReceive = !!r?.money?.canReceive;
  const canPay = !!r?.money?.canPay;

  const title = shown ? (
    <span className="inline-flex flex-wrap items-center gap-2">
      {shown.type.name}
      <ActPill act={shown.act} label={t(`report.act.${shown.act}`)} />
      {shown.revision ? (
        <Tag tone="info">{t('report.card.revision', { n: shown.revision })}</Tag>
      ) : null}
    </span>
  ) : (
    ''
  );
  const sub: ReactNode = shown ? (
    <>
      {`${shown.contractor.name} · ${shown.periodFull} · ${shown.organ}`}
      {reportHasAmount(shown.act) && shown.pays ? (
        <>
          <br />
          {t('report.card.pays', { pays: shown.pays })}
        </>
      ) : null}
    </>
  ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={title}
      label={shown?.type.name ?? ''}
      sub={sub}
      footer={
        <>
          {items.length > 0 ? (
            <button
              type="button"
              data-report-more=""
              className={buttonClass('default')}
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              onClick={(e) => setMenu(menu ? null : e.currentTarget)}
            >
              <Icon name="more" size="sm" />
              {t('report.act.more')}
            </button>
          ) : null}
          <div className="flex-1" />
          {r && canReceive ? (
            <button
              type="button"
              data-report-button="receive"
              className={buttonClass('default')}
              onClick={() => onAction('receive', r)}
            >
              <Icon name="download" size="sm" />
              {t('report.act.receive')}
            </button>
          ) : null}
          {r && buttons?.fix ? (
            <button
              type="button"
              data-report-button="fix"
              className={buttonClass('default')}
              onClick={() => onAction('fix', r)}
            >
              <Icon name="refresh" size="sm" />
              {t('report.act.fix')}
            </button>
          ) : null}
          {r && buttons?.pay && canPay ? (
            <button
              type="button"
              data-report-button="pay"
              className={buttonClass('default')}
              onClick={() => onAction('pay', r)}
            >
              <Icon name="wallet" size="sm" />
              {t('report.act.mark_paid')}
            </button>
          ) : null}
          {r && buttons?.primary && (buttons.primary !== 'pay' || canPay) ? (
            <button
              type="button"
              data-report-button={buttons.primary}
              className={buttonClass('cta')}
              disabled={buttons.disabled}
              title={buttons.disabled ? (buttons.why ?? undefined) : undefined}
              onClick={() => onAction(buttons.primary!, r)}
            >
              <Icon
                name={
                  buttons.primary === 'submit'
                    ? 'send'
                    : buttons.primary === 'pay'
                      ? 'wallet'
                      : 'check'
                }
                size="sm"
              />
              {t(
                buttons.primary === 'submit'
                  ? 'report.act.submit'
                  : buttons.primary === 'pay'
                    ? 'report.act.mark_paid'
                    : 'report.act.confirm',
              )}
            </button>
          ) : null}
        </>
      }
    >
      <div data-report-card={id} className="flex flex-col gap-3.5">
        {query.isError && !r ? <Note tone="bad">{t('report.card.load_error')}</Note> : null}
        {r ? (
          <CardBody
            t={t}
            r={r}
            actor={actor}
            onStep={(action) => onAction(action, r)}
            onBack={(to) => onBack(r, to)}
            onVersion={onVersion}
            onResponsible={changeResponsible}
            onReceive={canReceive ? () => onAction('receive', r) : null}
            onPay={canPay ? () => onAction('pay', r) : null}
            onCancelPay={r.money?.canCancel ? () => onAction('cancelPay', r) : null}
          />
        ) : null}
      </div>
      {people ? (
        <ActionMenu
          items={people.items}
          place={{ anchor: people.anchor }}
          label={t('report.card.responsible')}
          onClose={() => setPeople(null)}
        />
      ) : null}
      {menu && r ? (
        <ActionMenu
          items={items}
          place={{ anchor: menu }}
          label={t('report.act.more')}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </Modal>
  );
}

function CardBody({
  t,
  r,
  actor,
  onStep,
  onBack,
  onVersion,
  onResponsible,
  onReceive,
  onPay,
  onCancelPay,
}: {
  t: Translate;
  r: Card;
  actor: ReportActor | null;
  onStep: (action: 'start' | 'submit') => void;
  onBack: (to: string) => void;
  onVersion: (id: string) => void;
  onResponsible: ((anchor: HTMLElement) => void) | null;
  onReceive: (() => void) | null;
  onPay: (() => void) | null;
  onCancelPay: (() => void) | null;
}) {
  const now = new Date();
  const events = statusEvents(r.statusHistory);
  const history = historyView(t, 'report', events, now);
  const timeline = r.history.map((h, i) => reportHistoryItem(t, h, i, r.revision));
  const late = r.overdue ? Math.abs(r.days ?? 0) : 0;
  // Деньги отчёта — при «Учёте оплаты налогов» у вида с суммой (прототип `feat('taxpay') && t.sum`).
  const money = r.taxpay && reportHasAmount(r.act);
  const sums = money && r.status !== 'not_required';
  const payHistory = money ? historyView(t, 'payment', paymentEvents(t, r), now) : null;
  const why = OPEN_REPORT_STATUSES.has(r.status) ? payFirstWhy(t, r, r.taxpay && r.payFirst) : '';

  return (
    <>
      {r.act !== 'pay' || money ? (
        <Box>
          <div className="flex flex-col gap-3">
            {r.act !== 'pay' ? (
              <ScaleBox t={t} r={r} actor={actor} onStep={onStep} onBack={onBack} />
            ) : null}
            {money ? <PaymentScale t={t} r={r} onPay={onPay} onCancel={onCancelPay} /> : null}
          </div>
        </Box>
      ) : null}
      {sums ? <SumsBox t={t} r={r} /> : null}
      {why ? <PayFirstNote t={t} why={why} onReceive={onReceive} onPay={onPay} /> : null}
      {r.overdue ? (
        <div className="flex flex-wrap gap-2">
          <Pill tone="bad" icon="alert">
            {t(`report.card.overdue.${pluralForm(late)}`, { n: late })}
          </Pill>
        </div>
      ) : null}
      <ConfirmBox t={t} r={r} actor={actor} />
      <Box>
        <KeyValues items={cardItems(t, r, onResponsible, { sums, onReceive })} />
        {r.penalty ? <Note>{r.penalty}</Note> : null}
      </Box>
      {r.versions.length > 1 ? (
        <Box title={t('report.card.versions')}>
          <MiniTable
            label={t('report.card.versions')}
            empty=""
            headless
            columns={[
              { key: 'name', label: t('report.card.versions') },
              { key: 'status', label: t('status.col_status') },
              { key: 'amount', label: t('report.card.amount'), numeric: true },
            ]}
            rows={[...r.versions]
              .sort((a, b) => a.revision - b.revision)
              .map((v) => ({
                key: v.id,
                cells: {
                  name: (
                    <span className="inline-flex items-center gap-1.5">
                      {v.revision
                        ? t('report.card.version_n', { n: v.revision })
                        : t('report.card.version_first')}
                      {v.id === r.id ? <Tag>{t('report.card.version_open')}</Tag> : null}
                    </span>
                  ),
                  status: <VersionStatus t={t} r={r} v={v} confirmOn={actor?.confirmOn ?? false} />,
                  amount: v.amount === null ? '—' : formatSom(v.amount),
                },
              }))}
            onOpen={(key) => {
              if (key !== r.id) onVersion(key);
            }}
          />
        </Box>
      ) : null}
      {money ? <ScheduleBox t={t} r={r} today={bishkekDate(now)} /> : null}
      {r.filesOn ? <RecordFiles source={{ kind: 'report', id: r.id }} /> : null}
      <Box title={t('status.history')}>
        {r.act !== 'pay' ? (
          <StatusHistory
            rows={history.rows}
            totals={history.totals}
            title={money ? t('status.scale.report') : undefined}
            labels={historyLabels(t)}
          />
        ) : null}
        {payHistory ? (
          <StatusHistory
            rows={payHistory.rows}
            totals={payHistory.totals}
            title={r.act === 'pay' ? undefined : t('status.scale.payment')}
            labels={historyLabels(t)}
          />
        ) : null}
      </Box>
      <Box title={t('report.card.history')}>
        {timeline.length > 0 ? (
          <Timeline items={timeline} label={t('report.card.history')} />
        ) : (
          <span className="text-faint">{t('report.card.history_empty')}</span>
        )}
      </Box>
    </>
  );
}

/** Статус версии меткой: у сданной при подтверждении — отметка (прототип repStKey). */
function VersionStatus({
  t,
  r,
  v,
  confirmOn,
}: {
  t: Translate;
  r: Card;
  v: Card['versions'][number];
  confirmOn: boolean;
}) {
  const mark = confirmOn && v.status === 'submitted' && r.act !== 'pay';
  const key = mark ? (v.confirmed ? 'confirmed' : 'waiting') : v.status;
  return <StatusPill {...statusPillView(t, 'report', key)} size="sm" />;
}

/** Сегодня по Бишкеку — для последствий отката. */
export const reportToday = () => bishkekDate(new Date());
