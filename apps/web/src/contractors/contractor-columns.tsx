'use client';

import { formatDateRu, formatMomentRu, formatSom, type ListSort } from '@buhuchet/domain';
import type { ContractorRow } from '@buhuchet/shared';
import {
  Icon,
  iconButtonClass,
  Pill,
  StatusMini,
  StatusMiniNone,
  StatusPill,
  type GridAudit,
  type GridColumn,
  type GridRowTone,
} from '@buhuchet/ui';
import { KpiMissingBadge } from '../kpi/kpi-card-tab';
import type { Translate } from '../l10n/translate';
import { miniView } from '../status/status-view';

/**
 * Сортировка по умолчанию во всех списках — от новых к старым по «Создано» (ТЗ «Списки записей»,
 * прототип defSort: у списка со служебными столбцами `sort` прототипа не действует).
 */
export const CONTRACTOR_DEFAULT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/**
 * Видимые по умолчанию (ТЗ «Столбцы, видимые по умолчанию»; прототип cpCols без `hide`): название,
 * ИНН, режим налогообложения, статус обслуживания, ответственный, просрочено.
 */
export const CONTRACTOR_DEFAULT_VISIBLE = [
  'name',
  'inn',
  'regime',
  'service',
  'responsible',
  'overdue',
];

export const CONTRACTOR_AUDIT: GridAudit<ContractorRow> = {
  createdBy: (r) => r.audit.createdBy ?? '',
  updatedBy: (r) => r.audit.updatedBy ?? r.audit.createdBy ?? '',
  createdAt: (r) => formatMomentRu(new Date(r.audit.createdAt)),
  updatedAt: (r) => formatMomentRu(new Date(r.audit.updatedAt)),
};

/**
 * Подсветка строки (прототип rowClass): без ответственного — оранжевым (ТЗ «Закрепление»: контрагент
 * без ответственного подсвечивается), архивный и приостановленный — приглушённо.
 */
export function contractorTone(r: ContractorRow): GridRowTone | undefined {
  if (!r.responsible && r.serviceStatus !== 'archived') return 'warn';
  return r.serviceStatus === 'active' ? undefined : 'muted';
}

const Faint = ({ children }: { children: string }) => (
  <span className="text-faint">{children}</span>
);

/** Телефон: номер ссылкой «Позвонить» (tel:) и кнопка «Написать в WhatsApp» (прототип phoneHtml). */
export function PhoneLinks({ t, phone, text }: { t: Translate; phone: string; text: string }) {
  if (!phone) return <Faint>—</Faint>;
  const digits = phone.replace(/\D/g, '');
  return (
    <span className="inline-flex items-center gap-1.5" data-phone="">
      <a
        href={`tel:+${digits}`}
        title={t('cp.list.call')}
        className="font-mono text-inherit underline"
        onClick={(e) => e.stopPropagation()}
      >
        {text || phone}
      </a>
      <a
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noopener noreferrer"
        title={t('cp.list.whatsapp')}
        aria-label={t('cp.list.whatsapp')}
        className={iconButtonClass('sm')}
        onClick={(e) => e.stopPropagation()}
      >
        <Icon name="chat" size="sm" />
      </a>
    </span>
  );
}

/** Тариф Соцфонда меткой (прототип sfPill) и «под вопросом». */
export function SocfundPill({ t, s }: { t: Translate; s: NonNullable<ContractorRow['socfund']> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Pill
        tone={
          s.id === null ? 'warn' : s.id === 'spino' ? 'ok' : s.id === 'pvtpki' ? 'info' : 'plain'
        }
        size="sm"
        icon="shield"
      >
        {s.total ? `${s.short} · ${s.total}` : s.short}
      </Pill>
      {s.ask && s.id !== null ? (
        <Pill tone="warn" size="sm" icon="alert">
          {t('cp.list.socfund_ask')}
        </Pill>
      ) : null}
    </span>
  );
}

