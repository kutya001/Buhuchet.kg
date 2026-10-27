import { defaultUiTexts } from '@buhuchet/domain';
import type { WhoContractor } from '@buhuchet/shared';
import type { ShellModule } from '@buhuchet/ui';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { kpiMissingCount, withTabCounts } from '../shell/tab-counts';
import {
  columnSub,
  monthGenName,
  monthName,
  monthShortName,
  parseCell,
  pasteBlock,
  totalText,
  valueText,
} from './kpi-format';
import { indicatorHistoryText } from './kpi-history';
import { whoFilter, whoSub } from './kpi-who-filter';

// Подписи, ввод ячеек, фильтр «Кому вести», история показателя и счётчик «Не заполнено» (задача 2.27;
// прототип modules/kpi.js: ymLabel, ymS, kParse, kWhoFilter, log('kind', …), kMissBadge).

const t = makeTranslate(defaultUiTexts());

describe('подписи месяцев и значений', () => {
  it('месяц словами, в родительном падеже и коротко', () => {
    expect(monthName(t, '2026-10')).toBe('октябрь 2026');
    expect(monthGenName(t, '2026-10')).toBe('октября 2026');
    expect(monthShortName(t, '2026-08')).toBe('авг 26');
  });

  it('значение с единицей, пусто — пустая строка', () => {
    // Разряды — неразрывным пробелом, как в суммах «1 250,50».
    expect(valueText({ type: 'som', unit: 'сом' }, 125_000_050).replace(/\u00a0/g, ' ')).toBe(
      '1 250 000,50 сом',
    );
    expect(valueText({ type: 'int', unit: '' }, 4_200)).toBe('42');
    expect(valueText({ type: 'int', unit: 'чел.' }, null)).toBe('');
  });

  it('под названием столбца — единица или тип значения, «необязательный»', () => {
    const col = { type: 'int', unit: '', required: false } as Parameters<typeof columnSub>[1];
    expect(columnSub(t, col)).toBe('Целое число · необязательный');
    expect(columnSub(t, { ...col, unit: 'шт.', required: true })).toBe('шт.');
  });

  it('итог без значений — «—», среднее — до сотых', () => {
    expect(totalText('som', { count: 0 }, 'sum')).toBe('—');
    const totals = { count: 3, sum: 1_000, avg: 333.333, max: 500, min: 100, last: 400 };
    expect(totalText('dec', totals, 'avg')).toBe('3,33');
    expect(totalText('int', totals, 'max')).toBe('5');
  });
});

describe('ввод ячейки и вставка блока из Excel', () => {
  it('пусто — null, 0 — ноль, не число — undefined', () => {
    expect(parseCell('int', '')).toBeNull();
    expect(parseCell('int', '0')).toBe(0);
    expect(parseCell('som', '1 250,5')).toBe(125_050);
    expect(parseCell('int', 'abc')).toBeUndefined();
  });

  it('строки по переводу строки, ячейки по табуляции, последний перевод строки отбрасывается', () => {
    expect(pasteBlock('1\t2\r\n3\t4\r\n')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(pasteBlock('5\n6')).toEqual([['5'], ['6']]);
  });

  it('одна ячейка — не блок: её вставляет само поле', () => {
    expect(pasteBlock('125')).toBeNull();
    expect(pasteBlock('125\n')).toBeNull();
  });
});

const contractor = (over: Partial<WhoContractor>): WhoContractor => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Ала-Тоо Сервис',
  inn: '01234567890123',
  regimeCode: 'onr',
  regimeName: 'ОНР',
  responsibleEmployeeId: '00000000-0000-4000-8000-0000000000e1',
  responsibleName: 'Тилекова А.',
  paused: false,
  gked: ['47.11.0'],
  cells: [],
  ...over,
});

