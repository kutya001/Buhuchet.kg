import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Plate, Plates } from './plates';

describe('Статистика модуля — плашки-итоги (прототип `plate`)', () => {
  it('плашка-фильтр — кнопка: значок в цветном кружке, подпись, число, пояснение; нажатая — отмечена', () => {
    const html = renderToStaticMarkup(
      <Plates>
        <Plate
          id="over"
          icon="clock"
          color="red"
          label="Просрочено"
          value="0"
          sub="за всё время"
          on
          onClick={vi.fn()}
        />
        <Plate id="sum" icon="wallet" color="green" label="К уплате" value="1 250,50" unit="сом" />
      </Plates>,
    );
    expect(html).toContain('data-plates');
    expect(html).toMatch(/<button type="button" data-plate="over" aria-pressed="true"/);
    expect(html).toContain('bg-danger-bg text-danger');
    expect(html).toContain('Просрочено');
    expect(html).toContain('>0<');
    expect(html).toContain('за всё время');
    // Плашка без действия только показывает итог: не кнопка и не нажимается.
    expect(html).toMatch(/<div data-plate="sum"/);
    expect(html).toContain('сом</small>');
  });

  it('недоступная плашка-действие без числа: бледная кнопка, не нажимается', () => {
    const html = renderToStaticMarkup(
      <Plate
        id="add"
        icon="plus"
        color="gray"
        label="Добавить язык"
        sub="Пока не используется"
        disabled
      />,
    );
    expect(html).toMatch(/<button type="button" data-plate="add" disabled=""/);
    expect(html).toContain('opacity-60');
    expect(html).toContain('Пока не используется');
    expect(html).not.toContain('text-[25px]');
  });

  it('скрытая кнопкой «Статистика» — ряда плашек нет', () => {
    const html = renderToStaticMarkup(
      <Plates shown={false}>
        <Plate id="a" icon="clock" color="gray" label="А" value="1" />
      </Plates>,
    );
    expect(html).toBe('');
  });
});
