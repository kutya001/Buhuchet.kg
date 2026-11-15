import type { Tyiyn } from '../common/money';
import { isYearMonth, type YearMonth } from '../common/months';
import { FILE_MAX_BYTES } from '../files/files';
import { SENT_FILE_COMMENT_MAX } from '../files/sent-files';
import type { ReportAct } from '../platform-dicts/catalog';
import type { IsoDate } from '../common/dates';
import type { PayClaimPurpose } from './pay-claims';
import { cpReceiptFileOk } from './telegram-receipt';

/*
 * Страница контрагента: оплата по месяцам, «Я оплатил» и код в Telegram (доработки 14.11.2026, блок 6,
 * этап 3, поток К; прототип v116 modules/cp-paid.js). Это не онлайн-оплата: клиент переводит деньги в
 * своём банке или кошельке по реквизитам из «Как оплатить», а бухгалтер подтверждает получение.
 * «Оплачено» считается только по принятым деньгам; пока клиент сообщил об оплате, а деньги не приняты, —
 * «Ожидает подтверждения».
 */

/** Пометка оплаты месяца (прототип `PG_MPAY`): оплачено, ожидает подтверждения, частично, не оплачено. */
export const PAGE_MONTH_PAY_STATUSES = ['paid', 'wait', 'partial', 'unpaid'] as const;
export type PageMonthPayStatus = (typeof PAGE_MONTH_PAY_STATUSES)[number];

/** Отчёт месяца для оплаты: сумма к уплате, оплачено в бюджет и получено от клиента под него. */
export interface PageMonthPayReport {
  id: string;
  act: ReportAct;
  /** К уплате; `null` — ещё не рассчитана. */
  amount: Tyiyn | null;
  paid: Tyiyn;
  /** Получено от контрагента под этот отчёт (сверка денег на налоги). */
  received: Tyiyn;
  payDue: IsoDate | null;
}

/** Отчёт с остатком к оплате — строка окна «Перечислить». */
export interface PageMonthPayRow {
  id: string;
  left: Tyiyn;
  payDue: IsoDate | null;
}

/** Оплата месяца для клиента (прототип `pgMonthPay`). */
export interface PageMonthPay {
  month: YearMonth;
  sum: Tyiyn;
  got: Tyiyn;
  left: Tyiyn;
  /** Нечего оплачивать (сумм нет) — `null`. */
  status: PageMonthPayStatus | null;
  rows: PageMonthPayRow[];
}

/**
 * Оплата месяца (прототип `pgMonthPay`): «к оплате» — суммы налогов месяца, «оплачено» — что бухгалтер
 * принял от клиента под отчёты месяца или уже уплатил в бюджет, не больше суммы отчёта, «осталось» —
 * разница. `waiting` — клиент сообщил об оплате этого месяца, а деньги ещё не приняты.
 */
export function pageMonthPay(
  month: YearMonth,
  reports: readonly PageMonthPayReport[],
  waiting: boolean,
): PageMonthPay {
  let sum = 0;
  let got = 0;
  const rows: PageMonthPayRow[] = [];
  for (const r of reports) {
    if (r.act === 'sub' || r.amount === null || r.amount <= 0) continue;
    const g = Math.min(r.amount, Math.max(r.paid, r.received));
    sum += r.amount;
    got += g;
    if (r.amount - g > 0) rows.push({ id: r.id, left: r.amount - g, payDue: r.payDue });
  }
  // Без срока оплаты — первыми, как в прототипе (`(a.payDue||'') < (b.payDue||'')`).
  rows.sort((a, b) => (a.payDue ?? '').localeCompare(b.payDue ?? ''));
  const left = sum - got;
  const status: PageMonthPayStatus | null =
    sum <= 0 ? null : left <= 0 ? 'paid' : waiting ? 'wait' : got > 0 ? 'partial' : 'unpaid';
  return { month, sum, got, left, status, rows };
}

/** Месяцы с остатком к оплате — от старых к новым (прототип `pgOpenMonths`, «За какой месяц»). */
export function pageOpenMonths(months: readonly PageMonthPay[]): PageMonthPay[] {
  return months.filter((m) => m.left > 0).sort((a, b) => a.month.localeCompare(b.month));
}

/* ---------- «Я оплатил» ---------- */

/** Сумма «Я оплатил» — не больше миллиарда сомов (прототип: «Слишком большая сумма»). */
export const PAGE_PAID_MAX: Tyiyn = 100_000_000_000;

