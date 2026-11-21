import { describe, expect, it } from 'vitest';
import { flashWaits, KB_GO } from './kb-go';

describe('«Перейти»: сколько ждать место шага на экране', () => {
  it('первые 2,5 секунды — всегда: экран после перехода ещё открывается', () => {
    expect(flashWaits(0, false)).toBe(true);
    expect(flashWaits(2499, false)).toBe(true);
    expect(flashWaits(2500, false)).toBe(false);
  });

  it('дольше — только пока экран показывает заглушку загрузки, и не дольше 10 секунд', () => {
    expect(flashWaits(2500, true)).toBe(true);
    expect(flashWaits(9999, true)).toBe(true);
    expect(flashWaits(10_000, true)).toBe(false);
    expect(flashWaits(6000, false)).toBe(false);
  });

  it('«Настройки» подсвечивают свою кнопку «Сохранить настройки», «Хранилище» — свой блок', () => {
    expect(KB_GO.settings?.flash).toBe('[data-org-settings-save]');
    expect(KB_GO.storage?.flash).toBe('[data-org-storage]');
  });
});