describe('фильтр контрагентов «Кому вести»', () => {
  const a = contractor({});
  const b = contractor({
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Бишкек Строй',
    inn: '99900000000001',
    regimeCode: 'en',
    regimeName: 'ЕН',
    responsibleEmployeeId: null,
    responsibleName: null,
    paused: true,
    gked: ['41.20.0', '43.99.0'],
  });
  const list = [a, b];

  it('поиск — по названию без учёта регистра и по ИНН', () => {
    expect(whoFilter(list, { q: 'ала-тоо' })).toEqual([a]);
    expect(whoFilter(list, { q: '999' })).toEqual([b]);
  });

  it('режим, ответственный («-» — без ответственного), статус, начало любого кода ГКЭД', () => {
    expect(whoFilter(list, { regime: 'en' })).toEqual([b]);
    expect(whoFilter(list, { resp: '-' })).toEqual([b]);
    expect(whoFilter(list, { resp: a.responsibleEmployeeId! })).toEqual([a]);
    expect(whoFilter(list, { status: 'active' })).toEqual([a]);
    expect(whoFilter(list, { status: 'paused' })).toEqual([b]);
    expect(whoFilter(list, { gked: '43' })).toEqual([b]);
    expect(whoFilter(list, {})).toEqual(list);
  });

  it('под названием — режим, ответственный, «приостановлен», пометка «Не ведётся с …»', () => {
    expect(whoSub(t, a)).toBe('ОНР · Тилекова А.');
    expect(whoSub(t, b, 'Не ведётся с октября 2026')).toBe(
      'ЕН · без ответственного · приостановлен · Не ведётся с октября 2026',
    );
  });
});

describe('история показателя словами', () => {
  const item = (
    action: string,
    changes: { field: string; from?: unknown; to?: unknown }[],
    contractorName: string | null = null,
  ) => ({
    at: '2026-10-27T04:00:00.000Z',
    actor: 'Садыков Э.',
    action,
    contractor: contractorName,
    changes,
  });

  it('создание и изменённые поля «было → стало»', () => {
    expect(indicatorHistoryText(t, item('create', [{ field: 'name', to: 'Выручка' }]))).toBe(
      'Создан показатель «Выручка»',
    );
    expect(
      indicatorHistoryText(
        t,
        item('update', [
          { field: 'total', from: 'sum', to: 'avg' },
          { field: 'required', from: true, to: false },
          { field: 'startMonth', from: '2026-01', to: '2026-03' },
        ]),
      ),
    ).toBe(
      'Основной итог: Сумма → Среднее; Обязательно заполнять каждый месяц: да → нет; Вести с: 01.2026 → 03.2026',
    );
  });

  it('у контрагента: «Ведётся» → «Не ведётся» и «вести с», архив', () => {
    expect(
      indicatorHistoryText(
        t,
        item('who', [{ field: 'enabled', from: true, to: false }], 'Ала-Тоо Сервис'),
      ),
    ).toBe('Ала-Тоо Сервис: «Ведётся» → «Не ведётся»');
    expect(
      indicatorHistoryText(
        t,
        item('who', [{ field: 'fromMonth', from: '2026-01', to: '2026-05' }], 'Ала-Тоо Сервис'),
      ),
    ).toBe('Ала-Тоо Сервис: вести с 01.2026 → с 05.2026');
    expect(
      indicatorHistoryText(t, item('archive', [{ field: 'archived', from: false, to: true }])),
    ).toBe('Отправлен в архив');
  });
});

describe('счётчик «Не заполнено» у вкладки и модуля', () => {
  const module: ShellModule = {
    id: 'kpi',
    title: 'Показатели контрагентов',
    icon: 'gauge',
    href: '/kpi',
    tabs: [
      { id: 'month', label: 'Ввод за месяц', icon: 'edit', href: '/kpi/month' },
      { id: 'missing', label: 'Не заполнено', icon: 'alert', href: '/kpi/missing' },
    ],
  };

  it('красный — есть просроченные, жёлтый — срок не прошёл; у модуля — тот же цветной счётчик', () => {
    const red = kpiMissingCount(t, { count: 3, overdue: true, contractors: [] });
    expect(red).toEqual({
      value: 3,
      tone: 'red',
      title: 'Не заполнены показатели, есть просроченные месяцы',
    });
    const m = withTabCounts(module, { missing: red });
    expect(m.count).toEqual(red);
    expect(m.tabs.find((x) => x.id === 'missing')?.count).toEqual(red);
    expect(kpiMissingCount(t, { count: 1, overdue: false, contractors: [] }).tone).toBe('yellow');
  });

  it('ноль — серый у вкладки, у модуля счётчика нет', () => {
    const zero = kpiMissingCount(t, { count: 0, overdue: false, contractors: [] });
    expect(zero).toEqual({ value: 0 });
    const m = withTabCounts(module, { missing: zero });
    expect(m.count).toBeUndefined();
    expect(m.tabs.find((x) => x.id === 'missing')?.count).toEqual(zero);
  });
});
