import { defaultUiTexts, type PhoneCodeOption } from '@buhuchet/domain';
import type { RegdocsResult } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { newDraft } from './contractor-form-model';
import {
  altValueText,
  docsText,
  needs,
  regdocsDraft,
  regdocsState,
  regdocsSummary,
  sourceOf,
  takeAlt,
} from './contractor-regdocs-model';

// Форма «Новый контрагент» из свидетельства и выписки (задача 2.17; прототип
// modules/contractor-regdocs.js: rdPrefill, rdHead, rdMarks, `data-rdalt`).

const t = makeTranslate(defaultUiTexts());
const codes: PhoneCodeOption[] = [
  { cc: 'KG', code: '996', mask: 'XXX XXX XXX', active: true },
  { cc: 'KZ', code: '7', mask: 'XXX XXX XX XX', active: true },
];

const base = () =>
  newDraft({
    kind: 'regular',
    today: '2026-10-31',
    formCode: 'ФС-01',
    regimeCode: '',
    responsibleId: '',
    phoneCc: 'KG',
  });

/** Итог по свидетельству и выписке ОсОО: имя расходится, ГКЭД и налоговый орган найдены. */
const result = (o: Partial<RegdocsResult> = {}): RegdocsResult => ({
  v: {
    name: 'ОсОО «Тестовая бухгалтерия»',
    full: 'Общество с ограниченной ответственностью «Тестовая бухгалтерия»',
    inn: '02503202010045',
    regNo: '214365-3301-ООО',
    okpo: '31415926',
    form: 'ФС-02',
    addr: 'г.Бишкек, Октябрьский район, ул.Тестовая, д. 7, кв. 12',
    phone: '+996555010203',
    email: 'office@test-buh.kg',
    head: 'Тестова Айгуль Тестовна',
    regDate: '2020-03-15',
    founders: 1,
    foreign: 'no',
  },
  src: {
    name: 'vyp',
    full: 'both',
    inn: 'both',
    regNo: 'both',
    okpo: 'both',
    form: 'vyp',
    addr: 'vyp',
    phone: 'vyp',
    email: 'vyp',
    head: 'both',
    regDate: 'both',
    founders: 'both',
    foreign: 'vyp',
  },
  alt: {
    name: [
      { v: 'ОсОО «Тестовая бухгалтерия»', src: 'vyp', date: '2026-10-20' },
      { v: 'ОсОО «Тестовая бухгалтерия-2»', src: 'svid', date: '2026-10-18' },
    ],
  },
  gk: {
    code: '69.20.0',
    name: 'Деятельность в области бухгалтерского учета и аудита',
    choose: [],
    like: [],
    raw: '69.20.0',
    text: 'Деятельность в области бухгалтерского учета и аудита',
    src: 'vyp',
    more: [{ code: '62.01.0', name: 'Разработка программного обеспечения' }],
  },
  ugns: '003',
  stopped: false,
  status: 'Регистрация',
  phoneBad: '',
  ...o,
});

describe('черновик из документов (rdPrefill)', () => {
  it('реквизиты, форма, налоговый орган, основной и дополнительные ГКЭД, регистрационные данные раскрыты', () => {
    const d = regdocsDraft(base(), result(), codes);
    expect(d).toMatchObject({
      name: 'ОсОО «Тестовая бухгалтерия»',
      inn: '02503202010045',
      phone: { cc: 'KG', local: '555010203' },
      head: 'Тестова Айгуль Тестовна',
      formCode: 'ФС-02',
      taxOfficeCode: '003',
      gked: { code: '69.20.0', name: 'Деятельность в области бухгалтерского учета и аудита' },
      gkedExtra: [{ code: '62.01.0', name: 'Разработка программного обеспечения' }],
      regOpen: true,
      registration: {
        fullName: 'Общество с ограниченной ответственностью «Тестовая бухгалтерия»',
        regNo: '214365-3301-ООО',
        okpo: '31415926',
        address: 'г.Бишкек, Октябрьский район, ул.Тестовая, д. 7, кв. 12',
        email: 'office@test-buh.kg',
        regDate: '2020-03-15',
        reRegDate: '',
        founders: '1',
        foreign: 'no',
      },
    });
  });

  it('формы собственности и ГКЭД нет в документах — поля пустые, телефон остаётся с кодом страны', () => {
    const { form: _f, phone: _p, ...v } = result().v;
    const d = regdocsDraft(base(), result({ v, gk: null, ugns: '' }), codes);
    expect(d.formCode).toBe('');
    expect(d.gked).toBeNull();
    expect(d.gkedExtra).toEqual([]);
    expect(d.taxOfficeCode).toBe('');
    expect(d.phone).toEqual({ cc: 'KG', local: '' });
  });
});

