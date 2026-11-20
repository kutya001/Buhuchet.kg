'use client';

import {
  bishkekDate,
  FEATURES,
  formatCount,
  formatDateRu,
  formatMomentRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  ORG_TIMEZONES,
  type Tyiyn,
  weekDayOf,
  type YearMonth,
} from '@buhuchet/domain';
import { AdminOrgCard, type AdminOrganization } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Hint,
  Icon,
  KeyValues,
  linkButtonClass,
  MiniTable,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  Plate,
  Plates,
  Tag,
  Timeline,
  useToast,
  type ActionItem,
  type CardTab,
  type IconName,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiFailure, apiFailure, callApi } from '../api-client';
import { OrgFilesTab } from '../afiles/org-files-tab';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { ORG_CARD_KEY } from './org-actions';
import {
  ORG_REPORTS_VIEW,
  OrgContractorsTab,
  OrgReportsTab,
  OrgStaffTab,
  type OrgReportsView,
} from './org-card-lists';
import {
  megabytesText,
  ORG_CARD_TABS,
  ORG_PLATE_TABS,
  orgHistoryItems,
  remindText,
  type OrgCardTab,
} from './org-card-model';

const TAB_ICONS: Readonly<Record<OrgCardTab, IconName>> = {
  main: 'landmark',
  sum: 'gauge',
  staff: 'users',
  cps: 'building',
  rep: 'file',
  money: 'coins',
  set: 'sliders',
  files: 'folder',
  hist: 'history',
};

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');
const DASH = <span className="text-faint">—</span>;
const som = (n: number) => formatSom(n as Tyiyn);
/** «45 000 сом» — суммы вне таблиц (прототип som). */
const somUnit = (n: number) => formatSomWithUnit(n as Tyiyn);

/** Владелец организации — для «Сбросить пароль владельцу» и ссылки на его карточку. */
export type OrgCardOwner = NonNullable<AdminOrgCard['owner']>;

/**
 * Карточка организации в Админке (ТЗ «Админка» → «Карточка организации»; прототип v83,
 * admin/admin-cards.js, orgCard): вкладки «Основное», «Сводка», «Сотрудники», «Контрагенты»,
 * «Отчёты», «Деньги», «Настройки», «Файлы», «История». Только просмотр: меняют данные лишь кнопки
 * шапки — «Заблокировать» или «Разблокировать» (как в меню строки списка) и «Сбросить пароль
 * владельцу». Каждое открытие сервер пишет в историю организации; перечитывание открытой карточки
 * (после действия) новой записи не даёт.
 */
