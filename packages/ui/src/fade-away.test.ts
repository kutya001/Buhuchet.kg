import { describe, expect, it } from 'vitest';
import { EXIT_MS, leaveClass, motionOff } from './fade-away';

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

  it('копия живёт 150 мс; без окна браузера (на сервере) движения нет', () => {
    expect(EXIT_MS).toBe(150);
    expect(motionOff()).toBe(true);
  });
});
