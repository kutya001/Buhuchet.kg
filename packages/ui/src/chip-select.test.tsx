import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CheckList, ChipSelect } from './chip-select';

// Поля реквизита (задача 2.18): вид плашками и банки номера галочками. Разметка —
// renderToStaticMarkup, обработчики — вызовом компонента как функции.

type Clickable = { props: { onClick?: () => void; children?: unknown } };
type Checkable = { props: { children: ReactElement<{ onChange: (e: unknown) => void }>[] } };

describe('ChipSelect — выбор одного варианта плашками (прототип .chipsel)', () => {
  const options = [
    { value: 'acc', label: 'Расчётный счёт' },
    { value: 'phone', label: 'Перевод по номеру телефона' },
  ] as const;

  it('выбранная плашка нажата, группа подписана', () => {
    const html = renderToStaticMarkup(
      <ChipSelect label="Вид реквизита" options={options} value="phone" onChange={() => {}} />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Вид реквизита"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.indexOf('aria-pressed="true"')).toBeGreaterThan(html.indexOf('Расчётный счёт'));
  });

  it('нажатие на плашку передаёт её значение', () => {
    const onChange = vi.fn();
    const root = ChipSelect({ label: 'Вид', options, value: 'acc', onChange });
    const buttons = (root.props as { children: Clickable[] }).children;
    buttons[1]!.props.onClick!();
    expect(onChange).toHaveBeenCalledWith('phone');
  });
});

describe('CheckList — список галочек в рамке (прототип .fl-list)', () => {
  const options = [
    { value: 'b2', label: 'Бакай Банк' },
    { value: 'b13', label: 'M-Bank' },
    { value: 'b17', label: 'О!Банк' },
  ];

  it('отмеченные — по порядку списка, а не по порядку нажатий; снятая уходит', () => {
    const onChange = vi.fn();
    const root = CheckList({ label: 'Банки', options, value: ['b17'], onChange });
    const labels = (root.props as { children: Checkable[] }).children;
    const input = (i: number) => labels[i]!.props.children[0]!;
    input(0).props.onChange({ target: { checked: true } });
    expect(onChange).toHaveBeenLastCalledWith(['b2', 'b17']);
    input(2).props.onChange({ target: { checked: false } });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('ошибка — красная рамка и aria-invalid', () => {
    const html = renderToStaticMarkup(
      <CheckList label="Банки" options={options} value={[]} onChange={() => {}} invalid />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('border-danger');
  });
});
