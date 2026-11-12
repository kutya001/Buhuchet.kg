/**
 * Устройство сеанса входа — «браузер и система по заголовку браузера» (ТЗ «Админка» → «Карточка
 * пользователя», вкладка «Сеансы»; прототип demoDB.sessions[].dev: «Chrome 130 · Windows 10»). Из
 * заголовка User-Agent берётся только эта короткая подпись: сам заголовок и адрес IP не хранятся.
 */

/** Предел длины подписи: заголовок приходит от браузера и может быть любым. */
export const SESSION_DEVICE_MAX = 80;

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/YaBrowser\/(\d+)/, 'Яндекс Браузер'],
  [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
  [/Version\/(\d+)[\d.]* (?:Mobile\/\w+ )?Safari\//, 'Safari'],
];

function browserOf(ua: string): string | null {
  for (const [re, name] of BROWSERS) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1]}`;
  }
  return null;
}

function systemOf(ua: string): string | null {
  let m = /\((iPhone|iPad|iPod)[^)]*? OS (\d+)/.exec(ua);
  if (m) return `iOS ${m[2]} (${m[1]})`;
  m = /Android (\d+)/.exec(ua);
  if (m) return `Android ${m[1]}`;
  // Windows 11 в заголовке тоже «Windows NT 10.0»: отличить нельзя, поэтому «Windows 10 или 11».
  m = /Windows NT (\d+)\.(\d+)/.exec(ua);
  if (m) return m[1] === '10' ? 'Windows 10 или 11' : `Windows NT ${m[1]}.${m[2]}`;
  m = /Mac OS X (\d+)[._](\d+)/.exec(ua);
  if (m) return `macOS ${m[1]}${m[1] === '10' ? `.${m[2]}` : ''}`;
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

/**
 * Подпись устройства по заголовку User-Agent: «Chrome 130 · Windows 10 или 11», «Safari 18 · iOS 18
 * (iPhone)». Не узнали ни браузер, ни систему (или заголовка нет) — `null`: в карточке прочерк.
 */
export function sessionDevice(userAgent: string | null | undefined): string | null {
  const ua = (userAgent ?? '').slice(0, 512);
  const parts = [browserOf(ua), systemOf(ua)].filter((x): x is string => x !== null);
  return parts.length ? parts.join(' · ').slice(0, SESSION_DEVICE_MAX) : null;
}

/**
 * Чем закрыт сеанс — подпись в журнале сеансов (миграция 0112): выход, срок, «Завершить все сеансы»
 * администратором платформы, блокировка, смена своего пароля, сброс пароля; `closed` — прочее.
 */
export const SESSION_END_REASONS = [
  'logout',
  'expired',
  'admin',
  'blocked',
  'password',
  'reset',
  'closed',
] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

export function isSessionEndReason(value: string | null | undefined): value is SessionEndReason {
  return (SESSION_END_REASONS as readonly string[]).includes(value ?? '');
}
