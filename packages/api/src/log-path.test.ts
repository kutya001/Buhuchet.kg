import { describe, expect, it } from 'vitest';
import { logPath } from './log-path';

describe('путь запроса в журнале сервера', () => {
  it('ключ ссылки «Задать пароль» заменяется шаблоном, остальные пути — как есть', () => {
    expect(logPath(`/api/auth/setup/${'A'.repeat(43)}`)).toBe('/api/auth/setup/:token');
    expect(logPath('/api/auth/setup/')).toBe('/api/auth/setup/:token');
    expect(logPath('/api/auth/login')).toBe('/api/auth/login');
    expect(logPath('/api/admin/organizations/1/owner-setup')).toBe(
      '/api/admin/organizations/1/owner-setup',
    );
  });
});