/** Компактная шкала обслуживания (прототип `scaleMini('svc', …)`). */
function ServiceCell({ t, r }: { t: Translate; r: ContractorRow }) {
  const view = miniView(t, {
    scale: 'service',
    status: r.serviceStatus,
    history: [
      {
        at: new Date(r.serviceSince.at),
        from: null,
        to: r.serviceStatus,
        rollback: false,
        reason: null,
        actor: r.serviceSince.by,
      },
    ],
  });
  if (view.kind === 'none') return <StatusMiniNone label={view.label} title={view.title} />;
  if (view.kind === 'pill') return <StatusPill {...view.pill} size="sm" />;
  return <StatusMini {...view.props} />;
}

export interface ContractorColumnsOptions {
  /** Право «Видеть плату за обслуживание»: «Стоимость обслуживания». */
  fee: boolean;
  /** Индикатор «Показателей контрагентов» доступен: значок в названии и столбец «Не заполнены показатели». */
  kpi: boolean;
}

/**
 * Столбцы списка контрагентов — как в прототипе (modules/contractors.js, `cpCols`), ключи — как на
 * сервере. «Платит одной суммой», «Файл к поступлению обязателен», «Свободный остаток» и «Долг за
 * обслуживание» добавят задачи денег (поток В); служебные «Создал», «Изменил», «Создано», «Изменено»
 * добавляет сам список (`CONTRACTOR_AUDIT`).
 */
