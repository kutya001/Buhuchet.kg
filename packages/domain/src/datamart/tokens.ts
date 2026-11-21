import { bishkekDate, diffDays, formatDateRu } from '../common/dates';
import { DM_TOKEN_MAX_DAYS } from './datamart';

/*
 * API-токены «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 5; блок 8, пункт 6; поток Т,
 * этап 1, П14) — прототип v153–v155 `modules/vitrina.js` (`dmIssue`, `dmTokSt`, `dmNewDlg`,
 * `dmReissue`, `dmRevoke`). Токен — `bk_` и 32 случайных байта знаками [A-Za-z0-9]; показывается один
 * раз, в базе — только хеш SHA-256 (считает API) и начало «bk_a1b2c3». Случайные байты и «сейчас» —
 * параметрами.
 */

/** Сроки токена, дней (прототип `DM_TERMS`). */
export const DM_TOKEN_TERMS = [7, 30, 90, 180] as const;
export type DmTokenTerm = (typeof DM_TOKEN_TERMS)[number];
/** Срок по умолчанию — 30 дней, у организации и в Админке (блок 5, пункт 11). */
export const DM_TOKEN_DEFAULT_TERM: DmTokenTerm = 30;
/** Действующих токенов у организации (и у Админки) — не больше 20 (блок 5, пункт 4). */
export const DM_TOKENS_LIVE_MAX = 20;
/** Перевыпущенный токен работает ещё 24 часа (блок 5, пункт 6). */
export const DM_TOKEN_GRACE_HOURS = 24;
/** Название токена — до 100 знаков (`dm_tokens_fields_check`). */
export const DM_TOKEN_NAME_MAX = 100;
/** Случайных байт в токене (блок 8, пункт 6). */
export const DM_TOKEN_BYTES = 32;
/** Знаков начала после «bk_», которое видно в списке (прототип `pre`). */
export const DM_TOKEN_PREFIX_CHARS = 6;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const DAY_MS = 86_400_000;

/**
 * Токен из случайных байт: «bk_» и запись числа из 32 байт по основанию 62 — 43 знака (без смещения,
 * как было бы у `байт % 62` прототипа). Меньше 32 байт — ошибка: слабый токен не выпускается.
 */
export function dmTokenFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== DM_TOKEN_BYTES) throw new Error('dm token: нужно 32 случайных байта');
  const digits: number[] = [];
  const num = Array.from(bytes);
  // Деление «столбиком» на 62, пока число не кончится: младшие разряды — первыми.
  while (num.some((b) => b !== 0)) {
    let rest = 0;
    for (let i = 0; i < num.length; i++) {
      const cur = rest * 256 + num[i]!;
      num[i] = Math.floor(cur / 62);
      rest = cur % 62;
    }
    digits.push(rest);
  }
  const body = digits
    .reverse()
    .map((d) => ALPHABET[d])
    .join('')
    .padStart(43, ALPHABET[0]);
  return `bk_${body}`;
}

/** Похоже ли значение на токен Витрины: «bk_» и 43 знака [A-Za-z0-9] (до сверки хеша). */
export const DM_TOKEN_RE = /^bk_[A-Za-z0-9]{43}$/;

/** Начало токена для списка: «bk_» и 6 знаков (`DM_TOKEN_PREFIX_RE`). */
export function dmTokenPrefix(token: string): string {
  return token.slice(0, 3 + DM_TOKEN_PREFIX_CHARS);
}

/** До какого момента действует новый токен: сейчас + срок в сутках (не больше 180). */
export function dmTokenExpiresAt(now: Date, termDays: number): Date {
  if (!Number.isInteger(termDays) || termDays < 1 || termDays > DM_TOKEN_MAX_DAYS) {
    throw new Error('dm token: срок от 1 до 180 дней');
  }
  return new Date(now.getTime() + termDays * DAY_MS);
}

