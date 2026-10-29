import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import { ADMIN_DICT_META, ADMIN_VALUE_DICTS } from './admin';
import { NEW_REPORT_TYPE } from './admin-types';
import {
  IO_COLUMNS,
  ioCellText,
  ioChanges,
  ioCodeValid,
  ioHeader,
  ioMerge,
  ioNewValue,
  ioRow,
  ioTsv,
  parseIoCell,
  parseIoRows,
  parseIoText,
  type IoContext,
  type IoValue,
} from './io';

const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const ctx: IoContext = {
  t,
  refs: {
    organs: [
      { code: 'ОРГ-01', label: 'ГНС' },
      { code: 'ОРГ-02', label: 'Соцфонд' },
    ],
    regimes: [
      { code: 'РЕЖ-01', label: 'Общий' },
      { code: 'РЕЖ-02', label: 'ЕН' },
    ],
    bases: [{ code: 'employees', label: 'Есть сотрудники' }],
    types: [
      { code: 'nds', label: 'НДС', alt: ['Налог на добавленную стоимость'] },
      { code: 'soc', label: 'Соцфонд' },
    ],
    ugns: [{ code: 'ugns-lenin', label: 'Ленинский', alt: ['002'] }],
  },
};

const nds: IoValue = {
  code: 'nds',
  name: 'Налог на добавленную стоимость',
  active: true,
  data: {
    ...ioNewValue('types', 'nds').data,
    shortName: 'НДС',
    formCode: 'STI-062',
    authorityCode: 'ОРГ-01',
    period: 'M',
    dueDay: 25,
    dueAfter: 1,
    dueMonth: null,
    kind: 'regime',
    act: 'both',
    payments: [{ name: 'НДС', authority: 'ОРГ-01', kbk: '11111' }],
    regimes: ['РЕЖ-01'],
    bizSizes: ['small', 'large'],
    paySchedule: [
      [3, 20],
      [6, 20],
    ],
  },
};

/** Загрузить строку файла, как она выгружена, и сравнить со значением. */
const roundTrip = (dict: (typeof ADMIN_VALUE_DICTS)[number], x: IoValue) => {
  const parsed = parseIoRows(dict, [ioHeader(dict, t), ioRow(dict, x, ctx)], ctx);
  if ('fatal' in parsed) throw new Error(parsed.fatal);
  const [row] = parsed.rows;
  expect(row!.errors).toEqual([]);
  return ioChanges(parsed.columns, x, ioMerge(x, row!.values), ctx);
};

