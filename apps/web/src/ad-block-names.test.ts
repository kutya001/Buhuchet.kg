import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Имена элементов (id и классы), которые прячут блокировщики рекламы (uBlock Origin, AdBlock, AdGuard,
 * встроенные в браузеры). В их общих списках (EasyList, AdGuard) тысячи правил вида `###ad-…` и
 * `##.ad-…`: элемент с таким именем на любом сайте скрыт. Так на стенде пропало поле для кода при входе
 * администратора платформы: оно называлось «ad-code» (правило `###ad-code`).
 * Слово имени — часть между «-» и «_»; запрещены слова, с которых начинаются общие правила списков.
 */
const AD_WORDS = new Set([
  'ad',
  'ads',
  'adv',
  'advert',
  'adverts',
  'advertisement',
  'advertising',
  'banner',
  'banners',
  'sponsor',
  'sponsored',
  'adbox',
  'adsbox',
  'adslot',
  'adunit',
  'adbanner',
  'textad',
  'topad',
]);

const ROOTS = ['./', '../app/', '../../../packages/ui/src/'].map((p) =>
  fileURLToPath(new URL(p, import.meta.url)),
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name) ? [path] : [];
  });
}

/** id и классы из исходников: id="…", id={`…`}, className="…", className={`…`}, классы в CSS. */
function elementNames(source: string, css: boolean): string[] {
  const names: string[] = [];
  const literal = /\b(id|htmlFor|className)=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g;
  for (const m of source.matchAll(literal)) {
    const value = (m[2] ?? m[3] ?? m[4] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    names.push(...value.split(/\s+/).filter(Boolean));
  }
  if (css) for (const m of source.matchAll(/\.([a-z][\w-]*)/gi)) names.push(m[1] ?? '');
  return names;
}

const isAdName = (name: string) => name.split(/[-_]/).some((w) => AD_WORDS.has(w.toLowerCase()));

describe('имена элементов не прячут блокировщики рекламы', () => {
  const found = ROOTS.flatMap(sourceFiles).flatMap((file) =>
    elementNames(readFileSync(file, 'utf8'), file.endsWith('.css'))
      .filter(isAdName)
      .map((name) => `${file.slice(file.lastIndexOf('/src/') + 1)}: ${name}`),
  );

  it('проверка узнаёт имена из правил блокировщиков', () => {
    expect(['ad-code', 'lg-banner-ad', 'ad_sky', 'ch-ads', 'adsbox'].every(isAdName)).toBe(true);
    expect(
      ['ac-code', 'lg-login', 'fg-code', 'pub-k', 'grid-cols-2', 'load', 'adapt'].some(isAdName),
    ).toBe(false);
    expect(elementNames('<Field id="ac-code" className={`x ${a}-ad`} />', false)).toEqual([
      'ac-code',
      'x',
      '-ad',
    ]);
  });

  it('в интерфейсе нет id и классов со словами ad, ads, banner, sponsor', () => {
    expect(found).toEqual([]);
  });
});
