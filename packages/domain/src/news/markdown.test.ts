import { describe, expect, it } from 'vitest';
import {
  newsMdBlocks,
  newsMdImageIds,
  newsMdSpans,
  newsMdText,
  newsMdTrim,
  type NewsMdBlock,
} from './markdown';

// Ответы сверены с прототипом (modules/kb-news.js, mdHtml): все 58 новостей refDB.json и примеры ниже
// дают ту же разметку, кроме порядка вложения «жирный» и «ссылка» (выглядит одинаково).

describe('newsMdSpans — оформление строки', () => {
  it('жирный, курсив двумя способами и код; HTML остаётся текстом', () => {
    expect(newsMdSpans('А **жирный** и *курсив*, _ещё_ и `код <b>` <script>x</script>.')).toEqual([
      { text: 'А ' },
      { text: 'жирный', bold: true },
      { text: ' и ' },
      { text: 'курсив', italic: true },
      { text: ', ' },
      { text: 'ещё', italic: true },
      { text: ' и ' },
      { text: 'код <b>', code: true },
      { text: ' <script>x</script>.' },
    ]);
  });

  it('звёздочка внутри слова и без пары — не курсив', () => {
    expect(newsMdSpans('2*3*4 и *одна')).toEqual([{ text: '2*3*4 и *одна' }]);
  });

  it('ссылки: внешняя, на модуль с вкладкой, на статью; чужая схема — только текст', () => {
    expect(
      newsMdSpans(
        '[сайт](https://buhuchet.kg) [виды](#mod:dicts.types) [отчёты](#mod:reports) [статья](#art:a5) [зло](javascript:alert(1))',
      ),
    ).toEqual([
      { text: 'сайт', link: { kind: 'url', href: 'https://buhuchet.kg' } },
      { text: ' ' },
      { text: 'виды', link: { kind: 'mod', module: 'dicts', tab: 'types' } },
      { text: ' ' },
      { text: 'отчёты', link: { kind: 'mod', module: 'reports', tab: null } },
      { text: ' ' },
      { text: 'статья', link: { kind: 'art', id: 'a5' } },
      { text: ' ' },
      { text: 'зло' },
      { text: ')' },
    ]);
  });

  it('жирный внутри ссылки и ссылка внутри жирного', () => {
    expect(newsMdSpans('**см. [здесь](#art:a5)** [**тут**](#mod:kb)')).toEqual([
      { text: 'см. ', bold: true },
      { text: 'здесь', bold: true, link: { kind: 'art', id: 'a5' } },
      { text: ' ' },
      { text: 'тут', bold: true, link: { kind: 'mod', module: 'kb', tab: null } },
    ]);
  });

  it('картинка — только https или загруженная в Админке; иначе остаётся подпись', () => {
    const id = '0b9c3f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    expect(
      newsMdSpans(
        `![схема](https://img.kg/a.png) ![своя](/api/news/images/${id}) ![data](data:image/png;base64,AAAA) ![](http://x.kg/a.png)`,
      ),
    ).toEqual([
      { image: 'https://img.kg/a.png', alt: 'схема' },
      { text: ' ' },
      { image: `/api/news/images/${id}`, alt: 'своя' },
      { text: ' ' },
      { text: 'data' },
      { text: ' ' },
    ]);
    expect(newsMdImageIds(`![a](/api/news/images/${id}) ![b](https://x.kg/b.png)`)).toEqual([id]);
  });
});

describe('newsMdBlocks — блоки', () => {
  it('заголовки, абзац из нескольких строк, цитата, разделитель', () => {
    expect(
      newsMdBlocks('# Большой\n## Малый\nстрока один\nстрока два\n\n> при\n> мечание\n---'),
    ).toEqual<NewsMdBlock[]>([
      { type: 'h4', spans: [{ text: 'Большой' }] },
      { type: 'h5', spans: [{ text: 'Малый' }] },
      { type: 'p', spans: [{ text: 'строка один строка два' }] },
      { type: 'quote', spans: [{ text: 'при мечание' }] },
      { type: 'hr' },
    ]);
  });

  it('списки: вложенность по отступу, смена нумерованного на маркированный — новый список', () => {
    expect(
      newsMdBlocks('1. один\n2. два\n   - вложенный\n   - ещё\n3. три\n- другой\n- \nабзац'),
    ).toEqual<NewsMdBlock[]>([
      {
        type: 'list',
        items: [
          { depth: 0, ordered: true, spans: [{ text: 'один' }] },
          { depth: 0, ordered: true, spans: [{ text: 'два' }] },
          { depth: 1, ordered: false, spans: [{ text: 'вложенный' }] },
          { depth: 1, ordered: false, spans: [{ text: 'ещё' }] },
          { depth: 0, ordered: true, spans: [{ text: 'три' }] },
        ],
      },
      { type: 'list', items: [{ depth: 0, ordered: false, spans: [{ text: 'другой' }] }] },
      { type: 'p', spans: [{ text: 'абзац' }] },
    ]);
  });

  it('простая таблица: недостающие ячейки пустые, лишние отбрасываются', () => {
    expect(newsMdBlocks('| Было | Стало |\n|---|---|\n| 1 | **2** | 3 |\n| 4 |')).toEqual<
      NewsMdBlock[]
    >([
      {
        type: 'table',
        head: [[{ text: 'Было' }], [{ text: 'Стало' }]],
        rows: [
          [[{ text: '1' }], [{ text: '2', bold: true }]],
          [[{ text: '4' }], []],
        ],
      },
    ]);
  });

  it('строка с «|» без разделителя — обычный абзац; пустой текст — без блоков', () => {
    expect(newsMdBlocks('| не таблица')).toEqual([
      { type: 'p', spans: [{ text: '| не таблица' }] },
    ]);
    expect(newsMdBlocks('')).toEqual([]);
    expect(newsMdBlocks('\r\n\n')).toEqual([]);
  });
});

describe('newsMdText и newsMdTrim', () => {
  it('текст без разметки: без картинок, ссылки — текстом', () => {
    expect(
      newsMdText(
        '## Что нового\n- **Жирный** [ссылка](#mod:kb) ![к](https://a.kg/p.png)\n| a | b |',
      ),
    ).toBe('Что нового - Жирный ссылка a b');
  });

  it('пустые разделы шаблона убираются, заполненные остаются', () => {
    expect(
      newsMdTrim(
        '## Что нового\n- Пункт\n\n## Изменено\n- \n\n## Исправлено\n- \n\n\n\n## Где найти\n- Тут\n',
      ),
    ).toBe('## Что нового\n- Пункт\n\n## Где найти\n- Тут');
    expect(newsMdTrim('Вступление\n## Изменено\n- ')).toBe('Вступление');
  });
});
