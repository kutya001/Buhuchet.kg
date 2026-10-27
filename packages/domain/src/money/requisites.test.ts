import { describe, expect, it } from 'vitest';
import {
  bankChoices,
  lastTaxAccountWarning,
  localPhoneText,
  mainTaxRequisite,
  normalizeRequisite,
  orgAccountMains,
  orgMainAccount,
  purposeServes,
  requisiteNumberText,
  requisiteProblem,
  requisiteProblems,
  requisiteText,
  taxRequisiteChoices,
  walletMains,
  type BankOption,
  type OrgAccountMain,
  type RequisiteInput,
} from './requisites';

/** Часть справочника «Коды телефонов» (refDB.json → phoneCodes). */
const CODES = [
  { cc: 'KG', code: '996', mask: 'XXX XXX XXX', active: true },
  { cc: 'KZ', code: '7', mask: 'XXX XXX XX XX', active: true },
];

/** Часть справочника «Банковские провайдеры» (refDB.json → dictionaries.banks). */
const BANKS: BankOption[] = [
  { code: 'БНК-01', name: 'АБанк', byPhone: false, active: true },
  { code: 'БНК-02', name: 'Бакай Банк', byPhone: true, active: true },
  { code: 'БНК-09', name: 'M-Bank', byPhone: true, active: true },
  { code: 'БНК-30', name: 'Закрытый банк', byPhone: true, active: false },
  { code: 'КШЛ-02', name: 'О!Деньги', byPhone: true, active: true },
];

const account = (over: Partial<RequisiteInput> = {}): RequisiteInput => ({
  kind: 'acc',
  bankCode: 'БНК-01',
  accountNo: '1091 8200 0456 7012',
  bik: '109018',
  phone: null,
  phoneBanks: [],
  ...over,
});

const byPhone = (over: Partial<RequisiteInput> = {}): RequisiteInput => ({
  kind: 'phone',
  bankCode: null,
  accountNo: null,
  bik: null,
  phone: '+996555123456',
  phoneBanks: ['БНК-09', 'БНК-02'],
  ...over,
});

describe('провайдеры для выбора (ТЗ «Банковские провайдеры»)', () => {
  it('в расчётном счёте — все действующие, в переводе по номеру — только с переводами по номеру', () => {
    expect(bankChoices(BANKS, 'acc').map((b) => b.name)).toEqual([
      'АБанк',
      'Бакай Банк',
      'M-Bank',
      'О!Деньги',
    ]);
    expect(bankChoices(BANKS, 'phone').map((b) => b.name)).toEqual([
      'Бакай Банк',
      'M-Bank',
      'О!Деньги',
    ]);
  });

  it('отключённый банк, уже выбранный в реквизите, остаётся в списке', () => {
    expect(bankChoices(BANKS, 'phone', ['БНК-30']).map((b) => b.code)).toContain('БНК-30');
    expect(bankChoices(BANKS, 'acc').map((b) => b.code)).not.toContain('БНК-30');
  });
});

