'use client';

import {
  bishkekDate,
  formatDateRu,
  formatMomentRu,
  formatSom,
  type ListSort,
} from '@buhuchet/domain';
import type { ReportRow } from '@buhuchet/shared';
import {
  ActPill,
  Icon,
  Pill,
  StatusMini,
  StatusMiniNone,
  StatusPill,
  Tag,
  type GridAudit,
  type GridColumn,
  type GridRowTone,
} from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { miniView, statusName, type StatusEvent } from '../status/status-view';

/**
 * Сортировка по умолчанию во всех списках — от новых к старым по «Создано» (ТЗ «Списки записей»,
 * прототип defSort: у списка со служебными столбцами `sort` прототипа repGrid не действует).
 */
export const REPORT_DEFAULT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/**
 * Видимые по умолчанию (ТЗ «Столбцы, видимые по умолчанию», прототип reportCols без `hide`):
 * контрагент, вид отчёта, что сделать, период, срок сдачи, статус сдачи, к уплате, ответственный; во
 * вкладке «Ожидают подтверждения» — ещё «Ждёт, дней» и «Сдал». «Получено от контрагента» и «Оплачено
 * в бюджет» добавит задача 2.19.
 */
export function reportDefaultVisible(waiting: boolean): string[] {
  return [
    'cp',
    'type',
    'act',
    'period',
    'due',
    'status',
    ...(waiting ? ['wait', 'submittedBy'] : []),
    'amount',
    'responsible',
  ];
}

export const REPORT_AUDIT: GridAudit<ReportRow> = {
  createdBy: (r) => r.audit.createdBy ?? '',
  updatedBy: (r) => r.audit.updatedBy ?? r.audit.createdBy ?? '',
  createdAt: (r) => formatMomentRu(new Date(r.audit.createdAt)),
  updatedAt: (r) => formatMomentRu(new Date(r.audit.updatedAt)),
};

/** Подсветка строки (прототип repRowClass): просроченный — красным, «Не требуется» — приглушённо. */
export const reportTone = (r: ReportRow): GridRowTone | undefined =>
  r.overdue ? 'overdue' : r.status === 'not_required' ? 'muted' : undefined;

/** Отметка подтверждения на шаге «Сдан» (прототип repMark): только при подтверждении в политике. */
export function reportMark(r: ReportRow, confirm: boolean): 'waiting' | 'confirmed' | null {
  if (!confirm || r.status !== 'submitted' || r.act === 'pay') return null;
  return r.confirmedAt ? 'confirmed' : 'waiting';
}

/** «Ждёт подтверждения · 3 дн.», «Подтвердил Алишер Т.» (прототип repConfTxt). */
export function reportMarkText(t: Translate, r: ReportRow, confirm: boolean): string {
  const mark = reportMark(r, confirm);
  if (!mark) return '';
  const name = statusName(t, 'report', mark);
  if (mark === 'waiting') return t('status.mark_waiting_days', { name, n: r.waitDays ?? 0 });
  return r.confirmedBy ? t('status.mark_confirmed_by', { who: r.confirmedBy.shortName }) : name;
}

/** Подсказка у метки «перенос»: с какого дня и почему (прототип dueHtml). */
export function dueMovedTitle(t: Translate, r: ReportRow): string {
  const date = formatDateRu(r.dueBase);
  // ОТКЛОНЕНИЕ: docs/deviations.md#Б-5
  if (r.dueManual) return t('report.due.manual_title', { date });
  return t('report.due.moved_title', { date, why: r.dueHoliday || t('report.due.weekend') });
}

/**
 * Сумма «К уплате» строкой (прототип `val`): у вида «Сдача» и у не указанной — пусто, на плитке её нет;
 * в таблице не указанная — «не указана».
 */
export function amountText(r: ReportRow): string {
  return r.act === 'sub' || r.amount === null ? '' : formatSom(r.amount, 'auto');
}

const Dash = () => <span className="text-faint">—</span>;

function DueCell({ t, r }: { t: Translate; r: ReportRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {r.overdue ? (
        <span className="text-danger" title={t('report.due.overdue')}>
          <Icon name="alert" size="sm" />
        </span>
      ) : null}
      <span className={r.overdue ? 'font-semibold text-danger' : undefined}>
        {formatDateRu(r.dueDate)}
      </span>
      {r.dueDate !== r.dueBase ? (
        <Tag title={dueMovedTitle(t, r)}>{t('report.due.moved')}</Tag>
      ) : null}
    </span>
  );
}

function DaysCell({ t, r }: { t: Translate; r: ReportRow }) {
  if (r.days === null) return <Dash />;
  if (r.days < 0) {
    return (
      <Pill tone="bad" size="sm">
        {String(r.days)}
      </Pill>
    );
  }
  if (r.days === 0) {
    return (
      <Pill tone="warn" size="sm">
        {t('report.days.today')}
      </Pill>
    );
  }
  return r.days <= 3 ? (
    <span className="font-semibold text-warn-label">{r.days}</span>
  ) : (
    <>{r.days}</>
  );
}

