import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const theme = readFileSync(path.join(here, 'theme.css'), 'utf8');
const proto = readFileSync(path.join(here, '../../../spec/prototype/src/css/base.css'), 'utf8');

/** Тело блока правил, который начинается сразу после `head` (до парной закрывающей скобки). */
function blockAfter(css: string, head: string): string {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`нет блока ${head}`);
  let depth = 0;
  const from = css.indexOf('{', start + head.length - 1);
  for (let i = from; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(from + 1, i);
  }
  throw new Error(`блок ${head} не закрыт`);
}

/** Значение для сравнения: без пробелов и ведущих нулей (`0.5` = `.5`). */
const norm = (value: string | undefined) =>
  value?.replace(/\s+/g, '').replace(/(^|[^\d])0\./g, '$1.');

/** Переменные блока: имя без префикса → значение. */
function vars(block: string, prefix: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = block.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (!m[1]!.startsWith(prefix)) continue;
    out.set(m[1]!.slice(prefix.length), m[2]!.replace(/\s+/g, ' ').trim());
  }
  return out;
}

/** Цвета, которых нет в прототипе: опасная кнопка (docs/deviations.md, п. 26). */
const PRODUCT_ONLY = ['danger-btn'];

const light = vars(blockAfter(theme, ':root {'), 'bu-');
const dark = vars(blockAfter(theme, ":root[data-theme='dark'] {"), 'bu-');
const darkAuto = vars(blockAfter(theme, ":root:not([data-theme='light']) {"), 'bu-');
const protoLight = vars(blockAfter(proto, ':root{'), '');
const protoDark = vars(blockAfter(proto, ':root[data-theme="dark"]{'), '');

/** Яркость цвета `hsl(h s% l%)` по WCAG 2.1. */
function luminance(hsl: string): number {
  const [h, s, l] = hsl
    .replace(/hsla?\(|\)|%/g, '')
    .split(/[\s,/]+/)
    .map(Number) as [number, number, number];
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('тема оформления', () => {
  it('у светлой и тёмной темы одинаковый набор цветов и теней', () => {
    expect([...dark.keys()]).toEqual([...light.keys()]);
    expect(light.size).toBeGreaterThan(40);
  });

  it('тёмная тема по выбору и по настройке устройства — одни и те же значения', () => {
    expect(darkAuto).toEqual(dark);
  });

  it('цвета и тени — как в прототипе (css/base.css), в обеих темах', () => {
    for (const [name, value] of light) {
      if (PRODUCT_ONLY.includes(name)) continue;
      expect([name, norm(protoLight.get(name))]).toEqual([name, norm(value)]);
    }
    for (const [name, value] of dark) {
      if (PRODUCT_ONLY.includes(name)) continue;
      expect([name, norm(protoDark.get(name))]).toEqual([name, norm(value)]);
    }
  });

  it('текст «Добавить» на основной кнопке читается: контраст не ниже 4,5 : 1 в обеих темах', () => {
    expect(contrast(light.get('on-accent')!, light.get('accent')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.get('on-accent')!, dark.get('accent')!)).toBeGreaterThanOrEqual(4.5);
  });

  it('надпись на опасной кнопке («Удалить», «Закрыть без сохранения») читается: не ниже 4,5 : 1', () => {
    expect(contrast(light.get('on-accent')!, light.get('danger-btn')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.get('on-accent')!, dark.get('danger-btn')!)).toBeGreaterThanOrEqual(4.5);
  });

  it('текст уведомления внизу экрана читается: контраст не ниже 4,5 : 1 в обеих темах', () => {
    expect(contrast(light.get('toast-fg')!, light.get('toast-bg')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.get('toast-fg')!, dark.get('toast-bg')!)).toBeGreaterThanOrEqual(4.5);
  });
});