describe('проверка реквизита', () => {
  it('расчётный счёт организации: банк, счёт — 16 цифр, БИК — 6 цифр', () => {
    expect(requisiteProblem(account(), 'org', BANKS, CODES)).toBeNull();
    expect(requisiteProblem(account({ bankCode: null }), 'org', BANKS, CODES)).toEqual({
      problem: 'bank_required',
      field: 'bankCode',
    });
    expect(requisiteProblem(account({ accountNo: '1091 8200' }), 'org', BANKS, CODES)).toEqual({
      problem: 'account_no_invalid',
      field: 'accountNo',
    });
    expect(requisiteProblem(account({ bik: '10901' }), 'org', BANKS, CODES)).toEqual({
      problem: 'bik_invalid',
      field: 'bik',
    });
    expect(requisiteProblem(account({ bik: '10901a' }), 'org', BANKS, CODES)?.problem).toBe(
      'bik_invalid',
    );
  });

  it('ошибки сразу под всеми неверными полями', () => {
    expect(
      requisiteProblems(account({ accountNo: '123', bik: '1' }), 'org', BANKS, CODES).map(
        (p) => p.field,
      ),
    ).toEqual(['accountNo', 'bik']);
    expect(
      requisiteProblems(byPhone({ phone: null, phoneBanks: [] }), 'org', BANKS, CODES).map(
        (p) => p.problem,
      ),
    ).toEqual(['invalid_phone', 'phone_banks_required']);
  });

  it('банк не из действующих — отказ; прежний банк реквизита после отключения остаётся допустимым', () => {
    const closed = account({ bankCode: 'БНК-30' });
    expect(requisiteProblem(closed, 'org', BANKS, CODES)?.problem).toBe('bank_unavailable');
    expect(requisiteProblem(closed, 'org', BANKS, CODES, ['БНК-30'])).toBeNull();
    expect(requisiteProblem(account({ bankCode: 'БНК-99' }), 'org', BANKS, CODES)?.problem).toBe(
      'bank_unavailable',
    );
  });

  it('счёт или кошелёк сотрудника: номер — не меньше 6 цифр, БИКа нет', () => {
    const wallet = account({ bankCode: 'КШЛ-02', accountNo: '0555 123 456', bik: null });
    expect(requisiteProblem(wallet, 'employee', BANKS, CODES)).toBeNull();
    expect(requisiteProblem({ ...wallet, accountNo: '12345' }, 'employee', BANKS, CODES)).toEqual({
      problem: 'wallet_no_invalid',
      field: 'accountNo',
    });
  });

  it('перевод по номеру: полный номер и хотя бы один банк с переводами по номеру', () => {
    expect(requisiteProblem(byPhone(), 'org', BANKS, CODES)).toBeNull();
    expect(requisiteProblem(byPhone(), 'employee', BANKS, CODES)).toBeNull();
    expect(requisiteProblem(byPhone({ phone: '+99655512345' }), 'org', BANKS, CODES)).toEqual({
      problem: 'invalid_phone',
      field: 'phone',
    });
    expect(requisiteProblem(byPhone({ phone: null }), 'org', BANKS, CODES)?.problem).toBe(
      'invalid_phone',
    );
    expect(requisiteProblem(byPhone({ phoneBanks: [] }), 'org', BANKS, CODES)).toEqual({
      problem: 'phone_banks_required',
      field: 'phoneBanks',
    });
    // АБанк без переводов по номеру.
    expect(
      requisiteProblem(byPhone({ phoneBanks: ['БНК-01'] }), 'org', BANKS, CODES)?.problem,
    ).toBe('bank_unavailable');
  });
});

describe('реквизит к сохранению', () => {
  it('у счёта поля перевода по номеру очищаются, у сотрудника нет БИКа', () => {
    const input = account({
      accountNo: ' 1091 8200 0456 7012 ',
      phone: '+996555123456',
      phoneBanks: ['БНК-02'],
    });
    expect(normalizeRequisite(input, 'org', BANKS)).toEqual({
      ...input,
      accountNo: '1091 8200 0456 7012',
      phone: null,
      phoneBanks: [],
    });
    expect(normalizeRequisite(input, 'employee', BANKS).bik).toBeNull();
  });

  it('у перевода по номеру поля счёта очищаются, банки — без повторов и по порядку справочника', () => {
    const input = byPhone({
      bankCode: 'БНК-01',
      accountNo: '123',
      bik: '109018',
      phoneBanks: ['КШЛ-02', 'БНК-02', 'КШЛ-02'],
    });
    expect(normalizeRequisite(input, 'org', BANKS)).toEqual({
      ...input,
      bankCode: null,
      accountNo: null,
      bik: null,
      phoneBanks: ['БНК-02', 'КШЛ-02'],
    });
  });
});

