'use client';

import { formatDateRu, formatMomentRu, formatSom, type GridKey } from '@buhuchet/domain';
import {
  ListValues,
  ReportList,
  type Assignment,
  type Contractor,
  type ContractorRow,
  type ContractorService,
  type ReportRow,
} from '@buhuchet/shared';
import {
  ActionMenu,
  Box,
  buttonClass,
  ConfirmDialog,
  DataGrid,
  EmptyState,
  Icon,
  iconButtonClass,
  KeyValues,
  MiniTable,
  Modal,
  Note,
  PHONE_QUERY,
  Pill,
  StatusHistory,
  StatusHistoryDetails,
  StatusNone,
  StatusPill,
  StatusScale,
  Tag,
  Timeline,
  useMediaQuery,
  type ActionEntry,
  type CardTab,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { api, apiFailure } from '../api-client';
import { ContractorPageBox } from '../contractor-page/page-box';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { catalogQuery, type Catalog } from '../dicts/dicts-data';
import { KpiCardTab, useKpiCardCount } from '../kpi/kpi-card-tab';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import {
  ContractorBalanceBox,
  ContractorMoneyTab,
  useMoneySettingsItems,
  useMoneyTabOn,
} from '../money/contractor-money';
import { useReportActions } from '../reports/report-actions';
import {
  REPORT_AUDIT,
  REPORT_DEFAULT_SORT,
  reportColumns,
  reportDefaultVisible,
  reportTone,
} from '../reports/report-columns';
import { useShell } from '../shell/context';
import {
  historyLabels,
  historyView,
  scaleView,
  statusEvents,
  statusPillView,
} from '../status/status-view';
import { ContractorTasksTab } from '../tasks/contractor-tasks-tab';
import { contractorTasksQuery } from '../tasks/tasks-data';
import { AssignmentDialog } from './assignment-dialog';
import { useCardEdits, type CardEdits } from './card-edits';
import { contractText, PhoneLinks } from './contractor-columns';
import { assignmentsQuery, contractorHistoryQuery, contractorQuery } from './contractor-data';
import { ContractorFilesTab, contractorFilesQuery, useFilesTabOn } from './contractor-files';
import { GkedNotesView } from './contractor-fields';
import { contractorHistoryItem } from './contractor-history';
import { serviceScaleSteps } from './contractor-menu';
import { useNotNeededRemove } from './not-needed-remove';
import { RatesDialog } from './rates-dialog';
import { NotNeededNote, ReportPickTab } from './report-pick';
import { reportPickQuery } from './report-pick-data';
import { serviceQuery } from './service-data';
import { ServicePlanNote, ServiceStatusBlock } from './service-actions';

export type ContractorCardTab =
  'main' | 'reports' | 'pick' | 'money' | 'tasks' | 'kpi' | 'files' | 'hist';

const REPORTS_GRID: GridKey = 'cps.reports';

/** Кто и когда: имя, под ним момент мелким серым (прототип `auditKv`). */
function Audit({ who, at }: { who: string | null; at: string }) {
  return (
    <>
      {who ?? '—'}
      <span className="block text-[11.5px] text-faint">{formatMomentRu(new Date(at))}</span>
    </>
  );
}

const Faint = ({ children }: { children: ReactNode }) => (
  <span className="text-faint">{children}</span>
);
const Hint = ({ children }: { children: ReactNode }) => (
  <span className="block text-[11.5px] leading-[1.4] text-faint">{children}</span>
);

export interface ContractorCardProps {
  id: string;
  /** Строка списка — показывается, пока карточка не загрузилась. */
  initial: ContractorRow | null;
  tab: ContractorCardTab;
  open: boolean;
  onClose: () => void;
  /** Пункты «Действия» (без «Открыть карточку» и «Подобрать отчёты»). */
  actions: (c: Contractor, service: ContractorService | undefined) => ActionEntry[];
  /** Пункты обслуживания: шаги шкалы нажимаются, если есть пункт. */
  serviceActions: (c: Contractor, service: ContractorService) => ActionEntry[];
  /** «сменить» у ответственного; null — нет права. */
  onResponsible: ((c: Contractor) => void) | null;
  /** «Указать» ГКЭД и «Изменить»; null — нет права. */
  onEdit: ((c: Contractor) => void) | null;
  /** «Отменить приостановку» у отметки; null — нет права. */
  onCancelPause: ((c: Contractor, service: ContractorService) => void) | null;
}

/**
 * Карточка контрагента (ТЗ «Карточка контрагента с вкладками»; прототип modules/contractor-card.js,
 * `openCp`): в заголовке — название и «архив», под ним ИНН, режим, приостановка, «разовый» и
 * «просрочено отчётов: N». Вкладки «Основное», «Отчёты к сдаче» (просроченные — красным числом),
 * «Подбор отчётов» (у постоянного), «Деньги» (при «Учёте оплаты налогов»), «Задачи», «Показатели»,
 * «Файлы», «История»; «Обслуживание» и «Проекты» добавят их задачи. Уйти с «Подбора отчётов» с несохранённым выбором —
 * вопрос «Подбор не применён». Внизу — «Действия» и «Готово»; «На весь экран» и свайпы по вкладкам — у
 * окна карточки.
 */
export function ContractorCardWindow(props: ContractorCardProps) {
  const { id, initial, open, onClose, actions } = props;
  const t = useT();
  const { access } = useShell();
  const query = useQuery(contractorQuery(id));
  const c = query.data ?? null;
  const service = useQuery(serviceQuery(id)).data;
  const [tab, setTab] = useState<ContractorCardTab>(props.tab);
  const [pickDirty, setPickDirty] = useState(false);
  const [leave, setLeave] = useState<{ go: () => void; open: boolean } | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const filesOn = useFilesTabOn();
  const regular = (c?.kind ?? initial?.kind) !== 'oneoff';
  const archived = (c?.serviceStatus ?? initial?.serviceStatus) === 'archived';
  const kpiOn = access.feature('indicators') && access.can('kpiView') && regular;
  const tasksOn = access.feature('tasks');
  const kpiCount = useKpiCardCount(id, kpiOn && !archived);
  const tasks = useQuery({ ...contractorTasksQuery(id), enabled: tasksOn }).data;
  const files = useQuery({ ...contractorFilesQuery(id), enabled: filesOn }).data;
  const overdue = c?.overdue ?? initial?.overdue ?? 0;
  const repView = access.can('repView');
  const moneyOn = useMoneyTabOn(c);

  const tabs: CardTab[] = [
    { id: 'main', label: t('cp.card.tab.main'), icon: 'building' },
    ...(repView
      ? [
          {
            id: 'reports',
            label: t('cp.card.tab.reports'),
            icon: 'file',
            ...(overdue
              ? { count: { value: overdue, tone: 'red', title: t('cp.card.overdue') } as const }
              : {}),
          } satisfies CardTab,
        ]
      : []),
    ...(regular && repView
      ? [{ id: 'pick', label: t('cp.card.tab.pick'), icon: 'list' } satisfies CardTab]
      : []),
    ...(moneyOn
      ? [{ id: 'money', label: t('cp.card.tab.money'), icon: 'wallet' } satisfies CardTab]
      : []),
    ...(tasksOn
      ? [
          {
            id: 'tasks',
            label: t('cp.card.tab.tasks'),
            icon: 'task',
            ...(tasks?.open ? { count: { value: tasks.open } } : {}),
          } satisfies CardTab,
        ]
      : []),
    ...(kpiOn
      ? [
          {
            id: 'kpi',
            label: t('cp.card.tab.kpi'),
            icon: 'gauge',
            ...(kpiCount ? { count: kpiCount } : {}),
          } satisfies CardTab,
        ]
      : []),
    ...(filesOn
      ? [
          {
            id: 'files',
            label: t('cp.card.tab.files'),
            icon: 'clip',
            ...(files?.total ? { count: { value: files.total } } : {}),
          } satisfies CardTab,
        ]
      : []),
    { id: 'hist', label: t('cp.card.tab.hist'), icon: 'history' },
  ];
  const shownTab = tabs.some((x) => x.id === tab) ? tab : 'main';

  // Несохранённый подбор не теряется молча: при уходе с вкладки и закрытии — вопрос (прототип pkLeave).
  const guard = (go: () => void) => {
    if (shownTab === 'pick' && pickDirty) setLeave({ go, open: true });
    else go();
  };
  const close = () => guard(onClose);
  const items = c ? actions(c, service) : [];
  const name = c?.name ?? initial?.name ?? '';
  const inn = c?.inn ?? initial?.inn ?? '';
  const regime = c ? c.regime?.name : initial?.regime;

  const title = name ? (
    <span className="inline-flex flex-wrap items-center gap-2">
      {name}
      {archived ? <Tag>{t('cp.card.archived')}</Tag> : null}
    </span>
  ) : (
    ''
  );
  const sub = name ? (
    <span data-cp-sub="">
      <CardSub
        t={t}
        inn={inn}
        regime={regime ?? null}
        paused={(c?.serviceStatus ?? initial?.serviceStatus) === 'paused'}
        oneoff={!regular}
        overdue={overdue}
      />
    </span>
  ) : null;

  return (
    <Modal
      open={open}
      onClose={close}
      kind="card"
      size="wide"
      title={title}
      label={name}
      sub={sub}
      tabs={{
        items: tabs,
        active: shownTab,
        onSelect: (next) => guard(() => setTab(next as ContractorCardTab)),
        label: t('cp.card.tabs'),
      }}
      footer={
        <>
          {items.length > 0 ? (
            <button
              type="button"
              data-cp-more=""
              className={buttonClass('default')}
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              onClick={(e) => setMenu(menu ? null : e.currentTarget)}
            >
              <Icon name="more" size="sm" />
              {t('cp.card.more')}
            </button>
          ) : null}
          <div className="flex-1" />
          <button type="button" data-cp-done="" className={buttonClass('cta')} onClick={close}>
            {t('btn.done')}
          </button>
        </>
      }
    >
      <div data-cp-card={id} data-cp-tab={shownTab} className="flex min-w-0 flex-col gap-3.5">
        {query.isError && !c ? <Note tone="bad">{t('cp.card.load_error')}</Note> : null}
        {c && shownTab === 'main' ? (
          <MainTab
            {...props}
            t={t}
            c={c}
            service={service}
            onPick={() => guard(() => setTab('pick'))}
          />
        ) : null}
        {shownTab === 'reports' ? <ReportsTab contractorId={id} /> : null}
        {shownTab === 'pick' ? <ReportPickTab contractorId={id} onDirty={setPickDirty} /> : null}
        {shownTab === 'money' ? <ContractorMoneyTab contractorId={id} /> : null}
        {shownTab === 'tasks' ? <ContractorTasksTab contractorId={id} archived={archived} /> : null}
        {shownTab === 'kpi' ? <KpiCardTab contractorId={id} /> : null}
        {shownTab === 'files' ? <ContractorFilesTab contractorId={id} archived={archived} /> : null}
        {shownTab === 'hist' ? <HistoryTab t={t} id={id} /> : null}
      </div>
      {menu && c ? (
        <ActionMenu
          items={items}
          place={{ anchor: menu }}
          label={t('cp.card.more')}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {leave ? (
        <ConfirmDialog
          open={leave.open}
          onClose={() => setLeave({ ...leave, open: false })}
          title={t('cp.card.pick_leave.title')}
          text={t('cp.card.pick_leave.text')}
          ok={t('cp.card.pick_leave.ok')}
          danger
          onConfirm={() => {
            setPickDirty(false);
            leave.go();
          }}
        />
      ) : null}
    </Modal>
  );
}

/** «ИНН … · режим · обслуживание приостановлено · разовый контрагент · просрочено отчётов: N». */
function CardSub({
  t,
  inn,
  regime,
  paused,
  oneoff,
  overdue,
}: {
  t: Translate;
  inn: string;
  regime: string | null;
  paused: boolean;
  oneoff: boolean;
  overdue: number;
}) {
  const [before, after] = t('cp.card.sub', {
    inn: '\u0000',
    regime: regime ?? t('cp.card.sub_no_regime'),
  }).split('\u0000');
  return (
    <>
      {before}
      <span className="font-mono">{inn}</span>
      {after}
      {paused ? (
        <>
          {' · '}
          <b className="text-warn-label">{t('cp.card.sub_paused')}</b>
        </>
      ) : null}
      {oneoff ? ` · ${t('cp.card.sub_oneoff')}` : null}
      {overdue ? (
        <>
          {' · '}
          <b className="text-danger-label">{t('cp.card.sub_overdue', { n: overdue })}</b>
        </>
      ) : null}
    </>
  );
}

/** Шкала «Статус обслуживания» с запланированным и «Историей статусов» (прототип scaleFull('svc')). */
function ServiceBox({
  t,
  c,
  service,
  entries,
  onCancelPause,
}: {
  t: Translate;
  c: Contractor;
  service: ContractorService;
  entries: readonly ActionEntry[];
  onCancelPause: ContractorCardProps['onCancelPause'];
}) {
  // Начало обслуживания — первая запись шкалы: кто и когда создал контрагента (прототип statusHist('svc')).
  const history0 = service.statusHistory;
  const events = statusEvents(
    history0[0]?.from === null
      ? history0
      : [
          {
            at: c.audit.createdAt,
            from: null,
            to: 'active',
            rollback: false,
            reason: t('cp.card.start'),
            actor: c.audit.createdBy,
          },
          ...history0,
        ],
  );
  const steps = serviceScaleSteps(entries);
  const run = (action: string) => {
    const entry = entries.find((e) => !('separator' in e) && e.id === action);
    if (entry && !('separator' in entry) && !entry.disabled) entry.run?.();
  };
  const view = scaleView(t, {
    scale: 'service',
    status: c.serviceStatus,
    history: events,
    next: Object.keys(steps.next),
    back: steps.back,
  });
  const history = historyView(t, 'service', events, new Date());
  return (
    <Box>
      <div data-service-scale="">
        {view.kind === 'none' ? (
          <StatusNone title={view.title} text={view.text} since={view.since} undo={null} />
        ) : view.kind === 'pill' ? (
          <StatusPill {...view.pill} />
        ) : (
          <StatusScale
            {...view.props}
            onStep={(to) => {
              const action = steps.next[to];
              if (action) run(action);
            }}
            onBack={() => run('rollback')}
          />
        )}
      </div>
      <ServicePlanNote
        service={service}
        onCancelPause={onCancelPause ? () => onCancelPause(c, service) : null}
      />
      {history.rows.length ? (
        <StatusHistoryDetails title={t('cp.card.status_history')}>
          <StatusHistory rows={history.rows} totals={history.totals} labels={historyLabels(t)} />
        </StatusHistoryDetails>
      ) : null}
    </Box>
  );
}

function MainTab({
  t,
  c,
  service,
  serviceActions,
  onResponsible,
  onEdit,
  onCancelPause,
  onPick,
}: ContractorCardProps & {
  t: Translate;
  c: Contractor;
  service: ContractorService | undefined;
  onPick: () => void;
}) {
  const regular = c.kind !== 'oneoff';
  const entries = service ? serviceActions(c, service) : [];
  const catalog = useQuery(catalogQuery).data;
  const edits = useCardEdits(c, catalog);
  const money = useMoneySettingsItems(c);
  return (
    <>
      {service ? (
        <ServiceBox t={t} c={c} service={service} entries={entries} onCancelPause={onCancelPause} />
      ) : null}
      {regular || c.gked ? <GkedNotesView notes={c.gkedNotes} /> : null}
      <Box>
        <KeyValues
          items={[
            ...mainItems(t, c, service, { onResponsible, onEdit }, { edits, catalog }),
            ...money,
          ]}
        />
      </Box>
      <RegistrationBox t={t} c={c} />
      <AssignmentsBox t={t} c={c} onPick={regular ? onPick : null} />
      <ContractorPageBox contractorId={c.id} />
      <ContractorBalanceBox contractorId={c.id} />
      {edits.dialogs}
    </>
  );
}

/** Строки «Основного» (прототип openCp, `.kv`): порядок — как в прототипе. */
function mainItems(
  t: Translate,
  c: Contractor,
  service: ContractorService | undefined,
  run: Pick<ContractorCardProps, 'onResponsible' | 'onEdit'>,
  { edits, catalog }: { edits: CardEdits; catalog: Catalog | undefined },
): KeyValueItem[] {
  // Режим полным названием из справочника (прототип REGIME_FULL), отключённый — как сохранён.
  const regimeName = (r: { code: string; name: string }) =>
    catalog?.regimes.find((x) => x.code === r.code)?.fullName || r.name;
  const regular = c.kind !== 'oneoff';
  const live = c.serviceStatus !== 'archived';
  const gked = (code: string, name: string) => (
    <span className="block">
      <span className="font-mono font-semibold">{code}</span> {name}
    </span>
  );
  const items: KeyValueItem[] = [
    {
      id: 'gked',
      label: t('cp.card.gked'),
      value: c.gked ? (
        gked(c.gked.code, c.gked.name)
      ) : (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Pill tone="warn" icon="alert">
            {t('cp.card.gked_none')}
          </Pill>
          {run.onEdit && live ? (
            <button
              type="button"
              data-gked-fix=""
              className="cursor-pointer text-[12px] text-accent underline-offset-2 hover:underline"
              onClick={() => run.onEdit?.(c)}
            >
              {t('cp.card.gked_fix')}
            </button>
          ) : null}
        </span>
      ),
    },
    ...(c.gkedExtra.length
      ? [
          {
            id: 'gked-extra',
            label: t('cp.card.gked_extra'),
            value: (
              <>
                {c.gkedExtra.map((g) => (
                  <span key={g.code}>{gked(g.code, g.name)}</span>
                ))}
              </>
            ),
          },
        ]
      : []),
    { id: 'inn', label: t('cp.card.inn'), value: c.inn, mono: true },
    {
      id: 'created',
      label: t('grid.col.created_by'),
      value: <Audit who={c.audit.createdBy} at={c.audit.createdAt} />,
    },
    {
      id: 'updated',
      label: t('grid.col.updated_by'),
      value: <Audit who={c.audit.updatedBy ?? c.audit.createdBy} at={c.audit.updatedAt} />,
    },
    {
      id: 'phone',
      label: t('cp.card.phone'),
      value: <PhoneLinks t={t} phone={c.phone} text={c.phoneText} />,
    },
    { id: 'form', label: t('cp.card.form'), value: c.form.name },
    {
      id: 'regime',
      label: t('cp.card.regime'),
      value: c.regime ? (
        <>
          {regimeName(c.regime)}
          {c.regime2 ? (
            <>
              {' '}
              <Faint>{t('cp.card.regime2')}</Faint> {regimeName(c.regime2)}
            </>
          ) : null}
        </>
      ) : (
        <>
          <Pill tone="warn" icon="alert">
            {t('cp.card.regime_none')}
          </Pill>
          <Hint>{t('cp.card.regime_none_hint')}</Hint>
        </>
      ),
    },
    { id: 'benefits', label: t('cp.card.benefits'), value: edits.benefits },
  ];
  if (edits.socfund) {
    items.push({ id: 'socfund', label: t('cp.socfund.title'), value: edits.socfund, span2: true });
  }
  if (regular) {
    items.push(
      {
        id: 'bases',
        label: t('cp.card.bases'),
        value: c.bases.length ? (
          c.bases.map((b) => b.name).join(', ')
        ) : (
          <Faint>{t('cp.card.none')}</Faint>
        ),
      },
      { id: 'size', label: t('cp.card.size'), value: t(`cp.biz.${c.bizSize}`) },
    );
  }
  items.push(
    {
      id: 'office',
      label: t('cp.card.office'),
      value: edits.office,
    },
    {
      id: 'kind',
      label: t('cp.card.kind'),
      value: regular ? (
        t('cp.card.kind_regular')
      ) : (
        <>
          {t('cp.card.kind_oneoff')} <Faint>{t('cp.card.kind_oneoff_hint')}</Faint>
        </>
      ),
    },
    {
      id: 'status',
      label: t('cp.card.status'),
      value: service ? (
        <ServiceStatusBlock service={service} onCancelPause={null} plan={false} />
      ) : (
        <StatusPill {...statusPillView(t, 'service', c.serviceStatus)} />
      ),
    },
    { id: 'head', label: t('cp.card.head'), value: c.head || '—' },
    { id: 'contact', label: t('cp.card.contact'), value: c.contact || '—' },
    { id: 'start', label: t('cp.card.start'), value: formatDateRu(c.startDate) },
    { id: 'contract', label: t('cp.card.contract'), value: contractText(t, c) || '—' },
  );
  if (regular && c.feeDay !== null) {
    items.push({
      id: 'fee-day',
      label: t('cp.card.fee_day'),
      value: t('cp.card.fee_day_value', { n: c.feeDay }),
    });
  }
  if (c.tariff && regular) {
    items.push({
      id: 'fee',
      label: t('cp.col.fee'),
      value: `${formatSom(c.tariff.amount)} ${t(c.tariff.period === 'Y' ? 'cp.list.per_year' : 'cp.list.per_month')}`,
    });
  }
  if (c.note) {
    items.push({
      id: 'note',
      label: t('cp.card.note'),
      value: <span className="whitespace-pre-wrap">{c.note}</span>,
    });
  }
  items.push({
    id: 'responsible',
    label: t('cp.card.responsible'),
    value: (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {c.responsible ? (
          c.responsible.shortName
        ) : (
          <Pill tone="caution" icon="alert">
            {t('cp.card.responsible_none')}
          </Pill>
        )}
        {run.onResponsible && live ? (
          <button
            type="button"
            data-cp-resp=""
            className="cursor-pointer text-[12px] text-accent underline-offset-2 hover:underline"
            onClick={() => run.onResponsible?.(c)}
          >
            {t('cp.card.responsible_change')}
          </button>
        ) : null}
      </span>
    ),
  });
  return items;
}

/**
 * «Регистрационные данные» (прототип regKvBox): незаполненные — «—»; пустой блок — подсказка; у
 * созданного из свидетельства и выписки — подпись «из свидетельства и выписки».
 */
function RegistrationBox({ t, c }: { t: Translate; c: Contractor }) {
  const r = c.registration;
  const rows: [string, string | undefined][] = [
    ['cp.reg.full_name', r.fullName],
    ['cp.reg.reg_no', r.regNo],
    ['cp.reg.reg_date', r.regDate && formatDateRu(r.regDate)],
    ['cp.reg.rereg_date', r.reRegDate && formatDateRu(r.reRegDate)],
    ['cp.reg.okpo', r.okpo],
    ['cp.reg.address', r.address],
    ['cp.reg.founders', r.founders === undefined ? undefined : String(r.founders)],
    [
      'cp.reg.foreign',
      r.foreign && t(r.foreign === 'yes' ? 'cp.reg.foreign_yes' : 'cp.reg.foreign_no'),
    ],
    ['cp.reg.email', r.email],
  ];
  const empty = rows.every(([, v]) => !v);
  return (
    <Box
      title={
        c.regdocs ? (
          <>
            {t('cp.card.reg')}{' '}
            <span
              className="text-[12px] font-medium tracking-normal normal-case"
              data-cp-reg-docs=""
            >
              {t('cp.rd.card_label')}
            </span>
          </>
        ) : (
          t('cp.card.reg')
        )
      }
    >
      {empty ? (
        <Faint>{t('cp.card.reg_empty')}</Faint>
      ) : (
        <KeyValues
          items={rows.map(([key, v]) => ({
            id: key,
            label: t(key as 'cp.reg.okpo'),
            value: v || '—',
          }))}
        />
      )}
    </Box>
  );
}

/**
 * «Сдаёт отчёты · N» (прототип openCp, `cp-asg`): действующие назначения — вид и код формы, орган,
 * срок сдачи с метками «по статусу», «разовый», «только оплата», ставка, повторяющаяся сумма, с какого и
 * по какой месяц, ответственный («отдельно» — свой у вида), примечание и «Изменить назначение» (право
 * «Назначать отчёты»). Над таблицей — «По статусу «…» не нужны». На телефоне — плитка на вид. В
 * заголовке — «Подбор отчётов» и, с правом «Назначать отчёты», «Ставки» (окно «Ставки и сроки отчётов»).
 */
function AssignmentsBox({
  t,
  c,
  onPick,
}: {
  t: Translate;
  c: Contractor;
  onPick: (() => void) | null;
}) {
  const { access } = useShell();
  const query = useQuery(assignmentsQuery(c.id));
  const catalog = useQuery(catalogQuery).data;
  const [edit, setEdit] = useState<{ a: Assignment; open: boolean; n: number } | null>(null);
  const [rates, setRates] = useState<DialogSlot<null> | null>(null);
  const list = (query.data ?? []).filter((a) => !a.endedOn);
  const canEdit = access.can('assign') && c.serviceStatus !== 'archived';
  // «Снять» у «По статусу «…» не нужны» — кто может менять отчёты в «Подборе отчётов» (прототип pkEdit:
  // «Создавать контрагентов» или «Назначать отчёты» в своей области), как решает сервер.
  const pickable =
    c.kind === 'regular' &&
    c.serviceStatus !== 'archived' &&
    (access.can('assign') || access.can('createCp'));
  const pickEdit = useQuery({ ...reportPickQuery({ contractorId: c.id }), enabled: pickable }).data
    ?.edit.types;
  const notNeeded = useNotNeededRemove(
    c.id,
    list.map((a) => a.reportTypeCode),
  );
  const month = (d: string | null) => (d ? `${d.slice(5, 7)}.${d.slice(0, 4)}` : null);
  return (
    <Box
      title={t('cp.card.asg.title', { n: list.length })}
      actions={
        onPick || (canEdit && list.length) ? (
          <>
            {onPick ? (
              <button
                type="button"
                data-cp-pick=""
                title={t('cp.card.asg.pick_title')}
                className={`${buttonClass('default', 'sm')} normal-case tracking-normal`}
                onClick={onPick}
              >
                <Icon name="list" size="sm" />
                {t('cp.card.asg.pick')}
              </button>
            ) : null}
            {canEdit && list.length ? (
              <button
                type="button"
                data-cp-rates=""
                title={t('cp.card.asg.rates_title')}
                className={`${buttonClass('default', 'sm')} normal-case tracking-normal`}
                onClick={() => setRates(openSlot(null))}
              >
                <Icon name="sliders" size="sm" />
                {t('cp.card.asg.rates')}
              </button>
            ) : null}
          </>
        ) : null
      }
    >
      {catalog ? (
        <NotNeededNote
          benefits={c.benefits.map((b) => b.code)}
          assigned={list.map((a) => a.reportTypeCode)}
          catalog={catalog}
          {...(pickable && pickEdit ? { onRemove: notNeeded.onRemove } : {})}
        />
      ) : null}
      {query.data ? (
        <MiniTable
          label={t('cp.card.asg.title', { n: list.length })}
          empty={t('cp.card.asg.none')}
          columns={[
            { key: 'type', label: t('cp.card.asg.col.type') },
            { key: 'organ', label: t('cp.card.asg.col.organ') },
            { key: 'due', label: t('cp.card.asg.col.due') },
            { key: 'rate', label: t('cp.card.asg.col.rate') },
            { key: 'fixed', label: t('cp.card.asg.col.fixed'), numeric: true },
            { key: 'from', label: t('cp.card.asg.col.from') },
            { key: 'until', label: t('cp.card.asg.col.until') },
            { key: 'resp', label: t('cp.card.asg.col.resp') },
            { key: 'note', label: t('cp.card.asg.col.note') },
            ...(canEdit ? [{ key: 'edit', label: '', actions: true }] : []),
          ]}
          rows={list.map((a) => ({
            key: a.id,
            wide: ['due', 'note'],
            cells: {
              type: (
                <span title={a.reportTypeName}>
                  <b>{a.reportTypeShort}</b>{' '}
                  <Faint>{catalog?.type(a.reportTypeCode)?.formCode ?? ''}</Faint>
                </span>
              ),
              organ: a.authority,
              due: (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {a.dueText}
                  {a.dueStatus ? (
                    <Tag title={t('cp.card.asg.tag.status_title', { name: a.dueStatus.name })}>
                      {t('cp.card.asg.tag.status')}
                    </Tag>
                  ) : null}
                  {a.oneOff ? <Tag>{t('cp.card.asg.tag.oneoff')}</Tag> : null}
                  {a.act === 'pay' ? <Tag>{t('cp.card.asg.tag.pay')}</Tag> : null}
                  {!a.typeActive ? <Tag>{t('cp.card.asg.tag.off')}</Tag> : null}
                </span>
              ),
              rate: a.rateText || '—',
              fixed:
                a.fixedAmount !== null ? (
                  <span className="inline-flex items-center gap-1">
                    <Icon name="repeat" size="sm" />
                    {formatSom(a.fixedAmount)}
                  </span>
                ) : (
                  <Faint>—</Faint>
                ),
              from: month(a.fromMonth),
              until: month(a.untilMonth) ?? <Faint>—</Faint>,
              resp: (
                <span>
                  {a.responsible?.shortName ?? c.responsible?.shortName ?? '—'}
                  {a.responsible ? (
                    <>
                      {' '}
                      <Tag>{t('cp.card.asg.tag.separate')}</Tag>
                    </>
                  ) : null}
                </span>
              ),
              note: a.note || <Faint>—</Faint>,
              edit: (
                <button
                  type="button"
                  data-asg-edit={a.reportTypeCode}
                  className={iconButtonClass('sm')}
                  title={t('cp.card.asg.edit', { name: a.reportTypeShort })}
                  aria-label={t('cp.card.asg.edit', { name: a.reportTypeShort })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEdit({ a, open: true, n: (edit?.n ?? 0) + 1 });
                  }}
                >
                  <Icon name="edit" size="sm" />
                </button>
              ),
            },
          }))}
        />
      ) : null}
      {edit ? (
        <AssignmentDialog
          key={`asg-${edit.n}`}
          assignment={edit.a}
          contractor={{ id: c.id, responsible: c.responsible?.id ?? null }}
          open={edit.open}
          onClose={() => setEdit({ ...edit, open: false })}
        />
      ) : null}
      {notNeeded.dialog}
      {rates ? (
        <RatesDialog
          key={`rates-${rates.n}`}
          contractor={c}
          assignments={list}
          open={rates.open}
          onClose={() => setRates(closeSlot)}
        />
      ) : null}
    </Box>
  );
}

/**
 * «Отчёты к сдаче» карточки (прототип repGrid('cp-rep', compact)): общий список отчётов только этого
 * контрагента — без поиска оболочки и без столбца «Контрагент» по умолчанию; строка открывает карточку
 * отчёта, меню — те же действия, что в «Отчётах для сдачи».
 */
function ReportsTab({ contractorId }: { contractorId: string }) {
  const t = useT();
  const { access } = useShell();
  const phone = useMediaQuery(PHONE_QUERY);
  const labels = useGridLabels('report.count');
  const reports = useReportActions();
  const taxpay = access.feature('taxpay');
  const onReceive = reports.receive;
  const columns = useMemo(
    () =>
      reportColumns(t, {
        waiting: false,
        confirm: access.reportConfirm,
        waitDays: 3,
        phone,
        taxpay,
        onReceive,
      }),
    [t, access.reportConfirm, phone, taxpay, onReceive],
  );
  const defaultVisible = useMemo(
    () => reportDefaultVisible(false, taxpay).filter((k) => k !== 'cp'),
    [taxpay],
  );
  const view = useViewSettings(REPORTS_GRID);
  const extra = useMemo(() => ({ tab: 'all' as const, contractorId }), [contractorId]);
  const fetchPage = useCallback<FetchListPage<ReportRow>>(async (params) => {
    const res = await api.api.reports.$get({ query: params });
    if (!res.ok) throw await apiFailure(res);
    return ReportList.parse(await res.json());
  }, []);
  // Значения фильтров и «В Excel» — тоже только по отчётам контрагента (прототип repGrid в карточке).
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const query = { col, tab: 'all' as const, contractorId };
      const res = await api.api.reports.values.$get({ query: q ? { ...query, q } : query });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [contractorId],
  );
  const list = useListPage({
    gridKey: REPORTS_GRID,
    columns,
    defaultVisible,
    settings: view.settings,
    defaultSort: REPORT_DEFAULT_SORT,
    search: '',
    enabled: view.ready,
    fetchPage,
    extra,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.reports.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  return (
    <>
      <DataGrid
        columns={columns}
        audit={REPORT_AUDIT}
        defaultVisible={defaultVisible}
        defaultSort={REPORT_DEFAULT_SORT}
        settings={view.settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? list.data : undefined}
        onPageChange={list.setPage}
        error={list.error}
        errorText={list.errorText}
        errorTextOf={list.errorTextOf}
        onRetry={list.retry}
        filters={list.filters}
        onFiltersChange={list.setFilters}
        loadValues={loadValues}
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={<EmptyState icon="file" title={t('cp.card.reports_empty')} />}
        rowKey={(r) => r.id}
        titleKey="type"
        rowTone={reportTone}
        label={t('cp.card.tab.reports')}
        labels={labels}
        actions={reports.actions}
        onOpen={reports.openCard}
        bulk={reports.bulk('all')}
      />
      {reports.dialogs}
    </>
  );
}

/** «История» (прототип openCp, `st.tab==='hist'`): от новых к старым; у отчёта — «вид период ·». */
function HistoryTab({ t, id }: { t: Translate; id: string }) {
  const query = useQuery(contractorHistoryQuery(id));
  if (query.isError) return <Note tone="bad">{t('cp.card.load_error')}</Note>;
  const data = query.data;
  if (!data) return null;
  const items = data.items.map((e) => contractorHistoryItem(t, e, data.names));
  return (
    <Box>
      {items.length ? (
        <Timeline items={items} label={t('cp.card.tab.hist')} />
      ) : (
        <Faint>{t('cp.hist.empty')}</Faint>
      )}
    </Box>
  );
}