describe('подписи у полей (rdMarks)', () => {
  it('подпись источника — пока значение в поле равно значению из документа', () => {
    const st = regdocsState(result());
    const d = regdocsDraft(base(), result(), codes);
    expect(sourceOf(st, d, 'inn', codes)).toBe('both');
    expect(sourceOf(st, d, 'phone', codes)).toBe('vyp');
    expect(sourceOf(st, d, 'founders', codes)).toBe('both');
    // налоговый орган — «Предложено по адресу», ГКЭД — документ основного кода
    expect(sourceOf(st, d, 'ugns', codes)).toBe('addr');
    expect(sourceOf(st, d, 'gked', codes)).toBe('vyp');
    // поле изменили — подписи нет
    expect(sourceOf(st, { ...d, inn: '02503202010046' }, 'inn', codes)).toBeNull();
    expect(sourceOf(st, { ...d, gked: null }, 'gked', codes)).toBeNull();
    // реквизита нет в документах — подписи нет
    expect(sourceOf(st, d, 'reRegDate', codes)).toBeNull();
  });

  it('«Заполните вручную»: пустые обязательные поля и не тронутая дата начала обслуживания', () => {
    const st = regdocsState(result());
    const d = regdocsDraft(base(), result(), codes);
    expect(needs(st, d, { reports: 2, fee: true })).toEqual(['resp', 'fee', 'start']);
    expect(needs(st, d, { reports: 0, fee: false })).toEqual(['types', 'resp', 'start']);
    expect(
      needs({ ...st, startSet: true }, { ...d, responsibleId: 'emp-1', fee: '5 000' }, {
        reports: 1,
        fee: true,
      }),
    ).toEqual([]);
    const empty = { ...d, name: ' ', inn: '', phone: { cc: 'KG', local: '' }, gked: null };
    expect(needs(st, { ...empty, formCode: '' }, { reports: 1, fee: false })).toEqual([
      'name',
      'inn',
      'phone',
      'gked',
      'form',
      'resp',
      'start',
    ]);
    // у разового контрагента отчётов нет — «Сдаёт отчёты» не спрашивается
    expect(needs(st, { ...d, kind: 'oneoff' }, { reports: 0, fee: false })).not.toContain('types');
  });

  it('«взять это»: значение встаёт первым, становится значением документа и попадает в поле', () => {
    const st = regdocsState(result());
    const d = regdocsDraft(base(), result(), codes);
    const next = takeAlt(st, d, 'name', 1, codes);
    expect(next.d.name).toBe('ОсОО «Тестовая бухгалтерия-2»');
    expect(next.st.v.name).toBe('ОсОО «Тестовая бухгалтерия-2»');
    expect(next.st.src.name).toBe('svid');
    expect(next.st.alt.name?.map((a) => a.src)).toEqual(['svid', 'vyp']);
    expect(sourceOf(next.st, next.d, 'name', codes)).toBe('svid');
    // телефон и регистрационные данные — в свои поля; неизвестный номер — без изменений
    const phone = takeAlt(
      { ...st, alt: { phone: [{ v: '+77011234567', src: 'svid', date: '' }] } },
      d,
      'phone',
      0,
      codes,
    );
    expect(phone.d.phone).toEqual({ cc: 'KZ', local: '7011234567' });
    const addr = takeAlt(
      { ...st, alt: { addr: [{ v: 'г.Ош, ул.Ленина, 1', src: 'svid', date: '' }] } },
      d,
      'addr',
      0,
      codes,
    );
    expect(addr.d.registration.address).toBe('г.Ош, ул.Ленина, 1');
    expect(takeAlt(st, d, 'name', 5, codes)).toEqual({ st, d });
  });

  it('значения расхождений — как в прототипе (rdFmt)', () => {
    const x = { codes, formName: (c: string) => (c === 'ФС-02' ? 'ОсОО' : c) };
    expect(altValueText('phone', '+996555010203', t, x)).toBe('+996 555 010 203');
    expect(altValueText('regDate', '2020-03-15', t, x)).toBe('15.03.2020');
    expect(altValueText('foreign', 'yes', t, x)).toBe('есть');
    expect(altValueText('foreign', 'no', t, x)).toBe('нет');
    expect(altValueText('form', 'ФС-02', t, x)).toBe('ОсОО');
    expect(altValueText('founders', 3, t, x)).toBe('3');
  });
});

describe('сводка над формой (rdHead)', () => {
  it('заполнено, требуют проверки, чего нет и предупреждения', () => {
    const res = result();
    expect(regdocsSummary(regdocsState(res), res, t)).toEqual({
      // 13 реквизитов + налоговый орган + основной ГКЭД
      filled: 15,
      // расхождение имени + налоговый орган по адресу
      check: 2,
      miss: [],
      warn: ['документы расходятся: название'],
    });
  });

  it('без телефона, формы и ГКЭД; неполный телефон в документе; ГКЭД не подставлен — на проверку', () => {
    const { form: _f, phone: _p, ...v } = result().v;
    const gk = { ...result().gk!, code: '', name: '', choose: [{ code: '69.20.0', name: 'x' }] };
    const res = result({ v, alt: {}, ugns: '', gk, phoneBad: '555 01' });
    expect(regdocsSummary(regdocsState(res), res, t)).toEqual({
      filled: 11,
      check: 1,
      miss: ['Телефон', 'Форма собственности', 'Основной вид деятельности (ГКЭД)'],
      warn: ['телефон в документе неполный (555 01)'],
    });
  });

  it('«Распознано: Свидетельство от 18.10.2026 и Выписка»', () => {
    expect(
      docsText(
        [
          { kind: 'svid', issued: '2026-10-18' },
          { kind: 'vyp', issued: '' },
        ],
        t,
      ),
    ).toBe('Свидетельство от 18.10.2026 и Выписка');
  });
});
