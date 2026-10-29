import { describe, expect, it } from 'vitest';
import {
  contractorDeleteRefusal,
  contractorFieldProblems,
  innDuplicateMessage,
  innProblem,
  officeBenefitChanges,
  parseContract,
  type ContractorFieldsInput,
} from './rules';

describe('ИНН контрагента', () => {
  it('ровно 14 цифр, первая — 0, 1 или 2', () => {
    expect(innProblem('01234567890123')).toBeNull();
    expect(innProblem('21234567890123')).toBeNull();
    expect(innProblem('1234567890123')).toBe('inn_format');
    expect(innProblem('123456789012345')).toBe('inn_format');
    expect(innProblem('0123456789012a')).toBe('inn_format');
    expect(innProblem('')).toBe('inn_format');
    expect(innProblem('31234567890123')).toBe('inn_start');
    expect(innProblem('91234567890123')).toBe('inn_start');
  });

  it('дубль называет найденного; у архивного при создании — вернуть из архива', () => {
    expect(innDuplicateMessage({ name: 'ОсОО «Ала-Тоо»', archived: false }, 'create')).toBe(
      'Такой ИНН уже есть: ОсОО «Ала-Тоо»',
    );
    expect(innDuplicateMessage({ name: 'ИП Асанов', archived: true }, 'create')).toBe(
      'Такой ИНН уже есть: ИП Асанов (в архиве — верните его из архива, а не создавайте заново)',
    );
    expect(innDuplicateMessage({ name: 'ИП Асанов', archived: true }, 'edit')).toBe(
      'Такой ИНН уже есть: ИП Асанов (в архиве)',
    );
  });
});

describe('Удаление контрагента', () => {
  it('только без отчётов, денег и проектов; отчёты — первыми', () => {
    expect(contractorDeleteRefusal({ reports: 0, money: 0, projects: 0 })).toBeNull();
    expect(contractorDeleteRefusal({ reports: 2, money: 1, projects: 1 })).toBe('has_reports');
    expect(contractorDeleteRefusal({ reports: 0, money: 1, projects: 1 })).toBe('has_money');
    expect(contractorDeleteRefusal({ reports: 0, money: 0, projects: 3 })).toBe('has_projects');
  });
});

describe('Поля контрагента', () => {
  const ok: ContractorFieldsInput = {
    gked: '47.11.0',
    gkedExtra: ['62.01.0'],
    regimeCode: 'РЕЖ-03',
    regime2Code: 'РЕЖ-02',
    benefits: [{ code: 'ЛЬГ-01', validFrom: '2026-01-01', validTo: '2026-12-31' }],
    registration: { okpo: '12345678', email: 'buh@example.kg' },
  };

  it('правильные поля — замечаний нет', () => {
    expect(contractorFieldProblems(ok)).toEqual([]);
    expect(contractorFieldProblems({ ...ok, regime2Code: null, registration: undefined })).toEqual(
      [],
    );
  });

  it('основной ГКЭД обязателен и не повторяется в дополнительных', () => {
    expect(contractorFieldProblems({ ...ok, gked: null })).toEqual([
      { field: 'gked', problem: 'gked_required' },
    ]);
    expect(contractorFieldProblems({ ...ok, gkedExtra: ['47.11.0'] })).toEqual([
      { field: 'gkedExtra', problem: 'gked_extra_main' },
    ]);
  });

  it('дополнительный режим — только с основным и не тот же', () => {
    expect(contractorFieldProblems({ ...ok, regimeCode: null })).toEqual([
      { field: 'regime2Code', problem: 'regime2_without_regime' },
    ]);
    expect(contractorFieldProblems({ ...ok, regime2Code: 'РЕЖ-03' })).toEqual([
      { field: 'regime2Code', problem: 'regime2_same' },
    ]);
  });

  it('«Действует по» не раньше «Действует с»; открытые сроки допустимы', () => {
    expect(
      contractorFieldProblems({
        ...ok,
        benefits: [{ code: 'ЛЬГ-01', validFrom: '2026-05-01', validTo: '2026-04-30' }],
      }),
    ).toEqual([{ field: 'benefits', problem: 'benefit_dates' }]);
    expect(
      contractorFieldProblems({
        ...ok,
        benefits: [{ code: 'ЛЬГ-01', validFrom: null, validTo: '2026-04-30' }],
      }),
    ).toEqual([]);
  });

  it('ОКПО — 8 цифр, почта — с «@» и доменом', () => {
    expect(
      contractorFieldProblems({ ...ok, registration: { okpo: '1234567', email: 'buh@kg' } }),
    ).toEqual([
      { field: 'registration.okpo', problem: 'okpo_format' },
      { field: 'registration.email', problem: 'email_format' },
    ]);
  });
});

describe('Договор из строки прототипа', () => {
  it('номер и дата', () => {
    expect(parseContract('№ 160/24 от 16.07.2024')).toEqual({ no: '160/24', date: '2024-07-16' });
    expect(parseContract('№ 12')).toEqual({ no: '12', date: null });
    expect(parseContract('Без номера от 01.02.2026')).toEqual({ no: '', date: '2026-02-01' });
    expect(parseContract('—')).toEqual({ no: '', date: null });
    expect(parseContract('')).toEqual({ no: '', date: null });
    expect(parseContract('устный')).toEqual({ no: 'устный', date: null });
  });
});

describe('Статусы «Ставится по УГНС»', () => {
  it('новое УГНС отмечает свои статусы, прежнее снимает свои; ручные не трогаются', () => {
    expect(officeBenefitChanges([], [], ['ЛЬГ-30'])).toEqual({ add: ['ЛЬГ-30'], drop: [] });
    expect(officeBenefitChanges(['ЛЬГ-30'], [], ['ЛЬГ-30'])).toEqual({ add: [], drop: [] });
    expect(officeBenefitChanges(['ЛЬГ-30', 'ЛЬГ-29'], ['ЛЬГ-30'], [])).toEqual({
      add: [],
      drop: ['ЛЬГ-30'],
    });
    // Поставлен вручную при другом УГНС: смена УГНС его не снимает.
    expect(officeBenefitChanges(['ЛЬГ-30'], [], [])).toEqual({ add: [], drop: [] });
    expect(officeBenefitChanges(['ЛЬГ-30'], ['ЛЬГ-30'], ['ЛЬГ-30'])).toEqual({
      add: [],
      drop: [],
    });
  });
});
