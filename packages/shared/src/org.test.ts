import { describe, expect, it } from 'vitest';
import { OrgMainForm, OrgSlugField } from './org';

describe('форма «Основное» в «Моей организации»', () => {
  const ok = {
    name: '  ОсОО «Бухгалтер Плюс» ',
    okpo: ' 12345678 ',
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
      okpo: '12345678',
      address: 'г. Бишкек',
      head: '',
      slug: 'buhgalter-plyus',
    });
  });

  it('ошибки — ключи словаря с текстами прототипа: «Введите название», «Код ОКПО — 8 цифр»', () => {
    expect(messages({ ...ok, name: '   ', okpo: '1234567' })).toEqual([
      'name: err.name_required',
      'okpo: err.okpo_invalid',
    ]);
    expect(messages({ ...ok, okpo: '1234567a' })).toEqual(['okpo: err.okpo_invalid']);
    // ОКПО необязателен (прототип v114 og-save); ИНН формы больше не проверяет — его не меняет владелец.
    expect(messages({ ...ok, okpo: '' })).toEqual([]);
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
