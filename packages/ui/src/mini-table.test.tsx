import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MiniTable } from './mini-table';

describe('Маленькая таблица карточки (прототип `table.mini.m-cards`)', () => {
  it('итоговая строка (прототип `tr.m-total`) отмечена и не открывается; обычная строка открывается', () => {
    const html = renderToStaticMarkup(
      <MiniTable
        label="Оплаты (транши) · 1"
        empty=""
        onOpen={vi.fn()}
        columns={[
          { key: 'date', label: 'Дата' },
          { key: 'note', label: 'Комментарий' },
          { key: 'amount', label: 'Сумма', numeric: true },
        ]}
        rows={[
          { key: 't1', cells: { date: '15.10.2026', note: 'Аванс', amount: '50 000,00' } },
          {
            key: 'total',
            total: true,
            blank: ['note'],
            cells: { date: 'Получено', amount: '50 000,00' },
          },
        ]}
      />,
    );
    const rows = html.split('<tr').slice(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('data-open=""');
    expect(rows[0]).not.toContain('data-mini-total=""');
    expect(rows[1]).toContain('data-mini-total=""');
    expect(rows[1]).not.toContain('data-open=""');
    expect(rows[1]).not.toContain('tabindex');
    expect(rows[1]).toContain('Получено');
  });

  it('с `onMenu` строка с `menu` получает меню (правый клик, долгое нажатие), итоговая — нет (прототип v110 `.rm-list`)', () => {
    const html = renderToStaticMarkup(
      <MiniTable
        label="За октябрь 2026"
        empty=""
        onOpen={vi.fn()}
        onMenu={vi.fn()}
        columns={[
          { key: 'type', label: 'Отчёт' },
          { key: 'amount', label: 'К уплате', numeric: true },
        ]}
        rows={[
          { key: 'r1', menu: true, cells: { type: 'НДС', amount: '1 000,00' } },
          { key: 'r2', cells: { type: '1-Т', amount: '—' } },
          { key: 'total', total: true, menu: true, cells: { type: 'Итого', amount: '1 000,00' } },
        ]}
      />,
    );
    const rows = html.split('<tr').slice(2);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('data-open=""');
    expect(rows[0]).toContain('tabindex="0"');
    // Без меню строка всё равно открывает карточку.
    expect(rows[1]).toContain('data-open=""');
    expect(rows[2]).not.toContain('data-open=""');
    expect(rows[2]).not.toContain('tabindex');
  });
});
