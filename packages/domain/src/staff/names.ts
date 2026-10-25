/**
 * Короткое имя для списков: «Токтогулов Алишер Бакытович» → «Алишер Т.» (прототип modules/staff.js).
 * Если в ФИО одно слово, оно и есть короткое имя.
 */
export function shortName(fullName: string): string {
  const [surname, name] = fullName.trim().split(/\s+/);
  if (!surname) return '';
  return name ? `${name} ${surname[0]}.` : surname;
}