describe('номер для показа', () => {
  it('номер Кыргызстана — с нулём, как в приложении банка; другие страны — с кодом', () => {
    expect(localPhoneText('+996555123456', CODES)).toBe('0555 123 456');
    expect(localPhoneText('+77011234567', CODES)).toBe('+7 701 123 45 67');
    expect(localPhoneText('+12345', CODES)).toBe('+12345');
  });

  it('в таблице: у перевода по номеру — телефон, у счёта — номер счёта', () => {
    expect(
      requisiteNumberText({ kind: 'phone', accountNo: null, phone: '+996700901234' }, CODES),
    ).toBe('0700 901 234');
    expect(
      requisiteNumberText({ kind: 'acc', accountNo: '1091 8200 0456 7012', phone: null }, CODES),
    ).toBe('1091 8200 0456 7012');
  });
});

describe('реквизит одной строкой (ТЗ «Напоминания контрагенту в WhatsApp»)', () => {
  const TEMPLATES: Record<string, string> = {
    'money.req.text.phone': 'Перевод по номеру {phone} ({banks}){holder}',
    'money.req.text.account': '{bank}: р/с {account}, БИК {bik}{holder}',
    'money.req.text.wallet': '{bank}: {account}',
    'money.req.text.holder': ', получатель {name}',
  };
  const t = (key: string, params: Record<string, string>) =>
    TEMPLATES[key]!.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');

  it('перевод по номеру — номер, банки и получатель', () => {
    expect(
      requisiteText(
        {
          kind: 'phone',
          bankNames: ['M-Bank', 'Бакай Банк'],
          accountNo: null,
          bik: null,
          phoneText: '0555 123 456',
          holderName: 'Асанов А.',
        },
        'employee',
        t,
      ),
    ).toBe('Перевод по номеру 0555 123 456 (M-Bank, Бакай Банк), получатель Асанов А.');
  });

  it('расчётный счёт организации — банк, счёт, БИК, получатель; кошелёк сотрудника — провайдер и номер', () => {
    const acc = {
      kind: 'acc' as const,
      bankNames: ['Optima Bank'],
      accountNo: '1091 8200 0456 7012',
      bik: '109018',
      phoneText: '',
      holderName: 'ОсОО «Бухгалтер Плюс»',
    };
    expect(requisiteText(acc, 'org', t)).toBe(
      'Optima Bank: р/с 1091 8200 0456 7012, БИК 109018, получатель ОсОО «Бухгалтер Плюс»',
    );
    expect(
      requisiteText({ ...acc, bankNames: ['M-Bank'], accountNo: '0555 123 456' }, 'employee', t),
    ).toBe('M-Bank: 0555 123 456');
    expect(requisiteText({ ...acc, holderName: '' }, 'org', t)).toBe(
      'Optima Bank: р/с 1091 8200 0456 7012, БИК 109018',
    );
  });
});

const acc = (id: string, purpose: OrgAccountMain['purpose'], mainTax = false, mainFee = false) => ({
  id,
  purpose,
  mainTax,
  mainFee,
});

describe('«Основной» счёт организации для налогов и для обслуживания', () => {
  it('purposeServes: «Налоги и обслуживание» подходит для обоих', () => {
    expect(purposeServes('both', 'tax')).toBe(true);
    expect(purposeServes('both', 'fee')).toBe(true);
    expect(purposeServes('tax', 'fee')).toBe(false);
    expect(purposeServes('fee', 'fee')).toBe(true);
  });

  it('первый счёт становится основным и для налогов, и для обслуживания', () => {
    expect(orgAccountMains([acc('a', 'both')], 'a')).toEqual([acc('a', 'both', true, true)]);
  });

  it('отмеченный в форме основным становится им, у остальных отметка снимается', () => {
    const result = orgAccountMains(
      [acc('a', 'both', true, true), acc('b', 'both', true, false)],
      'b',
    );
    expect(result).toEqual([acc('a', 'both', false, true), acc('b', 'both', true, false)]);
  });

  it('у счёта с неподходящим назначением отметки нет; основным становится первый подходящий', () => {
    // Счёт «a» сменил назначение на «Обслуживание»: основным для налогов становится «b».
    const result = orgAccountMains(
      [acc('a', 'fee', true, true), acc('b', 'both', false, false)],
      'a',
    );
    expect(result).toEqual([acc('a', 'fee', false, true), acc('b', 'both', true, false)]);
  });

  it('снятая в форме отметка у единственного основного возвращается к первому подходящему', () => {
    const result = orgAccountMains(
      [acc('a', 'both', false, true), acc('b', 'both', false, false)],
      'a',
    );
    expect(result[0]).toEqual(acc('a', 'both', true, true));
  });

  it('после удаления основного им становится первый подходящий', () => {
    expect(orgAccountMains([acc('b', 'tax'), acc('c', 'fee')])).toEqual([
      acc('b', 'tax', true, false),
      acc('c', 'fee', false, true),
    ]);
  });

  it('основной счёт: отмеченный, иначе первый подходящий, иначе нет', () => {
    const list = [acc('a', 'fee', false, true), acc('b', 'tax'), acc('c', 'both', true)];
    expect(orgMainAccount(list, 'tax')?.id).toBe('c');
    expect(orgMainAccount(list, 'fee')?.id).toBe('a');
    expect(orgMainAccount([acc('b', 'tax'), acc('c', 'both')], 'tax')?.id).toBe('b');
    expect(orgMainAccount([acc('a', 'fee')], 'tax')).toBeNull();
  });
});

