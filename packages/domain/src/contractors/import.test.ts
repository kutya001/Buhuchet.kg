import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import {
  checkImportRows,
  CP_IMPORT_CELL_MAX,
  CP_IMPORT_MAX_COLUMNS,
  CP_IMPORT_MAX_ROWS,
  importColumnOf,
  importFee,
  importPhone,
  importReady,
  importRequestRows,
  importValues,
  parseImportText,
  type CpImportDicts,
} from './import';

const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);

const PHONES = [
  { code: '996', mask: 'XXX XXX XXX' },
  { code: '7', mask: 'XXX XXX XX XX' },
];

const DICTS: CpImportDicts = {
  phoneCodes: PHONES,
  takenInns: new Set(['02105199910024']),
  employees: [
    { id: 'e-alisher', login: 'alisher', shortName: 'Алишер Т.', fullName: 'Токтогулов Алишер' },
    { id: 'e-aigerim', login: 'aigerim', shortName: 'Айгерим С.', fullName: 'Садыкова Айгерим' },
  ],
  types: [
    { code: 'STI-061', name: 'Единый налог (квартальный)', shortName: 'ЕН кв.' },
    { code: 'STI-161', name: 'Отчёт в Соцфонд', shortName: 'Соцфонд' },
    { code: 'STI-091', name: 'НДС', shortName: 'НДС' },
  ],
  offices: [
    {
      code: 'ugns-bishkek-lenin',
      gnsCode: '002',
      name: 'УГНС по Ленинскому району г. Бишкек',
      shortName: 'Ленинский р-н, Бишкек',
    },
    {
      code: 'ugns-large',
      gnsCode: null,
      name: 'Управление по крупным налогоплательщикам ГНС',
      shortName: 'Крупные НП',
    },
  ],
  regimes: [
    { code: 'РЕЖ-01', name: 'ОНР' },
    { code: 'РЕЖ-03', name: 'Единый налог' },
  ],
  forms: [
    { code: 'ФС-01', name: 'ОсОО' },
    { code: 'ФС-02', name: 'ИП' },
  ],
  gked: new Map([
    ['69.20.0', { level: 'subclass', active: true }],
    ['62.01.0', { level: 'subclass', active: true }],
    ['69.20', { level: 'class', active: true }],
    ['01.11.0', { level: 'subclass', active: false }],
  ]),
  fee: true,
};

const HEAD = ['name', 'inn', 'phone', 'types', 'fee', 'resp', 'form', 'regime', 'gked'] as const;

const row = (over: Partial<Record<(typeof HEAD)[number], string>> = {}) => {
  const base = {
    name: 'ОсОО «Жашыл Талаа»',
    inn: '01504202010077',
    phone: '+996 555 404 404',
    types: 'ЕН кв., Соцфонд',
    fee: '15000',
    resp: 'Алишер Т.',
    form: 'ОсОО',
    regime: 'Единый налог',
    gked: '69.20.0',
    ...over,
  };
  return HEAD.map((k) => base[k]);
};

const check = (rows: string[][], dicts: Partial<CpImportDicts> = {}) =>
  checkImportRows([...HEAD], rows, { ...DICTS, ...dicts }, t);

describe('загрузка контрагентов: разбор вставки (прототип importDlg parse)', () => {
  it('из Excel — табуляция, заголовки находятся по названию', () => {
    const table = parseImportText(
      'Название\tИНН\tТелефон\tВиды отчётов\tНеизвестно\nОсОО «А»\t01504202010077\t555 404 404\tНДС\tх\n\n',
    )!;
    expect(table.delimiter).toBe('\t');
    expect(table.hasHeader).toBe(true);
    expect(table.map).toEqual(['name', 'inn', 'phone', 'types', 'skip']);
    expect(table.rows).toEqual([['ОсОО «А»', '01504202010077', '555 404 404', 'НДС', 'х']]);
  });

  it('CSV — точка с запятой; без заголовков колонки идут по порядку шаблона', () => {
    const table = parseImportText(
      'ОсОО «А»;01504202010077;555 404 404\r\nИП Б;21002199001234;0700 112 233',
    )!;
    expect(table.delimiter).toBe(';');
    expect(table.hasHeader).toBe(false);
    expect(table.map).toEqual(['name', 'inn', 'phone']);
    expect(table.rows).toHaveLength(2);
  });

  it('одна найденная колонка — ещё не заголовки; пустая вставка — нечего показывать', () => {
    expect(parseImportText('Название\tчто-то\tещё')!.hasHeader).toBe(false);
    expect(parseImportText('  \n\t\n')).toBeNull();
  });

  it('больше 500 строк — загружаются первые 500', () => {
    const lines = Array.from(
      { length: CP_IMPORT_MAX_ROWS + 20 },
      (_, i) => `К ${i};01504202010077`,
    );
    expect(parseImportText(lines.join('\n'))!.rows).toHaveLength(CP_IMPORT_MAX_ROWS);
  });

  it('заголовки: точное совпадение или начало, «ё» как «е», первая подходящая колонка', () => {
    expect(importColumnOf('Дополнительные ГКЭД')).toBe('gked2');
    expect(importColumnOf('Основной ГКЭД')).toBe('gked');
    expect(importColumnOf('ГКЭД')).toBe('gked');
    expect(importColumnOf('Подтверждён ГНС')).toBe('sfp');
    expect(importColumnOf('УГНС (код)')).toBe('ugns');
    expect(importColumnOf('Отчёты')).toBe('types');
    expect(importColumnOf('Тел.')).toBe('phone');
    expect(importColumnOf('Стоимость обслуживания')).toBe('fee');
    expect(importColumnOf('Реестр в Салык.кг')).toBe('sfr');
    expect(importColumnOf('Дата')).toBeNull();
  });

  it('значения по колонкам: «не загружать» пропускается, у повторённой колонки — последняя', () => {
    const v = importValues(['name', 'skip', 'name'], [' А ', 'Б', 'В']);
    expect(v.name).toBe('В');
    expect(v.inn).toBe('');
  });

  it('колонок не больше 60; в запрос — ячейки под колонками, пустые досоздаются, длинные обрезаются', () => {
    const wide = Array.from({ length: 70 }, (_, i) => `x${i}`).join('\t');
    expect(parseImportText(wide)!.map).toHaveLength(CP_IMPORT_MAX_COLUMNS);
    const long = 'я'.repeat(CP_IMPORT_CELL_MAX + 50);
    expect(importRequestRows(['name', 'note'], [['А', long, 'лишняя'], ['Б']])).toEqual([
      ['А', 'я'.repeat(CP_IMPORT_CELL_MAX)],
      ['Б', ''],
    ]);
  });
});

