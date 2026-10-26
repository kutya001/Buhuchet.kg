import {
  LOGIN_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PERMISSION_IDS,
  RESET_CODE_LENGTH,
  SCOPE_GROUPS,
  SCOPES,
  type PermissionId,
  type ScopeGroupId,
} from '@buhuchet/domain';
import { z } from 'zod';
import { Uuid } from './common';
import { FeatureSchema, MenuModuleIdSchema } from './org';
import { TelegramInfo } from './telegram';

/** Вход по логину и паролю (без почты). Логин сравнивается без учёта регистра. */
export const LoginRequest = z.object({
  login: z.string().trim().min(1).max(LOGIN_MAX_LENGTH),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** Смена своего пароля: текущий и новый (не короче 8 символов). Повтор нового сверяет форма. */
export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

export const PermissionIdSchema = z.enum(PERMISSION_IDS as [PermissionId, ...PermissionId[]]);
export const ScopeGroupIdSchema = z.enum(SCOPE_GROUPS as [ScopeGroupId, ...ScopeGroupId[]]);

/**
 * Кто вошёл (ответ входа и GET /api/auth/me). У администратора платформы нет сотрудника, организации
 * и прав в организации. permissions — действующие права, scopes — область каждой группы, features —
 * функции учётной политики, modules — модули меню сотрудника по функциям и правам.
 */
export const MeResponse = z.object({
  user: z.object({
    id: Uuid,
    login: z.string(),
    isPlatformAdmin: z.boolean(),
    /** Вошёл с временным паролем: пока не сменит, остальные методы отвечают 403. */
    mustChangePassword: z.boolean(),
  }),
  employee: z
    .object({
      id: Uuid,
      fullName: z.string(),
      shortName: z.string(),
      roleId: Uuid,
      roleName: z.string(),
      isOwner: z.boolean(),
    })
    .nullable(),
  organization: z.object({ id: Uuid, name: z.string(), slug: z.string() }).nullable(),
  /** Привязанный Telegram; null — не привязан (напоминания не приходят, «Забыли пароль?» не работает). */
  telegram: TelegramInfo.nullable(),
  permissions: z.array(PermissionIdSchema),
  scopes: z.partialRecord(ScopeGroupIdSchema, z.enum(SCOPES)),
  features: z.partialRecord(FeatureSchema, z.boolean()),
  modules: z.array(MenuModuleIdSchema),
});
export type MeResponse = z.infer<typeof MeResponse>;

/** «Забыли пароль?», шаг 1: логин — бот пришлёт код в привязанный Telegram. */
export const PasswordResetRequest = z.object({
  login: z.string().trim().min(1).max(LOGIN_MAX_LENGTH),
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequest>;

/**
 * «Забыли пароль?», шаг 1: один ответ для любого логина — пришлёт ли бот код, не сообщается
 * (docs/deviations.md, п. 4, решение Б).
 */
export const PasswordResetRequestedResponse = z.object({ message: z.string() });
export type PasswordResetRequestedResponse = z.infer<typeof PasswordResetRequestedResponse>;

/** «Забыли пароль?», шаг 2: код из Telegram и новый пароль. Повтор нового пароля сверяет форма. */
export const PasswordResetConfirmRequest = z.object({
  login: z.string().trim().min(1).max(LOGIN_MAX_LENGTH),
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${RESET_CODE_LENGTH}}$`)),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequest>;

/** Пароль сброшен владельцем или администратором: временный пароль показывается один раз. */
export const TemporaryPasswordResponse = z.object({
  temporaryPassword: z.string(),
  /** Бот сообщил о смене пароля в привязанный Telegram. */
  telegramNotified: z.boolean(),
});
export type TemporaryPasswordResponse = z.infer<typeof TemporaryPasswordResponse>;

/** Ответ без данных: выход, смена пароля. */
export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;
