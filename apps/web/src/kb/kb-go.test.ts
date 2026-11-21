import { describe, expect, it } from 'vitest';
import { flashWaits, KB_GO, onScreen } from './kb-go';

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

  it('ушёл на другой адрес во время продлённого ожидания — поиск прекращается; до 2,5 секунды адрес не важен', () => {
    expect(flashWaits(3000, true, true)).toBe(false);
    expect(flashWaits(3000, true, false)).toBe(true);
    expect(flashWaits(1000, false, true)).toBe(true);
  });

  it('экран шага — его адрес или глубже; другой модуль и похожее начало адреса — нет', () => {
    expect(onScreen('/app/org/main', '/app/org/main')).toBe(true);
    expect(onScreen('/app/org/main/', '/app/org/main')).toBe(true);
    expect(onScreen('/app/files/all', '/app/files')).toBe(true);
    expect(onScreen('/app/org/settings', '/app/org/main')).toBe(false);
    expect(onScreen('/app/kb/lessons', '/app/org/main')).toBe(false);
    expect(onScreen('/app/orgs', '/app/org')).toBe(false);
  });

  it('«Настройки» подсвечивают свою кнопку «Сохранить настройки», «Хранилище» — свой блок', () => {
    expect(KB_GO.settings?.flash).toBe('[data-org-settings-save]');
    expect(KB_GO.storage?.flash).toBe('[data-org-storage]');
  });
});