describe('Выгрузка и загрузка справочников: столбцы файла', () => {
  it('у каждого справочника первый столбец — код, у каждого поля значения — столбец, заголовки разные', () => {
    for (const dict of ADMIN_VALUE_DICTS) {
      const keys = IO_COLUMNS[dict].map((c) => c.key);
      expect(keys[0]).toBe('code');
      expect(keys).toContain('active');
      for (const f of ADMIN_DICT_META[dict].fields) expect(keys, `${dict}.${f}`).toContain(f);
      const titles = ioHeader(dict, t);
      expect(new Set(titles).size, dict).toBe(titles.length);
    }
  });

  it('строка вида отчёта — словами прототипа: орган и режимы названием, «Да»/«Нет», платежи через «/»', () => {
    const row = Object.fromEntries(IO_COLUMNS.types.map((c) => [c.key, ioCellText(c, nds, ctx)]));
    expect(row).toMatchObject({
      code: 'nds',
      shortName: 'НДС',
      authorityCode: 'ГНС',
      period: 'Месяц',
      dueDay: '25',
      dueAfter: '1',
      dueMonth: '',
      kind: 'Режимный',
      act: 'Сдача + уплата',
      payments: 'НДС / ГНС / 11111',
      regimes: 'Общий',
      bizSizes: 'Малый; Крупный',
      paySchedule: '20.03; 20.06',
      shiftToWorkday: 'Да',
      oneOff: 'Нет',
      active: 'Да',
    });
    // У годового — «Месяц следующего года», «Месяцев после» пусто.
    const yearly = { ...nds, data: { ...nds.data, period: 'Y', dueAfter: null, dueMonth: 4 } };
    const cell = (key: string) =>
      ioCellText(
        IO_COLUMNS.types.find((c) => c.key === key)!,
        yearly,
        ctx,
      );
    expect([cell('dueAfter'), cell('dueMonth')]).toEqual(['', '4']);
  });

  it('выгруженная строка загружается без изменений у каждого справочника', () => {
    expect(roundTrip('types', nds)).toEqual([]);
    const benefit: IoValue = {
      ...ioNewValue('benefits', 'ЛЬГ-30'),
      name: 'Крупный налогоплательщик',
      data: {
        ...ioNewValue('benefits', 'ЛЬГ-30').data,
        gives: 'Сдаёт в УГНС по крупным',
        validUntil: '2026-12-31',
        removes: ['soc'],
        offices: ['ugns-lenin'],
        dueRules: [
          {
            reportType: 'nds',
            dueDay: 31,
            dueAfter: 1,
            dueMonth: null,
            payDay: 25,
            payAfter: 1,
          },
          {
            reportType: 'soc',
            dueDay: 30,
            dueAfter: null,
            dueMonth: 4,
            payDay: null,
            payAfter: null,
          },
        ],
      },
    };
    expect(roundTrip('benefits', benefit)).toEqual([]);
    expect(
      ioCellText(
        IO_COLUMNS.benefits.find((c) => c.key === 'dueRules')!,
        benefit,
        ctx,
      ),
    ).toBe('nds: сдача последний+1; уплата 25+1 | soc: сдача 30.04');
    const organ: IoValue = {
      ...ioNewValue('organs', 'ОРГ-01'),
      name: 'ГНС',
      data: {
        ...ioNewValue('organs', 'ОРГ-01').data,
        contacts: [
          { label: 'Колл-центр', value: '1202' },
          { label: '', value: '+996 312 00 00 00' },
        ],
        site: 'https://sti.gov.kg',
      },
    };
    expect(roundTrip('organs', organ)).toEqual([]);
    // Новое значение с заполненными обязательными текстами; вид отчёта (обязателен ещё орган) — выше, на НДС.
    for (const dict of ADMIN_VALUE_DICTS.filter((d) => d !== 'types')) {
      const x = ioNewValue(dict, 'X-1');
      const data = { ...x.data };
      for (const c of IO_COLUMNS[dict]) {
        if (c.required && c.field.type === 'text' && c.key in data) data[c.key] = 'Значение';
      }
      expect(roundTrip(dict, { ...x, name: 'Значение', data }), dict).toEqual([]);
    }
  });

  it('одна изменённая ячейка — одно изменение «было → стало»; отключение — «Активно»', () => {
    const header = ioHeader('types', t);
    const row = ioRow('types', nds, ctx);
    row[header.indexOf('Срок: число')] = '28';
    const parsed = parseIoRows('types', [header, row], ctx);
    if ('fatal' in parsed) throw new Error(parsed.fatal);
    const after = ioMerge(nds, parsed.rows[0]!.values);
    expect(ioChanges(parsed.columns, nds, after, ctx)).toEqual([
      { key: 'dueDay', title: 'Срок: число', from: '25', to: '28' },
    ]);
    row[header.indexOf('Активен')] = 'нет';
    const off = parseIoRows('types', [header, row], ctx);
    if ('fatal' in off) throw new Error(off.fatal);
    expect(ioMerge(nds, off.rows[0]!.values).active).toBe(false);
  });

  it('столбцов, которых нет в файле, значение не теряет; лишние столбцы пропускаются', () => {
    const parsed = parseIoRows(
      'types',
      [
        ['код', 'КРАТКО', 'Лишний столбец'],
        ['nds', 'НДС-2', 'что-то'],
      ],
      ctx,
    );
    if ('fatal' in parsed) throw new Error(parsed.fatal);
    expect(parsed.columns.map((c) => c.key)).toEqual(['code', 'shortName']);
    const after = ioMerge(nds, parsed.rows[0]!.values);
    expect(after.data).toEqual({ ...nds.data, shortName: 'НДС-2' });
    expect(ioChanges(parsed.columns, nds, after, ctx)).toEqual([
      { key: 'shortName', title: 'Кратко', from: 'НДС', to: 'НДС-2' },
    ]);
  });
});

