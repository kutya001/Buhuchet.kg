'use client';

import {
  bishkekDate,
  formatDateRu,
  OPEN_REPORT_STATUSES,
  formatMomentRu,
  formatSom,
  formatSomWithUnit,
  reportHasAmount,
  type IsoDate,
} from '@buhuchet/domain';
import type { ReportCard as Card, ReportRow } from '@buhuchet/shared';
import {
  ActPill,
  ActionMenu,
  Box,
  buttonClass,
  DueBit,
  Fold,
  Icon,
  KeyValues,
  linkButtonClass,
  MiniTable,
  Modal,
  Note,
  Pill,
  StatusHistory,
  StatusLine,
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
import { InfoTip } from '../kpi/kpi-table';
import {
  FundsCell,
  PayFirstNote,
  PaymentMini,
  PaymentScale,
  payFirstWhy,
  paymentEvents,
  ScheduleBox,
  SumsBox,
} from '../money/report-money';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { dueWords, MiniScale } from '../status/status-line';
import {
  confirmMarkLabel,
  historyLabels,
  historyView,
  scaleView,
  statusEvents,
  statusPillView,
} from '../status/status-view';
import { reportHistoryItem } from './report-history';
import {
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
      {s.capHint ? <InfoTip label={t('cp.socfund.title')} text={s.capHint} /> : null}
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
 * Строки «подпись — значение» на виду (прототип v134 openReport, `.kv`): «Срок сдачи» — у закрытого
 * отчёта (у открытого срок — в строке состояния), сумма со строками, «Срок оплаты» и «Деньги
 * контрагента». Остальное — в «Подробностях» (`detailItems`).
 */
function cardItems(
  t: Translate,
  r: Card,
  money: { sums: boolean; onReceive: (() => void) | null },
): KeyValueItem[] {
  const items: KeyValueItem[] = [];
  if (r.act !== 'pay' && !OPEN_REPORT_STATUSES.has(r.status))
    items.push({ id: 'due', label: t('report.card.due'), value: formatDateRu(r.dueDate) });
  if (!reportHasAmount(r.act)) return items;
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
  // У вида «Уплата» срок оплаты до оплаты — в строке состояния.
  if (r.taxpay && !(r.act === 'pay' && r.paymentStatus !== 'paid')) {
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
  return items;
}

/** «Подробности» (прототип v134 `details.rc-det`): ИНН, код формы, ставка, тариф, УГНС, кто и когда. */
function detailItems(t: Translate, r: Card): KeyValueItem[] {
  const items: KeyValueItem[] = [
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
  items.push(
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
  );
  return items;
}

/** Срок в строке состояния (прототип v134 openReport, `stLine`): сдача, оплата у «Уплаты» или «сдан». */
function duePart(t: Translate, r: Card, today: IsoDate): ReactNode {
  if (r.act === 'pay') {
    const shown =
      r.taxpay &&
      r.payDue &&
      r.paymentStatus !== 'paid' &&
      r.status !== 'not_required' &&
      r.paymentStatus !== 'not_required';
    if (!shown || !r.payDue) return null;
    return (
      <DueBit
        text={t('report.line.pay_due', { date: formatDateRu(r.payDue) })}
        {...dueWords(t, r.payDue, r.payOverdue, today)}
      />
    );
  }
  if (r.submittedOn && !OPEN_REPORT_STATUSES.has(r.status))
    return (
      <>
        <Icon name="send" size="sm" />
        <span>{t('report.line.submitted', { date: formatDateRu(r.submittedOn) })}</span>
      </>
    );
  const base = formatDateRu(r.dueBase).slice(0, 5);
  const note =
    r.dueDate === r.dueBase
      ? null
      : t(r.dueManual ? 'report.line.manual' : 'report.line.moved', { date: base });
  return (
    <DueBit
      text={t('status.line.due', { date: formatDateRu(r.dueDate) })}
      {...dueWords(t, r.dueDate, r.overdue, today)}
      note={note}
    />
  );
}

/** Шкала сдачи коротко (прототип `scaleMini0('rep')`), с отметкой подтверждения. */
function ReportMini({ t, r }: { t: Translate; r: Card }) {
  return (
    <MiniScale
      t={t}
      input={{
        scale: 'report',
        status: r.status,
        history: [],
        ...(r.mark
          ? {
              mark: r.mark,
              markLabel: confirmMarkLabel(t, statusEvents(r.statusHistory), r.mark, new Date()),
            }
          : {}),
      }}
    />
  );
}

const periodKey = (p: Card['period']) => p.toLowerCase() as 'm' | 'q' | 'h' | 'y';

/**
 * Причина возврата «На исправление» (прототип v134: `repConfBox` — только у «Требует исправления»; кто
 * подтвердил и сколько ждёт — на шкале и в «Истории»).
 */
function FixBox({ t, r }: { t: Translate; r: Card }) {
  if (r.status !== 'needs_fix' || !r.fix?.reason) return null;
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
  // «Сдан» до оплаты закрыт: шаг неактивен с причиной, под шкалой — подсказка (прототип scaleFull, `blk`).
  const why = steps.submitted ? payFirstWhy(t, r, r.taxpay && r.payFirst) : '';
  const view = scaleView(t, {
    scale: 'report',
    status: r.status,
    history: events,
    mark: r.mark,
    markLabel: r.mark ? confirmMarkLabel(t, events, r.mark, new Date()) : null,
    next: Object.keys(steps),
    back,
    blocked: why ? { submitted: why } : {},
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
      hints={
        why
          ? [
              ...(view.props.hints ?? []),
              <span key="pay-first" className="inline-flex items-center gap-1">
                <Icon name="lock" size="sm" />
                {t('report.pay_first.scale_hint', { why })}
              </span>,
            ]
          : view.props.hints
      }
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
 * Карточка отчёта (ТЗ «Отчеты для сдачи» → «Карточка отчёта», «Подтверждение сдачи»; прототип v134
 * modules/report-card.js, `openReport`; решение заказчика 17.11.2026 «Меньше текста, понятнее,
 * плавнее»). В заголовке — вид, «Что нужно сделать», «уточнённый N»; под ним — контрагент ссылкой,
 * период, орган и «?» «Что уплачивается». Сразу под шапкой — строка состояния: шкалы коротко, срок и
 * ответственный со «сменить»; полные шкалы «Сдача» и «Оплата» (шаги, откат, закрытый до оплаты «Сдан»)
 * раскрываются нажатием на короткие. Дальше — блок сумм или «Сумма к уплате не указана» с «Указать»,
 * причина «Сначала оплатите налог», возврат на исправление, сумма со строками, «Срок оплаты», «Деньги
 * контрагента», пеня с «?», свёрнутые «Подробности», график оплаты, «Версии» (строка открывает другую
 * версию), «Файлы» и свёрнутая «История» (статусы и «Изменения»). Внизу один ряд: «Действия» и следующий
 * шаг — «Отметить сданным», «Подтвердить» с «На исправление» или «Отметить оплаченным»; «Принять
 * деньги» и прочее — в «Действиях».
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
  /** Пункты «Действия» (без «Открыть карточку»). */
  actions: (r: Card) => ActionEntry[];
  onAction: (
    action: 'submit' | 'start' | 'confirm' | 'fix' | 'receive' | 'pay' | 'cancelPay' | 'amount',
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
      <ContractorLink id={shown.contractor.id} name={shown.contractor.name} />
      {` · ${shown.periodFull} · ${shown.organ}`}
      {reportHasAmount(shown.act) && shown.pays ? (
        <>
          {' '}
          <InfoTip
            label={t('report.card.pays_tip')}
            text={t('report.card.pays', { pays: shown.pays })}
          />
        </>
      ) : null}
    </>
  ) : null;
  // Сдача закрыта оплатой — главным становится «Отметить оплаченным» (прототип `payBtn`).
  const payInstead = !!buttons?.pay && canPay && buttons.primary === 'submit';

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
              className={`${buttonClass('default')} max-md:min-w-11 max-md:px-2.5`}
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              aria-label={t('status.act.more')}
              onClick={(e) => setMenu(menu ? null : e.currentTarget)}
            >
              <Icon name="more" size="sm" />
              <span className="max-md:hidden">{t('status.act.more')}</span>
            </button>
          ) : null}
          <div className="flex-1" />
          {r && buttons?.fix ? (
            <button
              type="button"
              data-report-button="fix"
              className={buttonClass('dangerOutline')}
              onClick={() => onAction('fix', r)}
            >
              <Icon name="refresh" size="sm" />
              {t('report.act.fix')}
            </button>
          ) : null}
          {r && payInstead ? (
            <button
              type="button"
              data-report-button="pay"
              className={buttonClass('cta')}
              onClick={() => onAction('pay', r)}
            >
              <Icon name="wallet" size="sm" />
              {t('report.act.mark_paid')}
            </button>
          ) : r && buttons?.primary && (buttons.primary !== 'pay' || canPay) ? (
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
            onAmount={actor?.can.changeSum && !r.superseded ? () => onAction('amount', r) : null}
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
          label={t('status.act.more')}
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
  onAmount,
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
  onAmount: (() => void) | null;
}) {
  const now = new Date();
  const today = bishkekDate(now);
  const events = statusEvents(r.statusHistory);
  const history = historyView(t, 'report', events, now);
  const timeline = r.history.map((h, i) => reportHistoryItem(t, h, i, r.revision));
  // Деньги отчёта — при «Учёте оплаты налогов» у вида с суммой (прототип `feat('taxpay') && t.sum`).
  const money = r.taxpay && reportHasAmount(r.act);
  const sums = money && r.status !== 'not_required';
  // Суммы ещё нет и денег не было — одна строка с «Указать» вместо четырёх пустых плиток (прототип `sumNo`).
  const sumNone = sums && r.amount === null && !(r.received > 0) && !(r.paid > 0);
  const payHistory = money ? historyView(t, 'payment', paymentEvents(t, r), now) : null;
  const why = OPEN_REPORT_STATUSES.has(r.status) ? payFirstWhy(t, r, r.taxpay && r.payFirst) : '';
  const scales = r.act !== 'pay' || money;
  const kv = cardItems(t, r, { sums, onReceive });

  return (
    <>
      <StatusLine
        id={`r${r.id}`}
        label={t('status.line.scale')}
        minis={
          scales ? (
            <>
              {r.act !== 'pay' ? <ReportMini t={t} r={r} /> : null}
              {money ? <PaymentMini t={t} r={r} /> : null}
            </>
          ) : (
            <span className="text-faint">—</span>
          )
        }
        parts={[
          duePart(t, r, today),
          <>
            <Icon name="user" size="sm" />
            <span>{r.responsible?.shortName ?? '—'}</span>
            {onResponsible ? (
              <button
                type="button"
                data-report-responsible=""
                aria-haspopup="menu"
                className={`${linkButtonClass()} text-[12.5px]`}
                onClick={(e) => onResponsible(e.currentTarget)}
              >
                {t('report.card.change_responsible')}
              </button>
            ) : null}
          </>,
        ]}
        full={
          scales ? (
            <div className="flex flex-col gap-3">
              {r.act !== 'pay' ? (
                <ScaleBox t={t} r={r} actor={actor} onStep={onStep} onBack={onBack} />
              ) : null}
              {money ? <PaymentScale t={t} r={r} onPay={onPay} onCancel={onCancelPay} /> : null}
            </div>
          ) : undefined
        }
      />
      {sumNone ? (
        <div data-report-sum-none="" className="flex flex-wrap items-center gap-2.5">
          <span className="text-faint">{t('report.sums.none')}</span>
          {onAmount ? (
            <button
              type="button"
              data-report-sum-set=""
              className={buttonClass('default', 'sm')}
              onClick={onAmount}
            >
              <Icon name="coins" size="sm" />
              {t('report.sums.set')}
            </button>
          ) : null}
        </div>
      ) : sums ? (
        <SumsBox t={t} r={r} />
      ) : null}
      {why ? <PayFirstNote t={t} r={r} /> : null}
      <FixBox t={t} r={r} />
      <Box>
        {kv.length > 0 ? <KeyValues items={kv} /> : null}
        {r.penalty ? (
          <div data-report-penalty="">
            <Note tone="warn" icon="alert">
              {r.penalty} <InfoTip label={t('report.card.penalty_tip')} text={r.penaltyTip} />
            </Note>
          </div>
        ) : null}
        <Fold
          title={t('status.fold.details')}
          first={kv.length === 0 && !r.penalty}
          data-report-details=""
        >
          <KeyValues items={detailItems(t, r)} />
        </Fold>
      </Box>
      {/* График оплаты — у вида с суммой и долями, и без «Учёта оплаты налогов» (прототип report-card.js). */}
      {reportHasAmount(r.act) ? <ScheduleBox t={t} r={r} today={today} /> : null}
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
      {r.filesOn ? <RecordFiles source={{ kind: 'report', id: r.id }} /> : null}
      <Fold
        box
        data-report-history=""
        title={<h3 className="m-0 [font:inherit] text-inherit">{t('status.fold.history')}</h3>}
      >
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
        <h4 className="m-0 mt-1 text-[12.5px] font-semibold text-muted">
          {t('status.fold.changes')}
        </h4>
        {timeline.length > 0 ? (
          <Timeline items={timeline} label={t('status.fold.changes')} />
        ) : (
          <span className="text-faint">{t('report.card.history_empty')}</span>
        )}
      </Fold>
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
