import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureAppLoginRole, roleFromUrl, scramSha256Verifier } from './migrate';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

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

describe('scramSha256Verifier', () => {
  it('формат PostgreSQL, пароль в нём не виден', () => {
    const v = scramSha256Verifier('secret-pass');
    expect(v).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(v).not.toContain('secret-pass');
  });

  it('та же соль — тот же результат, другая соль — другой', () => {
    const salt = Buffer.alloc(16, 1);
    expect(scramSha256Verifier('pw', salt)).toBe(scramSha256Verifier('pw', salt));
    expect(scramSha256Verifier('pw')).not.toBe(scramSha256Verifier('pw'));
  });
});

describe('ensureAppLoginRole: проверки до подключения', () => {
  const admin = 'postgres://postgres:pw@localhost:5432/buhuchet';

  it('роль только с префиксом buhuchet_', async () => {
    await expect(
      ensureAppLoginRole(admin, 'postgres://authenticator:pw@localhost:5432/buhuchet'),
    ).rejects.toThrow(/buhuchet_/);
  });

  it('не владелец схемы и с паролем', async () => {
    await expect(
      ensureAppLoginRole(admin, 'postgres://postgres:pw@localhost:5432/buhuchet'),
    ).rejects.toThrow();
    await expect(
      ensureAppLoginRole(admin, 'postgres://buhuchet_web@localhost:5432/buhuchet'),
    ).rejects.toThrow(/пароля/);
  });
});

describe.skipIf(!databaseAvailable())('ensureAppLoginRole: в базе', () => {
  let t: TestDatabase;
  const BAD_ROLE = `buhuchet_test_owner_${process.pid}`;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t?.admin.sql.unsafe(`drop role if exists "${BAD_ROLE}"`);
    await t?.drop();
  });

  it('роль входит в базу с паролем из строки подключения', async () => {
    const [row] = await t.app.sql<{ me: string }[]>`select current_user as me`;
    expect(row?.me).toBe(roleFromUrl(t.appUrl));
  });

  it('роль с правами владельца таблиц отклоняется', async () => {
    const [owner] = await t.admin.sql<{ owner: string }[]>`
      select tableowner as owner from pg_tables where tablename = 'organizations'`;
    await t.admin.sql.unsafe(`create role "${BAD_ROLE}" login`);
    await t.admin.sql.unsafe(`grant "${owner!.owner}" to "${BAD_ROLE}"`);
    const url = new URL(t.appUrl);
    url.username = BAD_ROLE;
    url.password = 'pw-123456';
    await expect(ensureAppLoginRole(t.adminUrl, url.toString())).rejects.toThrow(/владельца/);
  });
});
