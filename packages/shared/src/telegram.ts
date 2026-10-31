import { NOTIFY_KINDS, NOTIFY_MODES } from '@buhuchet/domain';
import { z } from 'zod';
import { RecordVersion } from './common';

/** Привязанный Telegram: «@имя» (или имя в Telegram) и когда привязан. */
export const TelegramInfo = z.object({
  name: z.string(),
  linkedAt: z.iso.datetime(),
});
export type TelegramInfo = z.infer<typeof TelegramInfo>;

/** Адрес без логина и порта (проверка идёт и для строки, которая уже не прошла z.url()). */
function withoutLoginAndPort(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

/**
 * Одноразовая ссылка привязки Telegram из «Мой профиль» (прототип modules/profile.js): t.me/бот?start=…,
 * действует 15 минут; бот проверит её, привяжет чат и пришлёт подтверждение.
 */
export const TelegramLinkResponse = z.object({
  // Только https://t.me/… без логина и порта: экран вставляет ссылку в href.
  url: z.url({ protocol: /^https$/, hostname: /^t\.me$/ }).refine(withoutLoginAndPort),
  expiresAt: z.iso.datetime(),
});
export type TelegramLinkResponse = z.infer<typeof TelegramLinkResponse>;

/**
 * «Уведомления в Telegram» в «Мой профиль» (задача 2.25; прототип modules/profile.js — `notifyBox`):
 * режим (только владельцу и главному бухгалтеру) и отключённые переключатели. `boss` — показывать ли
 * режим и переключатели по отчётам других сотрудников; версия 0 — настройки ещё не сохранялись.
 */
export const NotifySettingsResponse = z.object({
  boss: z.boolean(),
  mode: z.enum(NOTIFY_MODES),
  off: z.array(z.enum(NOTIFY_KINDS)),
  version: RecordVersion,
});
export type NotifySettingsResponse = z.infer<typeof NotifySettingsResponse>;

export const NotifySettingsRequest = z.strictObject({
  version: RecordVersion,
  mode: z.enum(NOTIFY_MODES),
  off: z.array(z.enum(NOTIFY_KINDS)).max(NOTIFY_KINDS.length),
});
export type NotifySettingsRequest = z.infer<typeof NotifySettingsRequest>;
