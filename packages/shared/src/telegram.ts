import {
  BELL_KINDS,
  NOTIFY_KINDS,
  NOTIFY_MODES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordVersion } from './common';

/** Привязанный Telegram: «@имя» (или имя в Telegram) и когда привязан. */
export const TelegramInfo = z.object({
  name: z.string(),
  linkedAt: z.iso.datetime(),
  /** «Сообщения простым текстом» — только в «кто я» (свой профиль). */
  plain: z.boolean().optional(),
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

/** «Сообщения простым текстом» в «Мой профиль» (поток Т, задача Т1): без таблиц и раскрывающихся разделов. */
export const TelegramPlainRequest = z.strictObject({ plain: z.boolean() });
export type TelegramPlainRequest = z.infer<typeof TelegramPlainRequest>;

/**
 * «Общий чат фирмы в Telegram» в «Моя организация» → «Настройки» (поток Т, задача Т8; прототип v105
 * modules/tg-group.js): подключённая группа или null; `canEdit` — владелец (право «Настройки и учётная
 * политика»); `bot` — бот подключён к платформе (без него ссылку не создать).
 */
export const TelegramGroupResponse = z.object({
  group: z
    .object({
      title: z.string(),
      linkedByName: z.string().nullable(),
      linkedAt: z.iso.datetime(),
      summary: z.boolean(),
      gone: z.boolean(),
      version: z.number().int().positive(),
    })
    .nullable(),
  /** «Время сводки» учётной политики (ЧЧ:ММ): сводка в группу уходит вместе с напоминаниями за день. */
  time: z.string(),
  canEdit: z.boolean(),
  bot: z.boolean(),
});
export type TelegramGroupResponse = z.infer<typeof TelegramGroupResponse>;

/** Ссылка подключения группы: t.me/бот?startgroup=g_…, одноразовая, 15 минут. */
export const TelegramGroupLinkResponse = TelegramLinkResponse;
export type TelegramGroupLinkResponse = TelegramLinkResponse;

/** «Сводка дня в группу» — включить или выключить, с версией записи. */
export const TelegramGroupSummaryRequest = z.strictObject({
  version: z.number().int().positive(),
  summary: z.boolean(),
});
export type TelegramGroupSummaryRequest = z.infer<typeof TelegramGroupSummaryRequest>;

/** «Отключить группу» с версией записи. */
export const TelegramGroupUnlinkRequest = z.strictObject({ version: z.number().int().positive() });
export type TelegramGroupUnlinkRequest = z.infer<typeof TelegramGroupUnlinkRequest>;

/*
 * Страница «Задать пароль» по ссылке из Telegram (доработки 14.11.2026, блок 1; прототип v113
 * setPassPage): без входа. Ключ — в пути; пароль — по тем же правилам, что при смене временного.
 */
export const PasswordSetupParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const PasswordSetupInfo = z.object({ login: z.string(), organization: z.string() });
export type PasswordSetupInfo = z.infer<typeof PasswordSetupInfo>;
export const PasswordSetupRequest = z.strictObject({
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type PasswordSetupRequest = z.infer<typeof PasswordSetupRequest>;
export const PasswordSetupDone = z.object({ ok: z.literal(true), login: z.string() });
export type PasswordSetupDone = z.infer<typeof PasswordSetupDone>;

/*
 * Колокольчик уведомлений (доработки 16.11.2026, блок 3; поток Т): ответы панели. Экран — поток И
 * (стык — /mnt/project-files/stream-t/bell-contract.md).
 */

/** Кнопка-фильтр панели: «Все» и виды строк («Другое» — только во «Все»). */
export const BellTab = z.enum(['all', 'reports', 'tasks', 'files', 'money', 'news']);
export type BellTab = z.infer<typeof BellTab>;

export const BellQuery = z.object({
  tab: BellTab.default('all'),
  /** Номер последней показанной строки — «Показать ещё». */
  before: z.uuid().optional(),
});
export type BellQuery = z.infer<typeof BellQuery>;

/** Строка колокольчика: что случилось, контрагент (имя — сейчас), когда, прочитана, что открыть. */
export const BellItem = z.object({
  id: z.uuid(),
  kind: z.enum(BELL_KINDS),
  event: z.string(),
  contractor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  text: z.string(),
  at: z.iso.datetime(),
  read: z.boolean(),
  /** Что открыть по нажатию; незнакомый вид панель показывает без перехода. */
  open: z.object({ kind: z.string(), id: z.string() }).nullable(),
});
export type BellItem = z.infer<typeof BellItem>;

export const BellPage = z.object({ items: z.array(BellItem), more: z.boolean() });
export type BellPage = z.infer<typeof BellPage>;

/**
 * Значок колокольчика: `unseen` — непросмотренные рабочие уведомления (красное число), `news` —
 * непросмотренные новости версий (серая точка, когда рабочих нет; прототип v138).
 */
export const BellCount = z.object({
  unseen: z.number().int().nonnegative(),
  news: z.number().int().nonnegative(),
});
export type BellCount = z.infer<typeof BellCount>;

export const BellReadParams = z.object({ id: z.uuid() });
export const BellDone = z.object({ ok: z.literal(true) });
