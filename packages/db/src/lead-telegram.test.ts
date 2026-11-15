import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import {
  completePasswordSetup,
  issueLeadTgToken,
  issuePasswordSetup,
  linkLeadOwnerTelegramRow,
  peekPasswordSetup,
  startLeadTelegram,
  takeLeadRefusal,
} from './lead-telegram';
import { connectLeadToOrganization, setLeadStatus, submitLead, type LeadSubmission } from './leads';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  employees,
  passwordSetupTokens,
  platformLeadEvents,
  platformLeads,
  platformLeadTgTokens,
  sessions,
  telegramLinks,
  users,
} from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

/*
 * Telegram заявителя и пароль владельца по ссылке (доработки 14.11.2026, блок 1; миграция 0149):
 * ссылка на бота — одна на заявку и только браузеру, который её получил; «Старт» — один раз; причина
 * отказа — заявителю один раз; «Одобрить» переносит Telegram заявителя владельцу; «Задать пароль» —
 * 7 дней, один раз, новая гасит прежнюю, пароль иначе — ссылки не действуют.
 */

const NOW = new Date('2026-11-15T06:00:00.000Z');
const hour = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const key = () => randomBytes(32).toString('base64url');
const hashOf = (k: string) => createHash('sha256').update(k, 'utf8').digest('hex');
const code = (c: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code: c }) });

