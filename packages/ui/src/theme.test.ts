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

/**
 * Цвета продукта под другими именами в прототипе версии 59 (docs/deviations.md, п. 26): опасная кнопка
 * и красный счётчик — `--red-btn`, текст цветных меток и заметок — сами цвета меток.
 */
const PROTO_NAME: Readonly<Record<string, string>> = {
  'danger-btn': 'red-btn',
  'red-label': 'red',
  'orange-label': 'orange',
  'yellow-label': 'yellow',
  'blue-label': 'blue',
};

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

/** Цвет `hsl()` / `hsla()` в RGB 0…1 и его прозрачность. */
function rgba(color: string): { rgb: [number, number, number]; alpha: number } {
  const [h, s, l, alpha = 1] = color
    .replace(/hsla?\(|\)|%/g, '')
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number) as [number, number, number, number?];
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { rgb: [f(0), f(8), f(4)], alpha };
}

/** Полупрозрачный цвет поверх сплошного — сплошной `hsl()`-независимый RGB. */
function over(top: string, base: [number, number, number]): [number, number, number] {
  const { rgb, alpha } = rgba(top);
  return rgb.map((c, i) => c * alpha + base[i]! * (1 - alpha)) as [number, number, number];
}

function rgbLuminance(rgb: [number, number, number]): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
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
    // В светлой теме у прототипа нет `--faint-pill-bg`: бледная метка — без подложки (`transparent`).
    expect(light.get('faint-pill-bg')).toBe('hsla(0 0% 100% / 0)');
    for (const [name, value] of light) {
      if (name === 'faint-pill-bg') continue;
      const proto = PROTO_NAME[name] ?? name;
      expect([name, norm(protoLight.get(proto))]).toEqual([name, norm(value)]);
    }
    for (const [name, value] of dark) {
      const proto = PROTO_NAME[name] ?? name;
      expect([name, norm(protoDark.get(proto))]).toEqual([name, norm(value)]);
    }
  });

  it('текст «Добавить» на основной кнопке читается: контраст не ниже 4,5 : 1 в обеих темах', () => {
    expect(contrast(light.get('on-accent')!, light.get('accent')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.get('on-accent')!, dark.get('accent')!)).toBeGreaterThanOrEqual(4.5);
  });

  it('надпись на опасной кнопке («Удалить», «Закрыть без сохранения») и число на красном счётчике читаются: не ниже 4,5 : 1', () => {
    expect(contrast(light.get('on-accent')!, light.get('danger-btn')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.get('on-accent')!, dark.get('danger-btn')!)).toBeGreaterThanOrEqual(4.5);
  });

  it('надпись на цветной кнопке («Выполнено», «Подтвердить») и номер текущего шага шкалы статусов: не ниже 4,5 : 1', () => {
    for (const color of ['green', 'blue', 'yellow', 'orange', 'purple', 'gray', 'faint']) {
      for (const [name, theme] of [
        ['светлая', light],
        ['тёмная', dark],
      ] as const) {
        const ratio = contrast(theme.get('on-accent')!, theme.get(`${color}-btn`)!);
        expect([name, color, ratio >= 4.5]).toEqual([name, color, true]);
      }
    }
  });

  it('цветные метки и заметки читаются на карточке и под наведением строки: не ниже 4,5 : 1', () => {
    // Метка: текст `--X-label` на подложке `--X-bg`, подложка — поверх карточки списка (`--raised`) или
    // строки под указателем (`--row-hover` поверх `--raised`). Красная — «Заблокирован», зелёная —
    // «Активен», оранжевая — «не привязан», жёлтая — счётчик «Справочники» и метка «скоро»; синяя —
    // «Сдача» у вида отчёта, синяя на зелёном — правый край метки «Сдача + уплата».
    const pairs = [
      ['red-label', 'red-bg'],
      ['green', 'green-bg'],
      ['blue-label', 'blue-bg'],
      ['blue-label', 'green-bg'],
      ['orange-label', 'orange-bg'],
      ['yellow-label', 'yellow-bg'],
      ['label', 'label-bg'],
      ['label', 'faint-pill-bg'],
    ] as const;
    for (const [name, theme] of [
      ['светлая', light],
      ['тёмная', dark],
    ] as const) {
      const raised = rgba(theme.get('raised')!).rgb;
      const surfaces = { raised, hover: over(theme.get('row-hover')!, raised) };
      for (const [text, bg] of pairs) {
        for (const [surface, base] of Object.entries(surfaces)) {
          const fg = rgbLuminance(rgba(theme.get(text)!).rgb);
          const back = rgbLuminance(over(theme.get(bg)!, base));
          const ratio = (Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05);
          expect([name, text, surface, ratio >= 4.5]).toEqual([name, text, surface, true]);
        }
      }
    }
  });

  it('метки статусов в карточке записи и «Истории статусов» читаются: не ниже 4,5 : 1', () => {
    // Все цвета справочника «Статусы» на карточке и на рабочей области (без наведения: строки
    // истории не подсвечиваются): серые и бледные — `--label`, текущий серый шаг — на `--btn`.
    const pairs = [
      ['blue', 'blue-bg'],
      ['purple', 'purple-bg'],
      ['green', 'green-bg'],
      ['yellow-label', 'yellow-bg'],
      ['orange-label', 'orange-bg'],
      ['red-label', 'red-bg'],
      ['label', 'label-bg'],
      ['label', 'faint-pill-bg'],
      ['label', 'btn'],
    ] as const;
    for (const [name, theme] of [
      ['светлая', light],
      ['тёмная', dark],
    ] as const) {
      for (const surface of ['raised', 'pane'] as const) {
        const base = rgba(theme.get(surface)!).rgb;
        for (const [text, bg] of pairs) {
          const fg = rgbLuminance(rgba(theme.get(text)!).rgb);
          const back = rgbLuminance(over(theme.get(bg)!, base));
          const ratio = (Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05);
          expect([name, text, bg, surface, ratio >= 4.5]).toEqual([name, text, bg, surface, true]);
        }
      }
    }
  });

  it('текст уведомления внизу экрана читается: контраст не ниже 4,5 : 1 в обеих темах', () => {
    expect(contrast(light.get('toast-fg')!, light.get('toast-bg')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.get('toast-fg')!, dark.get('toast-bg')!)).toBeGreaterThanOrEqual(4.5);
  });
});
