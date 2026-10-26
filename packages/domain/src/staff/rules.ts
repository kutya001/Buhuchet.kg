import { hasOwnerGrantedPermission } from '../roles/editing';
import type { PermissionId } from '../roles/permissions';

/** Предел длины ФИО: длиннее ФИО не бывает, а строка без предела — путь забить базу. */
export const FULL_NAME_MAX_LENGTH = 200;

/** ФИО сотрудника: хотя бы фамилия и имя (прототип modules/staff.js, empAddDlg). */
export function isFullName(fullName: string): boolean {
  const name = fullName.trim();
  return name.length <= FULL_NAME_MAX_LENGTH && name.split(/\s+/).length >= 2;
}

/** Код страны из справочника платформы «Коды телефонов» (refDB.phoneCodes): код и маска номера. */
export interface PhoneCode {
  code: string;
  mask: string;
}

/**
 * Телефон в виде «+996555100200»: код страны из справочника и ровно столько цифр, сколько «X» в
 * маске этой страны (прототип ui/popups.js, readPhone). null — номер подходит, иначе — что не так.
 */
export function phoneProblem(phone: string, codes: readonly PhoneCode[]): string | null {
  const match = /^\+(\d+)$/.exec(phone);
  if (!match) return 'Номер — «+», код страны и цифры';
  const digits = match[1]!;
  const known = codes.filter((c) => digits.startsWith(c.code));
  if (known.length === 0) return 'Неизвестный код страны';
  const need = (c: PhoneCode) => c.mask.split('X').length - 1;
  if (known.some((c) => digits.length === c.code.length + need(c))) return null;
  return `Номер — ${need(known[0]!)} цифр после кода страны`;
}

/** Действие над сотрудником в модуле «Сотрудники». */
export type StaffAction = 'edit' | 'changeRole' | 'block' | 'unblock' | 'resetPassword';

/** Кто действует: владелец или сотрудник с правом «Сотрудники и роли». */
export interface StaffActor {
  employeeId: string;
  isOwner: boolean;
}

/** Сотрудник, над которым действуют, и права его роли. */
export interface StaffTarget {
  employeeId: string;
  role: { isOwner: boolean; permissions: readonly PermissionId[] };
}

/** Почему действие над сотрудником запрещено. */
export type StaffRefusal =
  /** Сотрудник — владелец организации: его роль, блокировку и пароль ведёт администратор платформы. */
  | 'owner_employee'
  /** Свою роль сотрудник не меняет. */
  | 'own_role'
  /** Себя не блокируют. */
  | 'own_account'
  /** Роль владельца не назначается. */
  | 'owner_role'
  /** Права, которые выдаёт и снимает только владелец: такую роль назначает и снимает владелец. */
  | 'owner_granted';

/**
 * Можно ли действие над сотрудником (прототип modules/staff.js, empActions: у владельца организации
 * действий нет). Сверх прототипа (ОТКЛОНЕНИЕ: docs/deviations.md#15): свою роль меняет только
 * владелец; роль с правами, которые выдаёт только владелец, назначает и снимает только владелец, и
 * пароль сотруднику с такой ролью сбрасывает только он — иначе через сброс пароля эти права получил бы
 * тот, кому их не выдавали; себя не блокируют. `newRole` — роль, которую назначают (changeRole).
 */
export function staffActionRefusal(
  actor: StaffActor,
  target: StaffTarget,
  action: StaffAction,
  newRole?: StaffTarget['role'],
): StaffRefusal | null {
  const self = actor.employeeId === target.employeeId;
  if (target.role.isOwner) {
    return action === 'edit' && self ? null : 'owner_employee';
  }
  switch (action) {
    case 'edit':
    case 'unblock':
      return null;
    case 'block':
      return self ? 'own_account' : null;
    case 'resetPassword':
      return !actor.isOwner && hasOwnerGrantedPermission(target.role) ? 'owner_granted' : null;
    case 'changeRole':
      if (!newRole) throw new Error('staffActionRefusal: changeRole без новой роли');
      if (newRole.isOwner) return 'owner_role';
      if (actor.isOwner) return null;
      if (self) return 'own_role';
      return hasOwnerGrantedPermission(target.role) || hasOwnerGrantedPermission(newRole)
        ? 'owner_granted'
        : null;
  }
}

/** Можно ли дать новому сотруднику роль: не роль владельца; не владельцу — без прав «выдаёт владелец». */
export function newEmployeeRoleRefusal(
  actor: Pick<StaffActor, 'isOwner'>,
  role: StaffTarget['role'],
): Extract<StaffRefusal, 'owner_role' | 'owner_granted'> | null {
  if (role.isOwner) return 'owner_role';
  return !actor.isOwner && hasOwnerGrantedPermission(role) ? 'owner_granted' : null;
}
