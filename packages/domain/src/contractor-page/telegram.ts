/*
 * Telegram контрагента (доработки 13.11.2026, задача К3; прототип v92 modules/cp-telegram.js): клиент
 * сам подключает свой Telegram к боту на странице контрагента, подключение подтверждает организация.
 * Здесь — правила без базы и сети: статусы, пределы, имя в Telegram, разбор ссылки и команды клиента.
 */

/** Статусы строки (прототип PG_TG_ST): ждёт подтверждения, подключён, отклонён, отключён. */
export const CP_TG_STATUSES = ['wait', 'on', 'no', 'off'] as const;
export type CpTgStatus = (typeof CP_TG_STATUSES)[number];

/** Мест у контрагента: подключённые и ждущие подтверждения считаются вместе (прототип PG_TG_MAX). */
export const CP_TG_MAX = 5;
/** Ссылка «Подключить Telegram» действует 24 часа и один раз (прототип PG_TG_TTL_H). */
export const CP_TG_LINK_TTL_HOURS = 24;
/** Сколько неиспользованных ссылок одного контрагента действует одновременно: кнопку не «накликать». */
export const CP_TG_MAX_TOKENS = 5;
/** Имя в Telegram в списке и сообщениях — не длиннее 32 знаков (прототип pgTgRequest). */
export const CP_TG_NAME_MAX = 32;

/**
 * Параметр ссылки t.me/бот?start=cp_<токен>: приставка отличает ссылку страницы контрагента от ссылки
 * привязки Telegram сотрудника. Telegram допускает в параметре до 64 знаков A–Z, a–z, 0–9, _ и -.
 */
export const CP_TG_START_PREFIX = 'cp_';

/** Токен из параметра «/start cp_<токен>»; null — это не ссылка страницы контрагента. */
export function cpTgStartToken(payload: string | null): string | null {
  if (!payload?.startsWith(CP_TG_START_PREFIX)) return null;
  const token = payload.slice(CP_TG_START_PREFIX.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/**
 * Имя в Telegram для списка «Telegram контрагента» и сообщений сотруднику. Его задаёт клиент, поэтому
 * оно идёт одной строкой, без невидимых и управляющих знаков (смена направления текста) и не длиннее
 * 32 знаков — не выдать за текст бота. Режется по знакам, а не по половинкам UTF-16. «@» в начале — только
 * у настоящего логина: имя без логина, написанное как «@ivanov», не выдать за логин клиента.
 */
export function cpTgName(from: { username?: string | null; firstName?: string | null }): string {
  const raw = from.username
    ? `@${from.username}`
    : (from.firstName ?? '').replace(/^[\s@＠﹫]+/u, '');
  const chars = [
    ...raw
      // Соединитель эмодзи (U+200D) остаётся, иначе составной эмодзи распался бы на части.
      .replace(/(?!‍)[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ];
  if (chars.length === 0) return 'Telegram';
  return chars.length > CP_TG_NAME_MAX
    ? `${chars.slice(0, CP_TG_NAME_MAX - 1).join('')}…`
    : chars.join('');
}

/** Решение сотрудника: подтвердить, отклонить, отключить (прототип pgTgDecide: ok, no, off). */
/**
 * Коды действий кнопок «Подтвердить» и «Отклонить» под сообщением бота сотруднику о запросе (задача
 * К5; прототип `cptg-ok`, `cptg-no`): действия сотрудника — в реестре `BOT_ACTIONS`.
 */
export const CP_TG_OK_ACTION = 'cptgOk';
export const CP_TG_NO_ACTION = 'cptgNo';

export const CP_TG_ACTIONS = ['approve', 'reject', 'unlink'] as const;
export type CpTgAction = (typeof CP_TG_ACTIONS)[number];

/** Каким становится статус после решения. */
export const CP_TG_ACTION_STATUS: Record<CpTgAction, CpTgStatus> = {
  approve: 'on',
  reject: 'no',
  unlink: 'off',
};

/** Отказ решению сотрудника. */
export type CpTgRefusal = 'cp_tg_not_on' | 'cp_tg_done' | 'cp_tg_limit' | 'cp_tg_section_off';

/**
 * Что мешает решению сотрудника (прототип pgTgWhy): код отказа — ключ словаря `err.<код>`.
 * `connected` — сколько Telegram уже подключено к контрагенту.
 */
export function cpTgActionRefusal(
  status: CpTgStatus,
  action: CpTgAction,
  connected: number,
): CpTgRefusal | null {
  if (action === 'unlink') return status === 'on' ? null : 'cp_tg_not_on';
  if (status !== 'wait') return 'cp_tg_done';
  if (action === 'approve' && connected >= CP_TG_MAX) return 'cp_tg_limit';
  return null;
}

/** Тексты отказов (прототип pgTgWhy, pgTgPub): те же строки у сервера и в словаре `err.<код>`. */
export const CP_TG_MESSAGES = {
  cp_tg_done: 'Запрос уже рассмотрен',
  cp_tg_not_on: 'Telegram уже не подключён',
  cp_tg_limit: `Уже подключено ${CP_TG_MAX} Telegram: сначала отключите лишний`,
  cp_tg_section_off:
    'Раздел «Telegram» на странице контрагента сейчас не показан: подключить нельзя',
  cp_tg_full: `Подключено или ждёт подтверждения ${CP_TG_MAX} Telegram — больше нельзя. Попросите вашего бухгалтера отключить лишний`,
  cp_tg_link_limit: 'Слишком много попыток. Попробуйте через час',
} as const;

/** Порядок строк списка (прототип pgTgBox): ждущие, подключённые, остальные; внутри — новые сверху. */
export function cpTgOrder<T extends { status: CpTgStatus; requestedAt: string }>(rows: T[]): T[] {
  const rank = (s: CpTgStatus) => (s === 'wait' ? 0 : s === 'on' ? 1 : 2);
  return [...rows].sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      (a.requestedAt < b.requestedAt ? 1 : a.requestedAt > b.requestedAt ? -1 : 0),
  );
}

/**
 * Команда клиента «Отключить» в боте (прототип pgTgLeave). С номером — «Отключить 2»: когда Telegram
 * подключён к нескольким контрагентам, бот присылает их список с номерами. null — это не команда.
 */
export function cpTgLeaveCommand(text: string): { index: number | null } | null {
  const match = /^\/?отключить(?:\s+(\d{1,2}))?$/iu.exec(text.trim());
  if (!match) return null;
  return { index: match[1] ? Number(match[1]) : null };
}