export function OrgCard({
  id,
  initial,
  tab: firstTab = 'main',
  open,
  onClose,
  actions,
  onUser,
  onLead,
  onResetOwner,
}: {
  id: string;
  /** Строка списка — название окна, пока карточка не загрузилась. */
  initial: AdminOrganization | null;
  /** С какой вкладки открыть; по умолчанию — «Основное». */
  tab?: OrgCardTab;
  open: boolean;
  onClose: () => void;
  /** Кнопки шапки (пункты меню строки без «Открыть карточку»). */
  actions: (o: AdminOrganization) => ActionItem[];
  /** Открыть карточку пользователя: владелец и строка «Сотрудников». */
  onUser: (userId: string) => void;
  /** Открыть заявку, по которой создана организация. */
  onLead: (leadId: string) => void;
  /** «Сбросить пароль владельцу» — то же окно, что у «Сбросить пароль» учётной записи. */
  onResetOwner: (owner: OrgCardOwner) => void;
}) {
  const t = useT();
  // Первое чтение — открытие карточки (запись в историю), дальше — перечитывание открытой.
  const opened = useRef(false);
  const query = useQuery({
    queryKey: [...ORG_CARD_KEY, id],
    queryFn: async () => {
      const res = await api.api.admin.organizations[':id'].card.$get({
        param: { id },
        query: opened.current ? { refresh: '1' } : {},
      });
      if (!res.ok) throw await apiFailure(res);
      opened.current = true;
      return AdminOrgCard.parse(await res.json());
    },
    staleTime: 0,
    gcTime: 0,
  });
  const card = query.data;
  const org = card?.org ?? initial;
  // Такой организации нет (ссылка `#orgs/<номер>` на удалённую): окна нет, только уведомление.
  const toast = useToast();
  const missing = query.error instanceof ApiFailure && query.error.status === 404;
  const gone = useRef(false);
  useEffect(() => {
    if (!missing || gone.current) return;
    gone.current = true;
    toast(t('orgs.card.none'), { bad: true });
    onClose();
  }, [missing, toast, t, onClose]);
  const [tab, setTab] = useState<OrgCardTab>(firstTab);
  // Плитка, поиск и «По месяцам» вкладки «Отчёты» живут, пока открыта карточка (прототип `st.rf`).
  const [repView, setRepView] = useState<OrgReportsView>(ORG_REPORTS_VIEW);
  const overdue = card?.summary.reports.overdue ?? 0;
  const tabs: CardTab[] = ORG_CARD_TABS.map((k) => ({
    id: k,
    label: t(`orgs.card.tab.${k}`),
    icon: TAB_ICONS[k],
    // Число сотрудников — все учётные записи организации, с заблокированными (прототип `us.length`).
    ...(k === 'staff' && card
      ? { count: { value: card.summary.staff + card.summary.staffBlocked } }
      : {}),
    ...(k === 'rep' && overdue
      ? { count: { value: overdue, tone: 'red' as const, title: t('orgs.card.sum.overdue') } }
      : {}),
  }));
  const owner = card?.owner ?? null;
  // «Отправить новую ссылку для пароля» (доработки 14.11.2026, блок 1, пункт 3; прототип v113
  // ownerSetupAct): владельцу организации по заявке, пока он не задал пароль.
  const errorText = useErrorText();
  const [sending, setSending] = useState(false);
  const ownerSetup = async () => {
    setSending(true);
    const res = await callApi(() =>
      api.api.admin.organizations[':id']['owner-setup'].$post({ param: { id } }),
    );
    setSending(false);
    if (res.ok) toast(t('orgs.card.owner_setup.sent'), { icon: 'tg' });
    else toast(errorText(res.error), { bad: true });
    void query.refetch();
  };
  const buttons: ActionItem[] = org
    ? [
        ...actions(org),
        ...(owner
          ? [
              {
                id: 'reset-owner',
                label: t('orgs.card.reset_owner'),
                icon: 'key' as const,
                run: () => onResetOwner(owner),
              },
            ]
          : []),
        ...(owner?.passwordUnset && card && !card.org.isDemo
          ? [
              {
                id: 'owner-setup',
                label: t('orgs.card.owner_setup'),
                icon: 'link' as const,
                disabled: !owner.telegram || sending,
                ...(owner.telegram ? {} : { reason: t('orgs.card.owner_setup.no_tg') }),
                run: () => void ownerSetup(),
              },
            ]
          : []),
      ]
    : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={org?.name ?? ''}
      sub={
        org ? (
          <>
            {t('orgs.card.sub.inn')} <span className={MONO_CLASS}>{org.inn ?? '—'}</span>
            {org.slug ? (
              <>
                {' · '}
                <span className={MONO_CLASS}>{t('orgs.card.sub.page', { slug: org.slug })}</span>
              </>
            ) : null}
            {' · '}
            {t('orgs.card.sub.since', {
              date: formatDateRu(bishkekDate(new Date(org.audit.createdAt))),
            })}
          </>
        ) : undefined
      }
      head={
        buttons.length ? (
          <>
            {buttons.map((a) => (
              <button
                key={a.id}
                type="button"
                data-org-action={a.id}
                title={a.disabled && a.reason ? a.reason : a.label}
                aria-label={a.label}
                disabled={a.disabled}
                className={`${buttonClass(a.danger ? 'danger' : 'default', 'sm')} mr-1 flex-none self-center max-md:px-2`}
                onClick={a.run}
              >
                {a.icon ? <Icon name={a.icon} size="sm" /> : null}
                <span className="max-md:hidden">{a.label}</span>
              </button>
            ))}
          </>
        ) : undefined
      }
      tabs={{
        items: tabs,
        active: tab,
        onSelect: (next) => setTab(next as OrgCardTab),
        label: t('orgs.card.tabs'),
      }}
      footer={
        <>
          <Hint>{t('orgs.card.readonly')}</Hint>
          <div className="flex-1" />
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('btn.done')}
          </button>
        </>
      }
    >
      <div data-org-card={id} className="flex flex-col gap-3">
        {query.isError && !card ? <Note tone="bad">{t('orgs.card.load_error')}</Note> : null}
        {card ? (
          <>
            <div data-org-states="" className="flex flex-wrap items-center gap-1.5">
              {card.org.active ? (
                <Pill tone="ok" icon="check">
                  {t('orgs.active')}
                </Pill>
              ) : (
                <Pill tone="bad" icon="lock">
                  {card.org.blockedReason || t('orgs.blocked')}
                </Pill>
              )}
              {card.org.isDemo ? (
                <Pill tone="violet" icon="star">
                  {t('orgs.card.demo')}
                </Pill>
              ) : null}
            </div>
            {tab === 'main' ? <MainTab t={t} card={card} onUser={onUser} onLead={onLead} /> : null}
            {tab === 'sum' ? (
              <SummaryTab
                t={t}
                card={card}
                onTab={(next, plate) => {
                  if (plate) setRepView((v) => ({ ...v, plate }));
                  setTab(next);
                }}
              />
            ) : null}
            {tab === 'staff' ? <OrgStaffTab t={t} orgId={id} onUser={onUser} /> : null}
            {tab === 'cps' ? <OrgContractorsTab t={t} orgId={id} /> : null}
            {tab === 'rep' ? (
              <OrgReportsTab
                t={t}
                orgId={id}
                orgName={card.org.name}
                reports={card.reports}
                view={repView}
                onView={setRepView}
              />
            ) : null}
            {tab === 'money' ? (
              <MoneyTab t={t} money={card.money} month={card.summary.month as YearMonth} />
            ) : null}
            {tab === 'set' ? <SettingsTab t={t} settings={card.settings} /> : null}
            {tab === 'files' ? <OrgFilesTab t={t} orgId={id} /> : null}
            {tab === 'hist' ? (
              <Box>
                {card.history.length ? (
                  <Timeline
                    label={t('orgs.card.tab.hist')}
                    items={orgHistoryItems(t, card.history)}
                  />
                ) : (
                  <span className="text-faint">{t('orgs.card.hist.empty')}</span>
                )}
              </Box>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * «Основное» (прототип ocMain): реквизиты из «Моей организации» и блок «На платформе» — владелец
 * (ссылка на карточку пользователя), заявка (ссылка), кем и когда создана, состояние, блокировки с
 * причинами.
 */
function MainTab({
  t,
  card,
  onUser,
  onLead,
}: {
  t: Translate;
  card: AdminOrgCard;
  onUser: (userId: string) => void;
  onLead: (leadId: string) => void;
}) {
  const o = card.org;
  const p = card.profile;
  const { owner, lead } = card;
  const digits = p.phone?.replace(/\D/g, '') ?? '';
  // ОТКЛОНЕНИЕ: docs/deviations.md#О-66 — «Полного названия» у организации в продукте нет.
  const main: KeyValueItem[] = [
    { id: 'name', label: t('orgs.card.main.name'), value: o.name },
    { id: 'inn', label: t('orgs.col.inn'), value: o.inn ?? DASH, mono: Boolean(o.inn) },
    // Доработки 14.11.2026, блок 1, пункт 4 (прототип v114 admin-cards.js ocMain): форма и ОКПО.
    {
      id: 'form',
      label: t('orgs.card.main.form'),
      value: p.legalForm ? t(`org.form.${p.legalForm}`) : DASH,
    },
    { id: 'okpo', label: t('orgs.card.main.okpo'), value: p.okpo ?? DASH, mono: Boolean(p.okpo) },
    { id: 'address', label: t('orgs.card.main.address'), value: p.address ?? DASH },
    {
      id: 'phone',
      label: t('orgs.card.main.phone'),
      value: p.phone ? (
        <a href={`tel:+${digits}`} className="font-mono text-inherit">
          {p.phone}
        </a>
      ) : (
        DASH
      ),
    },
    { id: 'head', label: t('orgs.card.main.head'), value: p.head ?? DASH },
    { id: 'slug', label: t('orgs.card.main.slug'), value: o.slug || DASH, mono: Boolean(o.slug) },
    {
      id: 'logo',
      label: t('orgs.card.main.logo'),
      value: t(p.hasLogo ? 'orgs.card.main.logo_yes' : 'orgs.card.no'),
    },
    {
      id: 'accounts',
      label: t('orgs.card.main.accounts'),
      value: p.accounts.length ? p.accounts.join(', ') : DASH,
      wide: p.accounts.length > 0,
    },
  ];
  const platform: KeyValueItem[] = [
    {
      id: 'owner',
      label: t('orgs.card.platform.owner'),
      value: owner ? (
        <>
          <button
            type="button"
            data-org-owner=""
            className={`${linkButtonClass()} ${MONO_CLASS}`}
            onClick={() => onUser(owner.userId)}
          >
            {owner.login}
          </button>
          {' · '}
          {owner.fullName}
        </>
      ) : (
        DASH
      ),
    },
    {
      id: 'lead',
      label: t('orgs.card.platform.lead'),
      value: lead ? (
        <button
          type="button"
          data-org-lead=""
          className={linkButtonClass()}
          onClick={() => onLead(lead.id)}
        >
          {lead.title} · {moment(lead.at)}
        </button>
      ) : (
        <span className="text-faint">{t('orgs.card.platform.no_lead')}</span>
      ),
    },
    {
      id: 'created',
      label: t('orgs.card.platform.created'),
      value: (
        <>
          {o.audit.createdBy ?? '—'}
          <span className="block text-[11.5px] text-faint">{moment(o.audit.createdAt)}</span>
        </>
      ),
    },
    {
      id: 'state',
      label: t('orgs.card.platform.state'),
      value: o.active
        ? t('orgs.active')
        : o.blockedReason
          ? t('orgs.card.blocked_reason', { reason: o.blockedReason })
          : t('orgs.blocked'),
    },
  ];
  return (
    <>
      <Box title={t('orgs.card.tab.main')}>
        <KeyValues items={main} />
      </Box>
      <Box title={t('orgs.card.platform')}>
        <KeyValues items={platform} />
        <h4 className="m-0 mt-1 text-[13px] font-[650]">{t('orgs.card.blocks')}</h4>
        <div data-org-blocks="">
          {card.blocks.length ? (
            <Timeline label={t('orgs.card.blocks')} items={orgHistoryItems(t, card.blocks)} />
          ) : (
            <span className="text-faint">{t('orgs.card.blocks.none')}</span>
          )}
        </div>
      </Box>
    </>
  );
}

/**
 * «Сводка» (прототип v150 ocSum): плитки с числами; нажатие открывает соответствующую вкладку,
 * «Отчёты» и «Просрочено» — вкладку «Отчёты» с плиткой «К сдаче» или «Просрочено».
 */
function SummaryTab({
  t,
  card,
  onTab,
}: {
  t: Translate;
  card: AdminOrgCard;
  onTab: (tab: OrgCardTab, plate?: 'due' | 'over') => void;
}) {
  const s = card.summary;
  const go = (plate: keyof typeof ORG_PLATE_TABS) => () =>
    onTab(
      ORG_PLATE_TABS[plate],
      plate === 'rep' ? 'due' : plate === 'overdue' ? 'over' : undefined,
    );
  return (
    <div data-org-summary="">
      <Plates static>
        <Plate
          id="staff"
          icon="users"
          color="blue"
          label={t('orgs.card.sum.staff')}
          value={formatCount(s.staff)}
          sub={t('orgs.card.sum.staff_sub', { n: s.staffBlocked })}
          onClick={go('staff')}
        />
        <Plate
          id="cps"
          icon="building"
          color="green"
          label={t('orgs.card.sum.cps')}
          value={formatCount(s.contractors.regular + s.contractors.oneoff + s.contractors.paused)}
          sub={t('orgs.card.sum.cps_sub', { ...s.contractors })}
          onClick={go('cps')}
        />
        <Plate
          id="rep"
          icon="file"
          color="yellow"
          label={t('orgs.card.sum.reports')}
          value={formatCount(s.reports.open)}
          sub={t('orgs.card.sum.reports_sub', { month: s.reports.month, later: s.reports.later })}
          onClick={go('rep')}
        />
        <Plate
          id="overdue"
          icon="alert"
          color={s.reports.overdue ? 'red' : 'green'}
          label={t('orgs.card.sum.overdue')}
          value={formatCount(s.reports.overdue)}
          sub={t('orgs.card.sum.overdue_today')}
          onClick={go('overdue')}
        />
        <Plate
          id="tasks"
          icon="task"
          color="purple"
          label={t('orgs.card.sum.tasks')}
          value={formatCount(s.tasks)}
        />
        <Plate
          id="files"
          icon="folder"
          color="blue"
          label={t('orgs.card.sum.files')}
          value={formatCount(s.files.count)}
          sub={t('orgs.card.sum.mb', { n: megabytesText(s.files.bytes) })}
          onClick={go('files')}
        />
        <Plate
          id="tg"
          icon="tg"
          color="blue"
          label={t('orgs.card.sum.tg')}
          value={formatCount(s.telegram)}
          sub={t('orgs.card.sum.tg_sub')}
          onClick={go('tg')}
        />
        <Plate
          id="logins"
          icon="key"
          color="green"
          label={t('orgs.card.sum.logins')}
          value={formatCount(s.logins30)}
          onClick={go('logins')}
        />
      </Plates>
    </div>
  );
}

/** «Деньги» (прототип ocMoney): итоги без детализации по операциям. */
function MoneyTab({
  t,
  money,
  month,
}: {
  t: Translate;
  money: AdminOrgCard['money'];
  month: YearMonth;
}) {
  const fee = (id: string, title: string, f: { charged: number; paid: number }): ReactNode => {
    const debt = Math.max(0, f.charged - f.paid);
    return (
      <Box title={title}>
        <div data-org-fee={id}>
          <KeyValues
            items={[
              { id: 'charged', label: t('orgs.card.money.charged'), value: somUnit(f.charged) },
              { id: 'paid', label: t('orgs.card.money.paid'), value: somUnit(f.paid) },
              {
                id: 'debt',
                label: t('orgs.card.money.debt'),
                value:
                  debt > 0 ? <b className="text-danger-label">{somUnit(debt)}</b> : somUnit(debt),
              },
            ]}
          />
        </div>
      </Box>
    );
  };
  return (
    <>
      {fee('month', t('orgs.card.money.fee_month', { month: monthLabel(month) }), money.feeMonth)}
      {fee('year', t('orgs.card.money.fee_year'), money.feeYear)}
      <Box title={t('orgs.card.money.taxes')}>
        <div data-org-taxes="">
          <MiniTable
            label={t('orgs.card.money.taxes')}
            columns={[
              { key: 'month', label: t('orgs.card.money.col.month') },
              { key: 'sum', label: t('orgs.card.money.col.sum'), numeric: true },
              { key: 'paid', label: t('orgs.card.money.col.paid'), numeric: true },
              { key: 'left', label: t('orgs.card.money.col.left'), numeric: true },
            ]}
            rows={money.taxes.map((x) => ({
              key: x.month,
              cells: {
                month: monthLabel(x.month as YearMonth),
                sum: som(x.sum),
                paid: som(x.paid),
                left: som(Math.max(0, x.sum - x.paid)),
              },
            }))}
            empty={t('orgs.card.empty')}
          />
        </div>
      </Box>
    </>
  );
}

/**
 * «Настройки» (прототип ocSet): учётная политика, включённые модули и функции, подключённые виды
 * отчётов, роли с числом прав и сотрудников, Telegram-напоминания.
 */
function SettingsTab({ t, settings }: { t: Translate; settings: AdminOrgCard['settings'] }) {
  if (!settings) return <Note>{t('orgs.card.set.none')}</Note>;
  const yes = (v: boolean) => t(v ? 'orgs.card.yes' : 'orgs.card.no');
  return (
    <div data-org-settings="" className="flex flex-col gap-3">
      <Box title={t('orgs.card.set.policy')}>
        <KeyValues
          items={[
            {
              id: 'report-confirm',
              label: t('orgs.card.set.report_confirm'),
              value: yes(settings.reportConfirm),
            },
            {
              id: 'wait-days',
              label: t('orgs.card.set.wait_days'),
              value: t('orgs.card.set.wait_days_value', { n: settings.confirmWaitDays }),
            },
            {
              id: 'task-confirm',
              label: t('orgs.card.set.task_confirm'),
              value: yes(settings.taskConfirm),
            },
            {
              id: 'pay-first',
              label: t('orgs.card.set.pay_first'),
              value: yes(settings.payBeforeSubmit),
            },
            {
              id: 'timezone',
              label: t('orgs.card.set.timezone'),
              value:
                ORG_TIMEZONES.find((z) => z.id === settings.timezone)?.label ?? settings.timezone,
            },
          ]}
        />
      </Box>
      <Box title={t('orgs.card.set.features')}>
        <div data-org-features="" className="flex flex-wrap items-center gap-1.5">
          {FEATURES.map((f) =>
            settings.features[f] ? (
              <Pill key={f} size="sm" tone="ok" icon="check">
                {t(`org.feature.${f}`)}
              </Pill>
            ) : (
              <Pill key={f} size="sm">
                {t(`org.feature.${f}`)}
              </Pill>
            ),
          )}
        </div>
      </Box>
      <Box title={t('orgs.card.set.types', { n: settings.reportTypes.length })}>
        <div data-org-types="" className="flex flex-wrap items-center gap-1.5">
          {settings.reportTypes.length
            ? // Короткие названия видов повторяются («1-Т»): ключ — место в списке.
              settings.reportTypes.map((name, i) => <Tag key={`${i}-${name}`}>{name}</Tag>)
            : DASH}
        </div>
      </Box>
      <Box title={t('orgs.card.set.roles', { n: settings.roles.length })}>
        <MiniTable
          label={t('orgs.card.set.roles', { n: settings.roles.length })}
          columns={[
            { key: 'role', label: t('orgs.card.set.col.role') },
            { key: 'perms', label: t('orgs.card.set.col.perms'), numeric: true },
            { key: 'staff', label: t('orgs.card.set.col.staff') },
          ]}
          rows={settings.roles.map((r) => ({
            key: r.id,
            cells: {
              role: r.name,
              perms: r.isOwner ? t('orgs.card.set.perms_all') : String(r.permissions),
              staff: String(r.employees),
            },
          }))}
          empty={t('orgs.card.empty')}
        />
      </Box>
      <Box title={t('orgs.card.set.tg')}>
        <KeyValues
          items={[
            {
              id: 'remind',
              label: t('orgs.card.set.remind'),
              value: remindText(t, settings.remindDays),
            },
            // Пакет 14.11.2026, блок 3 (прототип v111 admin-cards.js): день и час недельной сводки
            // и «Час напоминаний» организации.
            {
              id: 'digest',
              label: t('orgs.card.set.digest'),
              value: t('orgs.card.set.digest_value', {
                day: t(`tgn.wd.${weekDayOf(settings.weekDay)}`),
                time: settings.digestTime,
              }),
            },
            { id: 'hour', label: t('orgs.card.set.hour'), value: settings.digestTime },
            {
              id: 'overdue-repeat',
              label: t('orgs.card.set.overdue_repeat'),
              value: yes(settings.overdueRepeat),
            },
          ]}
        />
      </Box>
    </div>
  );
}
