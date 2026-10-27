import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { xlsxResponse } from './export';

// Заголовки ответа «В Excel»: сколько строк в файле, все ли вошли и сколько записей под фильтрами —
// по ним экран пишет «Выгружено 50 000 строк из 62 300 — сузьте фильтр…» (ТЗ «Списки»).
describe('ответ выгрузки «В Excel»', () => {
  const app = (more: boolean, total: number) =>
    new Hono().get('/', (c) =>
      xlsxResponse(c, {
        title: 'Сотрудники',
        today: new Date('2026-10-27T06:00:00Z'),
        columns: [{ label: 'col.name', type: 'text' }],
        rows: [['Айгерим'], ['Нурлан']],
        more,
        total,
        t: (key) => key,
      }),
    );

  it('вошли все — числа записей под фильтрами в заголовках нет', async () => {
    const res = await app(false, 2).request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-export-rows')).toBe('2');
    expect(res.headers.get('x-export-more')).toBe('0');
    expect(res.headers.get('x-export-total')).toBeNull();
  });

  it('вошли не все — сколько записей под фильтрами всего', async () => {
    const res = await app(true, 62_300).request('/');
    expect(res.headers.get('x-export-rows')).toBe('2');
    expect(res.headers.get('x-export-more')).toBe('1');
    expect(res.headers.get('x-export-total')).toBe('62300');
  });
});
