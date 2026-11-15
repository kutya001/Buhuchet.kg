import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, SETPASS_HEADERS, SETPASS_PATH, SITE_PAGES } from '../site-headers';

// Страница «Задать пароль» по ссылке из Telegram (доработки 14.11.2026, блок 1, пункт 3): ключ ссылки
// в адресе не уходит на другие сайты и не индексируется; общие заголовки безопасности тоже действуют.
describe('заголовки страницы «Задать пароль»', () => {
  it('без Referer и без индексации, поверх общих заголовков страниц', () => {
    expect(SETPASS_PATH).toBe('/setpass/:token');
    expect(new RegExp(`^${SITE_PAGES}$`).test('/setpass/abc')).toBe(true);
    expect(SETPASS_HEADERS).toContainEqual({ key: 'Referrer-Policy', value: 'no-referrer' });
    expect(SETPASS_HEADERS).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    // Заменяет только то, что общие заголовки задают иначе; запрет рамок и CSP остаются общими.
    const general = SECURITY_HEADERS.map((h) => h.key);
    expect(general).toContain('Content-Security-Policy');
    expect(SETPASS_HEADERS.map((h) => h.key)).not.toContain('Content-Security-Policy');
  });
});
