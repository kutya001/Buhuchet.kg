import { describe, expect, it } from 'vitest';
import { RecordChangedError, RecordNotFoundError } from './errors';
import {
  diffChanges,
  isSecretField,
  redactChanges,
  sameHistoryValue,
  toHistoryValue,
} from './history';

describe('toHistoryValue — значение поля как в JSON', () => {
  it('простые значения как есть, отсутствие — null', () => {
    expect(toHistoryValue('Алишер')).toBe('Алишер');
    expect(toHistoryValue(125050)).toBe(125050);
    expect(toHistoryValue(false)).toBe(false);
    expect(toHistoryValue(undefined)).toBeNull();
    expect(toHistoryValue(null)).toBeNull();
  });

  it('момент — строкой ISO, большое целое — строкой', () => {
    expect(toHistoryValue(new Date('2026-10-25T10:00:00Z'))).toBe('2026-10-25T10:00:00.000Z');
    expect(toHistoryValue(9007199254740993n)).toBe('9007199254740993');
    expect(toHistoryValue(Number.NaN)).toBe('NaN');
  });

  it('массивы и объекты — вложенно, поля undefined отбрасываются', () => {
    expect(
      toHistoryValue({ days: [7, 3], at: new Date('2026-10-25T00:00:00Z'), skip: undefined }),
    ).toEqual({ days: [7, 3], at: '2026-10-25T00:00:00.000Z' });
  });

  it('прочее — строкой', () => {
    expect(toHistoryValue(Symbol.for('x'))).toBe('Symbol(x)');
  });
});

describe('sameHistoryValue', () => {
  it('у объектов порядок ключей не важен, у массивов — важен', () => {
    expect(sameHistoryValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameHistoryValue([1, 2], [2, 1])).toBe(false);
    expect(sameHistoryValue([1], [1, 2])).toBe(false);
    expect(sameHistoryValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameHistoryValue({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameHistoryValue([1], { 0: 1 })).toBe(false);
    expect(sameHistoryValue(null, {})).toBe(false);
    expect(sameHistoryValue('1', 1)).toBe(false);
  });
});

describe('diffChanges — что было и что стало', () => {
  const employee = {
    fullName: 'Тилекова Алина',
    phone: null,
    active: true,
    updatedAt: new Date('2026-10-18T00:00:00Z'),
  };

  it('только поля, которые правка действительно меняет, в порядке правки', () => {
    expect(
      diffChanges(employee, {
        phone: '+996 555 123 456',
        fullName: 'Тилекова Алина',
        active: false,
      }),
    ).toEqual([
      { field: 'phone', from: null, to: '+996 555 123 456' },
      { field: 'active', from: true, to: false },
    ]);
  });

  it('поле со значением undefined правкой не считается', () => {
    expect(diffChanges(employee, { phone: undefined })).toEqual([]);
  });

  it('очистка поля — изменение на null', () => {
    expect(diffChanges({ phone: '+996 555 123 456' }, { phone: null })).toEqual([
      { field: 'phone', from: '+996 555 123 456', to: null },
    ]);
  });

  it('хеш пароля: в истории только факт смены, без значений', () => {
    const changes = diffChanges(
      { passwordHash: '$argon2id$old' },
      { passwordHash: '$argon2id$new' },
    );
    expect(changes).toEqual([{ field: 'passwordHash' }]);
    expect(JSON.stringify(changes)).not.toContain('argon2id');
  });

  it('свой список секретных полей', () => {
    expect(diffChanges({ code: '111111' }, { code: '222222' }, ['code'])).toEqual([
      { field: 'code' },
    ]);
  });

  it('набор прав роли: сравнение по значению, а не по ссылке', () => {
    expect(diffChanges({ permissions: ['cpView'] }, { permissions: ['cpView'] })).toEqual([]);
  });
});

describe('ошибки записи', () => {
  it('устаревшая версия — record_changed с текущей версией', () => {
    const e = new RecordChangedError('employee', 'e1', 3);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('record_changed');
    expect(e.currentVersion).toBe(3);
    expect(e.message).toContain('Запись изменена другим пользователем');
  });

  it('нет записи — not_found', () => {
    const e = new RecordNotFoundError('employee', 'e1');
    expect(e.code).toBe('not_found');
    expect(e.name).toBe('RecordNotFoundError');
  });
});

describe('секретные поля', () => {
  it('по списку и по окончанию имени: Hash, Token, Secret', () => {
    for (const f of ['passwordHash', 'sessionTokenHash', 'linkToken', 'webhookSecret']) {
      expect(isSecretField(f)).toBe(true);
    }
    for (const f of ['fullName', 'gkedCode', 'phone', 'hashtag', 'mustChangePassword']) {
      expect(isSecretField(f)).toBe(false);
    }
    expect(isSecretField('accessCode', ['accessCode'])).toBe(true);
  });

  it('из готового списка изменений значения секретных полей убираются', () => {
    expect(
      redactChanges([
        { field: 'telegramLinkToken', from: null, to: 'abc123' },
        { field: 'phone', from: null, to: '+996 555 123 456' },
      ]),
    ).toEqual([
      { field: 'telegramLinkToken' },
      { field: 'phone', from: null, to: '+996 555 123 456' },
    ]);
    expect(redactChanges([{ field: 'pin', from: '1', to: '2' }], ['pin'])).toEqual([
      { field: 'pin' },
    ]);
  });
});
