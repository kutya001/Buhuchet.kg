import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-path';

describe('возврат на страницу после входа', () => {
  it('страница программы с параметрами и якорем — возвращаемся на неё', () => {
    expect(safeReturnPath('/app')).toBe('/app');
    expect(safeReturnPath('/app/reports/all')).toBe('/app/reports/all');
    expect(safeReturnPath('/app/reports/all?open=12#x')).toBe('/app/reports/all?open=12#x');
    expect(safeReturnPath('/app?x=1')).toBe('/app?x=1');
  });

  it('чужой сайт, другая страница, обход через // и \\ — нет', () => {
    for (const bad of [
      null,
      undefined,
      '',
      'https://evil.example/app',
      '//evil.example/app',
      '/app//evil.example',
      '/\\evil.example',
      '/app\\..\\login',
      '/application',
      '/apps',
      '/login',
      '/',
      'app/reports',
      '/app/../login',
      '/app/./x',
      '/app/\u0000',
      '/app/\nx',
      `/app/${'a'.repeat(600)}`,
    ]) {
      expect([bad, safeReturnPath(bad)]).toEqual([bad, null]);
    }
  });
});