/** Срок прежнего токена для «Перевыпустить» — в сутках, как его выпустили (прототип `k.term`). */
export function dmTokenTermOf(createdAt: Date, expiresAt: Date): number {
  const days = Math.round((expiresAt.getTime() - createdAt.getTime()) / DAY_MS);
  return Math.min(DM_TOKEN_MAX_DAYS, Math.max(1, days));
}

/** Сколько ещё работает перевыпущенный токен: сутки, но не дольше его срока. */
export function dmTokenGraceUntil(now: Date, expiresAt: Date): Date {
  const grace = now.getTime() + DM_TOKEN_GRACE_HOURS * 3_600_000;
  return new Date(Math.min(grace, expiresAt.getTime()));
}

/** Почему действующий по сроку токен сейчас не отвечает (прототип `dmTokSt`, «Остановлен»; блок 5, пункт 8). */
export const DM_TOKEN_STOPS = [
  'tpl_off',
  'tpl_broken',
  'no_access',
  'org_blocked',
  'sub_closed',
  'api_off',
] as const;
export type DmTokenStop = (typeof DM_TOKEN_STOPS)[number];

export const DM_TOKEN_STATES = ['active', 'stopped', 'expired', 'revoked'] as const;
export type DmTokenState = (typeof DM_TOKEN_STATES)[number];

/** Что известно о токене для его состояния (из базы, без самого токена). */
export interface DmTokenFacts {
  expiresAt: Date;
  revokedAt: Date | null;
  graceUntil: Date | null;
  /** Токен Админки (без организации): к организации его остановки не относятся. */
  admin: boolean;
  /** Состояние шаблона токена. */
  templateState: 'draft' | 'published' | 'off' | 'broken';
  /** У организации есть доступ к шаблону (у «Все организации» — всегда). */
  templateAccess: boolean;
  orgBlocked: boolean;
  /** Доступ закрыт по подписке (`OrgUsage.closed`). */
  subClosed: boolean;
  /** «Внешний доступ по API» организации (`org_settings.ext_api`). */
  extApi: boolean;
}

/**
 * Состояние токена (прототип `dmTokSt`): отозван; истёк — срок прошёл или кончились сутки после
 * перевыпуска; остановлен — шаблон выключен или сломан, организацию убрали из доступа шаблона,
 * организация заблокирована, доступ закрыт по подписке, внешний доступ выключен (по порядку
 * прототипа); иначе действует. Остановка снимается сама, когда причина ушла.
 */
export function dmTokenState(
  f: DmTokenFacts,
  now: Date,
): { state: DmTokenState; stop: DmTokenStop | null } {
  if (f.revokedAt) return { state: 'revoked', stop: null };
  const till = f.graceUntil && f.graceUntil < f.expiresAt ? f.graceUntil : f.expiresAt;
  if (till.getTime() <= now.getTime()) return { state: 'expired', stop: null };
  const stop: DmTokenStop | null =
    f.templateState === 'off' || f.templateState === 'draft'
      ? 'tpl_off'
      : f.templateState === 'broken'
        ? 'tpl_broken'
        : f.admin
          ? null
          : !f.templateAccess
            ? 'no_access'
            : f.orgBlocked
              ? 'org_blocked'
              : f.subClosed
                ? 'sub_closed'
                : !f.extApi
                  ? 'api_off'
                  : null;
  return stop ? { state: 'stopped', stop } : { state: 'active', stop: null };
}

/** Можно ли ещё отозвать или перевыпустить: не отозван и не истёк. */
export const dmTokenLive = (state: DmTokenState): boolean =>
  state === 'active' || state === 'stopped';

/** Почему нельзя выпустить токен (прототип `dmNewDlg`; ключи словаря `err.<код>`). */
export type DmTokenIssueRefusal =
  | 'dm_token_demo'
  | 'dm_token_no_right'
  | 'dm_token_api_off'
  | 'dm_token_sub_closed'
  | 'dm_token_limit';

/**
 * Что мешает выпуску, по порядку прототипа: демо-организация открыта всем; нет права «Управлять
 * API-токенами»; внешний доступ выключен; доступ закрыт по подписке; действующих уже 20. У Админки —
 * только предел.
 */
