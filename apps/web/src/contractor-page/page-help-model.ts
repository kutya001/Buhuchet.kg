import {
  STATUS_SCALE_DEFS,
  type CpHelpView,
  type CpTourSec,
  type StatusTone,
} from '@buhuchet/domain';
import type { PublicPageBody } from '@buhuchet/shared';
import type { IconName } from '@buhuchet/ui';

/*
 * Правила подсказок открытой страницы контрагента без React (прототип v120 modules/cp-help.js): что
 * сейчас видно на странице, что подсвечивает облачко обзора, куда прокрутить, «Добро пожаловать» один
 * раз в этом браузере и метки «Что значат цвета у отчётов?».
 */

/**
 * Что видно на странице (прототип v135 `cphVis`, `cphSec`): показанные разделы и их части — `money`
 * (расчёт «Не хватает» в строке «Налоги» «Оплаты»), `fee` (строка «Услуги бухгалтера»), `tg` (Telegram
 * в «Связи»), счета для оплаты, «Я оплатил», «Отправить файл», места для Telegram и можно ли прислать
 * код в Telegram.
 */
export function pageHelpView(
  page: PublicPageBody,
  sections: Iterable<string>,
  o: { paid: boolean },
): CpHelpView {
  const shown = new Set(sections);
  const pay = shown.has('pay');
  if (pay && page.money) shown.add('money');
  if (pay && page.fee) shown.add('fee');
  if (page.telegram) shown.add('tg');
  const payTax = pay && !!page.pay?.tax;
  const payFee = pay && !!page.fee && !!page.pay?.fee;
  return {
    sections: shown,
    payTax,
    payFee,
    paid: o.paid && (payTax || payFee),
    up: !!page.sent?.upload && shown.has('files'),
    tgFull: !!page.telegram?.full,
    // Код уходит только в подтверждённые чаты, пока раздел «Telegram» действует (прототип `pgCodeTo`).
    code: (page.telegram?.on ?? 0) > 0,
  };
}

/**
 * Что подсвечивает облачко (прототип v135 `CPH_EL`, `cphElSel`): «Что нужно сделать», кнопка «?» (на
 * телефоне — «Помощь» нижнего меню), раздел; у «Оплаты» на телефоне — первая строка, чтобы облачко
 * внизу её не закрывало. «Готово!» — ничего.
 */
export function tourTargetSelector(sec: CpTourSec, phone: boolean): string | null {
  if (sec === 'end') return null;
  if (sec === 'state') return '[data-pub-state]';
  if (sec === 'help') return phone ? '[data-pub-nav="help"]' : '[data-pub-help]';
  if (sec === 'pay' && phone) return '#pub-pay [data-po]';
  return `#pub-${sec}`;
}

/**
 * Раздел, который обзор раскрывает на телефоне на своём шаге (прототип `pubFold(p.sec, true)`):
 * «Оплата» не сворачивается.
 */
export function tourUnfolds(sec: CpTourSec): boolean {
  return sec !== 'end' && sec !== 'state' && sec !== 'help' && sec !== 'pay';
}

/**
 * Куда прокрутить страницу к облачку (прототип `cphTourShow`): на телефоне и у высокого элемента — верх
 * элемента у верха экрана, иначе элемент посередине места над облачком.
 */
export function tourScrollTop(
  rect: { top: number; height: number },
  scrollY: number,
  viewHeight: number,
  phone: boolean,
): number {
  const bubble = phone ? Math.min(260, viewHeight * 0.45) : 0;
  const room = viewHeight - bubble - 24;
  const off = rect.height > room || phone ? 12 : Math.max(12, (room - rect.height) / 2);
  return Math.max(0, scrollY + rect.top - off);
}

/** «Добро пожаловать» уже показано в этом браузере для этой страницы (прототип `pgwel`). */
export const WELCOME_COOKIE = 'bh_pgwel';

export function welcomeSeen(cookies: string): boolean {
  return cookies
    .split(';')
    .map((part) => part.trim())
    .some((part) => part === `${WELCOME_COOKIE}=1`);
}

/**
 * Отметка «Добро пожаловать» показано: только под адресом этой страницы — у другой страницы своя, на
 * год (прототип запоминает в браузере навсегда, отдельно от кода, который живёт 1 день).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-16
export function welcomeCookie(address: { slug: string; inn: string }, secure: boolean): string {
  const path = `/${encodeURIComponent(address.slug)}/inn/${encodeURIComponent(address.inn)}`;
  return `${WELCOME_COOKIE}=1; Path=${path}; Max-Age=${365 * 24 * 60 * 60}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/**
 * Метка строки «Что значат цвета у отчётов?» (прототип `CPH_PILL`): название статуса отчёта — его цвет
 * и значок; «Впереди» — синяя с часами, «Просрочен» и «Просрочено» — красная; остальное — серая.
 */
export function legendLook(
  label: string,
  names: { status: (code: string) => string; ahead: readonly string[]; late: readonly string[] },
): { tone: StatusTone; icon: IconName } {
  const look = STATUS_SCALE_DEFS.report.look;
  for (const code of Object.keys(look)) {
    if (names.status(code) === label) {
      const l = look[code]!;
      return { tone: l.tone, icon: l.icon as IconName };
    }
  }
  if (names.ahead.includes(label)) return { tone: 'blue', icon: 'clock' };
  if (names.late.includes(label)) return { tone: 'red', icon: 'alert' };
  return { tone: 'gray', icon: 'circle' };
}
