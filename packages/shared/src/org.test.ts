import { describe, expect, it } from 'vitest';
import { OrgMainForm, OrgSlugField } from './org';

describe('форма «Основное» в «Моей организации»', () => {
  const ok = {
    name: '  ОсОО «Бухгалтер Плюс» ',
    inn: ' 01203201910123 ',
    address: ' г. Бишкек ',
    head: '',
    slug: 'buhgalter-plyus',
  };
  const messages = (input: unknown) => {
    const res = OrgMainForm.safeParse(input);
    return res.success ? [] : res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };

  it('пробелы по краям убираются', () => {
    expect(OrgMainForm.parse(ok)).toEqual({
      name: 'ОсОО «Бухгалтер Плюс»',
      inn: '01203201910123',
      address: 'г. Бишкек',
      head: '',
      slug: 'buhgalter-plyus',
    });
  });

  it('ошибки — ключи словаря с текстами прототипа: «Введите название», «ИНН — 14 цифр»', () => {
    expect(messages({ ...ok, name: '   ', inn: '0120320191012' })).toEqual([
      'name: err.name_required',
      'inn: err.inn_invalid',
    ]);
    expect(messages({ ...ok, inn: '0120320191012a' })).toEqual(['inn: err.inn_invalid']);
    expect(messages({ ...ok, address: 'а'.repeat(501) })).toEqual(['address: form.too_long']);
  });
});

describe('«Адрес страницы организации» в форме', () => {
  const problem = (value: string) => {
    const res = OrgSlugField.safeParse(value);
    return res.success ? null : res.error.issues[0]!.message;
  };

  it('строчные буквы, без пробелов по краям', () => {
    expect(OrgSlugField.parse('  Ahti ')).toBe('ahti');
  });

  it('занятые слова программы и неверный формат — тексты прототипа', () => {
    expect(problem('admin')).toBe('err.slug_reserved');
    expect(problem(' API ')).toBe('err.slug_reserved');
    expect(problem('ab')).toBe('err.slug_invalid');
    expect(problem('не-адрес')).toBe('err.slug_invalid');
    expect(problem('ahti')).toBeNull();
  });
});
