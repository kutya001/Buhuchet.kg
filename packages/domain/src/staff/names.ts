/**
 * Короткое имя для списков: «Токтогулов Алишер Бакытович» → «Алишер Т.» (прототип modules/staff.js).
 * Если в ФИО одно слово, оно и есть короткое имя.
 */
export function shortName(fullName: string): string {
  const [surname, name] = fullName.trim().split(/\s+/);
  if (!surname) return '';
  return name ? `${name} ${surname[0]}.` : surname;
}

/** Длина отображаемого имени (ТЗ «Сотрудники» → «Отображаемое имя», прототип v74 shortErr). */
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 40;

/** Управляющие и невидимые символы (нулевой ширины, смены направления): с ними имя на экране неотличимо от чужого. */
const HIDDEN_CHARS = /[\p{Cc}\p{Cf}]/gu;

/**
 * Отображаемое имя из поля формы (решение заказчика 06.11.2026, прототип v74 readShort): пробелы по
 * краям убраны, внутри — по одному; пустое поле — автоматическое имя по ФИО (`shortName`). Сверх
 * прототипа (защита — по более строгому): невидимые символы убраны, буквы — в одной записи (NFC),
 * чтобы повтор находился и для имени, которое только выглядит как чужое.
 */
export function displayName(value: string | null | undefined, fullName: string): string {
  const name = (value ?? '')
    .normalize('NFC')
    .replace(HIDDEN_CHARS, (c) => (/\s/.test(c) ? ' ' : ''))
    .trim()
    .replace(/\s+/g, ' ');
  return name || shortName(fullName);
}

/** «От 2 до 40 знаков» (прототип v74 shortErr); имя — уже после `displayName`. */
export function displayNameProblem(name: string): 'display_name_length' | null {
  const n = [...name].length;
  return n < DISPLAY_NAME_MIN_LENGTH || n > DISPLAY_NAME_MAX_LENGTH ? 'display_name_length' : null;
}

/**
 * Имя задано вручную — не совпадает с автоматическим по ФИО (прототип v74 shortManual): такое имя
 * при исправлении ФИО остаётся, автоматическое меняется вместе с ФИО.
 */
export function displayNameManual(name: string, fullName: string): boolean {
  return name !== shortName(fullName);
}

/** Инициалы для кружка «Мой профиль» в панели «Меню» телефона: «Сыдыков Эркин» → «СЭ» (прототип core/org.js). */
export function initials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/** Как показывать в «Создал» и «Изменил» запись администратора платформы (прототип core/session.js, whoName). */
export const PLATFORM_ADMIN_NAME = 'Администратор платформы';

/** Организация администратора платформы в Админке → «Учётные записи» (прототип admin/accounts-orgs.js, orgName). */
export const PLATFORM_ORG_NAME = 'Платформа';

/**
 * Кто создал или изменил запись: короткое имя сотрудника организации; пользователь без сотрудника в
 * организации — администратор платформы; null — система.
 */
export function auditActorName(
  userId: string | null,
  employeeShortName: string | null,
): string | null {
  if (!userId) return null;
  return employeeShortName ?? PLATFORM_ADMIN_NAME;
}
