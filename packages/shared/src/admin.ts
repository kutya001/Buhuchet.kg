import {
  ACCOUNT_STATUSES,
  FULL_NAME_MAX_LENGTH,
  isValidLogin,
  isValidOrgInn,
  LOGIN_MAX_LENGTH,
  normalizeLogin,
  ORG_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type UiTextKey,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordAudit, RecordVersion, Uuid } from './common';
import { listPageSchema } from './list';

/**
 * Организация в Админке → «Организации» (ТЗ «Админка» → «Модуль организаций»; прототип
 * admin/accounts-orgs.js, renderOrgs): название, ИНН, логин владельца, адрес страницы, контрагентов и
 * активных сотрудников, статус. Дата регистрации — `audit.createdAt`.
 */
export const AdminOrganization = z.object({
  id: Uuid,
  name: z.string(),
  inn: z.string().nullable(),
  slug: z.string(),
  /** null — у организации ещё нет владельца (не бывает у созданной Админкой). */
  ownerLogin: z.string().nullable(),
  /** Контрагентов — появится с модулем «Контрагенты»; пока 0. */
  contractors: z.number().int().nonnegative(),
  /** Активных сотрудников. */
  employees: z.number().int().nonnegative(),
  /** Нет — заблокирована: сотрудники не входят, данные сохраняются. */
  active: z.boolean(),
  /** Пометка администратора у заблокированной. */
  blockedReason: z.string().nullable(),
  /** Демо-организация стенда: её не блокируют. */
  isDemo: z.boolean(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type AdminOrganization = z.infer<typeof AdminOrganization>;

/** Страница списка организаций платформы: сортировка, страницы и фильтры — на сервере. */
export const AdminOrganizationList = listPageSchema(AdminOrganization);
export type AdminOrganizationList = z.infer<typeof AdminOrganizationList>;

/**
 * Плашки над списком организаций (прототип renderOrgs): активных организаций, контрагентов на
 * платформе, учётных записей организаций, запросов на добавление в справочники.
 */
export const AdminOrgSummary = z.object({
  active: z.number().int().nonnegative(),
  contractors: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
});
export type AdminOrgSummary = z.infer<typeof AdminOrgSummary>;

/**
 * Новая организация с владельцем (ТЗ: название, ИНН, ФИО владельца, логин владельца, временный
 * пароль — все обязательные). Адрес страницы подбирает сервер по названию.
 */
export const CreateOrganizationRequest = z.object({
  name: z.string().trim().min(1).max(ORG_NAME_MAX_LENGTH),
  inn: z.string().trim().max(20),
  ownerFullName: z.string().trim().min(1).max(FULL_NAME_MAX_LENGTH),
  ownerLogin: z.string().trim().min(1).max(LOGIN_MAX_LENGTH),
  // Не короче 8 символов, как у временного пароля сотрудника (docs/deviations.md, п. 17).
  temporaryPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequest>;

/** Организация создана. */
export const CreatedOrganization = z.object({ organization: AdminOrganization });
export type CreatedOrganization = z.infer<typeof CreatedOrganization>;

/** Заблокировать или разблокировать организацию: версия, которую видел администратор. */
export const OrganizationVersionRequest = z.object({ version: RecordVersion });
export type OrganizationVersionRequest = z.infer<typeof OrganizationVersionRequest>;

/**
 * Учётная запись в Админке → «Учётные записи» (ТЗ «Админка» → «Модуль учётных записей»; прототип
 * admin/accounts-orgs.js, renderAccounts): логин, ФИО, организация, роль, последний вход, статус. У
 * администратора платформы ФИО и роль — «Администратор платформы», организация — «Платформа».
 */
export const AdminUser = z.object({
  id: Uuid,
  login: z.string(),
  fullName: z.string(),
  /** null — администратор платформы. */
  orgId: Uuid.nullable(),
  orgName: z.string(),
  role: z.string(),
  isPlatformAdmin: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  /** Заблокирована администратором платформы. */
  blocked: z.boolean(),
  /**
   * `blocked` — администратором платформы, `owner_blocked` — сотрудника заблокировал владелец
   * организации (docs/deviations.md, п. 49).
   */
  status: z.enum(ACCOUNT_STATUSES),
  audit: RecordAudit,
  version: RecordVersion,
});
export type AdminUser = z.infer<typeof AdminUser>;

/** Страница списка учётных записей платформы: сортировка, страницы и фильтры — на сервере. */
export const AdminUserList = listPageSchema(AdminUser);
export type AdminUserList = z.infer<typeof AdminUserList>;

/** Заблокировать или разблокировать учётную запись: версия, которую видел администратор. */
export const AdminUserVersionRequest = z.object({ version: RecordVersion });
export type AdminUserVersionRequest = z.infer<typeof AdminUserVersionRequest>;

const message = (key: UiTextKey) => ({ message: key });

/**
 * Форма «Новая организация» (прототип admin/accounts-orgs.js, addOrgDlg; React Hook Form): «Введите
 * название», «ИНН — 14 цифр», «Введите ФИО», логин — латиница, цифры, точка, дефис, от 3 символов,
 * временный пароль — не короче `PASSWORD_MIN_LENGTH`. Сообщения — ключи словаря.
 */
export const NewOrganizationForm = z.object({
  name: z
    .string()
    .trim()
    .min(1, message('err.name_required'))
    .max(ORG_NAME_MAX_LENGTH, message('form.too_long')),
  inn: z.string().trim().refine(isValidOrgInn, message('err.inn_invalid')),
  ownerFullName: z
    .string()
    .trim()
    .min(1, message('err.owner_fio_required'))
    .max(FULL_NAME_MAX_LENGTH, message('form.too_long')),
  ownerLogin: z
    .string()
    .max(LOGIN_MAX_LENGTH, message('form.too_long'))
    .transform(normalizeLogin)
    .refine(isValidLogin, message('staff.err.login')),
  temporaryPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, message('staff.err.password'))
    .max(PASSWORD_MAX_LENGTH, message('form.too_long')),
});
export type NewOrganizationFormInput = z.input<typeof NewOrganizationForm>;
export type NewOrganizationForm = z.output<typeof NewOrganizationForm>;