export function contractorColumns(
  t: Translate,
  o: ContractorColumnsOptions,
): GridColumn<ContractorRow>[] {
  const yes = (v: boolean) => t(v ? 'cp.yes' : 'cp.no');
  const live = (r: ContractorRow) => r.serviceStatus !== 'archived';
  return [
    {
      key: 'name',
      label: t('cp.col.name'),
      type: 'text',
      width: 250,
      text: (r) => r.name,
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className="font-semibold">{r.name}</span>
          {!r.responsible && live(r) ? (
            <Pill tone="caution" size="sm" icon="alert">
              {t('cp.no_responsible')}
            </Pill>
          ) : null}
          {o.kpi && live(r) ? <KpiMissingBadge contractorId={r.id} /> : null}
        </span>
      ),
    },
    {
      key: 'inn',
      label: t('cp.col.inn'),
      type: 'text',
      width: 150,
      className: 'font-mono',
      text: (r) => r.inn,
    },
    {
      key: 'phone',
      label: t('cp.col.phone'),
      type: 'text',
      width: 190,
      text: (r) => r.phoneText,
      cell: (r) => <PhoneLinks t={t} phone={r.phone} text={r.phoneText} />,
    },
    { key: 'form', label: t('cp.col.form'), type: 'enum', width: 90, text: (r) => r.form },
    {
      key: 'regime',
      label: t('cp.col.regime'),
      type: 'enum',
      width: 170,
      text: (r) => r.regime ?? '',
    },
    {
      key: 'regime2',
      label: t('cp.col.regime2'),
      type: 'enum',
      width: 170,
      text: (r) => r.regime2 ?? '',
    },
    {
      key: 'benefits',
      label: t('cp.col.benefits'),
      type: 'text',
      width: 220,
      text: (r) => r.benefits ?? '',
    },
    {
      key: 'gked',
      label: t('cp.col.gked'),
      type: 'text',
      width: 280,
      text: (r) => (r.gked ? `${r.gked.code} ${r.gked.name}` : ''),
      cell: (r) =>
        r.gked ? (
          <span>
            <span className="font-mono">{r.gked.code}</span> {r.gked.name}
          </span>
        ) : (
          <Pill tone="warn" size="sm" icon="alert">
            {t('cp.no_gked')}
          </Pill>
        ),
    },
    {
      key: 'gkedExtra',
      label: t('cp.col.gked_extra'),
      type: 'text',
      width: 220,
      className: 'font-mono',
      text: (r) => r.gkedExtra ?? '',
    },
    {
      key: 'gkedSet',
      label: t('cp.col.gked_set'),
      type: 'enum',
      width: 120,
      text: (r) => yes(!!r.gked),
    },
    {
      key: 'socfund',
      label: t('cp.col.socfund'),
      type: 'enum',
      width: 190,
      text: (r) => r.socfund?.short ?? '',
      cell: (r) => (r.socfund ? <SocfundPill t={t} s={r.socfund} /> : null),
    },
    {
      key: 'socfundAsk',
      label: t('cp.col.socfund_ask'),
      type: 'enum',
      width: 150,
      text: (r) => yes(!!r.socfund?.ask),
    },
    {
      key: 'taxOffice',
      label: t('cp.col.tax_office'),
      type: 'enum',
      width: 210,
      text: (r) => r.taxOffice ?? '',
    },
    {
      key: 'kind',
      label: t('cp.col.kind'),
      type: 'enum',
      width: 150,
      text: (r) => t(r.kind === 'oneoff' ? 'cp.kind.oneoff' : 'cp.kind.regular'),
    },
    {
      key: 'service',
      label: t('cp.col.service'),
      type: 'enum',
      width: 190,
      text: (r) => t(`status.service.${r.serviceStatus}`),
      cell: (r) => <ServiceCell t={t} r={r} />,
    },
    {
      key: 'responsible',
      label: t('cp.col.responsible'),
      type: 'enum',
      width: 140,
      text: (r) => r.responsible?.shortName ?? '',
    },
    {
      key: 'start',
      label: t('cp.col.start'),
      type: 'date',
      width: 130,
      text: (r) => formatDateRu(r.startDate),
    },
    {
      key: 'contract',
      label: t('cp.col.contract'),
      type: 'text',
      width: 170,
      text: (r) => contractText(t, r),
    },
    { key: 'head', label: t('cp.col.head'), type: 'text', width: 190, text: (r) => r.head },
    {
      key: 'contact',
      label: t('cp.col.contact'),
      type: 'text',
      width: 190,
      text: (r) => r.contact,
    },
    {
      key: 'reportTypes',
      label: t('cp.col.report_types'),
      type: 'int',
      width: 112,
      text: (r) => String(r.reportTypes),
    },
    ...(o.kpi
      ? ([
          {
            key: 'kpiMissing',
            label: t('cp.col.kpi_missing'),
            type: 'enum',
            width: 180,
            sortable: false,
            text: () => '',
            cell: (r) => (live(r) ? <KpiMissingBadge contractorId={r.id} /> : null),
          },
        ] satisfies GridColumn<ContractorRow>[])
      : []),
    {
      key: 'overdue',
      label: t('cp.col.overdue'),
      type: 'int',
      width: 110,
      text: (r) => String(r.overdue),
      cell: (r) =>
        r.overdue ? (
          <Pill tone="bad" size="sm" icon="alert">
            {String(r.overdue)}
          </Pill>
        ) : (
          <Faint>0</Faint>
        ),
    },
    ...(o.fee
      ? ([
          {
            key: 'fee',
            label: t('cp.col.fee'),
            type: 'money',
            width: 185,
            text: (r) => (r.tariff ? formatSom(r.tariff.amount) : ''),
            cell: (r) =>
              r.tariff ? (
                <span>
                  {formatSom(r.tariff.amount)}{' '}
                  <span className="text-faint">
                    {t(r.tariff.period === 'Y' ? 'cp.list.per_year' : 'cp.list.per_month')}
                  </span>
                </span>
              ) : (
                <Faint>—</Faint>
              ),
          },
        ] satisfies GridColumn<ContractorRow>[])
      : []),
  ];
}

/** Договор, как на сервере: «№ 160/24 от 16.07.2024», «Без номера от …» или только номер. */
export function contractText(
  t: Translate,
  r: Pick<ContractorRow, 'contractNo' | 'contractDate'>,
): string {
  if (!r.contractNo && !r.contractDate) return '';
  if (!r.contractDate) return `№ ${r.contractNo}`;
  const date = formatDateRu(r.contractDate);
  if (!r.contractNo) return t('cp.contract.no_number', { date });
  return t('cp.contract', { no: r.contractNo, date });
}
