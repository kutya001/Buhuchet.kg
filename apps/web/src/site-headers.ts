// Заголовки безопасности страниц (у /api свои — secureHeaders в @buhuchet/api). Одинаковы на Vercel и VPS.
export const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'microphone=(), geolocation=()' },
];

/** Страницы сайта, кроме API (у него свои заголовки) и демо-версии (у неё свои). */
export const SITE_PAGES = '/((?!api/|demo(?:\\.html)?$).*)';

/**
 * Страница «Задать пароль» по ссылке из Telegram (`/setpass/<ключ>`, доработки 14.11.2026, блок 1,
 * пункт 3): ключ ссылки — в адресе, поэтому он не уходит на другие сайты в заголовке Referer, а
 * поисковики страницу не индексируют. Идёт после общих заголовков и заменяет их Referrer-Policy.
 */
export const SETPASS_PATH = '/setpass/:token';
export const SETPASS_HEADERS = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

/**
 * Демо-организация buhuchet.kg/demo (ТЗ «Лендинг» → «Демо-организация»): готовый файл прототипа
 * (`public/demo.html`, собирает scripts/build-demo.mjs), который работает только в браузере гостя.
 * Всё нужное демо-версии встроено в файл (скрипты, стили, шрифты, чтение PDF), поэтому сайт отдаёт его
 * с запретом загружать что-либо извне: ни запросов (`connect-src 'none'`), ни внешних скриптов, картинок,
 * шрифтов и форм — отправить данные некуда даже по ошибке, — и без индексации поисковиками.
 */
export const DEMO_PATHS = ['/demo', '/demo.html'] as const;
export const DEMO_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');
export const DEMO_HEADERS = [
  ...SECURITY_HEADERS.filter((h) => h.key !== 'Content-Security-Policy'),
  { key: 'Content-Security-Policy', value: DEMO_CSP },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];
