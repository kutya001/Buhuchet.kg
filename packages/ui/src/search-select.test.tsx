import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  SEARCH_SELECT_MAX,
  searchFold,
  SearchSelectFace,
  searchSelectHit,
  searchSelectMove,
  searchSelectRows,
  SearchSelectRows,
  type SearchSelectOption,
} from './search-select';

// Список контрагентов с поиском по названию и ИНН (доработки 13.11, задача И3; прототип v93,
// ui/cp-select.js). Правила — чистыми функциями, разметка — частями без хуков.

const options: SearchSelectOption[] = [
  { value: 'a', label: 'ОсОО «Ак-Жол Трейд»', hint: '01203199810045' },
  { value: 'b', label: 'ИП Чёрный А. Б.', hint: '22807198500321' },
  { value: 'c', label: 'ОсОО «Бета»', hint: '00911201710198' },
];
const withEmpty: SearchSelectOption[] = [
  { value: '', label: '— выберите контрагента —' },
  ...options,
];
const labels = {
  nothing: 'Ничего не найдено',
  more: (shown: number, total: number) => `Показаны первые ${shown} из ${total} — уточните поиск`,
};

describe('searchSelectHit — подходит ли строка под запрос (cpsHit прототипа)', () => {
  it('ищет по части названия без учёта регистра и «ё/е»', () => {
    expect(searchSelectHit(options[0]!, searchFold('ак-жол'))).toBe(true);
    expect(searchSelectHit(options[1]!, searchFold('ЧЕРНЫЙ'))).toBe(true);
    expect(searchSelectHit(options[1]!, searchFold('чёрный'))).toBe(true);
    expect(searchSelectHit(options[2]!, searchFold('ак-жол'))).toBe(false);
  });

  it('ищет по цифрам ИНН подряд, пробелы в цифрах не мешают', () => {
    expect(searchSelectHit(options[0]!, '0120319')).toBe(true);
    expect(searchSelectHit(options[0]!, '012 031 99')).toBe(true);
    expect(searchSelectHit(options[0]!, '9981')).toBe(true);
    expect(searchSelectHit(options[0]!, '777')).toBe(false);
  });

  it('буквы с цифрами — запрос к названию, а не к ИНН', () => {
    expect(searchSelectHit(options[0]!, 'инн 0120')).toBe(false);
  });

  it('пустой запрос подходит всем; пустой выбор при поиске не показывается', () => {
    expect(searchSelectHit(withEmpty[0]!, '')).toBe(true);
    expect(searchSelectHit(withEmpty[0]!, 'выберите')).toBe(false);
  });

  it('строка без ИНН цифрами не находится', () => {
    expect(searchSelectHit({ value: 'x', label: 'Без ИНН' }, '123')).toBe(false);
  });
});

describe('searchSelectRows — строки окошка и курсор клавиатуры', () => {
  it('без запроса — все строки, курсор на выбранной', () => {
    const rows = searchSelectRows(withEmpty, '', 'b');
    expect(rows.shown.map((o) => o.value)).toEqual(['', 'a', 'b', 'c']);
    expect(rows.active).toBe(2);
    expect(rows.total).toBe(4);
  });

  it('с запросом — подходящие строки, курсор на первой; пробелы по краям не считаются', () => {
    const rows = searchSelectRows(withEmpty, '  осоо ', 'b');
    expect(rows.shown.map((o) => o.value)).toEqual(['a', 'c']);
    expect(rows.active).toBe(0);
  });

  it('ничего не нашлось — курсора нет', () => {
    expect(searchSelectRows(withEmpty, 'яяя', 'b')).toEqual({ shown: [], total: 0, active: -1 });
  });

  it(`показывает первые ${SEARCH_SELECT_MAX}, число всех подходящих — отдельно`, () => {
    const many = Array.from({ length: SEARCH_SELECT_MAX + 40 }, (_, i) => ({
      value: `v${i}`,
      label: `Контрагент ${i}`,
    }));
    const rows = searchSelectRows(many, 'контрагент', '');
    expect(rows.shown).toHaveLength(SEARCH_SELECT_MAX);
    expect(rows.total).toBe(SEARCH_SELECT_MAX + 40);
  });
});

describe('searchSelectMove — ↑ и ↓ не выходят за края списка', () => {
  it('вниз и вверх по строкам', () => {
    expect(searchSelectMove(-1, 3, true)).toBe(0);
    expect(searchSelectMove(1, 3, true)).toBe(2);
    expect(searchSelectMove(2, 3, true)).toBe(2);
    expect(searchSelectMove(1, 3, false)).toBe(0);
    expect(searchSelectMove(0, 3, false)).toBe(0);
    expect(searchSelectMove(-1, 3, false)).toBe(0);
  });

  it('в пустом списке курсора нет', () => {
    expect(searchSelectMove(0, 0, true)).toBe(-1);
  });
});

describe('SearchSelectFace — что написано на кнопке поля (cpsFace прототипа)', () => {
  it('название и ИНН выбранного', () => {
    const html = renderToStaticMarkup(
      <SearchSelectFace text="ОсОО «Бета»" hint="00911201710198" />,
    );
    expect(html).toContain('ОсОО «Бета»');
    expect(html).toContain('00911201710198');
    expect(html).not.toContain('text-faint"');
  });

  it('ничего не выбрано — подпись пустого выбора бледным, ИНН нет', () => {
    const html = renderToStaticMarkup(<SearchSelectFace text="— выберите контрагента —" none />);
    expect(html).toContain('truncate text-faint');
    expect(html).not.toContain('<small');
  });
});

describe('SearchSelectRows — строки окошка', () => {
  const render = (shown: SearchSelectOption[], total: number, value: string, active: number) =>
    renderToStaticMarkup(
      <SearchSelectRows
        listId="l"
        shown={shown}
        total={total}
        value={value}
        active={active}
        labels={labels}
        onPick={() => {}}
      />,
    );

  it('выбранная строка отмечена, строка под курсором помечена', () => {
    const html = render(options, 3, 'b', 0);
    expect(html.match(/role="option"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/data-active=""/g)).toHaveLength(1);
    expect(html.indexOf('data-active')).toBeLessThan(html.indexOf('aria-selected="true"'));
    expect(html).toContain('22807198500321');
  });

  it('ничего не найдено', () => {
    expect(render([], 0, '', -1)).toContain('Ничего не найдено');
  });

  it('подходящих больше, чем показано, — приписка', () => {
    expect(render(options, 340, '', 0)).toContain('Показаны первые 3 из 340 — уточните поиск');
    expect(render(options, 3, '', 0)).not.toContain('Показаны первые');
  });

  it('нажатие на строку передаёт её', () => {
    const onPick = vi.fn();
    const root = SearchSelectRows({
      listId: 'l',
      shown: options,
      total: 3,
      value: '',
      active: 0,
      labels,
      onPick,
    });
    const rows = (root.props as { children: [{ props: { onClick: () => void } }[], unknown] })
      .children[0];
    rows[2]!.props.onClick();
    expect(onPick).toHaveBeenCalledWith(options[2]);
  });
});