describe('Выгрузка и загрузка справочников: разбор', () => {
  it('без столбца «Код» и без строк данных — ошибка файла', () => {
    expect(parseIoRows('forms', [['Код', 'Название']], ctx)).toEqual({ fatal: 'no_rows' });
    expect(
      parseIoRows(
        'forms',
        [
          ['Название', 'Активно'],
          ['ОсОО', 'Да'],
        ],
        ctx,
      ),
    ).toEqual({ fatal: 'no_code' });
  });

  it('ошибки строки: пустое обязательное, неверные числа и «да/нет», нет в справочнике, код повторяется', () => {
    const header = [
      'Код',
      'Название',
      'Кратко',
      'Орган',
      'Срок: число',
      'Разовый',
      'Применимые режимы',
    ];
    const parsed = parseIoRows(
      'types',
      [
        header,
        ['nds', '', 'НДС', 'Минфин', '40', 'может быть', 'Общий; Патент'],
        ['nds', 'НДС', 'НДС', 'ГНС', '', '', ''],
        ['', 'Без кода', 'Б', 'ГНС', '', '', ''],
      ],
      ctx,
    );
    if ('fatal' in parsed) throw new Error(parsed.fatal);
    expect(parsed.rows.map((r) => [r.line, r.code, r.errors])).toEqual([
      [
        2,
        'nds',
        [
          'Название: не заполнено',
          'Орган: органа «Минфин» нет в справочнике',
          'Срок: число: число от 1 до 31',
          'Применимые режимы: режима «Патент» нет в справочнике',
          'Разовый: да или нет',
        ],
      ],
      [3, 'nds', ['код повторяется в файле']],
      [4, '', ['нет кода']],
    ]);
  });

  it('пустые ячейки: число срока и «да/нет» — как было, свой срок оплаты — «как срок сдачи», текст и список — пусто', () => {
    const cell = (key: string, text: string) =>
      parseIoCell(
        IO_COLUMNS.types.find((c) => c.key === key)!,
        text,
        ctx,
      );
    expect(cell('dueDay', '')).toEqual({ value: undefined });
    expect(cell('payDay', '')).toEqual({ value: null });
    expect(cell('preselect', '')).toEqual({ value: undefined });
    expect(cell('kind', '')).toEqual({ value: undefined });
    expect(cell('formCode', '  ')).toEqual({ value: '' });
    expect(cell('regimes', '')).toEqual({ value: [] });
    expect(cell('paySchedule', '')).toEqual({ value: null });
    expect(cell('paySchedule', '20.13')).toEqual({ error: t('pdicts.err.schedule') });
  });

  it('значения — по подписи без учёта регистра и «ё», по коду или другому написанию', () => {
    const cell = (key: string, text: string) =>
      parseIoCell(
        IO_COLUMNS.types.find((c) => c.key === key)!,
        text,
        ctx,
      );
    expect(cell('act', 'сдача + УПЛАТА')).toEqual({ value: 'both' });
    expect(cell('act', 'both')).toEqual({ value: 'both' });
    expect(cell('act', 'Оплата')).toEqual({
      error: 'одно из: Сдача, Уплата, Сдача + уплата',
    });
    expect(cell('authorityCode', 'соцфонд')).toEqual({ value: 'ОРГ-02' });
    expect(cell('authorityCode', 'ОРГ-01')).toEqual({ value: 'ОРГ-01' });
    expect(cell('bases', 'есть сотрудники; employees')).toEqual({ value: ['employees'] });
    expect(cell('bizSizes', 'Крупный; малый')).toEqual({ value: ['small', 'large'] });
    expect(cell('shiftToWorkday', 'нет')).toEqual({ value: false });
    expect(cell('shiftToWorkday', '1')).toEqual({ value: true });
    const benefit = (key: string, text: string) =>
      parseIoCell(
        IO_COLUMNS.benefits.find((c) => c.key === key)!,
        text,
        ctx,
      );
    expect(benefit('removes', 'Налог на добавленную стоимость')).toEqual({ value: ['nds'] });
    expect(benefit('offices', '002')).toEqual({ value: ['ugns-lenin'] });
    expect(benefit('kind', 'статус')).toEqual({ value: 'status' });
  });

  it('«Что уплачивается»: «Платёж / Орган / КБК»; без органа — пусто; неизвестный орган — ошибка', () => {
    const cell = (text: string) =>
      parseIoCell(
        IO_COLUMNS.types.find((c) => c.key === 'payments')!,
        text,
        ctx,
      );
    expect(cell('Подоходный налог / ГНС; Страховые взносы / Соцфонд / 123')).toEqual({
      value: [
        { name: 'Подоходный налог', authority: 'ОРГ-01', kbk: '' },
        { name: 'Страховые взносы', authority: 'ОРГ-02', kbk: '123' },
      ],
    });
    expect(cell('Пошлина')).toEqual({ value: [{ name: 'Пошлина', authority: '', kbk: '' }] });
    expect(cell('Пошлина / Минюст')).toEqual({ error: 'органа «Минюст» нет в справочнике' });
    expect(cell('А / Б / В / Г')).toEqual({ error: t('pdicts.io.err.payments') });
  });

  it('«Меняет сроки»: «код: сдача 20+1; уплата 25»; неверный формат и неизвестный вид — ошибка', () => {
    const cell = (text: string) =>
      parseIoCell(
        IO_COLUMNS.benefits.find((c) => c.key === 'dueRules')!,
        text,
        ctx,
      );
    expect(cell('НДС: сдача ПОСЛЕДНИЙ + 2; уплата 25')).toEqual({
      value: [
        { reportType: 'nds', dueDay: 31, dueAfter: 2, dueMonth: null, payDay: 25, payAfter: null },
      ],
    });
    expect(cell('nds: сдача 40+1')).toEqual({ error: t('pdicts.io.err.due_rules') });
    expect(cell('nds: уплата 20.04')).toEqual({ error: t('pdicts.io.err.due_rules') });
    expect(cell('nds сдача 20+1')).toEqual({ error: t('pdicts.io.err.due_rules') });
    expect(cell('pn: сдача 20+1')).toEqual({ error: 'вида «pn» нет в каталоге' });
  });

  it('«Действует до»: ДД.ММ.ГГГГ, ГГГГ-ММ-ДД или дата Excel числом; пусто — без даты', () => {
    const cell = (text: string) =>
      parseIoCell(
        IO_COLUMNS.benefits.find((c) => c.key === 'validUntil')!,
        text,
        ctx,
      );
    expect(cell('31.12.2026')).toEqual({ value: '2026-12-31' });
    expect(cell('1.2.2027')).toEqual({ value: '2027-02-01' });
    expect(cell('2026-12-31')).toEqual({ value: '2026-12-31' });
    expect(cell('46387')).toEqual({ value: '2026-12-31' });
    expect(cell('')).toEqual({ value: null });
    expect(cell('31.02.2026')).toEqual({ error: 'дата — ДД.ММ.ГГГГ' });
  });

  it('телефоны органа: «Подпись: номер»; без подписи — только номер', () => {
    const cell = (text: string) =>
      parseIoCell(
        IO_COLUMNS.organs.find((c) => c.key === 'contacts')!,
        text,
        ctx,
      );
    expect(cell('Колл-центр: 1202; +996 312 00')).toEqual({
      value: [
        { label: 'Колл-центр', value: '1202' },
        { label: '', value: '+996 312 00' },
      ],
    });
  });
});

