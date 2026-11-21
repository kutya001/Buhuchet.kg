import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import {
  cleanupDmRequests,
  dmExtTarget,
  dmTokenTemplateHow,
  releaseDmExt,
  takeDmExt,
  type DmExtLimits,
} from './datamart-ext';
import { insertDmToken } from './datamart-tokens';
import { createOrganization, type CreatedOrganization } from './organizations';
import { dmRequests, dmTemplates, rateLimits } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const LIMITS: DmExtLimits = { perMinute: 3, perDay: 5, leaseSeconds: 30 };

// Внешний адрес «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 6, пункт 4; блок 8, пункт 6;
// поток Т, этап 2, П11; миграция 0172): токен по хешу без входа, счёт неизвестных токенов с адреса,
// пределы токена и очистка журнала.
describe.skipIf(!databaseAvailable())('витрина данных: внешний адрес', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let templateId = '';
  const raw = `bk_${randomUUID().replaceAll('-', '')}`;
  let tokenId = '';
  const target = (tokenHash: string, ip: string, badMax = 3) =>
    dmExtTarget(db.app.db, { tokenHash, ip, badMax, badWindowSeconds: 600 });

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810480',
      slug: 'dme-a',
      owner: { fullName: 'Владелец Тест', login: 'dme-owner-a', passwordHash: 'x' },
    });
    const [t] = await db.admin.db
      .insert(dmTemplates)
      .values({ code: 'dme-rep', name: 'Шаблон', module: 'reports', state: 'published' })
      .returning({ id: dmTemplates.id });
    templateId = t!.id;
    const made = await withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
      insertDmToken(tx, {
        templateId,
        name: 'Токен',
        tokenHash: hash(raw),
        prefix: raw.slice(0, 9),
        termDays: 30,
      }),
    );
    tokenId = made.id;
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('роль приложения сама не видит токены и счёт адресов — только функциями', async () => {
    const tokens = await db.app.db.execute(sql`select count(*)::int as n from public.dm_tokens`);
    expect(tokens[0]).toMatchObject({ n: 0 });
    await expect(db.app.db.select().from(rateLimits)).rejects.toThrow();
  });

  it('токен по хешу: организация, кто создал, шаблон и код; без входа', async () => {
    expect(await target(hash(raw), 'ip-1')).toEqual({
      outcome: 'ok',
      tokenId,
      orgId: a.orgId,
      createdBy: a.ownerUserId,
      templateId,
      templateCode: 'dme-rep',
    });
    // Не хеш — неизвестный.
    expect(await target('не хеш', 'ip-1')).toEqual({ outcome: 'unknown' });
  });

  it('неизвестные токены с адреса: после предела адрес ждёт даже с верным токеном; известный не считается', async () => {
    for (let i = 0; i < 3; i++) {
      expect(await target(hash(`bk_fake_${i}`), 'ip-2')).toEqual({ outcome: 'unknown' });
    }
    const wait = await target(hash(raw), 'ip-2');
    expect(wait.outcome).toBe('ip_wait');
    expect(wait.outcome === 'ip_wait' && wait.waitSeconds).toBeGreaterThan(590);
    // Другой адрес — свой счёт; известный токен счёт не растит.
    for (let i = 0; i < 5; i++) expect((await target(hash(raw), 'ip-3')).outcome).toBe('ok');
    const rows = await db.admin.db
      .select({ subject: rateLimits.subject })
      .from(rateLimits)
      .where(eq(rateLimits.kind, 'dm_ext_bad'));
    expect(rows.filter((r) => r.subject === 'ip-2')).toHaveLength(3);
    expect(rows.filter((r) => r.subject === 'ip-3')).toHaveLength(0);
  });

  it('пределы токена: один одновременно, за минуту и за сутки; отказ в счёт не идёт', async () => {
    const id = randomUUID();
    const first = await takeDmExt(db.app.db, id, LIMITS);
    expect(first.ok).toBe(true);
    expect(await takeDmExt(db.app.db, id, LIMITS)).toEqual({
      ok: false,
      reason: 'busy',
      waitSeconds: 1,
    });
    if (first.ok) await releaseDmExt(db.app.db, id, first.ticket);
    for (let i = 0; i < 2; i++) {
      const s = await takeDmExt(db.app.db, id, LIMITS);
      expect(s.ok).toBe(true);
      if (s.ok) await releaseDmExt(db.app.db, id, s.ticket);
    }
    const minute = await takeDmExt(db.app.db, id, LIMITS);
    expect(minute).toMatchObject({ ok: false, reason: 'limited' });
    expect(!minute.ok && minute.waitSeconds).toBeGreaterThanOrEqual(1);
    expect(!minute.ok && minute.waitSeconds).toBeLessThanOrEqual(60);
    // Минута прошла: в счёте за сутки — три, предел суток — пять.
    await db.admin.db
      .update(rateLimits)
      .set({ at: sql`${rateLimits.at} - interval '2 minutes'` })
      .where(eq(rateLimits.subject, id));
    for (let i = 0; i < 2; i++) {
      const s = await takeDmExt(db.app.db, id, LIMITS);
      expect(s.ok).toBe(true);
      if (s.ok) await releaseDmExt(db.app.db, id, s.ticket);
    }
    await db.admin.db
      .update(rateLimits)
      .set({ at: sql`${rateLimits.at} - interval '2 minutes'` })
      .where(eq(rateLimits.subject, id));
    const day = await takeDmExt(db.app.db, id, LIMITS);
    expect(day).toMatchObject({ ok: false, reason: 'limited' });
    expect(!day.ok && day.waitSeconds).toBeGreaterThan(3600);
    const rows = await db.admin.db.select().from(rateLimits).where(eq(rateLimits.subject, id));
    expect(rows).toHaveLength(LIMITS.perDay);
    // Чужой номер строки запрос другого токена не отпускает.
    const other = randomUUID();
    const s = await takeDmExt(db.app.db, other, LIMITS);
    if (s.ok) await releaseDmExt(db.app.db, id, s.ticket);
    expect((await takeDmExt(db.app.db, other, LIMITS)).ok).toBe(false);
  });

  it('неверные пределы — ошибка функции', async () => {
    await expect(
      takeDmExt(db.app.db, randomUUID(), { perMinute: 0, perDay: 1, leaseSeconds: 1 }),
    ).rejects.toThrow();
    await expect(
      dmExtTarget(db.app.db, { tokenHash: hash(raw), ip: 'x', badMax: 0, badWindowSeconds: 1 }),
    ).rejects.toThrow();
    await expect(cleanupDmRequests(db.app.db, 0)).rejects.toThrow();
  });

  it('«Как подключить»: код, параметры и столбцы видимого шаблона; невидимый — null', async () => {
    const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
      withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
    expect(await inA((tx) => dmTokenTemplateHow(tx, templateId))).toEqual({
      code: 'dme-rep',
      params: [],
      columns: [],
    });
    const [adm] = await db.admin.db
      .insert(dmTemplates)
      .values({ code: 'dme-adm', name: 'Админ', audience: 'admin', state: 'published' })
      .returning({ id: dmTemplates.id });
    expect(await inA((tx) => dmTokenTemplateHow(tx, adm!.id))).toBeNull();
    await db.admin.db
      .update(dmTemplates)
      .set({ state: 'off' })
      .where(eq(dmTemplates.id, templateId));
    expect(await inA((tx) => dmTokenTemplateHow(tx, templateId))).toBeNull();
    await db.admin.db
      .update(dmTemplates)
      .set({ state: 'published' })
      .where(eq(dmTemplates.id, templateId));
  });

  it('журнал запросов хранится 90 дней: старые строки удаляются', async () => {
    const at = (days: number) => sql`now() - make_interval(days => ${days})`;
    await db.admin.db.insert(dmRequests).values([
      { orgId: a.orgId, tokenId, templateId, via: 'api', outcome: 'ok', at: at(91) },
      { orgId: a.orgId, tokenId, templateId, via: 'api', outcome: 'ok', at: at(89) },
    ]);
    expect(await cleanupDmRequests(db.app.db, 90)).toBe(1);
    const left = await db.admin.db
      .select({ id: dmRequests.id })
      .from(dmRequests)
      .where(eq(dmRequests.tokenId, tokenId));
    expect(left).toHaveLength(1);
  });
});
