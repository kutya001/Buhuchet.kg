/** ИНН организации — 14 цифр (ТЗ «Админка» → «Модуль организаций»). */
export function isValidOrgInn(inn: string): boolean {
  return /^\d{14}$/.test(inn);
}