describe('загрузка контрагентов: телефон и стоимость (прототип parsePh, parseNum)', () => {
  it('номер без кода — кыргызский: 9 цифр и 10 с ведущим нулём', () => {
    expect(importPhone('555 778 900', PHONES)).toEqual({ phone: '+996555778900' });
    expect(importPhone('0700 112 233', PHONES)).toEqual({ phone: '+996700112233' });
    expect(importPhone('+996 555 404 404', PHONES)).toEqual({ phone: '+996555404404' });
  });

  it('номер с кодом страны из справочника распознаётся сам', () => {
    expect(importPhone('+7 701 555 44 33', PHONES)).toEqual({ phone: '+77015554433' });
    expect(importPhone('77015554433', PHONES)).toEqual({ phone: '+77015554433' });
  });

  it('пусто — нет телефона; не та длина или неизвестный код — неверная длина', () => {
    expect(importPhone(' - ', PHONES)).toEqual({ problem: 'missing' });
    expect(importPhone('12345', PHONES)).toEqual({ problem: 'length' });
    expect(importPhone('+44 20 7946 0958', PHONES)).toEqual({ problem: 'length' });
  });

  it('стоимость — число от нуля, в тыйынах; пробелы и запятая допускаются', () => {
    expect(importFee('15000')).toBe(1_500_000);
    expect(importFee('15 000,50')).toBe(1_500_050);
    expect(importFee('0')).toBe(0);
    expect(importFee('')).toBeNull();
    expect(importFee('-5')).toBeNull();
    expect(importFee('пятьсот')).toBeNull();
  });
});

