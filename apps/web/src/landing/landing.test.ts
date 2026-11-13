import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { afterLogin, loginHref } from '../auth/return-to';
import { DEMO_CSP, DEMO_HEADERS, DEMO_PATHS, SECURITY_HEADERS, SITE_PAGES } from '../site-headers';
import { demoScreens, LANDING_VERSION } from './landing-data';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('данные лендинга (задача #165)', () => {
  it('landing-data.json собран из spec/ — после pnpm spec:sync нужен pnpm landing:data', () => {
    expect(() =>
      execFileSync('node', ['scripts/landing-data.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('версия платформы в подвале — номер версии прототипа из spec/, без «v» и даты', () => {
    expect(LANDING_VERSION).toMatch(/^\d+$/);
  });

  it('картинка: последние 2 просроченных не старше 30 дней и ближайшие сроки, всего до 6 строк', () => {
    const today = '2026-11-01';
    const d = demoScreens(today);
    expect(d.rows.length).toBeGreaterThan(0);
    expect(d.rows.length).toBeLessThanOrEqual(6);
    const late = d.rows.filter((r) => r.due < today);
    expect(late.length).toBeLessThanOrEqual(2);
    for (const r of late) expect(r.due >= '2026-10-02').toBe(true);
    // Сначала просроченные, потом ближайшие — по сроку.
    const dues = d.rows.map((r) => r.due);
    expect([...dues].sort()).toEqual(dues);
    expect(d.overdue).toBeGreaterThanOrEqual(late.length);
    expect(d.card?.reports.length).toBeLessThanOrEqual(5);
    expect(d.card?.name).toBeTruthy();
  });
});

describe('заголовки страниц и демо-версии', () => {
  const page = new RegExp(`^${SITE_PAGES}$`);

  it('демо-версия: ничего не загружает извне и не отправляет, без индексации', () => {
    const csp = DEMO_HEADERS.filter((h) => h.key === 'Content-Security-Policy');
    expect(csp).toEqual([{ key: 'Content-Security-Policy', value: DEMO_CSP }]);
    const rules = Object.fromEntries(
      DEMO_CSP.split('; ').map((r) => [r.split(' ')[0], r.split(' ').slice(1).join(' ')]),
    );
    expect(rules).toMatchObject({
      'default-src': "'none'",
      'connect-src': "'none'",
      'form-action': "'none'",
      'frame-ancestors': "'none'",
    });
    // Ни один источник не разрешает другой сайт или сам сайт: только встроенное в файл.
    expect(DEMO_CSP).not.toMatch(/https?:|'self'|\*/);
    expect(DEMO_HEADERS).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    expect(DEMO_HEADERS).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
  });

  it('общие заголовки — всем страницам, кроме API и демо-версии', () => {
    for (const path of ['/', '/login', '/app/reports', '/demo-org/inn/123']) {
      expect([path, page.test(path)]).toEqual([path, true]);
    }
    for (const path of [...DEMO_PATHS, '/api/leads']) {
      expect([path, page.test(path)]).toEqual([path, false]);
    }
    expect(SECURITY_HEADERS.map((h) => h.key)).toContain('Content-Security-Policy');
  });
});

describe('возврат на страницу программы после входа', () => {
  it('страница входа с адресом возврата — только для страниц программы', () => {
    expect(loginHref('/app/reports/all?x=1')).toBe('/login?next=%2Fapp%2Freports%2Fall%3Fx%3D1');
    expect(loginHref('/app')).toBe('/login');
    expect(loginHref(null)).toBe('/login');
    expect(loginHref('//evil.example/app')).toBe('/login');
    expect(loginHref('https://evil.example/app')).toBe('/login');
  });

  it('после входа — адрес из next, если это страница программы, иначе /app', () => {
    expect(afterLogin('/app/tasks')).toBe('/app/tasks');
    expect(afterLogin(['/app/tasks', '/app/reports'])).toBe('/app');
    expect(afterLogin('/login')).toBe('/app');
    expect(afterLogin('/app/../admin')).toBe('/app');
    expect(afterLogin(undefined)).toBe('/app');
  });
});
