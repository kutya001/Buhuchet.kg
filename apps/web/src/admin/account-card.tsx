'use client';

import {
  accountCardTabs,
  formatDateRu,
  formatMomentRu,
  bishkekDate,
  monthLabel,
  periodLabel,
  shortName,
  type AccountCardState,
  type AccountCardTab,
  type ReportPeriod,
  type UiTextKey,
  type YearMonth,
} from '@buhuchet/domain';
import { AdminSessionsEnded, AdminUserCard, type AdminUser } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  ConfirmDialog,
  Hint,
  Icon,
  KeyValues,
  linkButtonClass,
  MiniTable,
  miniWide,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  Plate,
  Plates,
  Timeline,
  useToast,
  type ActionItem,
  type CardTab,
  type IconName,
  type KeyValueItem,
  type MiniColumn,
  type MiniRow,
  type PlateColor,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { KbBox } from '../kb/kb-parts';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { statusName } from '../status/status-view';
import { ACCOUNT_CARD_KEY } from './account-actions';
import { accountHistoryItems, sessionEndText, telegramErrorText } from './account-card-model';

const TAB_ICONS: Readonly<Record<AccountCardTab, IconName>> = {
  main: 'user',
  work: 'briefcase',
  ses: 'key',
  kb: 'grad',
  tg: 'tg',
  hist: 'history',
};

/** Состояния цветными метками (прототип acStates): зелёная, красные, жёлтая. */
const STATE_PILLS: Readonly<
  Record<AccountCardState, { tone: 'ok' | 'bad' | 'warn'; icon: IconName }>
> = {
  active: { tone: 'ok', icon: 'check' },
  blocked_admin: { tone: 'bad', icon: 'lock' },
  blocked_owner: { tone: 'bad', icon: 'lock' },
  login_locked: { tone: 'bad', icon: 'ban' },
  temp_password: { tone: 'warn', icon: 'key' },
};

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');
const DASH = <span className="text-faint">—</span>;

type Work = NonNullable<AdminUserCard['work']>;
type WorkKey = 'contractors' | 'due' | 'inWork' | 'overdue' | 'done' | 'tasks' | 'kpi';

/**
 * Карточка пользователя в Админке (ТЗ «Админка» → «Карточка пользователя»; прототип v83,
 * admin/admin-cards.js, accCard): вкладки «Основное», «Работа», «Сеансы», «Обучение и видео»,
 * «Telegram», «История» (у администратора платформы — «Основное», «Сеансы», «История»). Только
 * просмотр: меняют данные лишь кнопки шапки (те же, что в меню строки списка) и «Завершить все
 * сеансы». Каждое открытие сервер пишет в историю учётной записи; перечитывание открытой карточки
 * (после действия) новой записи не даёт.
 */