describe.skipIf(!databaseAvailable())('Telegram заявителя и пароль по ссылке', () => {
  let db: TestDatabase;
  let adminId: string;
  let other: CreatedOrganization;
  let n = 0;

  const asAdmin = <T>(run: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, run);

  const lead = (over: Partial<LeadSubmission> = {}): LeadSubmission => {
    n += 1;
    return {
      ipSubject: `ltg-ip-${n}`,
      name: 'Айгуль Садыкова',
      firm: 'ОсОО «Учёт Плюс»',
      phone: `+996555${String(300000 + n)}`,
      size: '21–50',
      telegram: '',
      note: '',
      fromStand: false,
      trap: false,
      notify: null,
      now: NOW,
      ...over,
    };
  };

  /** Заявка, поданная в `now`, и выданная ей ссылка (ключ и хеш). */
  const submitted = async (over: Partial<LeadSubmission> = {}) => {
    const s = lead(over);
    const res = await submitLead(db.app.db, s);
    const k = key();
    const issued = await db.app.db.transaction((tx) =>
      issueLeadTgToken(tx, {
        leadId: res.leadId!,
        hash: hashOf(k),
        priorHash: null,
        now: s.now,
        ttlHours: 24,
      }),
    );
    return { id: res.leadId!, key: k, issued, phone: s.phone };
  };

  const start = (k: string, chatId: number, now = hour(1)) =>
    startLeadTelegram(db.app.db, {
      hash: hashOf(k),
      chatId,
      username: 'aigul_s',
      firstName: 'Айгуль',
      name: '@aigul_s',
      now,
    });

  const reject = (id: string, reason: string, now = hour(2)) =>
    asAdmin((tx) =>
      setLeadStatus(tx, { id, version: null, to: 'rejected', before: 'new', text: reason, now }),
    );

  /** Организация по заявке (как «Одобрить» потока И): владелец без пароля, заявка «Подключена». */
  const approved = async (leadId: string, slug: string, inn: string) => {
    const org = await createOrganization(db.app.db, {
      name: `ОсОО «${slug}»`,
      inn,
      slug,
      owner: { fullName: 'Садыкова Айгуль', login: `${slug}-owner`, passwordHash: 'random' },
    });
    // «Одобрить» создаёт владельца без временного пароля: пароль он задаёт по ссылке.
    await db.admin.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, org.ownerUserId));
    const linked = await asAdmin(async (tx) => {
      await connectLeadToOrganization(tx, {
        id: leadId,
        orgId: org.orgId,
        orgName: `ОсОО «${slug}»`,
        now: hour(3),
      });
      return linkLeadOwnerTelegramRow(tx, { leadId, userId: org.ownerUserId });
    });
    return { org, linked };
  };

  const issueSetup = (userId: string, k: string, now = hour(4)) =>
    asAdmin((tx) => issuePasswordSetup(tx, { userId, hash: hashOf(k), now, days: 7 }));

  const complete = (org: CreatedOrganization, k: string, now = hour(5)) =>
    withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
      completePasswordSetup(tx, { hash: hashOf(k), passwordHash: 'argon-new', now }),
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'ltg-platform', passwordHash: 'h', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    other = await createOrganization(db.app.db, {
      name: 'ОсОО «Другая»',
      inn: '01811201810456',
      slug: 'ltg-other',
      owner: { fullName: 'Другой Владелец', login: 'ltg-other-owner', passwordHash: 'h' },
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('ссылка на бота: новой заявке — одна на 24 часа, в базе только хеш; второй раз и в другой момент — нет', async () => {
    const l = await submitted();
    expect(l.issued).toEqual({ outcome: 'new', till: hour(24) });
    const [row] = await db.admin.db
      .select()
      .from(platformLeadTgTokens)
      .where(eq(platformLeadTgTokens.leadId, l.id));
    expect(row?.tokenHash).toBe(hashOf(l.key));
    expect(JSON.stringify(row)).not.toContain(l.key);
    const again = (now: Date) =>
      db.app.db.transaction((tx) =>
        issueLeadTgToken(tx, { leadId: l.id, hash: hashOf(key()), priorHash: null, now, ttlHours: 24 }),
      );
    expect(await again(NOW)).toBeNull();
    expect(await again(hour(1))).toBeNull();
    expect(await db.admin.db.$count(platformLeadTgTokens, eq(platformLeadTgTokens.leadId, l.id))).toBe(1);
  });

  it('повтор с того же телефона: новой ссылки нет; браузеру с ключом — та же ссылка, после «Старта» — «подключён»', async () => {
    const l = await submitted();
    const repeat = async (priorHash: string | null, now: Date) => {
      const res = await submitLead(db.app.db, lead({ phone: l.phone, now }));
      expect(res.outcome).toBe('repeat');
      return db.app.db.transaction((tx) =>
        issueLeadTgToken(tx, { leadId: res.leadId!, hash: hashOf(key()), priorHash, now, ttlHours: 24 }),
      );
    };
    // Посторонний, знающий телефон: ни новой ссылки, ни чужой.
    expect(await repeat(null, hour(1))).toBeNull();
    const stranger = await submitted();
    expect(await repeat(hashOf(stranger.key), hour(2))).toBeNull();
    // Тот же браузер — та же ссылка с прежним сроком.
    expect(await repeat(hashOf(l.key), hour(3))).toEqual({ outcome: 'same', till: hour(24) });
    expect(await start(l.key, 7001, hour(4))).toEqual({ outcome: 'linked', firm: 'ОсОО «Учёт Плюс»' });
    expect(await repeat(hashOf(l.key), hour(5))).toEqual({ outcome: 'linked' });
    expect(await db.admin.db.$count(platformLeadTgTokens, eq(platformLeadTgTokens.leadId, l.id))).toBe(1);
  });

  it('«Старт»: заявка получает чат и имя, в истории «Telegram подключён» через Telegram; ссылка — один раз', async () => {
    const l = await submitted();
    expect(await start(l.key, 7101)).toEqual({ outcome: 'linked', firm: 'ОсОО «Учёт Плюс»' });
    const [saved] = await db.admin.db.select().from(platformLeads).where(eq(platformLeads.id, l.id));
    expect(saved).toMatchObject({
      tgChatId: 7101,
      tgLinkedAt: hour(1),
      tgUsername: 'aigul_s',
      tgFirstName: 'Айгуль',
      version: 2,
    });
    const events = await db.admin.db
      .select()
      .from(platformLeadEvents)
      .where(and(eq(platformLeadEvents.leadId, l.id), eq(platformLeadEvents.kind, 'tg')));
    expect(events).toEqual([
      expect.objectContaining({ text: '@aigul_s', via: 'telegram', actorUserId: null, at: hour(1) }),
    ]);
    // Telegram повторил доставку — «again», ответа нет; другой чат — «Ссылка устарела».
    expect(await start(l.key, 7101, hour(2))).toEqual({ outcome: 'again' });
    expect(await start(l.key, 7102, hour(2))).toEqual({ outcome: 'bad' });
    expect(await start(key(), 7103)).toEqual({ outcome: 'bad' });
  });

  it('«Старт» по истёкшей ссылке и у удалённой заявки — «Ссылка устарела»', async () => {
    const late = await submitted();
    expect(await start(late.key, 7201, hour(24))).toEqual({ outcome: 'bad' });
    const gone = await submitted();
    await db.admin.db.delete(platformLeads).where(eq(platformLeads.id, gone.id));
    expect(await start(gone.key, 7202)).toEqual({ outcome: 'bad' });
  });

  it('отказ: причина заявителю — один раз; отказ до «Старта» — причина сразу в ответ на «Старт»', async () => {
    const l = await submitted();
    await start(l.key, 7301);
    expect(await takeLeadRefusal(db.app.db, l.id)).toBeNull();
    await reject(l.id, 'Не наш регион');
    expect(await takeLeadRefusal(db.app.db, l.id)).toEqual({
      chatId: 7301,
      firm: 'ОсОО «Учёт Плюс»',
      reason: 'Не наш регион',
    });
    expect(await takeLeadRefusal(db.app.db, l.id)).toBeNull();
    // Сняли отказ и отказали снова — новая причина уходит.
    await asAdmin((tx) =>
      setLeadStatus(tx, { id: l.id, version: null, to: 'new', before: null, rollback: true, text: 'Ошибка', now: hour(3) }),
    );
    expect(await takeLeadRefusal(db.app.db, l.id)).toBeNull();
    await reject(l.id, 'Нет ИНН', hour(4));
    expect((await takeLeadRefusal(db.app.db, l.id))?.reason).toBe('Нет ИНН');

    const early = await submitted();
    await reject(early.id, 'Дубль заявки');
    expect(await takeLeadRefusal(db.app.db, early.id)).toBeNull();
    expect(await start(early.key, 7302, hour(3))).toEqual({
      outcome: 'refused',
      firm: 'ОсОО «Учёт Плюс»',
      reason: 'Дубль заявки',
    });
    expect(await takeLeadRefusal(db.app.db, early.id)).toBeNull();
  });

  it('«Одобрить»: Telegram заявителя — Telegram владельца; без Telegram, не владельцу и не администратору — нет', async () => {
    const l = await submitted();
    await start(l.key, 7401);
    const { org, linked } = await approved(l.id, 'ltg-alfa', '02811201810457');
    expect(linked).toBe(true);
    const [link] = await db.admin.db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, org.ownerUserId));
    expect(link).toMatchObject({ orgId: org.orgId, chatId: 7401, username: 'aigul_s', firstName: 'Айгуль' });
    // Повтор того же вызова — тот же чат, true; другой пользователь — нет.
    expect(await asAdmin((tx) => linkLeadOwnerTelegramRow(tx, { leadId: l.id, userId: org.ownerUserId }))).toBe(true);
    expect(await asAdmin((tx) => linkLeadOwnerTelegramRow(tx, { leadId: l.id, userId: other.ownerUserId }))).toBe(false);
    // Не администратор платформы (владелец организации в своём контексте) — нет.
    expect(
      await withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
        linkLeadOwnerTelegramRow(tx, { leadId: l.id, userId: org.ownerUserId }),
      ),
    ).toBe(false);

    const noTg = await submitted();
    const second = await approved(noTg.id, 'ltg-beta', '03811201810458');
    expect(second.linked).toBe(false);
    expect(await db.admin.db.$count(telegramLinks, eq(telegramLinks.userId, second.org.ownerUserId))).toBe(0);
  });

  it('«Задать пароль»: только администратор; ссылка — в привязанный чат; страница не тратит ссылку; пароль — один раз, сеансы завершены', async () => {
    const l = await submitted();
    await start(l.key, 7501);
    const { org } = await approved(l.id, 'ltg-gamma', '04811201810459');
    const k = key();
    expect(
      await withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
        issuePasswordSetup(tx, { userId: org.ownerUserId, hash: hashOf(k), now: hour(4), days: 7 }),
      ),
    ).toBeNull();
    expect(await issueSetup(org.ownerUserId, k)).toEqual({
      outcome: 'ok',
      chatId: 7501,
      login: 'ltg-gamma-owner',
      orgName: 'ОсОО «ltg-gamma»',
      first: true,
    });
    const unset = () =>
      asAdmin(async (tx) => {
        const [r] = await tx.execute<{ v: boolean }>(
          sql`select app.password_unset(${org.ownerUserId}::uuid) as v`,
        );
        return r?.v;
      });
    expect(await unset()).toBe(true);
    const peek = (kk: string, now = hour(5)) => peekPasswordSetup(db.app.db, { hash: hashOf(kk), now });
    expect(await peek(k)).toEqual({
      userId: org.ownerUserId,
      orgId: org.orgId,
      login: 'ltg-gamma-owner',
      orgName: 'ОсОО «ltg-gamma»',
    });
    expect(await peek(k)).not.toBeNull();
    expect(await peek(k, hour(4 + 7 * 24))).toBeNull();

    await db.admin.db.insert(sessions).values({
      userId: org.ownerUserId,
      orgId: org.orgId,
      tokenHash: hashOf(key()),
      expiresAt: hour(30),
    });
    // Ссылка чужой организации в контексте другой — не подходит.
    expect(
      await withOrgContext(db.app.db, { orgId: other.orgId, userId: other.ownerUserId }, (tx) =>
        completePasswordSetup(tx, { hash: hashOf(k), passwordHash: 'x', now: hour(5) }),
      ),
    ).toBeNull();
    expect(await complete(org, k)).toBe('ltg-gamma-owner');
    const [u] = await db.admin.db.select().from(users).where(eq(users.id, org.ownerUserId));
    expect(u).toMatchObject({ passwordHash: 'argon-new', mustChangePassword: false });
    expect(await db.admin.db.$count(sessions, eq(sessions.userId, org.ownerUserId))).toBe(0);
    expect(await complete(org, k)).toBeNull();
    expect(await peek(k)).toBeNull();
    expect(await unset()).toBe(false);
    // Пароль задан — новой ссылки нет.
    expect(await issueSetup(org.ownerUserId, key(), hour(6))).toBeNull();
  });

  it('новая ссылка гасит прежнюю; смена пароля иначе и блокировка гасят все; без Telegram — no_telegram', async () => {
    const l = await submitted();
    await start(l.key, 7601);
    const { org } = await approved(l.id, 'ltg-delta', '05811201810450');
    const first = key();
    const second = key();
    expect((await issueSetup(org.ownerUserId, first))?.outcome).toBe('ok');
    expect(await issueSetup(org.ownerUserId, second, hour(5))).toMatchObject({ outcome: 'ok', first: false });
    expect(await peekPasswordSetup(db.app.db, { hash: hashOf(first), now: hour(6) })).toBeNull();
    expect(await peekPasswordSetup(db.app.db, { hash: hashOf(second), now: hour(6) })).not.toBeNull();

    // Блокировка гасит ссылку насовсем: снятие блокировки её не возвращает.
    await db.admin.db.update(users).set({ blocked: true }).where(eq(users.id, org.ownerUserId));
    await db.admin.db.update(users).set({ blocked: false }).where(eq(users.id, org.ownerUserId));
    expect(await peekPasswordSetup(db.app.db, { hash: hashOf(second), now: hour(6) })).toBeNull();

    // Временный пароль от администратора — пароль задан, ссылки «использованы».
    const third = key();
    expect((await issueSetup(org.ownerUserId, third, hour(7)))?.outcome).toBe('ok');
    await db.admin.db.update(users).set({ passwordHash: 'temp' }).where(eq(users.id, org.ownerUserId));
    expect(await peekPasswordSetup(db.app.db, { hash: hashOf(third), now: hour(8) })).toBeNull();
    expect(
      await db.admin.db.$count(
        passwordSetupTokens,
        and(eq(passwordSetupTokens.userId, org.ownerUserId), sql`${passwordSetupTokens.usedAt} is null`),
      ),
    ).toBe(0);

    // Владелец без Telegram: ссылка не выдаётся.
    const noTg = await submitted();
    const plain = await approved(noTg.id, 'ltg-eps', '06811201810451');
    expect(await issueSetup(plain.org.ownerUserId, key())).toMatchObject({ outcome: 'no_telegram', first: true });
    expect(await db.admin.db.$count(passwordSetupTokens, eq(passwordSetupTokens.userId, plain.org.ownerUserId))).toBe(0);
  });

  it('первая ссылка — только владельцу организации по заявке, который не входил и не получал временный пароль', async () => {
    // Организация без заявки.
    expect(await issueSetup(other.ownerUserId, key())).toBeNull();
    const l = await submitted();
    await start(l.key, 7701);
    const { org } = await approved(l.id, 'ltg-zeta', '07811201810452');
    await db.admin.db
      .update(users)
      .set({ mustChangePassword: true })
      .where(eq(users.id, org.ownerUserId));
    expect(await issueSetup(org.ownerUserId, key())).toBeNull();
    await db.admin.db
      .update(users)
      .set({ mustChangePassword: false, lastLoginAt: hour(1) })
      .where(eq(users.id, org.ownerUserId));
    expect(await issueSetup(org.ownerUserId, key())).toBeNull();
    // Сотрудник — не владелец.
    const [emp] = await db.admin.db
      .select({ active: employees.active })
      .from(employees)
      .where(eq(employees.userId, org.ownerUserId));
    expect(emp?.active).toBe(true);
  });

  it('таблицы ссылок роль приложения не видит; «пароль не задан» чужой организации — нет', async () => {
    await expect(db.app.db.select().from(platformLeadTgTokens)).rejects.toThrow();
    await expect(db.app.db.select().from(passwordSetupTokens)).rejects.toThrow();
    const l = await submitted();
    await start(l.key, 7801);
    const { org } = await approved(l.id, 'ltg-eta', '08811201810453');
    await issueSetup(org.ownerUserId, key());
    const unsetIn = (orgId: string, userId: string) =>
      withOrgContext(db.app.db, { orgId, userId }, async (tx) => {
        const [r] = await tx.execute<{ v: boolean }>(
          sql`select app.password_unset(${org.ownerUserId}::uuid) as v`,
        );
        return r?.v;
      });
    expect(await unsetIn(org.orgId, org.ownerUserId)).toBe(true);
    expect(await unsetIn(other.orgId, other.ownerUserId)).toBe(false);
    // Функция-триггер роли приложения недоступна.
    await expect(
      db.app.db.execute(sql`select app.password_setup_revoke()`),
    ).rejects.toEqual(code('42501'));
  });
});
