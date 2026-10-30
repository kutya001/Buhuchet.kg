import { defaultUiTexts, type PhoneCodeOption } from '@buhuchet/domain';
import type { Contractor } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  chosenReports,
  createRequestOf,
  draftErrors,
  editDraftOf,
  editErrors,
  errorsInSection,
  formFieldOf,
  leftInSection,
  newDraft,
  prorationText,
  updatePatchOf,
  type ContractorDraft,
  type CreateExtras,
  type DraftCheckContext,
} from './contractor-form-model';

// Черновик формы контрагента (задача 2.09; прототип modules/contractor-form.js: addCpDlg — checks,
// cfMarks, `pro`, сохранение `c`; editCpDlg — `ok`, `ch`).

const t = makeTranslate(defaultUiTexts());
const codes: PhoneCodeOption[] = [
  { cc: 'KG', code: '996', mask: 'XXX XXX XXX', active: true },
  { cc: 'KZ', code: '7', mask: 'XXX XXX XX XX', active: true },
];
const sp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

const blank = (kind: ContractorDraft['kind'] = 'regular') =>
  newDraft({
    kind,
    today: '2026-10-18',
    formCode: 'ФС-01',
    regimeCode: 'РЕЖ-01',
    responsibleId: 'emp-1',
    phoneCc: 'KG',
  });

const filled = (kind: ContractorDraft['kind'] = 'regular'): ContractorDraft => ({
  ...blank(kind),
  name: '  ОсОО «Ала-Тоо»  ',
  inn: '01234567890123',
  phone: { cc: 'KG', local: '555 100 200' },
  gked: { code: '47.11.0', name: 'Розничная торговля' },
});

const cx = (o: Partial<DraftCheckContext> = {}): DraftCheckContext => ({
  codes,
  reports: ['STI-010'],
  fee: { feeOn: true, fee: true },
  block: null,
  socfundReason: false,
  ...o,
});

describe('ошибки полей формы создания', () => {
  it('пустая форма: название, ИНН, телефон, ГКЭД, отчёты, стоимость', () => {
    const e = draftErrors({ ...blank(), responsibleId: '', formCode: '' }, cx({ reports: [] }), t);
    expect(e).toEqual({
      name: t('err.name_empty'),
      inn: t('err.inn_format'),
      phone: t('err.phone_empty'),
      gked: t('err.gked_required'),
      formCode: t('err.form_required'),
      reports: t('err.reports_required'),
      responsibleEmployeeId: t('err.responsible_required'),
      tariff: t('err.tariff_required'),
    });
    expect(errorsInSection(e, 1)).toBe(5);
    expect(errorsInSection(e, 2)).toBe(0);
    expect(errorsInSection(e, 3)).toBe(3);
  });

  it('заполненная форма без ошибок; неполный номер — сколько цифр нужно', () => {
    expect(draftErrors({ ...filled(), fee: '15 000' }, cx(), t)).toEqual({});
    const short = { ...filled(), fee: '0', phone: { cc: 'KG', local: '555 10' } };
    expect(draftErrors(short, cx(), t)).toEqual({ phone: t('err.phone_digits', { n: 9 }) });
  });

  it('разовому контрагенту не нужны отчёты и стоимость', () => {
    expect(draftErrors(filled('oneoff'), cx({ reports: [] }), t)).toEqual({});
  });

  it('стоимость не проверяется без права или с выключенной функцией', () => {
    expect(draftErrors(filled(), cx({ fee: { feeOn: true, fee: false } }), t)).toEqual({});
    expect(draftErrors(filled(), cx({ fee: { feeOn: false, fee: true } }), t)).toEqual({});
  });

  it('сверка с ГКЭД и причина ручного тарифа Соцфонда', () => {
    const e = draftErrors(
      { ...filled(), fee: '100' },
      cx({ block: 'Режим нельзя применять', socfundReason: true }),
      t,
    );
    expect(e).toEqual({
      regimeCode: 'Режим нельзя применять',
      'socfund.reason': t('err.socfund_reason_required'),
    });
  });

  it('регистрационные данные проверяются и при свёрнутом блоке: они всё равно уходят на сервер', () => {
    const d = {
      ...filled(),
      fee: '100',
      registration: { ...filled().registration, okpo: '123', email: 'нет' },
    };
    const bad = { okpo: t('err.okpo_format'), email: t('err.email_format') };
    expect(draftErrors(d, cx(), t)).toEqual(bad);
    expect(draftErrors({ ...d, regOpen: true }, cx(), t)).toEqual(bad);
    const good = { ...d.registration, okpo: '12345678', email: 'a@b.kg' };
    expect(draftErrors({ ...d, registration: good }, cx(), t)).toEqual({});
  });
});