export function AccountCard({
  id,
  initial,
  open,
  onClose,
  actions,
  onOrg,
}: {
  id: string;
  /** Строка списка — название окна, пока карточка не загрузилась. */
  initial: AdminUser | null;
  open: boolean;
  onClose: () => void;
  /** Кнопки шапки для учётной записи (пункты меню строки без «Открыть карточку»). */
  actions: (u: AdminUser) => ActionItem[];
  /** Открыть карточку организации (ссылка в шапке и в «Основном»); нет — название текстом. */
  onOrg?: (orgId: string) => void;
}) {
  const t = useT();
  // Первое чтение — открытие карточки (запись в историю), дальше — перечитывание открытой.
  const opened = useRef(false);
  const query = useQuery({
    queryKey: [...ACCOUNT_CARD_KEY, id],
    queryFn: async () => {
      const res = await api.api.admin.users[':id'].card.$get({
        param: { id },
        query: opened.current ? { refresh: '1' } : {},
      });
      if (!res.ok) throw await apiFailure(res);
      opened.current = true;
      return AdminUserCard.parse(await res.json());
    },
    staleTime: 0,
    gcTime: 0,
  });
  const card = query.data;
  const user = card?.user ?? initial;
  const [tab, setTab] = useState<AccountCardTab>('main');
  const ids = accountCardTabs(user?.isPlatformAdmin ?? false);
  const tabs: CardTab[] = ids.map((k) => ({
    id: k,
    label: t(`accounts.card.tab.${k}`),
    icon: TAB_ICONS[k],
    ...(k === 'ses' && card?.sessions.open ? { count: { value: card.sessions.open } } : {}),
  }));
  const shownTab = ids.includes(tab) ? tab : 'main';
  const buttons = user ? actions(user) : [];
  const org = (u: AdminUser): ReactNode =>
    u.orgId && onOrg ? (
      <button type="button" className={linkButtonClass()} onClick={() => onOrg(u.orgId!)}>
        {u.orgName}
      </button>
    ) : (
      u.orgName || t('accounts.card.platform')
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={user?.fullName ?? ''}
      sub={
        user ? (
          <>
            <span className={MONO_CLASS}>{user.login}</span> · {org(user)} · {user.role}
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
                data-account-action={a.id}
                title={a.label}
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
        active: shownTab,
        onSelect: (next) => setTab(next as AccountCardTab),
        label: t('accounts.card.tabs'),
      }}
      footer={
        <>
          <Hint>{t('accounts.card.readonly')}</Hint>
          <div className="flex-1" />
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('btn.done')}
          </button>
        </>
      }
    >
      <div data-account-card={id} className="flex flex-col gap-3">
        {query.isError && !card ? <Note tone="bad">{t('accounts.card.load_error')}</Note> : null}
        {card ? (
          <>
            <div data-account-states="" className="flex flex-wrap items-center gap-1.5">
              {card.states.map((s) => (
                <Pill key={s} tone={STATE_PILLS[s].tone} icon={STATE_PILLS[s].icon}>
                  {t(`accounts.card.state.${s}`, { n: card.employee?.loginFailuresMax ?? 0 })}
                </Pill>
              ))}
              {card.user.isPlatformAdmin ? <Hint>{t('accounts.card.admin_hint')}</Hint> : null}
            </div>
            {shownTab === 'main' ? <MainTab t={t} card={card} org={org(card.user)} /> : null}
            {shownTab === 'work' && card.work ? (
              <WorkTab t={t} work={card.work} user={card.user} />
            ) : null}
            {shownTab === 'ses' ? <SessionsTab t={t} card={card} /> : null}
            {shownTab === 'kb' && card.kb ? <KbTab t={t} kb={card.kb} /> : null}
            {shownTab === 'tg' && card.telegram ? (
              <TelegramTab t={t} list={card.telegram} linked={card.employee?.telegram != null} />
            ) : null}
            {shownTab === 'hist' ? (
              <Box>
                {card.history.length ? (
                  <Timeline
                    label={t('accounts.card.tab.hist')}
                    items={accountHistoryItems(t, card.history)}
                  />
                ) : (
                  <span className="text-faint">{t('accounts.card.hist.empty')}</span>
                )}
              </Box>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

// ОТКЛОНЕНИЕ: docs/deviations.md#О-65 — списки карточки — простые таблицы до 200 строк, а не общий список.
/** «Показаны первые 200 из N» — список карточки длиннее предела ответа. */
function More({ t, shown, total }: { t: Translate; shown: number; total: number }) {
  return total > shown ? <Hint>{t('accounts.card.more', { n: shown, total })}</Hint> : null;
}

/** Кто и когда: имя, под ним момент мелким серым (прототип `.aud`). */
function Audit({ who, at }: { who: string | null; at: string }) {
  return (
    <>
      {who ?? '—'}
      <span className="block text-[11.5px] text-faint">{moment(at)}</span>
    </>
  );
}

function MainTab({ t, card, org }: { t: Translate; card: AdminUserCard; org: ReactNode }) {
  const u = card.user;
  const e = card.employee;
  const digits = e?.phone?.replace(/\D/g, '') ?? '';
  const kind = u.isPlatformAdmin ? 'admin' : e?.isOwner ? 'owner' : 'employee';
  const items: KeyValueItem[] = [
    { id: 'full-name', label: t('accounts.col.full_name'), value: u.fullName },
    {
      id: 'short-name',
      label: t('accounts.card.main.short'),
      value: e?.shortName || shortName(u.fullName),
    },
    { id: 'login', label: t('accounts.col.login'), value: u.login, mono: true },
    {
      id: 'phone',
      label: t('staff.col.phone'),
      value: e?.phone ? (
        <a href={`tel:+${digits}`} title={t('staff.card.call')} className="font-mono text-inherit">
          {e.phoneText ?? e.phone}
        </a>
      ) : (
        DASH
      ),
    },
    { id: 'org', label: t('accounts.col.org'), value: org },
    { id: 'role', label: t('accounts.col.role'), value: u.role },
    {
      id: 'kind',
      label: t('accounts.card.main.kind'),
      value: t(`accounts.card.main.kind.${kind}`),
    },
    {
      id: 'created',
      label: t('accounts.card.main.created'),
      value: <Audit who={u.audit.createdBy} at={u.audit.createdAt} />,
    },
    {
      id: 'last-login',
      label: t('accounts.col.last_login'),
      value: u.lastLoginAt ? moment(u.lastLoginAt) : DASH,
    },
    ...(e
      ? [
          {
            id: 'failures',
            label: t('accounts.card.main.failures'),
            value: t('accounts.card.main.failures_value', {
              n: e.loginFailures,
              max: e.loginFailuresMax,
            }),
          },
          {
            id: 'telegram',
            label: t('accounts.card.main.telegram'),
            value: e.telegram ? (
              <>
                <Pill size="sm" tone="ok" icon="tg">
                  {t('accounts.card.main.tg_on')}
                </Pill>{' '}
                <span className={MONO_CLASS}>{e.telegram.name}</span>
                <span className="block text-[11.5px] text-faint">
                  {t('accounts.card.main.tg_since', {
                    date: formatDateRu(bishkekDate(new Date(e.telegram.linkedAt))),
                  })}
                </span>
              </>
            ) : (
              <span className="text-caution-label">{t('accounts.card.main.tg_off')}</span>
            ),
          } satisfies KeyValueItem,
        ]
      : []),
  ];
  return (
    <>
      <Box>
        <KeyValues items={items} />
      </Box>
      {e && e.roleGroups.length ? (
        <Box
          title={t(e.isOwner ? 'accounts.card.perms_owner' : 'accounts.card.perms', {
            name: u.role,
          })}
        >
          <div
            data-account-perms=""
            className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-[18px] gap-y-2.5"
          >
            {e.roleGroups.map((g) => {
              const all = e.isOwner || g.scope === 'all';
              return (
                <div key={g.group} className="flex flex-col gap-[3px] text-[13px]">
                  <b className="font-[650]">{t(`roles.group.${g.group}` as UiTextKey)}</b>
                  {g.scope ? (
                    <span className="self-start">
                      <Pill size="sm" tone={all ? 'info' : 'plain'}>
                        {t(all ? 'accounts.card.scope.all' : 'accounts.card.scope.own')}
                      </Pill>
                    </span>
                  ) : null}
                  <Hint>{g.permissions.join(' · ')}</Hint>
                </div>
              );
            })}
          </div>
        </Box>
      ) : null}
    </>
  );
}

const CP_COLUMNS = (t: Translate): MiniColumn[] => [
  { key: 'name', label: t('accounts.card.col.name') },
  { key: 'inn', label: t('accounts.card.col.inn') },
  { key: 'regime', label: t('accounts.card.col.regime') },
  { key: 'service', label: t('accounts.card.col.service') },
];

const cpRows = (t: Translate, rows: Work['contractors']['rows']): MiniRow[] =>
  rows.map((c) => ({
    key: c.id,
    cells: {
      name: <span className="font-semibold">{c.name}</span>,
      inn: <span className={MONO_CLASS}>{c.inn ?? '—'}</span>,
      regime: c.regime ?? '—',
      service: t(`status.service.${c.serviceStatus}` as UiTextKey),
    },
    blank: [...(c.inn ? [] : ['inn']), ...(c.regime ? [] : ['regime'])],
  }));

/** Строки и столбцы списка «только просмотр» по плашке «Работы» (прототип acWorkList). */
function workList(
  t: Translate,
  work: Work,
  key: WorkKey,
  user: AdminUser,
): { columns: MiniColumn[]; rows: MiniRow[]; count: number } {
  if (key === 'contractors') {
    const list = work.contractors;
    return { columns: CP_COLUMNS(t), rows: cpRows(t, list.rows), count: list.count };
  }
  if (key === 'tasks') {
    return {
      columns: [
        { key: 'title', label: t('accounts.card.col.task') },
        { key: 'contractor', label: t('accounts.card.col.contractor') },
        { key: 'due', label: t('accounts.card.col.due') },
        { key: 'status', label: t('accounts.card.col.status') },
      ],
      rows: work.tasks.rows.map((x) => ({
        key: x.id,
        cells: {
          title: x.title,
          contractor: x.contractor ?? '—',
          due: x.dueDate ? formatDateRu(x.dueDate) : '—',
          status: statusName(t, 'task', x.status),
        },
        wide: miniWide({ title: x.title }),
        blank: [...(x.contractor ? [] : ['contractor']), ...(x.dueDate ? [] : ['due'])],
      })),
      count: work.tasks.count,
    };
  }
  if (key === 'kpi') {
    return {
      columns: [
        { key: 'contractor', label: t('accounts.card.col.contractor') },
        { key: 'indicator', label: t('accounts.card.col.indicator') },
        { key: 'value', label: t('accounts.card.col.value'), numeric: true },
        { key: 'at', label: t('accounts.card.col.entered') },
      ],
      rows: work.kpi.rows.map((v) => ({
        key: v.id,
        cells: {
          contractor: v.contractor,
          indicator: v.indicator,
          value: v.value,
          at: moment(v.at),
        },
      })),
      count: work.kpi.count,
    };
  }
  const list = work[key];
  return {
    columns: [
      { key: 'contractor', label: t('accounts.card.col.contractor') },
      { key: 'type', label: t('accounts.card.col.report') },
      { key: 'period', label: t('accounts.card.col.period') },
      { key: 'due', label: t('accounts.card.col.due') },
      { key: 'status', label: t('accounts.card.col.status') },
      { key: 'responsible', label: t('accounts.card.col.responsible') },
    ],
    rows: list.rows.map((r) => ({
      key: r.id,
      cells: {
        contractor: r.contractor,
        type: r.type,
        period: periodLabel(
          { period: r.period as ReportPeriod, start: r.periodStart, event: r.eventDate },
          t,
        ),
        due: formatDateRu(r.dueDate),
        status: statusName(t, 'report', r.status),
        responsible: shortName(user.fullName),
      },
    })),
    count: list.count,
  };
}

const WORK_PLATES: readonly {
  key: WorkKey;
  icon: IconName;
  color: PlateColor;
  label: UiTextKey;
  title: UiTextKey;
}[] = [
  {
    key: 'contractors',
    icon: 'building',
    color: 'blue',
    label: 'accounts.card.work.cps',
    title: 'accounts.card.list.cps',
  },
  {
    key: 'due',
    icon: 'file',
    color: 'yellow',
    label: 'accounts.card.work.due',
    title: 'accounts.card.list.due',
  },
  {
    key: 'inWork',
    icon: 'clock',
    color: 'purple',
    label: 'accounts.card.work.in_work',
    title: 'accounts.card.list.in_work',
  },
  {
    key: 'overdue',
    icon: 'alert',
    color: 'red',
    label: 'accounts.card.work.overdue',
    title: 'accounts.card.list.overdue',
  },
  {
    key: 'done',
    icon: 'check',
    color: 'green',
    label: 'accounts.card.work.done',
    title: 'accounts.card.list.done',
  },
  {
    key: 'tasks',
    icon: 'task',
    color: 'purple',
    label: 'accounts.card.work.tasks',
    title: 'accounts.card.list.tasks',
  },
  {
    key: 'kpi',
    icon: 'gauge',
    color: 'blue',
    label: 'accounts.card.work.kpi',
    title: 'accounts.card.list.kpi',
  },
];

/**
 * «Работа» (прототип acWork): плашки с числами — нажатие открывает список только для просмотра — и
 * закреплённые контрагенты. Списки — простые таблицы до 200 строк (docs/deviations.md, п. О-65).
 */
function WorkTab({ t, work, user }: { t: Translate; work: Work; user: AdminUser }) {
  const [list, setList] = useState<{ key: WorkKey; open: boolean } | null>(null);
  const shown = list ? workList(t, work, list.key, user) : null;
  const plate = WORK_PLATES.find((p) => p.key === list?.key);
  return (
    <>
      <div data-account-work="">
        <Plates static>
          {WORK_PLATES.map((p) => {
            const n = work[p.key].count;
            return (
              <Plate
                key={p.key}
                id={p.key}
                icon={p.icon}
                // «Просрочено» без просрочек — зелёная (прототип: `d.over.length?'red':'green'`).
                color={p.key === 'overdue' && n === 0 ? 'green' : p.color}
                label={t(p.label, { month: monthLabel(work.kpiMonth as YearMonth) })}
                value={String(n)}
                onClick={() => setList({ key: p.key, open: true })}
              />
            );
          })}
        </Plates>
      </div>
      <Box title={t('accounts.card.work.cps_box', { n: work.contractors.count })}>
        <MiniTable
          label={t('accounts.card.list.cps')}
          columns={CP_COLUMNS(t)}
          rows={cpRows(t, work.contractors.rows)}
          empty={t('accounts.card.work.cps_empty')}
        />
        <More t={t} shown={work.contractors.rows.length} total={work.contractors.count} />
      </Box>
      <Modal
        open={list?.open === true}
        onClose={() => setList((l) => l && { ...l, open: false })}
        kind="card"
        size="wide"
        title={plate ? t(plate.title) : ''}
        sub={t('accounts.card.list.sub', { name: user.fullName })}
        footer={
          <button
            type="button"
            className={buttonClass('cta')}
            onClick={() => setList((l) => l && { ...l, open: false })}
          >
            {t('btn.done')}
          </button>
        }
      >
        {shown && plate ? (
          <div data-account-list={plate.key} className="flex flex-col gap-2.5">
            <MiniTable
              label={t(plate.title)}
              columns={shown.columns}
              rows={shown.rows}
              empty={t('accounts.card.list.empty')}
            />
            <More t={t} shown={shown.rows.length} total={shown.count} />
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/**
 * «Сеансы» (прототип acSes): открытые и закрытые сеансы входа и «Завершить все сеансы» с
 * подтверждением. Свои сеансы и сеансы администраторов платформы отсюда не завершаются.
 */
function SessionsTab({ t, card }: { t: Translate; card: AdminUserCard }) {
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = card.sessions;
  // ОТКЛОНЕНИЕ: docs/deviations.md#О-65 — сеансы администраторов платформы из Админки не завершаются.
  const locked = s.self || card.user.isPlatformAdmin;
  const hint = s.self
    ? t('accounts.card.ses.end_self')
    : card.user.isPlatformAdmin
      ? t('accounts.card.admin_hint')
      : s.open
        ? t('accounts.card.ses.end_hint')
        : t('accounts.card.ses.end_none');

  const end = async () => {
    if (busy) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.admin.users[':id'].sessions.end.$post({ param: { id: card.user.id } }),
    );
    setBusy(false);
    void client.invalidateQueries({ queryKey: ACCOUNT_CARD_KEY });
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    if (!AdminSessionsEnded.safeParse(res.data).success) {
      return toast(t('err.unknown'), { bad: true });
    }
    toast(t('accounts.card.ses.done'), { icon: 'key' });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-muted" data-account-sessions={s.open}>
          {t('accounts.card.ses.open')} <b>{s.open}</b> ·{' '}
          {t('accounts.card.ses.total', { n: s.total })}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          data-account-sessions-end=""
          className={buttonClass('danger', 'sm')}
          disabled={!s.open || locked || busy}
          title={hint}
          onClick={() => setAsk(true)}
        >
          <Icon name="logout" size="sm" />
          {t('accounts.card.ses.end')}
        </button>
      </div>
      <MiniTable
        label={t('accounts.card.tab.ses')}
        columns={[
          { key: 'start', label: t('accounts.card.ses.col.start') },
          { key: 'last', label: t('accounts.card.ses.col.last') },
          { key: 'till', label: t('accounts.card.ses.col.till') },
          { key: 'device', label: t('accounts.card.ses.col.device') },
          { key: 'state', label: t('accounts.card.ses.col.state') },
        ]}
        rows={s.rows.map((r) => ({
          key: r.id,
          cells: {
            start: <span className="tabular-nums">{moment(r.startedAt)}</span>,
            last: <span className="tabular-nums">{moment(r.lastAt)}</span>,
            till: r.till ? <span className="tabular-nums">{moment(r.till)}</span> : '—',
            device: r.device ?? (
              <span className="text-faint">{t('accounts.card.ses.device_none')}</span>
            ),
            state: r.open ? (
              <Pill size="sm" tone="ok" icon="check">
                {t('accounts.card.ses.opened')}
              </Pill>
            ) : (
              <>
                <Pill size="sm">{t('accounts.card.ses.closed')}</Pill>{' '}
                <span className="text-[11.5px] text-faint">{sessionEndText(t, r.endReason)}</span>
              </>
            ),
          },
          wide: ['device', 'state'],
          blank: r.till ? [] : ['till'],
        }))}
        empty={t('accounts.card.ses.empty')}
      />
      <More t={t} shown={s.rows.length} total={s.total} />
      <Hint>{t('accounts.card.ses.hint')}</Hint>
      <ConfirmDialog
        open={ask}
        onClose={() => setAsk(false)}
        title={t('accounts.card.ses.ask.title', { login: card.user.login })}
        text={t('accounts.card.ses.ask.text', { n: s.open })}
        ok={t('accounts.card.ses.ask.ok')}
        danger
        onConfirm={() => void end()}
      />
    </>
  );
}

/** «Обучение и видео» (прототип acKb): уровень знаний, прочитанные статьи, просмотры видео. */
function KbTab({ t, kb }: { t: Translate; kb: NonNullable<AdminUserCard['kb']> }) {
  return (
    <>
      {kb.progress ? <KbBox progress={kb.progress} modules /> : null}
      <Box title={t('accounts.card.kb.articles', { n: kb.articles.count })}>
        {kb.articles.count ? (
          <>
            <MiniTable
              label={t('accounts.card.kb.articles', { n: kb.articles.count })}
              columns={[
                { key: 'title', label: t('accounts.card.kb.col.article') },
                { key: 'section', label: t('accounts.card.kb.col.section') },
                { key: 'read', label: t('accounts.card.kb.col.read') },
              ]}
              rows={kb.articles.rows.map((a) => ({
                key: a.id,
                cells: {
                  title: a.title,
                  section: a.section,
                  read: <span className="tabular-nums">{moment(a.readAt)}</span>,
                },
                wide: miniWide({ title: a.title }),
              }))}
              empty={t('accounts.card.kb.articles_empty')}
            />
            <More t={t} shown={kb.articles.rows.length} total={kb.articles.count} />
          </>
        ) : (
          <span className="text-faint">{t('accounts.card.kb.articles_empty')}</span>
        )}
      </Box>
      <Box title={t('accounts.card.kb.videos')}>
        <MiniTable
          label={t('accounts.card.kb.videos')}
          columns={[
            { key: 'title', label: t('accounts.card.kb.col.video') },
            { key: 'secs', label: t('accounts.card.kb.col.secs'), numeric: true },
            { key: 'pct', label: t('accounts.card.kb.col.pct'), numeric: true },
            { key: 'last', label: t('accounts.card.kb.col.last') },
            { key: 'state', label: t('accounts.card.kb.col.state') },
          ]}
          rows={kb.videos.rows.map((v) => ({
            key: v.id,
            cells: {
              title: v.title,
              secs: String(v.secs),
              pct: `${v.pct} %`,
              last: v.lastAt ? <span className="tabular-nums">{moment(v.lastAt)}</span> : '—',
              state: t(`video.view.${v.status}` as UiTextKey),
            },
            wide: miniWide({ title: v.title }),
            blank: v.lastAt ? [] : ['last'],
          }))}
          empty={t('accounts.card.kb.videos_empty')}
        />
        <More t={t} shown={kb.videos.rows.length} total={kb.videos.count} />
      </Box>
    </>
  );
}

/** «Telegram» (прототип acTg): сообщения бота пользователю из журнала — дата, тип, состояние; без текста. */
function TelegramTab({
  t,
  list,
  linked,
}: {
  t: Translate;
  list: NonNullable<AdminUserCard['telegram']>;
  linked: boolean;
}) {
  return (
    <>
      {linked ? null : <Note>{t('accounts.card.tg.none')}</Note>}
      <MiniTable
        label={t('accounts.card.tab.tg')}
        columns={[
          { key: 'at', label: t('accounts.card.tg.col.at') },
          { key: 'kind', label: t('accounts.card.tg.col.kind') },
          { key: 'state', label: t('accounts.card.tg.col.state') },
        ]}
        rows={list.rows.map((m) => ({
          key: m.id,
          cells: {
            at: <span className="tabular-nums">{moment(m.at)}</span>,
            kind: t(`telegram.kind.${m.kind}` as UiTextKey),
            state:
              m.status === 'sent' ? (
                <Pill size="sm" tone="ok" icon="check">
                  {t('tgadm.st.sent')}
                </Pill>
              ) : m.status === 'error' ? (
                <Pill size="sm" tone="bad" icon="alert">
                  {telegramErrorText(t, m.error)}
                </Pill>
              ) : (
                <Pill size="sm">{t('tgadm.st.pending')}</Pill>
              ),
          },
          wide: m.status === 'error' ? ['state'] : [],
        }))}
        empty={t('accounts.card.tg.empty')}
      />
      <More t={t} shown={list.rows.length} total={list.count} />
      <Hint>{t('accounts.card.tg.hint')}</Hint>
    </>
  );
}