describe('загрузка контрагентов: проверка строк (прототип importDlg check)', () => {
  it('строка примера прототипа готова: разобранные значения для создания', () => {
    const [r] = check([row()]);
    expect(r!.errors).toEqual([]);
    expect(r!.warnings).toEqual([]);
    expect(r!.draft).toEqual({
      name: 'ОсОО «Жашыл Талаа»',
      inn: '01504202010077',
      phone: '+996555404404',
      typeCodes: ['STI-061', 'STI-161'],
      fee: 1_500_000,
      responsibleEmployeeId: 'e-alisher',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-03',
      gked: '69.20.0',
      gkedExtra: [],
      taxOfficeCode: null,
      head: '',
      contact: '',
      note: '',
      socfund: {},
    });
  });

  it('ИНН: формат, начало, уже есть в организации, повторяется в списке выше', () => {
    const rows = check([
      row({ inn: '0160320181' }),
      row({ inn: '31504202010077' }),
      row({ inn: '02105199910024' }),
      row({ inn: '01504202010077' }),
      row({ inn: '01504202010077' }),
    ]);
    expect(rows.map((r) => r.errors)).toEqual([
      ['ИНН не 14 цифр'],
      ['ИНН в КР начинается с 0, 1 или 2'],
      ['ИНН уже есть в организации'],
      [],
      ['ИНН повторяется в списке'],
    ]);
    expect(importReady(rows)).toBe(1);
  });

  it('без названия, без телефона, неверная длина номера, стоимость не число', () => {
    expect(check([row({ name: '', phone: '', fee: 'много' })])[0]!.errors).toEqual([
      'нет названия',
      'нет телефона',
      'стоимость не число',
    ]);
    expect(check([row({ phone: '555 12' })])[0]!.errors).toEqual(['неверная длина номера']);
  });

  it('без права видеть плату колонка стоимости не загружается и не проверяется', () => {
    const [r] = check([row({ fee: 'много' })], { fee: false });
    expect(r!.errors).toEqual([]);
    expect(r!.draft.fee).toBeNull();
  });

  it('виды отчётов — по краткому названию (с точкой или без), названию или коду; неизвестный — ошибка', () => {
    const [r] = check([row({ types: 'ен кв, Отчёт в Соцфонд, STI-091, НДС, ЕНД орг.' })]);
    expect(r!.draft.typeCodes).toEqual(['STI-061', 'STI-161', 'STI-091']);
    expect(r!.errors).toEqual(['вид «ЕНД орг.» не найден']);
  });

  it('ответственный — логин, краткое имя без точек, ФИО или начало ФИО; пусто — ошибка', () => {
    const resp = (s: string) => check([row({ resp: s })])[0]!;
    expect(resp('aigerim').draft.responsibleEmployeeId).toBe('e-aigerim');
    expect(resp('Айгерим С').draft.responsibleEmployeeId).toBe('e-aigerim');
    expect(resp('Садыкова айгерим').draft.responsibleEmployeeId).toBe('e-aigerim');
    expect(resp('Токтогулов').draft.responsibleEmployeeId).toBe('e-alisher');
    expect(resp('Нурлан Б.').errors).toEqual(['сотрудник «Нурлан Б.» не найден']);
    expect(resp('').errors).toEqual(['не указан ответственный']);
  });

  it('ГКЭД: пусто — предупреждение «без ГКЭД»; неизвестный, не подкласс, отключённый — ошибка', () => {
    const gk = (s: string) => check([row({ gked: s })])[0]!;
    expect(gk('').warnings).toEqual(['без ГКЭД']);
    expect(gk('').errors).toEqual([]);
    expect(gk('').draft.gked).toBeNull();
    expect(gk('99.99.9').errors).toEqual(['ГКЭД «99.99.9» нет в справочнике']);
    expect(gk('69.20').errors).toEqual(['ГКЭД «69.20» — не подкласс, укажите код вида 69.20.0']);
    expect(gk('01.11.0').errors).toEqual(['ГКЭД «01.11.0» больше не действует']);
  });

  it('дополнительные ГКЭД через запятую или точку с запятой: без повторов и без основного', () => {
    const [r] = checkImportRows(
      ['name', 'inn', 'phone', 'types', 'fee', 'resp', 'gked', 'gked2'],
      [
        [
          'ОсОО «А»',
          '01504202010077',
          '555 404 404',
          'НДС',
          '0',
          'alisher',
          '69.20.0',
          '62.01.0; 69.20.0, 62.01.0, 69.20',
        ],
      ],
      DICTS,
      t,
    );
    expect(r!.draft.gkedExtra).toEqual(['62.01.0']);
    expect(r!.errors).toEqual(['ГКЭД «69.20» — не подкласс']);
  });

  it('УГНС — по коду ГНС, ключу, краткому или полному названию; неизвестное — ошибка', () => {
    const map = [...HEAD, 'ugns'] as const;
    const ug = (s: string) => checkImportRows([...map], [[...row(), s]], DICTS, t)[0]!;
    expect(ug('002').draft.taxOfficeCode).toBe('ugns-bishkek-lenin');
    expect(ug('2').draft.taxOfficeCode).toBe('ugns-bishkek-lenin');
    expect(ug('ugns-large').draft.taxOfficeCode).toBe('ugns-large');
    expect(ug('крупные нп').draft.taxOfficeCode).toBe('ugns-large');
    expect(ug('999').errors).toEqual(['УГНС «999» нет в справочнике']);
  });

  it('признаки Соцфонда: Да / Нет (yes, 1, true…), пусто — не указано, другое — ошибка', () => {
    const map = [...HEAD, 'sfc', 'sfr', 'sfp', 'sfg'] as const;
    const [r] = checkImportRows([...map], [[...row(), 'Да', 'нет', '', '1']], DICTS, t);
    expect(r!.draft.socfund).toEqual({ cashless: true, registry: false, gov: true });
    const [bad] = checkImportRows([...map], [[...row(), 'может быть', '', '', '']], DICTS, t);
    expect(bad!.errors).toEqual(['«Зарплата безналично»: только Да или Нет']);
  });

  it('режим и форма — из справочников; пустая форма — по началу названия', () => {
    expect(check([row({ regime: 'Патент', form: 'АО' })])[0]!.errors).toEqual([
      'режима нет в справочнике',
      'формы нет в справочнике',
    ]);
    expect(check([row({ form: '', name: 'ИП Бектурова Ж. А.' })])[0]!.draft.formCode).toBe('ФС-02');
    expect(check([row({ form: '' })])[0]!.draft.formCode).toBe('ФС-01');
    expect(check([row({ regime: '' })])[0]!.draft.regimeCode).toBeNull();
  });

  it('тексты длиннее пределов базы — ошибка строки', () => {
    expect(check([row({ name: 'Я'.repeat(301) })])[0]!.errors).toEqual([
      '«Название» длиннее 300 знаков',
    ]);
  });
});
