import type { AccessSubject } from '../roles/access';
import { hasOwnerGrantedPermission, roleWithinRights, type RoleRights } from '../roles/editing';

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
  if (known.some((c) => digits.length === c.code.length + maskDigits(c.mask))) return null;
  return `Номер — ${maskDigits(known[0]!.mask)} цифр после кода страны`;
}

/**
 * Телефон для показа: «+996555100200» → «+996 555 100 200» по маске страны из справочника (прототип
 * core/reference.js, fmtPhone). Номер, который не подходит ни к одной маске, показывается как есть.
 */
export function formatPhone(phone: string, codes: readonly PhoneCode[]): string {
  const digits = /^\+(\d+)$/.exec(phone)?.[1];
  if (!digits) return phone;
  const code = codes
    .filter(
      (c) => digits.startsWith(c.code) && digits.length === c.code.length + maskDigits(c.mask),
    )
    .sort((a, b) => b.code.length - a.code.length)[0];
  if (!code) return phone;
  return `+${code.code} ${applyPhoneMask(code.mask, digits.slice(code.code.length))}`;
}

/** Сколько цифр номера после кода страны по маске: «XXX XXX XXX» → 9. */
export function maskDigits(mask: string): number {
  return mask.split('X').length - 1;
}

/**
 * Цифры номера по маске страны, как их видно в поле ввода (прототип core/reference.js, applyMask):
 * «5551002» и «XXX XXX XXX» → «555 100 2»; лишние цифры отбрасываются.
 */
export function applyPhoneMask(mask: string, digits: string): string {
  let out = '';
  let i = 0;
  for (const ch of mask) {
    if (i >= digits.length) break;
    if (ch === 'X') out += digits[i++];
    else out += ch;
  }
  return out;
}

/** Код страны для поля ввода телефона: страна, код и маска; выключенный — не для нового номера. */
export interface PhoneCodeOption extends PhoneCode {
  cc: string;
  active: boolean;
}

/**
 * Поле ввода из сохранённого номера (прототип ui/popups.js, phoneInput): страна — по коду номера
 * (сначала самый длинный подходящий код с нужным числом цифр, при равных — первый по справочнику),
 * цифры — после кода. Пусто или номер не подходит ни к одному коду — первая включённая страна
 * справочника и пустой номер.
 */
export function splitPhone(
  phone: string | null,
  codes: readonly PhoneCodeOption[],
): { cc: string; local: string } {
  const first = codes.find((c) => c.active) ?? codes[0];
  const empty = { cc: first?.cc ?? '', local: '' };
  const digits = phone ? /^\+(\d+)$/.exec(phone)?.[1] : undefined;
  if (!digits) return empty;
  const fit = codes
    .filter(
      (c) => digits.startsWith(c.code) && digits.length === c.code.length + maskDigits(c.mask),
    )
    .sort((a, b) => b.code.length - a.code.length)[0];
  return fit ? { cc: fit.cc, local: digits.slice(fit.code.length) } : empty;
}

/**
 * Номер из поля ввода телефона: «+», код страны и цифры («+996555100200»). Без цифр — null (номер не
 * указан); `missing` — сколько цифр не хватает до маски страны (0 — номер полный).
 */
export function joinPhone(
  cc: string,
  local: string,
  codes: readonly PhoneCodeOption[],
): { phone: string | null; need: number; missing: number } {
  const code = codes.find((c) => c.cc === cc);
  const digits = local.replace(/\D/g, '');
  if (!code) return { phone: null, need: 0, missing: 0 };
  const need = maskDigits(code.mask);
  const value = digits.slice(0, need);
  if (!value) return { phone: null, need, missing: 0 };
  return { phone: `+${code.code}${value}`, need, missing: need - value.length };
}

/** Действие над сотрудником в модуле «Сотрудники». */
export type StaffAction = 'edit' | 'changeRole' | 'block' | 'unblock' | 'resetPassword';

/** Кто действует: владелец или сотрудник с правом «Сотрудники и роли», с его правами и областью. */
export type StaffActor = AccessSubject;

/** Сотрудник, над которым действуют, и права его роли. */
export interface StaffTarget {
  employeeId: string;
  role: RoleRights;
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
  | 'owner_granted'
  /** Роль шире прав того, кто действует: её назначает и снимает, носителей ведёт владелец. */
  | 'beyond_own';

/**
 * Можно ли действие над сотрудником (прототип modules/staff.js, empActions: у владельца организации
 * действий нет). Сверх прототипа (ОТКЛОНЕНИЕ: docs/deviations.md#15): свою роль меняет только
 * владелец; себя не блокируют. Сотрудника, в роли которого есть права, которые выдаёт только
 * владелец, блокирует и разблокирует, меняет ему роль и сбрасывает пароль только владелец — иначе эти
 * права снимал бы или получал (через временный пароль) тот, кому их не выдавали. По той же причине не
 * владелец назначает, снимает, сбрасывает пароль, блокирует и разблокирует только для ролей не шире
 * своей (`roleWithinRights`). `newRole` — роль, которую назначают (changeRole).
 */
export function staffActionRefusal(
  actor: StaffActor,
  target: StaffTarget,
  action: StaffAction,
  newRole?: RoleRights,
): StaffRefusal | null {
  const self = actor.employeeId === target.employeeId;
  if (target.role.isOwner) {
    return action === 'edit' && self ? null : 'owner_employee';
  }
  const ownerGranted = !actor.isOwner && hasOwnerGrantedPermission(target.role);
  switch (action) {
    case 'edit':
      return null;
    case 'block':
    case 'unblock':
      if (action === 'block' && self) return 'own_account';
      if (ownerGranted) return 'owner_granted';
      return roleWithinRights(actor, target.role) ? null : 'beyond_own';
    case 'resetPassword':
      if (ownerGranted) return 'owner_granted';
      return roleWithinRights(actor, target.role) ? null : 'beyond_own';
    case 'changeRole':
      if (!newRole) throw new Error('staffActionRefusal: changeRole без новой роли');
      if (newRole.isOwner) return 'owner_role';
      if (actor.isOwner) return null;
      if (self) return 'own_role';
      if (ownerGranted || hasOwnerGrantedPermission(newRole)) return 'owner_granted';
      return roleWithinRights(actor, target.role) && roleWithinRights(actor, newRole)
        ? null
        : 'beyond_own';
  }
}

/**
 * Можно ли дать новому сотруднику роль: не роль владельца; не владельцу — без прав «выдаёт только
 * владелец» и не шире своей роли (иначе временный пароль нового сотрудника дал бы ему права шире).
 */
export function newEmployeeRoleRefusal(
  actor: StaffActor,
  role: RoleRights,
): Extract<StaffRefusal, 'owner_role' | 'owner_granted' | 'beyond_own'> | null {
  if (role.isOwner) return 'owner_role';
  if (actor.isOwner) return null;
  if (hasOwnerGrantedPermission(role)) return 'owner_granted';
  return roleWithinRights(actor, role) ? null : 'beyond_own';
}