/**
 * Компактная шкала сдачи (прототип `scaleMini('rep', …)`): у вида «Уплата» — «—»; у сданного — отметка
 * «Ждёт подтверждения» или «Подтверждено»; под шкалой — когда и кем поставлен статус.
 */
function StatusCell({ t, r, confirm }: { t: Translate; r: ReportRow; confirm: boolean }) {
  if (r.act === 'pay') return <Dash />;
  const history: StatusEvent[] = r.lastStatus
    ? [
        {
          at: new Date(r.lastStatus.at),
          from: null,
          to: r.status,
          rollback: false,
          reason: null,
          actor: r.lastStatus.by,
        },
      ]
    : [];
  const mark = reportMark(r, confirm);
  const view = miniView(t, {
    scale: 'report',
    status: r.status,
    history,
    ...(mark ? { mark, markLabel: reportMarkText(t, r, confirm) } : {}),
  });
  if (view.kind === 'none') return <StatusMiniNone label={view.label} title={view.title} />;
  if (view.kind === 'pill') return <StatusPill {...view.pill} size="sm" />;
  return <StatusMini {...view.props} />;
}

function AmountCell({ t, r }: { t: Translate; r: ReportRow }) {
  if (r.act === 'sub') return <Dash />;
  if (r.amount === null) return <span className="text-faint">{t('report.amount.none')}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {formatSom(r.amount)}
      {r.amountAuto ? (
        <span className="text-faint" title={t('report.amount.repeat')}>
          <Icon name="repeat" size="sm" />
        </span>
      ) : null}
    </span>
  );
}

function WaitCell({ t, r, limit }: { t: Translate; r: ReportRow; limit: number }) {
  const d = r.waitDays;
  if (d === null) return <Dash />;
  if (d < limit) return <>{d}</>;
  return (
    <span title={t('report.wait.long', { n: limit })}>
      <Pill tone="caution" size="sm">
        {String(d)}
      </Pill>
    </span>
  );
}

function ConfirmCell({ t, r, confirm }: { t: Translate; r: ReportRow; confirm: boolean }) {
  const mark = reportMark(r, confirm);
  if (!mark) return <Dash />;
  return mark === 'waiting' ? (
    <Pill tone="warn" icon="hourglass" size="sm">
      {reportMarkText(t, r, confirm)}
    </Pill>
  ) : (
    <Pill tone="ok" icon="check" size="sm">
      {reportMarkText(t, r, confirm)}
    </Pill>
  );
}

export interface ReportColumnsOptions {
  /** Вкладка «Ожидают подтверждения»: столбцы «Ждёт, дней» и «Сдал». */
  waiting: boolean;
  /** «Сдача отчётов требует подтверждения» в учётной политике: отметки и столбцы подтверждения. */
  confirm: boolean;
  /** Через сколько дней ожидания — оранжевым (учётная политика, по умолчанию 3). */
  waitDays: number;
  /** Телефон: метка «Что сделать» — на плитке рядом с видом отчёта. */
  phone: boolean;
}

/**
 * Столбцы списка отчётов — как в прототипе (modules/reports.js, `reportCols`), ключи — как на сервере.
 * Суммы «Получено от контрагента», «Оплачено в бюджет», «Осталось оплатить», «Статус оплаты» и
 * «Деньги (сверка)» добавит задача 2.19, «Файлов» — 2.14. Служебные «Создал», «Изменил», «Создано»,
 * «Изменено» добавляет сам список (`REPORT_AUDIT`).
 */
