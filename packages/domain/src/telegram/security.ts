import type { UiTextKey } from '../l10n/texts';
import type { BotMessage } from './bot-message';
import type { OutboxKind } from './notify';
import type { TelegramTemplateKey } from './messages';

/*
 * «Это не я» под сообщениями бота о безопасности (поток Т, задача Т4; прототип v101
 * `modules/tg-security.js`; пакет заказчика 13.11.2026, идея 9). Кнопка стоит под тремя сообщениями:
 * «Пароль изменён» (в привязанный чат), «Привязан другой Telegram» и «Telegram отвязан» (оба — в
 * прежний чат). Нажатие завершает все сеансы учётной записи и закрывает вход, пока владелец
 * организации (владельцу — администратор платформы) не выдаст новый пароль; у администратора
 * платформы вход не закрывается — выдать ему пароль некому.
 */

/** Код действия кнопки. */
export const NOT_ME_ACTION = 'notMe';

/** Кнопка действует столько часов после сообщения (прототип `TG_NOTME_H`). */
export const NOT_ME_HOURS = 24;

/** Под каким сообщением стоит кнопка: пароль изменён, привязан другой Telegram, Telegram отвязан. */
export const SECURITY_NOTICES = ['pass', 'relink', 'unlink'] as const;
export type SecurityNotice = (typeof SECURITY_NOTICES)[number];

/** Шаблон сообщения, вид строки журнала отправок и ключ словаря «события словами» (прототип `TG_SEC`). */
export const SECURITY_NOTICE_DEFS: Readonly<
  Record<SecurityNotice, { template: TelegramTemplateKey; kind: OutboxKind; event: UiTextKey }>
> = {
  pass: { template: 'tgPassChanged', kind: 'pass_changed', event: 'telegram.notme.event.pass' },
  relink: { template: 'tgRelinked', kind: 'relinked', event: 'telegram.notme.event.relink' },
  unlink: { template: 'tgUnlinked', kind: 'unlinked', event: 'telegram.notme.event.unlink' },
};

const isNotice = (x: string): x is SecurityNotice =>
  (SECURITY_NOTICES as readonly string[]).includes(x);

/**
 * Запись кнопки: вид сообщения и момент отправки (секунды) — по нему считается срок действия. Данные
 * нажатия сами ничего не решают: бот сверяет их с отправленным сообщением, поэтому подставить другой
 * момент нельзя. `inert` — кнопка только объясняет, что делать: сообщение ушло, пока после сброса
 * пароля владельцем или администратором платформы прежнему чату доверять нельзя (временный пароль,
 * разрешение привязать Telegram без кода, привязка по такому разрешению).
 */
export function notMeArg(notice: SecurityNotice, sentAt: Date, inert = false): string {
  return `${notice}.${Math.floor(sentAt.getTime() / 1000)}${inert ? '.x' : ''}`;
}

/** Разобрать запись кнопки; null — не наша. */
export function parseNotMeArg(
  arg: string | null,
): { notice: SecurityNotice; sentAt: Date; inert: boolean } | null {
  const m = /^([a-z]+)\.(\d{1,12})(\.x)?$/.exec(arg ?? '');
  if (!m || !isNotice(m[1]!)) return null;
  return { notice: m[1], sentAt: new Date(Number(m[2]) * 1000), inert: m[3] !== undefined };
}

/** Кнопка нажата позже срока: бот советует попросить сброс пароля. */
export function notMeLate(sentAt: Date, now: Date): boolean {
  return now.getTime() - sentAt.getTime() > NOT_ME_HOURS * 3600_000;
}

/** Сообщение о безопасности с кнопкой «Это не я» (прототип `tgSecMsg`). */
export function securityBotMessage(
  text: string,
  notice: SecurityNotice,
  sentAt: Date,
  label: string,
  inert = false,
): BotMessage {
  return {
    text,
    buttons: [[{ text: label, action: NOT_ME_ACTION, arg: notMeArg(notice, sentAt, inert) }]],
  };
}
