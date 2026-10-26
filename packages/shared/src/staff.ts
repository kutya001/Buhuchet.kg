import {
  FULL_NAME_MAX_LENGTH,
  LOGIN_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordAudit, RecordVersion, Uuid } from './common';
import { listPageSchema } from './list';
import { TelegramInfo } from './telegram';

/** Телефон в виде «+996555100200»: код страны и цифры; маску страны проверяет сервер. */
export const Phone = z.string().trim().max(20);

/**
 * Сотрудник в списке и в карточке (прототип modules/staff.js, renderStaff и empCard). Число
 * контрагентов и отчётов, счёт и уровень знаний добавят их модули.
 */
export const Employee = z.object({
  id: Uuid,
  fullName: z.string(),
  /** «Алишер Т.» — как показывать в списках. */
  shortName: z.string(),
  login: z.string(),
  phone: z.string().nullable(),
  /** Телефон для показа по маске справочника «Коды телефонов»: «+996 555 100 200». */
  phoneText: z.string().nullable(),
  role: z.object({ id: Uuid, name: z.string(), isOwner: z.boolean() }),
  /** Нет — заблокирован: не входит, сеансы закрыты. */
  active: z.boolean(),
  /** Привязанный Telegram; null — не привязан. */
  telegram: TelegramInfo.nullable(),
  /** null — ещё не входил. */
  lastLoginAt: z.iso.datetime().nullable(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type Employee = z.infer<typeof Employee>;

/**
 * Страница списка сотрудников (ТЗ «Сотрудники», список на общем компоненте): сортировка, страницы и
 * фильтры — на сервере.
 */
export const EmployeeList = listPageSchema(Employee);
export type EmployeeList = z.infer<typeof EmployeeList>;

/**
 * Новый сотрудник (прототип modules/staff.js, empAddDlg): вход по логину и паролю, без почты.
 * Временный пароль задаёт владелец или, если поле пустое, сервер; при входе его нужно сменить.
 */
export const CreateEmployeeRequest = z.object({
  fullName: z.string().trim().min(1).max(FULL_NAME_MAX_LENGTH),
  login: z.string().trim().min(1).max(LOGIN_MAX_LENGTH),
  // ОТКЛОНЕНИЕ: docs/deviations.md#17 — не короче 8 символов (в прототипе 6).
  temporaryPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH).optional(),
  phone: Phone.nullable().optional(),
  roleId: Uuid,
});
export type CreateEmployeeRequest = z.infer<typeof CreateEmployeeRequest>;

/** Сотрудник создан: временный пароль показывается один раз, его передают сотруднику лично. */
export const CreatedEmployee = z.object({ employee: Employee, temporaryPassword: z.string() });
export type CreatedEmployee = z.infer<typeof CreatedEmployee>;

/** Правка сотрудника: ФИО, телефон, роль («Сменить роль»). Не переданное поле не меняется. */
export const UpdateEmployeeRequest = z.object({
  version: RecordVersion,
  fullName: z.string().trim().min(1).max(FULL_NAME_MAX_LENGTH).optional(),
  phone: Phone.nullable().optional(),
  roleId: Uuid.optional(),
});
export type UpdateEmployeeRequest = z.infer<typeof UpdateEmployeeRequest>;

/** Заблокировать или разблокировать: версия, которую видел пользователь. */
export const EmployeeVersionRequest = z.object({ version: RecordVersion });
export type EmployeeVersionRequest = z.infer<typeof EmployeeVersionRequest>;