describe('отметки разделов «осталось: N»', () => {
  it('считает пустые обязательные поля раздела', () => {
    expect(leftInSection(blank(), 1, cx())).toBe(4);
    expect(leftInSection(filled(), 1, cx())).toBe(0);
    expect(leftInSection(blank(), 2, cx())).toBe(0);
    expect(leftInSection({ ...blank(), responsibleId: '' }, 3, cx({ reports: [] }))).toBe(3);
    expect(leftInSection(blank('oneoff'), 3, cx({ reports: [] }))).toBe(0);
  });
});

describe('выбранные отчёты', () => {
  it('пока выбор не меняли — подобранные сами; разовому — никаких', () => {
    expect(chosenReports(blank(), ['STI-010', 'STI-161'])).toEqual(['STI-010', 'STI-161']);
    expect(chosenReports(blank(), null)).toEqual([]);
    const picked = { ...blank(), reports: { sel: ['STI-010'], picked: true } };
    expect(chosenReports(picked, ['STI-010', 'STI-161'])).toEqual(['STI-010']);
    expect(chosenReports(blank('oneoff'), ['STI-010'])).toEqual([]);
  });
});

describe('подсказка о начислении за первый месяц', () => {
  const d = {
    fee: '15000',
    startDate: '2026-10-18',
    period: 'M' as const,
    firstMonth: 'prorate' as const,
  };

  it('пропорционально дням: сумма × оставшиеся дни / дни месяца', () => {
    expect(sp(prorationText(d, t))).toBe('За октябрь 2026: 15 000,00 × 14 / 31 = 6 774 сом');
  });

  it('полный месяц, со следующего месяца, начало с 1-го числа', () => {
    expect(sp(prorationText({ ...d, firstMonth: 'full' }, t))).toBe(
      'За октябрь 2026 начислится полная ставка 15 000 сом.',
    );
    expect(sp(prorationText({ ...d, firstMonth: 'next' }, t))).toBe(
      'За октябрь 2026 ничего не начислится, с ноября 2026 — 15 000 сом.',
    );
    expect(sp(prorationText({ ...d, startDate: '2026-10-01' }, t))).toContain('полная ставка');
  });

  it('годовая ставка — словами месяц начала', () => {
    expect(sp(prorationText({ ...d, period: 'Y' }, t))).toBe(
      'Начисление 15 000 сом раз в год: в октябрь 2026, затем каждый октябрь.',
    );
  });

  it('пусто без суммы или даты', () => {
    expect(prorationText({ ...d, fee: '' }, t)).toBe('');
    expect(prorationText({ ...d, startDate: '' }, t)).toBe('');
  });
});

describe('запрос создания', () => {
  const x = (o: Partial<CreateExtras> = {}): CreateExtras => ({
    codes,
    fee: { feeOn: true, fee: true },
    reports: ['STI-010'],
    enDefaults: [],
    gkedConfirm: false,
    socfundConfirm: false,
    ...o,
  });

  it('постоянный: стоимость в тыйынах, первый месяц, отчёты и Соцфонд', () => {
    const r = createRequestOf(
      { ...filled(), fee: '15 000,50', bases: ['ОСН-01'], forced: ['STI-010', 'STI-020'] },
      x({ gkedConfirm: true }),
    );
    expect(r).toMatchObject({
      kind: 'regular',
      name: 'ОсОО «Ала-Тоо»',
      phone: '+996555100200',
      gked: '47.11.0',
      regimeCode: 'РЕЖ-01',
      regime2Code: null,
      bases: ['ОСН-01'],
      tariff: { amount: 1500050, period: 'M' },
      firstMonthMode: 'prorate',
      reports: [{ code: 'STI-010', rate: null, rateAdditions: [] }],
      reportsForced: ['STI-020'],
      gkedConfirm: true,
    });
    expect(r.socfund).toEqual({
      flags: { cashless: null, registry: null, confirmed: null, gov: null },
      reason: '',
    });
    expect(r).not.toHaveProperty('socfundConfirm');
  });

  it('годовая ставка — первый месяц «полный»; без права — стоимости в запросе нет', () => {
    expect(
      createRequestOf({ ...filled(), fee: '120000', period: 'Y', firstMonth: 'next' }, x()),
    ).toMatchObject({ tariff: { amount: 12000000, period: 'Y' }, firstMonthMode: 'full' });
    const r = createRequestOf({ ...filled(), fee: '100' }, x({ fee: { feeOn: true, fee: false } }));
    expect(r).not.toHaveProperty('tariff');
    expect(r).not.toHaveProperty('firstMonthMode');
  });

  it('разовый: без отчётов, оснований, стоимости и Соцфонда', () => {
    const r = createRequestOf({ ...filled('oneoff'), fee: '100', bases: ['ОСН-01'] }, x());
    expect(r.kind).toBe('oneoff');
    expect(r.bases).toEqual([]);
    expect(r.reportsForced).toEqual([]);
    for (const k of ['reports', 'tariff', 'firstMonthMode', 'socfund']) {
      expect(r).not.toHaveProperty(k);
    }
  });
});