/** Что не так в «Я оплатил»: поле и код текста (`pub.paid.err.<код>`). */
export type PagePaidProblem =
  | { field: 'sum'; code: 'sum' | 'sum_big' }
  | { field: 'month'; code: 'month' }
  | { field: 'file'; code: 'file' | 'file_type' | 'file_big' };

/**
 * Проверка «Я оплатил» (прототип `pubPaidDlg`): сумма больше нуля, чек обязателен — фото или PDF до
 * 20 МБ; месяц — из `months` (за что можно сообщить об оплате) или без месяца. Тот же порядок — на
 * экране и на сервере.
 */
export function pagePaidProblems(o: {
  amount: number;
  month: YearMonth | null;
  months: readonly YearMonth[];
  file: { name: string; size: number } | null;
}): PagePaidProblem[] {
  const out: PagePaidProblem[] = [];
  if (!Number.isSafeInteger(o.amount) || o.amount <= 0) out.push({ field: 'sum', code: 'sum' });
  else if (o.amount > PAGE_PAID_MAX) out.push({ field: 'sum', code: 'sum_big' });
  if (o.month !== null && (!isYearMonth(o.month) || !o.months.includes(o.month))) {
    out.push({ field: 'month', code: 'month' });
  }
  if (!o.file) out.push({ field: 'file', code: 'file' });
  else if (!cpReceiptFileOk(o.file.name)) out.push({ field: 'file', code: 'file_type' });
  else if (o.file.size > FILE_MAX_BYTES) out.push({ field: 'file', code: 'file_big' });
  return out;
}

/**
 * Комментарий чека в «Отправленных файлах» (прототип: «Чек: налоги, 5 000 сом. <комментарий>»): `head`
 * — «Чек: налоги за сентябрь 2026» текстом словаря (без суммы, docs/deviations.md п. К-14); всё вместе —
 * не длиннее комментария отправленного файла.
 */
export function pagePaidSentNote(head: string, comment: string | null): string {
  const text = comment ? `${head}. ${comment}` : head;
  return text.slice(0, SENT_FILE_COMMENT_MAX);
}

/** Месяц по умолчанию в «Я оплатил»: самый старый с остатком (налоги) или с долгом (обслуживание). */
export function pagePaidMonth(
  purpose: PayClaimPurpose,
  o: { taxOpen: readonly YearMonth[]; feeOpen: readonly YearMonth[] },
): YearMonth | null {
  const list = [...(purpose === 'tax' ? o.taxOpen : o.feeOpen)].sort();
  return list[0] ?? null;
}

/* ---------- Код через Telegram ---------- */

/**
 * «Забыли код? Прислать в Telegram» и команда бота «Код от страницы» (прототип v116 `PG_CODE_TG`):
 * не больше 3 раз за сутки на страницу — по ссылке и командой вместе.
 */
export const PAGE_CODE_TG_MAX = 3;
export const PAGE_CODE_TG_WINDOW_HOURS = 24;

/** Итог «Забыли код?» (прототип `pubForgot`): отправлен, Telegram не подключён, предел, страница закрыта. */
export const PAGE_FORGOT_OUTCOMES = ['sent', 'none', 'limit', 'closed'] as const;
export type PageForgotOutcome = (typeof PAGE_FORGOT_OUTCOMES)[number];

/** Как отправлен код (прототип `pgCodeSend`, `via`): ссылкой «Забыли код?» на странице или командой бота. */
export const PAGE_CODE_VIA = ['page', 'cmd'] as const;
export type PageCodeVia = (typeof PAGE_CODE_VIA)[number];

/** Команда бота «Код от страницы» в меню Telegram клиента (прототип v116 `title="/code"`). */
export const PAGE_CODE_SLASH = 'code';

/**
 * Команда «Код от страницы» из текста сообщения клиента: «/code», «/code@имя_бота» или подпись кнопки
 * меню (шаблон `tgCmdCpCode`). Регистр не важен.
 */
export function isPageCodeCommand(text: string, label: string): boolean {
  const said = text.trim();
  const slash = /^\/([a-z]+)(?:@[A-Za-z0-9_]+)?$/i.exec(said)?.[1];
  if (slash) return slash.toLowerCase() === PAGE_CODE_SLASH;
  return said !== '' && said.toLowerCase() === label.trim().toLowerCase();
}
