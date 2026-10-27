import {
  FULL_NAME_MAX_LENGTH,
  isFullName,
  isValidLogin,
  LOGIN_MAX_LENGTH,
  normalizeLogin,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type UiTextKey,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordAudit, RecordVersion, Uuid } from './common';
import { listPageSchema } from './list';
import { TelegramInfo } from './telegram';

/** Телефон в виде «+996555100200»: код страны и цифры; маску страны проверяет сервер. */
export const Phone = z.string().trim().max(20);

/**
 * Справочник платформы «Коды телефонов» для поля ввода телефона (прототип ui/popups.js, phoneInput):
 * страна, флаг, код и маска номера («XXX XXX XXX»); выключенный код не предлагается для нового номера.
 */
export const PhoneCodes = z.object({
  items: z.array(
    z.object({
      cc: z.string(),
      flag: z.string(),
      name: z.string(),
      code: z.string(),
      mask: z.string(),
      active: z.boolean(),
    }),
  ),
});
export type PhoneCodes = z.infer<typeof PhoneCodes>;

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
 * Счётчики вкладок модуля «Сотрудники» (прототип staffTabs): `list` — активных сотрудников, `roles` —
 * ролей организации (null — нет права «Сотрудники и роли», вкладки «Роли» нет).
 */
export const StaffTabCounts = z.object({
  list: z.number().int().nonnegative(),
  roles: z.number().int().nonnegative().nullable(),
});
export type StaffTabCounts = z.infer<typeof StaffTabCounts>;

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

const message = (key: UiTextKey) => ({ message: key });

/**
 * Форма «Новый сотрудник» (прототип modules/staff.js, empAddDlg; React Hook Form): ФИО — фамилия и
 * имя, логин — латиница, цифры, точка, дефис, от 3 символов (в нижнем регистре), временный пароль —
 * не короче `PASSWORD_MIN_LENGTH` (docs/deviations.md, п. 17), роль. Телефон проверяет поле ввода по
 * маске страны. Сообщения — ключи словаря.
 */
export const NewEmployeeForm = z.object({
  fullName: z
    .string()
    .trim()
    .max(FULL_NAME_MAX_LENGTH, message('form.too_long'))
    .refine(isFullName, message('staff.err.full_name')),
  login: z
    .string()
    .max(LOGIN_MAX_LENGTH, message('form.too_long'))
    .transform(normalizeLogin)
    .refine(isValidLogin, message('staff.err.login')),
  temporaryPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, message('staff.err.password'))
    .max(PASSWORD_MAX_LENGTH, message('form.too_long')),
  roleId: z.string().min(1, message('staff.err.role')),
});
export type NewEmployeeFormInput = z.input<typeof NewEmployeeForm>;
export type NewEmployeeForm = z.output<typeof NewEmployeeForm>;

/** Форма «Изменить сотрудника» (docs/deviations.md, п. 16): ФИО — как у нового; телефон проверяет поле ввода. */
export const EditEmployeeForm = NewEmployeeForm.pick({ fullName: true });
export type EditEmployeeFormInput = z.input<typeof EditEmployeeForm>;
export type EditEmployeeForm = z.output<typeof EditEmployeeForm>;
