import { describe, expect, it } from 'vitest';
import { EXIT_MS, innerDrops, leaveClass, motionOff, secretField } from './fade-away';

describe('плавный уход окна, меню и панели (прототип v131 `fadeAway`)', () => {
  it('у уходящей копии анимация появления заменена на уход, остальные классы — как были', () => {
    expect(leaveClass('fixed z-[70] animate-rise rounded-xl', 'animate-fade-out')).toBe(
      'fixed z-[70] rounded-xl animate-fade-out',
    );
  });

  it('анимация с условием («на телефоне — лист снизу») тоже снимается; уход — свой для ПК и телефона', () => {
    expect(
      leaveClass(
        'relative animate-slide-up max-md:animate-sheet-in motion-reduce:animate-none bg-pane',
        'animate-sink max-md:animate-sheet-out',
      ),
    ).toBe('relative bg-pane animate-sink max-md:animate-sheet-out');
  });

  it('класс, в котором «animate-» — часть другого слова, остаётся', () => {
    expect(leaveClass('data-[x=animate-y]:block no-animate-here', 'animate-fade-out')).toBe(
      'data-[x=animate-y]:block no-animate-here animate-fade-out',
    );
  });

  it('у вложенных элементов копии сняты признаки открытого окна и `id`; у частей рисунка `id` остаётся', () => {
    const el = (attrs: Record<string, string>, inSvg = false) => ({
      getAttribute: (name: string) => attrs[name] ?? null,
      closest: (selector: string) => (inSvg && selector === 'svg' ? {} : null),
    });
    expect(
      innerDrops(el({ role: 'dialog', 'aria-modal': 'true', 'data-window': '', id: 'w1' })).sort(),
    ).toEqual(['aria-modal', 'data-window', 'id', 'role']);
    expect(innerDrops(el({ role: 'menu', 'data-popover': '', 'data-overlay': '' })).sort()).toEqual(
      ['data-overlay', 'data-popover', 'role'],
    );
    // Вкладки, кнопки и подписи остаются как были: по ним окно не ищут.
    expect(innerDrops(el({ role: 'tab', 'aria-label': 'Файлы' }))).toEqual([]);
    expect(innerDrops(el({ for: 'f1' }))).toEqual(['for']);
    expect(innerDrops(el({ id: 'grad' }, true))).toEqual([]);
  });

  it('значение пароля и одноразового кода в копию не переносится, обычного поля — переносится', () => {
    expect(secretField('password', '')).toBe(true);
    expect(secretField('text', 'one-time-code')).toBe(true);
    expect(secretField('text', 'section-a new-password')).toBe(true);
    expect(secretField('text', 'current-password')).toBe(true);
    expect(secretField('text', 'off')).toBe(false);
    expect(secretField('search', '')).toBe(false);
  });

  it('копия живёт 150 мс; без окна браузера (на сервере) движения нет', () => {
    expect(EXIT_MS).toBe(150);
    expect(motionOff()).toBe(true);
  });
});
