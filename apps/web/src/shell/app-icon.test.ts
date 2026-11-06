import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Значок вкладки браузера (прототип v75: логотип 36, светлый и тёмный вариант). Next.js сам ставит
// app/icon.svg ссылкой rel="icon" на все страницы сайта.
const ICON = readFileSync(new URL('../../app/icon.svg', import.meta.url), 'utf8');

describe('значок вкладки — знак Buhuchet.kg', () => {
  it('только знак: спираль и буквы, без скриптов, ссылок и встроенных данных', () => {
    expect(
      ICON.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0.8 3.2 66.8 66.8">'),
    ).toBe(true);
    expect([...ICON.matchAll(/<([a-z]+)/gi)].map((m) => m[1])).toEqual([
      'svg',
      'style',
      'path',
      'path',
      'path',
    ]);
    expect(ICON).not.toMatch(/href|url\(|script|on[a-z]+=/i);
  });

  it('цвета темы: спираль и буквы в светлой, светлее — при тёмной теме устройства', () => {
    expect(ICON).toContain('.s{fill:#22729B}.l{fill:#5B3E1F}');
    expect(ICON).toContain('@media (prefers-color-scheme:dark){.s{fill:#4197B9}.l{fill:#DAC5AA}}');
  });
});
