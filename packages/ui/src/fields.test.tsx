import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { inputClass, Tag, type FieldControl } from './form';
import { MiniTable, miniWide } from './mini-table';
import { PhoneInput, type PhoneInputCode, type PhoneInputValue } from './phone-input';
import { Segments } from './segments';

// Поля и мелочи карточек из задачи #18: телефон по маске страны, переключатель, маленькая таблица,
// ярлык. Разметка — renderToStaticMarkup, обработчики — вызовом компонента как функции.

const CODES: PhoneInputCode[] = [
  { cc: 'KG', flag: '🇰🇬', code: '996', mask: 'XXX XXX XXX', active: true },
  { cc: 'KZ', flag: '🇰🇿', code: '7', mask: 'XXX XXX XX XX', active: true },
  { cc: 'UZ', flag: '🇺🇿', code: '998', mask: 'XX XXX XX XX', active: false },
];
const CONTROL: FieldControl = { id: 'phone' };

type Props = { onChange: (v: unknown) => void } & Record<string, unknown>;
/** Список кодов и поле номера из разметки `PhoneInput`. */
function phoneParts(value: PhoneInputValue, onChange: (v: PhoneInputValue) => void) {
  const root = PhoneInput({ codes: CODES, value, onChange, control: CONTROL, codeLabel: 'Код' });
  const [select, input] = (root.props as { children: ReactElement<Props>[] }).children;
  return { select: select!.props, input: input!.props };
}

describe('PhoneInput — телефон по маске страны (прототип phoneInput)', () => {
  it('номер показывается по маске, подсказка — маска нулями, выключенной страны в списке нет', () => {
    const html = renderToStaticMarkup(
      <PhoneInput
        codes={CODES}
        value={{ cc: 'KG', local: '5551002' }}
        onChange={() => {}}
        control={CONTROL}
        codeLabel="Код страны"
      />,
    );
    expect(html).toContain('value="555 100 2"');
    expect(html).toContain('placeholder="000 000 000"');
    expect(html).toContain('aria-label="Код страны"');
    expect(html).toContain('🇰🇬 +996');
    expect(html).toContain('🇰🇿 +7');
    expect(html).not.toContain('+998');
    // id и признаки ошибки от Field — у поля номера.
    expect(html).toMatch(/<input[^>]*id="phone"/);
  });

  it('выключенная страна остаётся в списке, если номер уже с ней', () => {
    const { select } = phoneParts({ cc: 'UZ', local: '901234567' }, () => {});
    const html = renderToStaticMarkup(<select {...select} />);
    expect(html).toContain('+998');
  });

  it('вводятся только цифры и не больше, чем в маске', () => {
    let got: PhoneInputValue | null = null;
    const { input } = phoneParts({ cc: 'KG', local: '' }, (v) => (got = v));
    input.onChange({ target: { value: '(555) 100-200-999' } });
    expect(got).toEqual({ cc: 'KG', local: '555100200' });
  });

  it('смена страны обрезает номер по её маске', () => {
    let got: PhoneInputValue | null = null;
    const { select } = phoneParts({ cc: 'KZ', local: '7011234567' }, (v) => (got = v));
    select.onChange({ target: { value: 'KG' } });
    expect(got).toEqual({ cc: 'KG', local: '701123456' });
  });

  it('список кодов — своей ширины: без w-full', () => {
    expect(inputClass({ full: false }).split(' ')).not.toContain('w-full');
    expect(inputClass().split(' ')).toContain('w-full');
    const { select } = phoneParts({ cc: 'KG', local: '' }, () => {});
    expect(String(select.className).split(' ')).toContain('w-[118px]');
    expect(String(select.className).split(' ')).not.toContain('w-full');
  });
});

