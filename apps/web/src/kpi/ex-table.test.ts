import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { follow, keyIndex, pasteWrites, selectionTsv, undoWrites, type ExCell } from './ex-table';
import { cellChanges, cellOk, cellText, exCellOf, putCells, type KxRef } from './kpi-ex';

// Таблица как в Excel (прототип v81 ui/extable.js `paste`, `copy`; modules/kpi.js `kTxt`, `kCellOk`,
// `kNoWhy`, `kPutAll`).

const t = makeTranslate(defaultUiTexts());

const ref = (over: Partial<KxRef> = {}): KxRef => ({
  contractorId: '00000000-0000-4000-8000-000000000001',
  indicatorId: '00000000-0000-4000-8000-0000000000a1',
  type: 'som',
  required: true,
  archived: false,
  month: '2026-10',
  state: 'required',
  start: '2026-01',
  offSince: null,
  value: null,
  editable: true,
  ...over,
});

describe('вставка блока', () => {
  const size = { rows: 5, cols: 3 };

  it('одно значение в выделенный диапазон — во все ячейки', () => {
    const { writes, select } = pasteWrites('7\n', { r0: 0, r1: 1, c0: 0, c1: 1 }, size);
    expect(writes).toEqual([
      { r: 0, c: 0, t: '7' },
      { r: 0, c: 1, t: '7' },
      { r: 1, c: 0, t: '7' },
      { r: 1, c: 1, t: '7' },
    ]);
    expect(select).toBeUndefined();
  });

  it('блок, который укладывается в диапазон целое число раз, повторяется', () => {
    const { writes } = pasteWrites('1\r\n2\r\n', { r0: 0, r1: 3, c0: 2, c1: 2 }, size);
    expect(writes.map((w) => w.t)).toEqual(['1', '2', '1', '2']);
  });

  it('иначе — от левого верхнего угла, за край таблицы не выходит; выделение — по блоку', () => {
    const { writes, select } = pasteWrites(
      '1\t2\t3\n4\t5\t6',
      { r0: 4, r1: 4, c0: 1, c1: 1 },
      size,
    );
    expect(writes).toEqual([
      { r: 4, c: 1, t: '1' },
      { r: 4, c: 2, t: '2' },
    ]);
    expect(select).toEqual({ a: { r: 4, c: 1 }, e: { r: 4, c: 2 } });
  });
});

describe('ячейки по ключу после перерисовки', () => {
  // Две строки (контрагенты A и B) × два месяца; ключ — контрагент|месяц.
  const grid = (rows: string[], months: string[]) =>
    keyIndex({ rows: rows.length, cols: months.length }, (r, c) => `${rows[r]}|${months[c]}`);
  const size = { rows: 2, cols: 2 };

  it('строки переставились (сортировка, перечитанный список) — выделение, правка и отмена идут за ячейкой', () => {
    const before = grid(['A', 'B'], ['2026-09', '2026-10']);
    const after = grid(['B', 'A'], ['2026-09', '2026-10']);
    expect(follow(before.keys, after.pos, { r: 0, c: 1 }, size)).toEqual({ r: 1, c: 1 });
    expect(undoWrites([{ r: 0, c: 1, k: 'A|2026-10', t: '100' }], after.pos)).toEqual([
      { r: 1, c: 1, t: '100' },
    ]);
  });

  it('другой месяц на экране — прежней ячейки нет: выделение сбрасывается, отмена её не трогает', () => {
    const october = grid(['A', 'B'], ['2026-10']);
    const september = grid(['A', 'B'], ['2026-09']);
    expect(follow(october.keys, september.pos, { r: 0, c: 0 }, { rows: 2, cols: 1 })).toBeNull();
    expect(undoWrites([{ r: 0, c: 0, k: 'A|2026-10', t: '' }], september.pos)).toEqual([]);
  });

  it('ячейка без значения (без ключа) остаётся на своём месте; за краем таблицы — нет', () => {
    const none = keyIndex(size, () => null);
    expect(follow(none.keys, none.pos, { r: 1, c: 0 }, size)).toEqual({ r: 1, c: 0 });
    expect(follow([], new Map(), { r: 3, c: 0 }, size)).toBeNull();
  });
});

describe('копирование выделения', () => {
  it('строки — через перевод строки, ячейки — через табуляцию, тексты как для правки', () => {
    const get = (r: number, c: number): ExCell => ({ t: `${r}${c}`, n: null, ed: true, why: '' });
    expect(selectionTsv({ r0: 0, r1: 1, c0: 1, c1: 2 }, get)).toBe('01\t02\n11\t12');
  });
});

describe('ячейки показателей', () => {
  it('текст для правки и копирования: без пробелов, копейки через запятую', () => {
    expect(cellText('som', 125_050)).toBe('1250,5');
    expect(cellText('som', -30_000)).toBe('-300');
    expect(cellText('int', 1_200)).toBe('12');
    expect(cellText('dec', null)).toBe('');
  });

  it('вносить можно, если показатель ведётся или месяц раньше «с …» и месяц не позже текущего', () => {
    expect(cellOk(ref(), '2026-11')).toBe(true);
    expect(cellOk(ref({ state: 'early' }), '2026-11')).toBe(true);
    expect(cellOk(ref({ state: 'off' }), '2026-11')).toBe(false);
    expect(cellOk(ref({ archived: true }), '2026-11')).toBe(false);
    expect(cellOk(ref({ month: '2026-12' }), '2026-11')).toBe(false);
  });

  it('почему ячейку не изменить', () => {
    expect(exCellOf(t, ref({ month: '2026-12' }), '2026-11')).toMatchObject({
      ed: false,
      why: 'Месяц ещё не начался',
    });
    expect(exCellOf(t, ref({ state: 'off', offSince: '2026-09' }), '2026-11').why).toBe(
      'Не ведётся с сентября 2026',
    );
    expect(exCellOf(t, ref({ editable: false, value: 1_200 }), '2026-11')).toEqual({
      t: '12',
      n: 1_200,
      ed: false,
      why: 'Вносит ответственный, главный бухгалтер или владелец',
    });
    expect(exCellOf(t, null, '2026-11')).toMatchObject({ ed: false, why: 'Здесь значения нет' });
  });

  it('записи → изменения: не число — отдельно, то же значение и повтор ячейки — не изменение', () => {
    const cells = [ref({ value: 10_000 }), ref({ indicatorId: 'b', value: null })];
    const at = (_r: number, c: number) => cells[c] ?? null;
    const { changes, bad } = cellChanges(
      [
        { r: 0, c: 0, t: '100' },
        { r: 0, c: 1, t: '1 250,5' },
        { r: 0, c: 1, t: '5' },
        { r: 0, c: 2, t: '9' },
        { r: 1, c: 0, t: 'abc ' },
      ],
      at,
    );
    expect(bad).toEqual(['abc']);
    expect(changes).toEqual([
      {
        r: 0,
        c: 1,
        contractorId: cells[1]!.contractorId,
        indicatorId: 'b',
        month: '2026-10',
        value: 125_050,
        prev: null,
      },
    ]);
  });

  it('сервер не записал — ни одна ячейка не изменена', async () => {
    const at = () => ref();
    const write = [{ r: 0, c: 0, t: '5' }];
    expect(await putCells(write, at, async () => false)).toEqual({
      bad: [],
      changed: [],
      failed: true,
    });
    expect(await putCells(write, at, async () => true)).toEqual({
      bad: [],
      changed: [{ r: 0, c: 0 }],
    });
  });
});