describe('Выгрузка и загрузка справочников: текст вставки и новые значения', () => {
  it('вставка из Excel: табуляция, иначе «;», иначе «,»; кавычки и переводы строк в ячейке', () => {
    expect(parseIoText('﻿Код\tНазвание\r\nФС-01\tОсОО\r\n\r\n')).toEqual([
      ['Код', 'Название'],
      ['ФС-01', 'ОсОО'],
    ]);
    expect(parseIoText('Код;Название\nФС-01;"ОсОО; ""Альфа""\nвторая строка"')).toEqual([
      ['Код', 'Название'],
      ['ФС-01', 'ОсОО; "Альфа"\nвторая строка'],
    ]);
    expect(parseIoText('Код,Название\nФС-01,ОсОО')).toEqual([
      ['Код', 'Название'],
      ['ФС-01', 'ОсОО'],
    ]);
    expect(
      ioTsv([
        ['Код', 'Описание'],
        ['ФС-01', 'две\nстроки'],
        ['ФС-02', 'с\tтабуляцией'],
      ]),
    ).toBe('Код\tОписание\nФС-01\t"две\nстроки"\nФС-02\tс табуляцией');
  });

  it('новое значение — как у окна «+ Добавить»: у вида отчёта — поля нового вида, «Тип» по умолчанию', () => {
    const type = ioNewValue('types', 'eco');
    expect(type).toMatchObject({ code: 'eco', name: '', active: true });
    expect(type.data).toMatchObject({ ...NEW_REPORT_TYPE, payments: [], regimes: [], rates: [] });
    expect(ioNewValue('regimes', 'РЕЖ-12').data.kind).toBe('special');
    expect(ioNewValue('banks', 'БНК-40').data).toMatchObject({ kind: 'bank', byPhone: false });
    expect(ioNewValue('forms', 'ФС-30').data.declarationFor).toBe('org');
    expect(ioNewValue('benefits', 'ЛЬГ-40').data).toMatchObject({
      kind: 'benefit',
      payer: 'all',
      validUntil: null,
    });
  });

  it('код нового значения: у видов, оснований и УГНС — латиница, у остальных — и кириллица', () => {
    expect(ioCodeValid('types', 'eco_fee')).toBe(true);
    expect(ioCodeValid('types', 'эко')).toBe(false);
    expect(ioCodeValid('bases', 'base-1a2b')).toBe(true);
    expect(ioCodeValid('regimes', 'РЕЖ-12')).toBe(true);
    expect(ioCodeValid('regimes', 'РЕЖ 12')).toBe(false);
    expect(ioCodeValid('forms', 'x'.repeat(41))).toBe(false);
  });
});
