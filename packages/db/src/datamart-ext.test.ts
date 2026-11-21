import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client';
import { withOrgContext } from './context';
import {
  cleanupDmRequests,
  dmExtTarget,
  dmTokenTemplateHow,
  releaseDmExt,
  takeDmExt,
  type DmExtLimits,
} from './datamart-ext';
import { insertDmToken, revokeDmToken } from './datamart-tokens';
import { createOrganization, type CreatedOrganization } from './organizations';
import { dmRequests, dmTemplates, rateLimits } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** Адрес — как его передаёт API (`clientIpSubject`): SHA-256 адреса с приставкой. */
const ipOf = (s: string) => hash(`dm_ext:${s}`);
const LIMITS: DmExtLimits = {
  perMinute: 3,
  perDay: 5,
  leaseSeconds: 30,
  orgRuns: 2,
  platformRuns: 3,
};

// Внешний адрес «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 6, пункт 4; блок 8, пункт 6;
// поток Т, этап 2, П11; миграция 0174): токен по хешу без входа, счёт неизвестных токенов с адреса,
// обращения известного токена, пределы токена, запуски платформы и организации, очистка журнала.
describe.skipIf(!databaseAvailable())('витрина данных: внешний адрес', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let templateId = '';
  const raw = `bk_${randomUUID().replaceAll('-', '')}`;
  let tokenId = '';
  const target = (tokenHash: string, ip: string, badMax = 3, tryMax = 100) =>
    dmExtTarget(db.app.db, {
      tokenHash,
      ip,
      badMax,
      badWindowSeconds: 600,
      tryMax,
      tryWindowSeconds: 60,
    });
  /** Токен организации или Админки (`orgId` null) с номером, которого нет в базе: пределы — по номеру. */
  const tok = (orgId: string | null = null) => ({ tokenId: randomUUID(), orgId });

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
    expect(await target(hash(raw), ipOf('ip-1'))).toEqual({
      outcome: 'ok',
      tokenId,
      orgId: a.orgId,
      createdBy: a.ownerUserId,
      templateId,
      templateCode: 'dme-rep',
    });
    // Не хеш — неизвестный.
    expect(await target('не хеш', ipOf('ip-1'))).toEqual({ outcome: 'unknown' });
  });

  it('неизвестные токены с адреса: после предела адрес ждёт даже с верным токеном; известный не считается', async () => {
    for (let i = 0; i < 3; i++) {
      expect(await target(hash(`bk_fake_${i}`), ipOf('ip-2'))).toEqual({ outcome: 'unknown' });
    }
    const wait = await target(hash(raw), ipOf('ip-2'));
    expect(wait.outcome).toBe('ip_wait');
    expect(wait.outcome === 'ip_wait' && wait.waitSeconds).toBeGreaterThan(590);
    // Другой адрес — свой счёт; известный токен счёт не растит.
    for (let i = 0; i < 5; i++) expect((await target(hash(raw), ipOf('ip-3'))).outcome).toBe('ok');
    const rows = await db.admin.db
      .select({ subject: rateLimits.subject })
      .from(rateLimits)
      .where(eq(rateLimits.kind, 'dm_ext_bad'));
    expect(rows.filter((r) => r.subject === ipOf('ip-2'))).toHaveLength(3);
    expect(rows.filter((r) => r.subject === ipOf('ip-3'))).toHaveLength(0);
  });

  it('пределы токена: один одновременно, за минуту и за сутки; отказ в счёт не идёт', async () => {
    const t = tok(a.orgId);
    const id = t.tokenId;
    const first = await takeDmExt(db.app.db, t, LIMITS);
    expect(first.ok).toBe(true);
    expect(await takeDmExt(db.app.db, t, LIMITS)).toEqual({
      ok: false,
      reason: 'busy',
      waitSeconds: 1,
    });
    if (first.ok) await releaseDmExt(db.app.db, first.slot);
    for (let i = 0; i < 2; i++) {
      const s = await takeDmExt(db.app.db, t, LIMITS);
      expect(s.ok).toBe(true);
      if (s.ok) await releaseDmExt(db.app.db, s.slot);
    }
    const minute = await takeDmExt(db.app.db, t, LIMITS);
    expect(minute).toMatchObject({ ok: false, reason: 'limited' });
    expect(!minute.ok && minute.waitSeconds).toBeGreaterThanOrEqual(1);
    expect(!minute.ok && minute.waitSeconds).toBeLessThanOrEqual(60);
    // Минута прошла: в счёте за сутки — три, предел суток — пять.
    await db.admin.db
      .update(rateLimits)
      .set({ at: sql`${rateLimits.at} - interval '2 minutes'` })
      .where(eq(rateLimits.subject, id));
    for (let i = 0; i < 2; i++) {
      const s = await takeDmExt(db.app.db, t, LIMITS);
      expect(s.ok).toBe(true);
      if (s.ok) await releaseDmExt(db.app.db, s.slot);
    }
    await db.admin.db
      .update(rateLimits)
      .set({ at: sql`${rateLimits.at} - interval '2 minutes'` })
      .where(eq(rateLimits.subject, id));
    const day = await takeDmExt(db.app.db, t, LIMITS);
    expect(day).toMatchObject({ ok: false, reason: 'limited' });
    expect(!day.ok && day.waitSeconds).toBeGreaterThan(3600);
    const rows = await db.admin.db.select().from(rateLimits).where(eq(rateLimits.subject, id));
    expect(rows).toHaveLength(LIMITS.perDay);
    // Чужой номер строки запрос другого токена не отпускает.
    const other = tok(a.orgId);
    const s = await takeDmExt(db.app.db, other, LIMITS);
    expect(s.ok).toBe(true);
    if (s.ok) await releaseDmExt(db.app.db, { ...s.slot, tokenId: id });
    expect((await takeDmExt(db.app.db, other, LIMITS)).ok).toBe(false);
    if (s.ok) await releaseDmExt(db.app.db, s.slot);
  });

  it('запуски по токенам: у организации не больше двух, на платформу — трёх; строка запуска уходит при отпускании', async () => {
    const runs = () =>
      db.admin.db.select().from(rateLimits).where(eq(rateLimits.kind, 'dm_ext_run'));
    expect(await runs()).toHaveLength(0);
    const take = async (t: ReturnType<typeof tok>) => {
      const s = await takeDmExt(db.app.db, t, LIMITS);
      expect(s.ok, JSON.stringify(s)).toBe(true);
      if (!s.ok) throw new Error('не занято');
      return s.slot;
    };
    const a1 = await take(tok(a.orgId));
    const a2 = await take(tok(a.orgId));
    // Третий токен той же организации ждёт, а токен Админки — нет.
    const a3 = tok(a.orgId);
    expect(await takeDmExt(db.app.db, a3, LIMITS)).toEqual({
      ok: false,
      reason: 'run_busy',
      waitSeconds: 1,
    });
    const adm = await take(tok(null));
    // Платформа занята: и токен Админки, и другой организации ждут.
    expect(await takeDmExt(db.app.db, tok(null), LIMITS)).toMatchObject({ reason: 'run_busy' });
    expect(await takeDmExt(db.app.db, tok(randomUUID()), LIMITS)).toMatchObject({
      reason: 'run_busy',
    });
    expect(await runs()).toHaveLength(3);
    // Отказ «занято» в счёт токена не идёт: строки у него нет.
    expect(
      await db.admin.db.select().from(rateLimits).where(eq(rateLimits.subject, a3.tokenId)),
    ).toHaveLength(0);
    // Номер запуска другой организации строку не удаляет.
    await releaseDmExt(db.app.db, { ...a1, orgId: null });
    expect(await runs()).toHaveLength(3);
    await releaseDmExt(db.app.db, a1);
    expect(await runs()).toHaveLength(2);
    const a3slot = await take(a3);
    // Брошенный сбоем запуск (не отпущен) перестаёт считаться, когда выйдет срок аренды.
    await db.admin.db
      .update(rateLimits)
      .set({ busyUntil: sql`now() - interval '1 second'` })
      .where(eq(rateLimits.kind, 'dm_ext_run'));
    const after = await take(tok(a.orgId));
    for (const s of [a2, adm, a3slot, after]) await releaseDmExt(db.app.db, s);
    expect((await runs()).filter((r) => r.busyUntil && r.busyUntil > new Date())).toHaveLength(0);
  });

  it('очередь запусков под гонкой: 20 токенов разом на пуле из шести соединений — занято ровно 3, у организации — 2', async () => {
    const pool = createDb(db.appUrl, { max: 6, applicationName: 'buhuchet-test-race' });
    try {
      const race = async (tokens: ReturnType<typeof tok>[]) => {
        const takes = await Promise.all(tokens.map((t) => takeDmExt(pool.db, t, LIMITS)));
        const slots = takes.flatMap((x) => (x.ok ? [x.slot] : []));
        expect(takes.filter((x) => !x.ok).every((x) => !x.ok && x.reason === 'run_busy')).toBe(
          true,
        );
        await Promise.all(slots.map((x) => releaseDmExt(pool.db, x)));
        return slots;
      };
      for (let round = 0; round < 3; round++) {
        // Токены разных организаций и Админки: занято столько, сколько мест на платформе.
        const mixed = Array.from({ length: 20 }, (_, i) => tok(i % 5 === 0 ? null : randomUUID()));
        expect(await race(mixed)).toHaveLength(LIMITS.platformRuns);
        // Токены одной организации: занято столько, сколько мест у организации.
        const one = Array.from({ length: 20 }, () => tok(a.orgId));
        expect(await race(one)).toHaveLength(LIMITS.orgRuns);
      }
      // Один токен разом: занят один запрос, остальные — «идёт прежний».
      const same = tok(a.orgId);
      const takes = await Promise.all(
        Array.from({ length: 10 }, () => takeDmExt(pool.db, same, LIMITS)),
      );
      const won = takes.flatMap((x) => (x.ok ? [x.slot] : []));
      expect(won).toHaveLength(1);
      await releaseDmExt(pool.db, won[0]!);
      const runs = await db.admin.db
        .select()
        .from(rateLimits)
        .where(eq(rateLimits.kind, 'dm_ext_run'));
      expect(runs.filter((r) => r.busyUntil && r.busyUntil > new Date())).toHaveLength(0);
    } finally {
      await pool.close();
    }
  });

  it('известный токен: не больше предела обращений за минуту, и отозванный тоже; в счёт адреса не идёт', async () => {
    const gone = `bk_${randomUUID().replaceAll('-', '')}`;
    const made = await withOrgContext(
      db.app.db,
      { orgId: a.orgId, userId: a.ownerUserId },
      async (tx) => {
        const t = await insertDmToken(tx, {
          templateId,
          name: 'Отозванный',
          tokenHash: hash(gone),
          prefix: gone.slice(0, 9),
          termDays: 30,
        });
        expect(await revokeDmToken(tx, t.id)).toBe(true);
        return t;
      },
    );
    const ip = ipOf('ip-try');
    for (let i = 0; i < 4; i++) {
      expect(await target(hash(gone), ip, 3, 4)).toMatchObject({ outcome: 'ok', tokenId: made.id });
    }
    const wait = await target(hash(gone), ip, 3, 4);
    expect(wait.outcome).toBe('token_wait');
    expect(wait.outcome === 'token_wait' && wait.waitSeconds).toBeGreaterThanOrEqual(1);
    expect(wait.outcome === 'token_wait' && wait.waitSeconds).toBeLessThanOrEqual(60);
    // Счёт адреса не вырос: отозванный токен известен.
    const bad = await db.admin.db
      .select()
      .from(rateLimits)
      .where(and(eq(rateLimits.kind, 'dm_ext_bad'), eq(rateLimits.subject, ip)));
    expect(bad).toHaveLength(0);
    // Другой токен с того же адреса — свой счёт (у него обращения прежних тестов: свой предел побольше).
    expect((await target(hash(raw), ip)).outcome).toBe('ok');
  });

  it('неверные пределы — ошибка функции', async () => {
    await expect(takeDmExt(db.app.db, tok(), { ...LIMITS, perMinute: 0 })).rejects.toThrow();
    await expect(takeDmExt(db.app.db, tok(), { ...LIMITS, orgRuns: 0 })).rejects.toThrow();
    // Предел платформы меньше предела организации — ошибка.
    await expect(
      takeDmExt(db.app.db, tok(), { ...LIMITS, orgRuns: 3, platformRuns: 2 }),
    ).rejects.toThrow();
    await expect(target(hash(raw), ipOf('x'), 0)).rejects.toThrow();
    await expect(target(hash(raw), ipOf('x'), 3, 0)).rejects.toThrow();
    // Адрес — только SHA-256 (64 знака hex): длинный текст в счёт адресов не попадёт.
    await expect(target(hash(raw), 'x'.repeat(500))).rejects.toThrow();
    // Журнал не стереть раньше 90 дней.
    await expect(cleanupDmRequests(db.app.db, 0)).rejects.toThrow();
    await expect(cleanupDmRequests(db.app.db, 89)).rejects.toThrow();
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
