/**
 * Короткое имя для списков: «Токтогулов Алишер Бакытович» → «Алишер Т.» (прототип modules/staff.js).
 * Если в ФИО одно слово, оно и есть короткое имя.
 */
export function shortName(fullName: string): string {
  const [surname, name] = fullName.trim().split(/\s+/);
  if (!surname) return '';
  return name ? `${name} ${surname[0]}.` : surname;
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
