import { bishkekDate, bishkekTime, formatDateRu, pluralForm } from '@buhuchet/domain';
import type { UiTextKey } from '@buhuchet/domain';
import type { AdminOrgCard } from '@buhuchet/shared';
import type { TimelineItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { policyHistoryItem } from '../org/policy-history';

// Карточка организации в Админке (прототип v83, admin/admin-cards.js: orgCard, ocMain, ocHist):
// вкладки, строки «Истории» и «Блокировок с причинами», объём файлов и адрес #orgs/<адрес>.

/** Вкладки карточки по порядку прототипа. */
export const ORG_CARD_TABS = [
  'main',
  'sum',
  'staff',
  'cps',
  'rep',
  'money',
  'set',
  'files',
  'hist',
] as const;
export type OrgCardTab = (typeof ORG_CARD_TABS)[number];

/** Плашка «Сводки» → вкладка, которую она открывает (прототип orgCard: `data-plate`). */
export const ORG_PLATE_TABS = {
  staff: 'staff',
  cps: 'cps',
  rep: 'rep',
  overdue: 'rep',
  files: 'files',
  tg: 'staff',
  logins: 'staff',
} as const satisfies Record<string, OrgCardTab>;

type HistoryEntry = AdminOrgCard['history'][number];
type HistoryChange = HistoryEntry['changes'][number];

const FIELD_KEYS: Readonly<Record<string, UiTextKey>> = {
  name: 'orgs.card.hist.field.name',
  inn: 'orgs.card.hist.field.inn',
  address: 'orgs.card.hist.field.address',
  phone: 'orgs.card.hist.field.phone',
  head: 'orgs.card.hist.field.head',
  slug: 'orgs.card.hist.field.slug',
  logoKey: 'orgs.card.hist.field.logo',
};

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const label = (t: Translate, field: string): string =>
  FIELD_KEYS[field] ? t(FIELD_KEYS[field]) : field;

/** Блокировка или разблокировка — как записи прототипа: «Организация заблокирована: причина». */
function statusText(t: Translate, changes: readonly HistoryChange[]): string | null {
  const status = changes.find((c) => c.field === 'status');
  if (!status) return null;
  const reason = changes.find((c) => c.field === 'blockedReason');
  if (status.to === 'blocked') {
    return t('orgs.card.hist.blocked', {
      reason: text(reason?.to) || t('orgs.block.reason'),
    });
  }
  const was = text(reason?.from);
  return was ? t('orgs.card.hist.unblocked_was', { reason: was }) : t('orgs.card.hist.unblocked');
}

/** Правка реквизитов: «Название: А → Б», остальные поля — «Изменено: …». */
function profileText(t: Translate, changes: readonly HistoryChange[]): string {
  const valued: string[] = [];
  const plain: string[] = [];
  for (const c of changes) {
    const from = text(c.from);
    const to = text(c.to);
    const field = label(t, c.field);
    if (from && to) valued.push(t('orgs.card.hist.value', { field, from, to }));
    else if (to) valued.push(t('orgs.card.hist.value_set', { field, to }));
    else if (from) valued.push(t('orgs.card.hist.value_cleared', { field, from }));
    else plain.push(field);
  }
  const parts = [
    ...valued,
    ...(plain.length ? [t('orgs.card.hist.updated', { fields: plain.join(', ') })] : []),
  ];
  return parts.length ? parts.join('; ') : t('orgs.card.hist.changed');
}

/** Запись о роли: создана, удалена, что изменено; название — нынешнее или из самой записи. */
function roleText(t: Translate, h: HistoryEntry): string {
  const renamed = h.changes.find((c) => c.field === 'name');
  const name = h.subject ?? (text(renamed?.to) || text(renamed?.from));
  if (h.action === 'create') {
    return name
      ? t('orgs.card.hist.role_created_name', { name })
      : t('orgs.card.hist.role_created');
  }
  if (h.action === 'delete') {
    return name
      ? t('orgs.card.hist.role_deleted_name', { name })
      : t('orgs.card.hist.role_deleted');
  }
  const parts = [
    ...(renamed && text(renamed.from) && text(renamed.to)
      ? [t('orgs.card.hist.role_renamed', { from: text(renamed.from), to: text(renamed.to) })]
      : []),
    ...(h.changes.some((c) => c.field === 'permissions') ? [t('orgs.card.hist.role_perms')] : []),
    ...(h.changes.some((c) => c.field === 'scopes') ? [t('orgs.card.hist.role_scopes')] : []),
  ];
  const what = parts.length ? parts.join(', ') : t('orgs.card.hist.role_changed');
  return name
    ? t('orgs.card.hist.role_name', { name, text: what })
    : t('orgs.card.hist.role', { text: what });
}

/**
 * Что произошло — строкой «Истории» (прототип ocHist): создание организации, блокировки с причиной,
 * действия администраторов с пояснением (открытие карточки), правки реквизитов «было → стало»,
 * учётная политика — теми же словами, что её история в «Моей организации», роли.
 */
export function orgHistoryText(t: Translate, h: HistoryEntry): string {
  if (h.entity === 'org_settings') {
    // «Действия из Telegram» (вкладка «Настройки», прототип org.js `#st-tgact`).
    const actions = h.changes.find((c) => c.field === 'telegramActions');
    const own =
      actions && typeof actions.to === 'boolean'
        ? t(actions.to ? 'orgs.card.hist.tg_actions_on' : 'orgs.card.hist.tg_actions_off')
        : null;
    // Экран шлёт переключатель отдельно, но метод принимает его и вместе с другими полями: остальные
    // изменения той же записи не теряются.
    const rest = h.changes.filter((c) => c !== actions);
    if (own && rest.length === 0) return own;
    const item = policyHistoryItem(
      { at: h.at, actor: h.actor, action: h.action, changes: rest, reason: h.reason },
      0,
      t,
    );
    const text =
      typeof item.text === 'string' && item.text ? item.text : t('orgs.card.hist.policy');
    return own ? `${own}; ${text}` : text;
  }
  if (h.entity === 'role') return roleText(t, h);
  if (h.action === 'create') return t('orgs.card.hist.created');
  const status = statusText(t, h.changes);
  if (status) return status;
  if (h.reason) return h.reason;
  return profileText(t, h.changes);
}

/** Кто: сотрудник организации, администратор платформы или «Система». */
export function orgHistoryWho(t: Translate, h: HistoryEntry): string {
  if (h.actor) return h.actor;
  return t(h.actorAdmin ? 'accounts.card.hist.admin' : 'status.system');
}

/** Лента «Истории» и «Блокировок с причинами»: сверху новые (порядок ответа сервера). */
export function orgHistoryItems(t: Translate, history: readonly HistoryEntry[]): TimelineItem[] {
  return history.map((h) => {
    const at = new Date(h.at);
    return {
      id: h.id,
      date: formatDateRu(bishkekDate(at)),
      time: bishkekTime(at),
      text: orgHistoryText(t, h),
      who: orgHistoryWho(t, h),
    };
  });
}

/** Объём в МБ с точностью до десятых, как в прототипе (`fmtM(Math.round(n / 1048576 * 10) / 10)`): «2,50». */
export function megabytesText(bytes: number): string {
  const mb = Math.round((bytes / 1_048_576) * 10) / 10;
  const [whole, part] = mb.toFixed(2).split('.');
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${part}`;
}

/** «за 7 дней, за 3 дня, за 1 день и в день срока» (прототип ocSet); дней нет — «в день срока». */
export function remindText(t: Translate, days: readonly number[]): string {
  if (!days.length) return t('orgs.card.set.remind_today');
  const list = days.map((n) => t(`orgs.card.set.remind_day.${pluralForm(n)}`, { n })).join(', ');
  return t('orgs.card.set.remind_value', { days: list });
}

/**
 * Адрес карточки организации на странице «Организации»: `#orgs/<адрес организации>` или
 * `#orgs/<номер организации>` (прототип admCardRoute и admCardOpen: `orgSlug(x) === v || x.id === v`).
 */
export const ORG_HASH = /^#orgs\/(.+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Что открыть по адресу `#orgs/…`: организацию по номеру или по адресу страницы; не тот адрес — null. */
export function orgHashTarget(hash: string): { id: string } | { slug: string } | null {
  const m = ORG_HASH.exec(hash);
  if (!m) return null;
  let value: string;
  try {
    value = decodeURIComponent(m[1]!).trim().toLowerCase();
  } catch {
    return null;
  }
  if (!value) return null;
  return UUID.test(value) ? { id: value } : { slug: value };
}
