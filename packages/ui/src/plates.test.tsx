import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Plate, Plates, PlatesLabelsProvider, platesHidden } from './plates';

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

  it('маленькая карточка окна (прототип v142 `.cp-hot`): число 20 px, красное у просрочки, подсказка', () => {
    const html = renderToStaticMarkup(
      <Plate
        id="reports"
        icon="alert"
        color="red"
        label="Просрочено отчётов"
        value="3"
        small
        danger
        title="Открыть вкладку"
        onClick={vi.fn()}
      />,
    );
    expect(html).toContain('title="Открыть вкладку"');
    expect(html).toContain('text-[20px] text-danger');
    expect(html).toContain('px-3 pt-2.5');
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

  it('плашки в окне (`static`): на ПК не уже 200 px, на телефоне компактнее', () => {
    const html = renderToStaticMarkup(
      <Plates static>
        <Plate id="kxn" icon="plus" color="blue" label="Новые" value="1" sub="было пусто" />
      </Plates>,
    );
    expect(html).toContain('data-static=""');
    expect(html).toContain('minmax(200px,1fr)');
    expect(html).toContain('max-md:group-data-static/plates:text-[18px]');
    expect(renderToStaticMarkup(<Plates>{null}</Plates>)).not.toContain('data-static');
  });

  it('(прототип v139) телефон: ряд модуля — одна строка, число сверху, без значка и пояснения; красное число — только у красной плашки', () => {
    const html = renderToStaticMarkup(
      <PlatesLabelsProvider labels={{ more: (n) => `Ещё ${n}`, less: 'Свернуть' }}>
        <Plates>
          <Plate
            id="over"
            icon="clock"
            color="red"
            label="Просрочено"
            value="3"
            sub="за всё время"
          />
          <Plate id="week" icon="clock" color="blue" label="На неделе" value="7" />
        </Plates>
      </PlatesLabelsProvider>,
    );
    expect(html).toMatch(/data-plates="true" data-row="" data-all=""/);
    expect(html).toContain('max-md:flex-nowrap');
    expect(html).toContain('max-md:[&amp;:not([data-all])&gt;:nth-child(n+4)]:hidden');
    // Значок и пояснение на телефоне скрыты, число красное только у «Просрочено».
    expect(html).toMatch(/data-plate-dot="red" class="[^"]*max-md:group-data-row\/plates:hidden/);
    expect(html).toMatch(/data-plate-sub="true" class="[^"]*max-md:group-data-row\/plates:hidden/);
    expect(html.match(/max-md:group-data-row\/plates:text-danger/g)).toHaveLength(1);
    // Плашек не больше четырёх — «Ещё N» нет.
    expect(html).not.toContain('data-plates-more');
    // Плашки в окне строкой не становятся.
    expect(
      renderToStaticMarkup(
        <Plates static>
          <Plate id="a" icon="clock" color="gray" label="А" value="1" />
        </Plates>,
      ),
    ).not.toContain('data-row=');
  });

  it('(прототип v139 `plMob`) за «Ещё N» прячутся плашки сверх трёх, когда их больше четырёх', () => {
    expect(platesHidden(0)).toBe(0);
    expect(platesHidden(4)).toBe(0);
    expect(platesHidden(5)).toBe(2);
    expect(platesHidden(9)).toBe(6);
  });
});