export function dmTokenIssueRefusal(o: {
  admin: boolean;
  demo: boolean;
  canTokens: boolean;
  extApi: boolean;
  subClosed: boolean;
  liveCount: number;
}): DmTokenIssueRefusal | null {
  if (!o.admin) {
    if (o.demo) return 'dm_token_demo';
    if (!o.canTokens) return 'dm_token_no_right';
    if (!o.extApi) return 'dm_token_api_off';
    if (o.subClosed) return 'dm_token_sub_closed';
  }
  return o.liveCount >= DM_TOKENS_LIVE_MAX ? 'dm_token_limit' : null;
}

/** Ошибка названия (прототип: «Введите название», «Токен с таким названием уже действует»). */
export function dmTokenNameProblem(
  name: string,
  liveNames: readonly string[],
): 'dm_token_name_required' | 'dm_token_name_long' | 'dm_token_name_taken' | null {
  const n = name.trim();
  if (!n) return 'dm_token_name_required';
  if (n.length > DM_TOKEN_NAME_MAX) return 'dm_token_name_long';
  return liveNames.includes(n) ? 'dm_token_name_taken' : null;
}

/*
 * Сообщения владельцам организации о токене — Telegram и колокольчик (блок 5, пункт 10; общий план 20.11,
 * этап 3, П5; прототип v158 `dmTell`, `dmDaily`): создан (выпуск и перевыпуск), отозван (и администратором
 * платформы), до конца срока 7 дней. Что и когда сказать — здесь; кому и куда — модуль telegram API.
 */

/** Что сообщается владельцам (шаблоны `tgDmTok*`). */
export const DM_TOKEN_EVENTS = ['new', 'revoked', 'soon'] as const;
export type DmTokenEvent = (typeof DM_TOKEN_EVENTS)[number];

/** Шаблон сообщения бота по событию. */
export const DM_TOKEN_EVENT_TEMPLATES = {
  new: 'tgDmTokNew',
  revoked: 'tgDmTokRevoked',
  soon: 'tgDmTokSoon',
} as const satisfies Record<DmTokenEvent, string>;

/** За сколько дней до конца срока напоминать (блок 5, пункт 10). */
export const DM_TOKEN_SOON_DAYS = 7;

/**
 * Сколько дней до конца срока, если сегодня (по Бишкеку) — время напомнить: от 1 до 7 дней. Токен на
 * 7 дней и короче не напоминает: срок уже есть в сообщении «создан», а напоминание пришло бы в день
 * выпуска (прототип `dmDaily`). Отозванный, истёкший и перевыпущенный отсекает вызывающий.
 */
export function dmTokenSoonDays(t: { createdAt: Date; expiresAt: Date }, now: Date): number | null {
  if (dmTokenTermOf(t.createdAt, t.expiresAt) <= DM_TOKEN_SOON_DAYS) return null;
  if (t.expiresAt.getTime() <= now.getTime()) return null;
  const days = diffDays(bishkekDate(t.expiresAt), bishkekDate(now));
  return days >= 1 && days <= DM_TOKEN_SOON_DAYS ? days : null;
}

/** Событие для владельцев: что случилось и данные токена. */
export type DmTokenNotice =
  | { event: 'new'; org: string; name: string; template: string; expiresAt: Date; who: string }
  | { event: 'revoked'; org: string; name: string; template: string; who: string }
  | { event: 'soon'; org: string; name: string; template: string; expiresAt: Date; days: number };

/** Подстановки шаблона `tgDmTok*` (прототип v158 `dmTell`): «Действует до» — день по Бишкеку. */
export function dmTokenNoticeValues(n: DmTokenNotice): Record<string, string | number> {
  const base = { организация: n.org, название: n.name, шаблон: n.template };
  switch (n.event) {
    case 'new':
      return { ...base, дата: formatDateRu(bishkekDate(n.expiresAt)), кто: n.who };
    case 'revoked':
      return { ...base, кто: n.who };
    case 'soon':
      return { ...base, дата: formatDateRu(bishkekDate(n.expiresAt)), дней: n.days };
  }
}
