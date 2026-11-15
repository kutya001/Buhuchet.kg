/*
 * Путь запроса для журнала сервера. Ключ ссылки «Задать пароль» (`/api/auth/setup/<ключ>`) — пропуск в
 * учётную запись владельца на 7 дней: в журнал (stdout, журналы Vercel и Docker) пишется шаблон пути,
 * а не ключ (доработки 14.11.2026, блок 1; docs/deviations.md п. Т-18).
 */
const SECRET_PATHS: readonly [RegExp, string][] = [[/^(\/api\/auth\/setup\/)[^/]*/, '$1:token']];

export function logPath(path: string): string {
  return SECRET_PATHS.reduce((p, [re, to]) => p.replace(re, to), path);
}