describe('«Основной» реквизит сотрудника', () => {
  const w = (id: string, isMain: boolean) => ({ id, isMain });

  it('первый реквизит — основной', () => {
    expect(walletMains([w('a', false)], 'a')).toEqual([w('a', true)]);
  });

  it('отмеченный основным становится им, у остальных отметка снимается («Сделать основным»)', () => {
    expect(walletMains([w('a', true), w('b', true)], 'b')).toEqual([w('a', false), w('b', true)]);
  });

  it('новый реквизит без отметки не трогает основной', () => {
    expect(walletMains([w('a', false), w('b', true), w('c', false)], 'c')).toEqual([
      w('a', false),
      w('b', true),
      w('c', false),
    ]);
  });

  it('снятая отметка у основного и удаление основного — основным становится первый', () => {
    expect(walletMains([w('a', false), w('b', false)], 'b')).toEqual([w('a', true), w('b', false)]);
    expect(walletMains([w('b', false), w('c', false)])).toEqual([w('b', true), w('c', false)]);
  });
});

describe('куда контрагент переводит деньги на налоги', () => {
  const orgAccounts = [acc('o1', 'fee', false, true), acc('o2', 'both', true, false)];
  const wallets = [
    { id: 'w1', isMain: false },
    { id: 'w2', isMain: true },
  ];

  it('на счёт организации — её счета для налогов, основной отмечен', () => {
    expect(
      taxRequisiteChoices('org', orgAccounts, wallets).map((x) => [x.requisite.id, x.main]),
    ).toEqual([['o2', true]]);
    expect(mainTaxRequisite('org', orgAccounts, wallets)?.id).toBe('o2');
  });

  it('на кошелёк ответственного — его реквизиты, основной отмечен', () => {
    expect(
      taxRequisiteChoices('emp', orgAccounts, wallets).map((x) => [x.requisite.id, x.main]),
    ).toEqual([
      ['w1', false],
      ['w2', true],
    ]);
    expect(mainTaxRequisite('emp', orgAccounts, wallets)?.id).toBe('w2');
    expect(mainTaxRequisite('emp', orgAccounts, [{ id: 'w1', isMain: false }])?.id).toBe('w1');
    expect(mainTaxRequisite('emp', orgAccounts, [])).toBeNull();
  });
});

describe('предупреждение при удалении счёта (ТЗ «Моя организация»)', () => {
  it('удаляется единственный счёт для налогов, а контрагенты платят на счёт организации', () => {
    const list = [acc('a', 'both', true, true), acc('b', 'fee')];
    expect(lastTaxAccountWarning(list, 'a', 3)).toBe(true);
    expect(lastTaxAccountWarning(list, 'a', 0)).toBe(false);
    expect(lastTaxAccountWarning(list, 'b', 3)).toBe(false);
    expect(lastTaxAccountWarning([...list, acc('c', 'tax')], 'a', 3)).toBe(false);
    expect(lastTaxAccountWarning(list, 'x', 3)).toBe(false);
  });
});
