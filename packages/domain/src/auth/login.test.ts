import { describe, expect, it } from 'vitest';
import { shortName } from '../staff/names';
import { isValidLogin, normalizeLogin } from './login';

describe('логин', () => {
  it('сравнивается без регистра и пробелов по краям', () => {
    expect(normalizeLogin('  Erkin ')).toBe('erkin');
  });

  it('латиница, цифры, точка, подчёркивание, дефис; от 3 символов', () => {
    expect(isValidLogin('b.toktomamatov')).toBe(true);
    expect(isValidLogin('a_b-1')).toBe(true);
    expect(isValidLogin('ab')).toBe(false);
    expect(isValidLogin('эркин')).toBe(false);
    expect(isValidLogin('erkin s')).toBe(false);
    expect(isValidLogin('Erkin')).toBe(false);
  });
});

describe('shortName', () => {
  it('имя и первая буква фамилии', () => {
    expect(shortName('Токтогулов Алишер Бакытович')).toBe('Алишер Т.');
    expect(shortName('  Садыков   Эркин ')).toBe('Эркин С.');
  });

  it('одно слово — как есть', () => {
    expect(shortName('Мээрим')).toBe('Мээрим');
    expect(shortName('')).toBe('');
  });
});
