import { describe, expect, it } from 'vitest';
import { cardToneClass } from './card-tone';

/** Сколько классов задают цвет всей рамки и фон: по одному, иначе победит порядок правил CSS. */
const count = (cls: string, re: RegExp) => cls.split(/\s+/).filter((c) => re.test(c)).length;

describe('рамка и фон плитки записи', () => {
  it('обычная плитка — рамка и фон темы; полоса слева — вид записи', () => {
    expect(cardToneClass()).toBe('border-line bg-raised');
    expect(cardToneClass('muted')).toBe('border-line bg-raised');
    expect(cardToneClass(undefined, 'info')).toContain('border-l-[3px] border-l-info');
    expect(cardToneClass('muted', 'violet')).toContain('border-l-violet');
  });

  it('просроченная — розовый фон и красноватая рамка; полоса вида записи — того же цвета', () => {
    const plain = cardToneClass('overdue');
    expect(plain).toContain('border-[color-mix(in_srgb,var(--bu-red)_40%,var(--bu-border))]');
    expect(plain).toContain('bg-[image:linear-gradient(var(--bu-red-bg),var(--bu-red-bg))]');
    expect(plain).not.toContain('border-line');
    const striped = cardToneClass('overdue', 'info');
    expect(striped).toContain('border-l-[3px]');
    expect(striped).not.toContain('border-l-info');
  });

  it('«внимание» — жёлтая полоса, если у записи нет своей', () => {
    expect(cardToneClass('warn')).toContain('border-l-caution');
    expect(cardToneClass('warn', 'info')).toContain('border-l-info');
    expect(cardToneClass('warn', 'info')).not.toContain('border-l-caution');
  });

  it('цвет всей рамки и цвет фона задаёт один класс', () => {
    for (const tone of [undefined, 'muted', 'overdue', 'warn'] as const) {
      for (const stripe of [undefined, 'info', 'violet'] as const) {
        const cls = cardToneClass(tone, stripe);
        expect(count(cls, /^border-(line|\[color-mix)/)).toBe(1);
        expect(count(cls, /^bg-raised$/)).toBe(1);
        expect(count(cls, /^border-l-(info|violet|caution)$/)).toBeLessThanOrEqual(1);
      }
    }
  });
});