export function reportColumns(t: Translate, o: ReportColumnsOptions): GridColumn<ReportRow>[] {
  const money = (v: number) => formatSom(v);
  const statusText = (r: ReportRow) =>
    r.act === 'pay'
      ? '—'
      : [statusName(t, 'report', r.status), reportMarkText(t, r, o.confirm)]
          .filter(Boolean)
          .join(' · ');
  return [
    {
      key: 'cp',
      label: t('report.col.cp'),
      type: 'text',
      width: 220,
      text: (r) => r.contractor.name,
      cell: (r) => <span className="font-semibold">{r.contractor.name}</span>,
    },
    {
      key: 'inn',
      label: t('report.col.inn'),
      type: 'text',
      width: 150,
      className: 'font-mono',
      text: (r) => r.contractor.inn,
    },
    {
      key: 'taxOffice',
      label: t('report.col.tax_office'),
      type: 'enum',
      width: 200,
      text: (r) => r.taxOffice ?? '',
    },
    {
      key: 'type',
      label: t('report.col.type'),
      type: 'enum',
      width: 140,
      text: (r) => r.type.shortName,
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span title={r.type.name}>{r.type.shortName}</span>
          {r.revision ? <Tag tone="info">{t('report.revision.tag', { n: r.revision })}</Tag> : null}
          {o.phone ? <ActPill act={r.act} label={t(`report.act.${r.act}`)} /> : null}
        </span>
      ),
    },
    {
      key: 'act',
      label: t('report.col.act'),
      type: 'enum',
      width: 175,
      desktopOnly: true,
      text: (r) => t(`report.act.${r.act}`),
      cell: (r) => <ActPill act={r.act} label={t(`report.act.${r.act}`)} />,
    },
    {
      key: 'rate',
      label: t('report.col.rate'),
      type: 'enum',
      width: 130,
      text: (r) => r.rate ?? '',
    },
    { key: 'organ', label: t('report.col.organ'), type: 'enum', width: 110, text: (r) => r.organ },
    {
      key: 'period',
      label: t('report.col.period'),
      type: 'enum',
      width: 112,
      text: (r) => r.periodLabel,
    },
    {
      key: 'due',
      label: t('report.col.due'),
      type: 'date',
      width: 176,
      text: (r) => formatDateRu(r.dueDate),
      cell: (r) => <DueCell t={t} r={r} />,
    },
    {
      key: 'days',
      label: t('report.col.days'),
      type: 'int',
      width: 132,
      text: (r) => (r.days === null ? '' : String(r.days)),
      cell: (r) => <DaysCell t={t} r={r} />,
    },
    {
      key: 'status',
      label: t('report.col.status'),
      type: 'enum',
      width: 175,
      text: statusText,
      cell: (r) => <StatusCell t={t} r={r} confirm={o.confirm} />,
    },
    ...(o.waiting
      ? ([
          {
            key: 'wait',
            label: t('report.col.wait'),
            type: 'int',
            width: 100,
            text: (r) => (r.waitDays === null ? '' : String(r.waitDays)),
            cell: (r) => <WaitCell t={t} r={r} limit={o.waitDays} />,
          },
          {
            key: 'submittedBy',
            label: t('report.col.submitted_by'),
            type: 'enum',
            width: 130,
            text: (r) => r.submittedBy?.shortName ?? r.responsible?.shortName ?? '',
          },
        ] satisfies GridColumn<ReportRow>[])
      : []),
    {
      key: 'submitted',
      label: t('report.col.submitted'),
      type: 'date',
      width: 108,
      text: (r) => (r.act === 'pay' || !r.submittedOn ? '' : formatDateRu(r.submittedOn)),
      cell: (r) =>
        r.act === 'pay' ? <Dash /> : r.submittedOn ? formatDateRu(r.submittedOn) : null,
    },
    {
      // Суммы всегда в одном порядке (решение заказчика 25.10.2026): «К уплате» → «Получено от
      // контрагента» → «Оплачено в бюджет»; на телефоне — одной строкой плитки.
      key: 'amount',
      label: t('report.col.amount'),
      type: 'money',
      width: 130,
      total: money,
      text: amountText,
      cell: (r) => <AmountCell t={t} r={r} />,
      tileLine: {},
    },
    {
      key: 'payDue',
      label: t('report.col.pay_due'),
      type: 'date',
      width: 116,
      text: (r) => (r.act === 'sub' || !r.payDue ? '' : formatDateRu(r.payDue)),
      cell: (r) => (r.act === 'sub' ? <Dash /> : r.payDue ? formatDateRu(r.payDue) : null),
    },
    {
      key: 'overdue',
      label: t('report.col.overdue'),
      type: 'enum',
      width: 140,
      text: (r) => (r.overdue ? t('report.overdue.sub') : ''),
    },
    { key: 'pays', label: t('report.col.pays'), type: 'text', width: 220, text: (r) => r.pays },
    {
      key: 'responsible',
      label: t('report.col.responsible'),
      type: 'enum',
      width: 132,
      text: (r) => r.responsible?.shortName ?? '',
    },
    {
      key: 'formCode',
      label: t('report.col.form_code'),
      type: 'text',
      width: 110,
      className: 'font-mono',
      text: (r) => r.formCode,
    },
    {
      key: 'periodFull',
      label: t('report.col.period_full'),
      type: 'text',
      width: 170,
      text: (r) => r.periodFull,
    },
    {
      key: 'dueBase',
      label: t('report.col.due_base'),
      type: 'date',
      width: 120,
      text: (r) => formatDateRu(r.dueBase),
    },
    ...(o.confirm
      ? ([
          {
            key: 'confirm',
            label: t('report.col.confirm'),
            type: 'enum',
            width: 190,
            text: (r) => reportMarkText(t, r, o.confirm),
            cell: (r) => <ConfirmCell t={t} r={r} confirm={o.confirm} />,
          },
          {
            key: 'confirmedOn',
            label: t('report.col.confirmed_on'),
            type: 'date',
            width: 130,
            text: (r) =>
              reportMark(r, o.confirm) === 'confirmed' && r.confirmedAt
                ? formatDateRu(bishkekDate(new Date(r.confirmedAt)))
                : '',
          },
        ] satisfies GridColumn<ReportRow>[])
      : []),
    {
      key: 'version',
      label: t('report.col.version'),
      type: 'enum',
      width: 110,
      text: (r) =>
        r.revision ? t('report.version.revision', { n: r.revision }) : t('report.version.primary'),
    },
    {
      key: 'ownership',
      label: t('report.col.ownership'),
      type: 'enum',
      width: 120,
      text: (r) => r.ownershipForm,
    },
    {
      key: 'regime',
      label: t('report.col.regime'),
      type: 'enum',
      width: 150,
      text: (r) => r.regime ?? '',
    },
  ];
}
