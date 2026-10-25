import { describe, expect, it } from 'vitest';
import { roleFromUrl } from './migrate';

describe('roleFromUrl', () => {
  it('берёт имя роли из строки подключения', () => {
    expect(roleFromUrl('postgres://buhuchet_web:pw@localhost:5432/buhuchet')).toBe('buhuchet_web');
  });

  it('у пула Supabase отбрасывает суффикс проекта', () => {
    expect(
      roleFromUrl(
        'postgres://buhuchet_web.abcdefgh:pw@aws-0-eu-central-1.pooler.example:6543/postgres',
      ),
    ).toBe('buhuchet_web');
  });
});