describe('Segments — переключатель (прототип .seg, .seg.sm)', () => {
  const options = [
    { value: 'own', label: 'Свои' },
    { value: 'all', label: 'Все' },
  ] as const;

  it('выбранная кнопка нажата, группа подписана; маленький размер — свои отступы', () => {
    const html = renderToStaticMarkup(
      <Segments options={options} value="all" onChange={() => {}} label="Область" size="sm" />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Область"');
    expect(html).toContain('data-segments');
    expect(html).toMatch(/aria-pressed="true"[^>]*>(<[^>]+>)*Все/);
    expect(html).toContain('min-h-6');
    expect(html).not.toContain('min-h-[26px]');
    const md = renderToStaticMarkup(
      <Segments options={options} value="own" onChange={() => {}} label="Область" fill />,
    );
    expect(md).toContain('min-h-[26px]');
    expect(md).toContain('flex-1');
  });

  it('нажатие сообщает значение', () => {
    let got = '';
    const root = Segments({ options, value: 'own', onChange: (v) => (got = v), label: 'Область' });
    const buttons = (root.props as { children: ReactElement<{ onClick: () => void }>[] }).children;
    buttons[1]!.props.onClick();
    expect(got).toBe('all');
  });

  it('закрытый выбор — кнопки неактивны', () => {
    const html = renderToStaticMarkup(
      <Segments options={options} value="own" onChange={() => {}} label="Область" disabled />,
    );
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
    const open = renderToStaticMarkup(
      <Segments options={options} value="own" onChange={() => {}} label="Область" />,
    );
    expect(open).not.toContain('disabled=""');
  });
});

describe('MiniTable — маленькая таблица карточки (прототип table.mini.m-cards)', () => {
  const columns = [
    { key: 'name', label: 'Контрагент' },
    { key: 'open', label: 'Несданных', numeric: true },
  ];

  it('пустая — одна строка с серым текстом на все столбцы, шапка на месте', () => {
    const html = renderToStaticMarkup(
      <MiniTable columns={columns} rows={[]} empty="Нет закреплённых" label="Контрагенты" />,
    );
    expect(html).toContain('aria-label="Контрагенты"');
    expect(html).toContain('<th scope="col"');
    expect(html).toContain('colSpan="2"');
    expect(html).toContain('Нет закреплённых');
  });

  it('строки — ячейки по ключам; на телефоне подпись столбца у значения, первый столбец — заголовок', () => {
    const html = renderToStaticMarkup(
      <MiniTable
        columns={columns}
        rows={[{ key: '1', cells: { name: 'ОсОО «Ала-Тоо»', open: 3 } }]}
        empty="—"
        label="Контрагенты"
      />,
    );
    expect(html).toContain('ОсОО «Ала-Тоо»');
    expect(html).toContain('data-label="Несданных"');
    expect(html).toContain('max-md:col-span-2');
    expect(html).toContain('md:text-right');
  });

  it('на телефоне кнопки строки — в правом верхнем углу, длинное значение — на всю ширину (прототип mCardsTable)', () => {
    const cells = (html: string) => html.split('<td').slice(1);
    const html = renderToStaticMarkup(
      <MiniTable
        columns={[...columns, { key: 'act', label: '', actions: true }]}
        rows={[
          {
            key: '1',
            cells: { name: 'ОсОО «Ала-Тоо»', open: 'Бакай Банк, M-Bank, О!Банк', act: 'x' },
            wide: miniWide({ open: 'Бакай Банк, M-Bank, О!Банк' }),
          },
        ]}
        empty="—"
        label="Счета"
      />,
    );
    const [title, open, act] = cells(html);
    expect(html).toContain('max-md:relative');
    expect(title).toContain('max-md:pr-10');
    expect(open).toContain('max-md:col-span-2');
    expect(act).toContain('max-md:absolute');
    expect(act).not.toContain('content-[attr(data-label)]');
  });

  it('headless — без строки заголовков и без подписей у значений на телефоне (прототип staff.js)', () => {
    const html = renderToStaticMarkup(
      <MiniTable
        columns={columns}
        rows={[{ key: '1', cells: { name: 'Optima Bank', open: 'Основной' } }]}
        empty="—"
        label="Реквизиты"
        headless
      />,
    );
    expect(html).toContain('<thead class="hidden">');
    expect(html).not.toContain('content-[attr(data-label)]');
  });

  it('miniWide — ключи значений длиннее 22 знаков без лишних пробелов', () => {
    expect(
      miniWide({ short: 'Optima Bank', long: 'Бакай Банк, M-Bank, О!Банк', spaced: '  a   b  ' }),
    ).toEqual(['long']);
  });
});

describe('Tag — ярлык рядом с названием', () => {
  it('текст, подсказка и значок', () => {
    const html = renderToStaticMarkup(
      <Tag icon="lock" title="Область задана правом">
        Все
      </Tag>,
    );
    expect(html).toContain('data-tag');
    expect(html).toContain('title="Область задана правом"');
    expect(html).toContain('Все');
    expect(html).toContain('<svg');
  });
});