describe('поле ответа сервера', () => {
  it('ложится под своё поле формы', () => {
    expect(formFieldOf('inn')).toBe('inn');
    expect(formFieldOf('registration.okpo')).toBe('okpo');
    expect(formFieldOf('gkedExtra')).toBe('gked');
    expect(formFieldOf('firstMonthMode')).toBe('tariff');
    expect(formFieldOf('socfund.reason')).toBe('socfund.reason');
    expect(formFieldOf('version')).toBeNull();
    expect(formFieldOf(undefined)).toBeNull();
  });
});

describe('«Изменить»', () => {
  const contractor = {
    name: 'ОсОО «Ала-Тоо»',
    inn: '01234567890123',
    phone: '+996555100200',
    gked: { code: '47.11.0', name: 'Розничная торговля' },
    gkedExtra: [],
    form: { code: 'ФС-01', name: 'ОсОО', declarationFor: 'org' },
    taxOffice: null,
    regime: { code: 'РЕЖ-01', name: 'ОНР' },
    regime2: null,
    bizSize: 'small',
    benefits: [
      { code: 'ЛЬГ-01', name: 'Льгота', validFrom: null, validTo: '2026-12-31', byOffice: false },
    ],
    bases: [{ code: 'ОСН-01', name: 'Есть наёмные сотрудники' }],
    socfund: { flags: { cashless: true }, tariff: { id: 'pvt', manual: true, reason: 'Резидент' } },
    head: '',
    contact: '',
    contractNo: '',
    contractDate: null,
    feeDay: 5,
    note: '',
    registration: { okpo: '12345678' },
  } as unknown as Contractor;
  const before = editDraftOf(contractor, codes);
  const opts = { codes, feeDay: true, socfund: true };

  it('черновик из карточки', () => {
    expect(before).toMatchObject({
      phone: { cc: 'KG', local: '555100200' },
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      bases: ['ОСН-01'],
      feeDay: '5',
      benefits: [{ code: 'ЛЬГ-01', validFrom: null, validTo: '2026-12-31' }],
      socfund: { tariff: 'pvt', reason: 'Резидент', touched: false },
    });
    expect(before.socfund.flags.cashless).toBe(true);
    expect(before.registration.okpo).toBe('12345678');
  });

  it('ничего не меняли — пусто («Изменений нет»)', () => {
    expect(updatePatchOf(before, { ...before }, opts)).toEqual({});
    expect(updatePatchOf(before, { ...before, name: ` ${before.name} ` }, opts)).toEqual({});
    expect(updatePatchOf(before, { ...before, bases: [...before.bases].reverse() }, opts)).toEqual(
      {},
    );
  });

  it('только изменённые поля', () => {
    const d = {
      ...before,
      name: 'ОсОО «Ала-Тоо Плюс»',
      regimeCode: '',
      regime2Code: 'РЕЖ-02',
      benefits: [],
      feeDay: '10',
      registration: { ...before.registration, okpo: '' },
    };
    expect(updatePatchOf(before, d, opts)).toEqual({
      name: 'ОсОО «Ала-Тоо Плюс»',
      regimeCode: null,
      benefits: [],
      feeDay: 10,
      registration: {},
    });
    expect(updatePatchOf(before, d, { ...opts, feeDay: false })).not.toHaveProperty('feeDay');
  });

  it('при смене УГНС список льгот и статусов уходит всегда: снятый вручную статус сервер не вернёт', () => {
    expect(updatePatchOf(before, { ...before, taxOfficeCode: 'ugns-large' }, opts)).toEqual({
      taxOfficeCode: 'ugns-large',
      benefits: before.benefits,
    });
  });

  it('Соцфонд — когда меняли признаки, выбор или причину', () => {
    const flags = { ...before.socfund.flags, registry: true };
    expect(
      updatePatchOf(before, { ...before, socfund: { ...before.socfund, flags } }, opts),
    ).toEqual({ socfund: { flags, reason: 'Резидент' } });
    const auto = { ...before.socfund, tariff: '', touched: true };
    expect(updatePatchOf(before, { ...before, socfund: auto }, opts)).toEqual({
      socfund: { flags: before.socfund.flags, tariff: null, reason: 'Резидент' },
    });
    expect(
      updatePatchOf(before, { ...before, socfund: auto }, { ...opts, socfund: false }),
    ).toEqual({});
  });

  it('ошибки: ГКЭД своим текстом, день оплаты 1–28', () => {
    const e = editErrors(
      { ...before, gked: null, feeDay: '29' },
      { codes, block: null, socfundReason: false, feeDay: true },
      t,
    );
    expect(e).toEqual({ gked: t('err.gked_required.edit'), feeDay: t('err.fee_day') });
    expect(
      editErrors(before, { codes, block: null, socfundReason: false, feeDay: true }, t),
    ).toEqual({});
  });
});
