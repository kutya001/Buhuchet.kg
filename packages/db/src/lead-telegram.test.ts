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
import { createEmployee } from './staff';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  employees,
  loginAttempts,
  organizations,
  passwordResetCodes,
  passwordSetupTokens,
  platformLeadEvents,
  platformLeads,
  platformLeadTgTokens,
  roles,
  sessionLog,
  sessions,
  telegramLinkGuards,
  telegramLinks,
  telegramOutbox,
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
 * действующая ссылка на бота у заявки одна и только браузеру, который её получил, истекла без «Старта» —
 * повтор заявки получает новую; «Старт» — один раз; причина
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
  const submitted = async (over: Partial<LeadSubmission> = {}, ttlHours = 24) => {
    const s = lead(over);
    const res = await submitLead(db.app.db, s);
    const k = key();
    const issued = await db.app.db.transaction((tx) =>
      issueLeadTgToken(tx, {
        leadId: res.leadId!,
        hash: hashOf(k),
        priorHash: null,
        now: s.now,
        ttlHours,
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
        issueLeadTgToken(tx, {
          leadId: l.id,
          hash: hashOf(key()),
          priorHash: null,
          now,
          ttlHours: 24,
        }),
      );
    expect(await again(NOW)).toBeNull();
    expect(await again(hour(1))).toBeNull();
    expect(
      await db.admin.db.$count(platformLeadTgTokens, eq(platformLeadTgTokens.leadId, l.id)),
    ).toBe(1);
  });

  it('повтор с того же телефона: пока ссылка действует — только её браузеру; истекла без «Старта» — новая; после «Старта» — «подключён» только с ключом', async () => {
    // Срок ссылки короче окна повтора (сейчас оба — 24 часа): так видно, что истёкшая ссылка не тупик.
    const l = await submitted({}, 2);
    expect(l.issued).toEqual({ outcome: 'new', till: hour(2) });
    const repeat = async (priorHash: string | null, now: Date, k = key()) => {
      const res = await submitLead(db.app.db, lead({ phone: l.phone, now }));
      expect(res.outcome).toBe('repeat');
      return db.app.db.transaction((tx) =>
        issueLeadTgToken(tx, {
          leadId: res.leadId!,
          hash: hashOf(k),
          priorHash,
          now,
          ttlHours: 24,
        }),
      );
    };
    // Посторонний, знающий телефон, пока ссылка действует: ни новой ссылки, ни чужой.
    expect(await repeat(null, hour(0.1))).toBeNull();
    const stranger = await submitted();
    expect(await repeat(hashOf(stranger.key), hour(0.2))).toBeNull();
    // Тот же браузер — та же ссылка с прежним сроком.
    expect(await repeat(hashOf(l.key), hour(0.3))).toEqual({ outcome: 'same', till: hour(2) });
    // Срок вышел без «Старта» — новая ссылка любому повтору (как в прототипе).
    const fresh = key();
    expect(await repeat(null, hour(3), fresh)).toEqual({ outcome: 'new', till: hour(27) });
    expect(await repeat(null, hour(4))).toBeNull();
    expect(await repeat(hashOf(l.key), hour(5))).toBeNull();
    expect(await repeat(hashOf(fresh), hour(6))).toEqual({ outcome: 'same', till: hour(27) });
    expect(await start(l.key, 7001, hour(7))).toEqual({ outcome: 'bad' });
    expect(await start(fresh, 7001, hour(7))).toEqual({
      outcome: 'linked',
      firm: 'ОсОО «Учёт Плюс»',
    });
    // Подключён — «подключён» браузеру с ключом любой ссылки этой заявки, остальным — ничего.
    expect(await repeat(hashOf(fresh), hour(8))).toEqual({ outcome: 'linked' });
    expect(await repeat(hashOf(l.key), hour(9))).toEqual({ outcome: 'linked' });
    expect(await repeat(null, hour(10))).toBeNull();
    expect(await repeat(hashOf(stranger.key), hour(11))).toBeNull();
    expect(
      await db.admin.db.$count(platformLeadTgTokens, eq(platformLeadTgTokens.leadId, l.id)),
    ).toBe(2);
  });

  it('через сутки тот же телефон — новая заявка со своей ссылкой: заявитель, потерявший ссылку, не в тупике', async () => {
    const l = await submitted();
    const res = await submitLead(db.app.db, lead({ phone: l.phone, now: hour(25) }));
    expect(res.outcome).toBe('created');
    expect(res.leadId).not.toBe(l.id);
    expect(
      await db.app.db.transaction((tx) =>
        issueLeadTgToken(tx, {
          leadId: res.leadId!,
          hash: hashOf(key()),
          priorHash: null,
          now: hour(25),
          ttlHours: 24,
        }),
      ),
    ).toEqual({ outcome: 'new', till: hour(49) });
  });

  it('«Старт»: заявка получает чат и имя, в истории «Telegram подключён» через Telegram; ссылка — один раз', async () => {
    const l = await submitted();
    expect(await start(l.key, 7101)).toEqual({ outcome: 'linked', firm: 'ОсОО «Учёт Плюс»' });
    const [saved] = await db.admin.db
      .select()
      .from(platformLeads)
      .where(eq(platformLeads.id, l.id));
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
      expect.objectContaining({
        text: '@aigul_s',
        via: 'telegram',
        actorUserId: null,
        at: hour(1),
      }),
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
    const take = (id: string) => asAdmin((tx) => takeLeadRefusal(tx, id));
    const l = await submitted();
    await start(l.key, 7301);
    expect(await take(l.id)).toBeNull();
    await reject(l.id, 'Не наш регион');
    // Не администратор платформы причину не берёт и не тратит.
    expect(
      await withOrgContext(db.app.db, { orgId: other.orgId, userId: other.ownerUserId }, (tx) =>
        takeLeadRefusal(tx, l.id),
      ),
    ).toBeNull();
    expect(await take(l.id)).toEqual({
      chatId: 7301,
      firm: 'ОсОО «Учёт Плюс»',
      reason: 'Не наш регион',
    });
    expect(await take(l.id)).toBeNull();
    // Сняли отказ и отказали снова — новая причина уходит.
    await asAdmin((tx) =>
      setLeadStatus(tx, {
        id: l.id,
        version: null,
        to: 'new',
        before: null,
        rollback: true,
        text: 'Ошибка',
        now: hour(3),
      }),
    );
    expect(await take(l.id)).toBeNull();
    await reject(l.id, 'Нет ИНН', hour(4));
    expect((await take(l.id))?.reason).toBe('Нет ИНН');

    const early = await submitted();
    await reject(early.id, 'Дубль заявки');
    expect(await take(early.id)).toBeNull();
    expect(await start(early.key, 7302, hour(3))).toEqual({
      outcome: 'refused',
      firm: 'ОсОО «Учёт Плюс»',
      reason: 'Дубль заявки',
    });
    expect(await take(early.id)).toBeNull();
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
    expect(link).toMatchObject({
      orgId: org.orgId,
      chatId: 7401,
      username: 'aigul_s',
      firstName: 'Айгуль',
    });
    // Повтор того же вызова — тот же чат, true; другой пользователь — нет.
    expect(
      await asAdmin((tx) =>
        linkLeadOwnerTelegramRow(tx, { leadId: l.id, userId: org.ownerUserId }),
      ),
    ).toBe(true);
    expect(
      await asAdmin((tx) =>
        linkLeadOwnerTelegramRow(tx, { leadId: l.id, userId: other.ownerUserId }),
      ),
    ).toBe(false);
    // Не администратор платформы (владелец организации в своём контексте) — нет.
    expect(
      await withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
        linkLeadOwnerTelegramRow(tx, { leadId: l.id, userId: org.ownerUserId }),
      ),
    ).toBe(false);

    // Владелец уже входил, уволен или привязывал и отвязывал Telegram — чат заявителя ему не
    // привязывается (иначе это замена Telegram в обход кода из прежнего чата).
    const relink = async (
      slug: string,
      inn: string,
      spoil: (userId: string) => Promise<unknown>,
    ) => {
      const ll = await submitted();
      await start(ll.key, 7400 + n);
      const org2 = await createOrganization(db.app.db, {
        name: `ОсОО «${slug}»`,
        inn,
        slug,
        owner: { fullName: 'Садыкова Айгуль', login: `${slug}-owner`, passwordHash: 'random' },
      });
      await db.admin.db
        .update(users)
        .set({ mustChangePassword: false })
        .where(eq(users.id, org2.ownerUserId));
      await spoil(org2.ownerUserId);
      return asAdmin(async (tx) => {
        await connectLeadToOrganization(tx, {
          id: ll.id,
          orgId: org2.orgId,
          orgName: slug,
          now: hour(3),
        });
        return linkLeadOwnerTelegramRow(tx, { leadId: ll.id, userId: org2.ownerUserId });
      });
    };
    expect(
      await relink('ltg-al1', '12811201810457', (id) =>
        db.admin.db
          .update(users)
          .set({ lastLoginAt: hour(1) })
          .where(eq(users.id, id)),
      ),
    ).toBe(false);
    expect(
      await relink('ltg-al2', '13811201810458', (id) =>
        db.admin.db.update(employees).set({ active: false }).where(eq(employees.userId, id)),
      ),
    ).toBe(false);
    expect(
      await relink('ltg-al3', '14811201810459', async (id) => {
        const [u] = await db.admin.db
          .select({ orgId: users.orgId })
          .from(users)
          .where(eq(users.id, id));
        await db.admin.db
          .insert(telegramLinkGuards)
          .values({ userId: id, orgId: u!.orgId, chatId: 7499 });
      }),
    ).toBe(false);

    const noTg = await submitted();
    const second = await approved(noTg.id, 'ltg-beta', '03811201810458');
    expect(second.linked).toBe(false);
    expect(
      await db.admin.db.$count(telegramLinks, eq(telegramLinks.userId, second.org.ownerUserId)),
    ).toBe(0);
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
    const peek = (kk: string, now = hour(5)) =>
      peekPasswordSetup(db.app.db, { hash: hashOf(kk), now });
    expect(await peek(k)).toEqual({
      userId: org.ownerUserId,
      orgId: org.orgId,
      login: 'ltg-gamma-owner',
      orgName: 'ОсОО «ltg-gamma»',
    });
    expect(await peek(k)).not.toBeNull();
    expect(await peek(k, hour(4 + 7 * 24))).toBeNull();

    const [session] = await db.admin.db
      .insert(sessions)
      .values({
        userId: org.ownerUserId,
        orgId: org.orgId,
        tokenHash: hashOf(key()),
        // По настоящим часам: журнал сеансов сверяет срок с now() базы.
        expiresAt: new Date(Date.now() + 30 * 3_600_000),
      })
      .returning({ id: sessions.id });
    // Неверные пароли и ждущий код «Забыли пароль?» до ссылки.
    await db.admin.db.update(users).set({ loginFailures: 3 }).where(eq(users.id, org.ownerUserId));
    await db.admin.db.insert(loginAttempts).values({ login: 'ltg-gamma-owner', failures: 3 });
    const [resetCode] = await db.admin.db
      .insert(passwordResetCodes)
      .values({
        userId: org.ownerUserId,
        orgId: org.orgId,
        codeHash: 'argon-code',
        expiresAt: hour(6),
      })
      .returning({ id: passwordResetCodes.id });
    // Ссылка чужой организации в контексте другой — не подходит.
    expect(
      await withOrgContext(db.app.db, { orgId: other.orgId, userId: other.ownerUserId }, (tx) =>
        completePasswordSetup(tx, { hash: hashOf(k), passwordHash: 'x', now: hour(5) }),
      ),
    ).toBeNull();
    // Организация ссылки, но от имени другого пользователя — тоже нет.
    expect(
      await withOrgContext(db.app.db, { orgId: org.orgId, userId: adminId }, (tx) =>
        completePasswordSetup(tx, { hash: hashOf(k), passwordHash: 'x', now: hour(5) }),
      ),
    ).toBeNull();
    expect(await complete(org, k)).toBe('ltg-gamma-owner');
    const [u] = await db.admin.db.select().from(users).where(eq(users.id, org.ownerUserId));
    expect(u).toMatchObject({
      passwordHash: 'argon-new',
      mustChangePassword: false,
      loginFailures: 0,
    });
    expect(await db.admin.db.$count(sessions, eq(sessions.userId, org.ownerUserId))).toBe(0);
    const [ended] = await db.admin.db
      .select()
      .from(sessionLog)
      .where(eq(sessionLog.id, session!.id));
    expect(ended?.endReason).toBe('password');
    expect(
      await db.admin.db.$count(loginAttempts, eq(loginAttempts.login, 'ltg-gamma-owner')),
    ).toBe(0);
    const [revoked] = await db.admin.db
      .select()
      .from(passwordResetCodes)
      .where(eq(passwordResetCodes.id, resetCode!.id));
    expect(revoked?.expiresAt).toEqual(hour(5));
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
    expect(await issueSetup(org.ownerUserId, second, hour(5))).toMatchObject({
      outcome: 'ok',
      first: false,
    });
    expect(await peekPasswordSetup(db.app.db, { hash: hashOf(first), now: hour(6) })).toBeNull();
    expect(
      await peekPasswordSetup(db.app.db, { hash: hashOf(second), now: hour(6) }),
    ).not.toBeNull();

    // Блокировка гасит ссылку насовсем: снятие блокировки её не возвращает — на любых часах (срок
    // становится моментом выдачи, часы базы не участвуют).
    await db.admin.db.update(users).set({ blocked: true }).where(eq(users.id, org.ownerUserId));
    await db.admin.db.update(users).set({ blocked: false }).where(eq(users.id, org.ownerUserId));
    expect(await peekPasswordSetup(db.app.db, { hash: hashOf(second), now: hour(6) })).toBeNull();
    expect(await peekPasswordSetup(db.app.db, { hash: hashOf(second), now: hour(5) })).toBeNull();

    // Закрытый вход («Это не я», неверные пароли) — так же; пока вход закрыт, новой ссылки нет.
    const locked = key();
    expect((await issueSetup(org.ownerUserId, locked, hour(6)))?.outcome).toBe('ok');
    await db.admin.db
      .update(users)
      .set({ loginLockedAt: hour(6) })
      .where(eq(users.id, org.ownerUserId));
    expect(await peekPasswordSetup(db.app.db, { hash: hashOf(locked), now: hour(6) })).toBeNull();
    expect(await issueSetup(org.ownerUserId, key(), hour(6))).toBeNull();
    await db.admin.db
      .update(users)
      .set({ loginLockedAt: null })
      .where(eq(users.id, org.ownerUserId));
    expect(await peekPasswordSetup(db.app.db, { hash: hashOf(locked), now: hour(6) })).toBeNull();

    // Организация заблокирована: ссылка не открывается, не тратится и не выдаётся.
    const blockedOrg = key();
    expect((await issueSetup(org.ownerUserId, blockedOrg, hour(6)))?.outcome).toBe('ok');
    await db.admin.db
      .update(organizations)
      .set({ status: 'blocked' })
      .where(eq(organizations.id, org.orgId));
    expect(
      await peekPasswordSetup(db.app.db, { hash: hashOf(blockedOrg), now: hour(6) }),
    ).toBeNull();
    expect(await complete(org, blockedOrg, hour(6))).toBeNull();
    expect(await issueSetup(org.ownerUserId, key(), hour(6))).toBeNull();
    await db.admin.db
      .update(organizations)
      .set({ status: 'active' })
      .where(eq(organizations.id, org.orgId));
    expect(
      await peekPasswordSetup(db.app.db, { hash: hashOf(blockedOrg), now: hour(6) }),
    ).not.toBeNull();

    // Временный пароль от администратора — пароль задан, ссылки «использованы».
    const third = key();
    expect((await issueSetup(org.ownerUserId, third, hour(7)))?.outcome).toBe('ok');
    await db.admin.db
      .update(users)
      .set({ passwordHash: 'temp' })
      .where(eq(users.id, org.ownerUserId));
    expect(await peekPasswordSetup(db.app.db, { hash: hashOf(third), now: hour(8) })).toBeNull();
    expect(
      await db.admin.db.$count(
        passwordSetupTokens,
        and(
          eq(passwordSetupTokens.userId, org.ownerUserId),
          sql`${passwordSetupTokens.usedAt} is null`,
        ),
      ),
    ).toBe(0);

    // Владелец без Telegram: ссылка не выдаётся.
    const noTg = await submitted();
    const plain = await approved(noTg.id, 'ltg-eps', '06811201810451');
    expect(await issueSetup(plain.org.ownerUserId, key())).toMatchObject({
      outcome: 'no_telegram',
      first: true,
    });
    expect(
      await db.admin.db.$count(
        passwordSetupTokens,
        eq(passwordSetupTokens.userId, plain.org.ownerUserId),
      ),
    ).toBe(0);
  });

  it('первая ссылка — только владельцу организации по заявке, который не входил и не получал временный пароль', async () => {
    const unset = (userId: string) =>
      asAdmin(async (tx) => {
        const [r] = await tx.execute<{ v: boolean }>(
          sql`select app.password_unset(${userId}::uuid) as v`,
        );
        return r?.v;
      });
    // Свежий владелец (не входил, временного пароля нет) организации без заявки.
    const plain = await createOrganization(db.app.db, {
      name: 'ОсОО «ltg-nolead»',
      inn: '15811201810450',
      slug: 'ltg-nolead',
      owner: { fullName: 'Иванов Иван', login: 'ltg-nolead-owner', passwordHash: 'random' },
    });
    await db.admin.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, plain.ownerUserId));
    await db.admin.db
      .insert(telegramLinks)
      .values({ userId: plain.ownerUserId, orgId: plain.orgId, chatId: 7700 });
    expect(await issueSetup(plain.ownerUserId, key())).toBeNull();
    expect(await unset(plain.ownerUserId)).toBe(false);
    const l = await submitted();
    await start(l.key, 7701);
    const { org } = await approved(l.id, 'ltg-zeta', '07811201810452');
    // До первой ссылки (её отправка не удалась) — уже «Пароль не задан»: кнопка выдаст первую.
    expect(await unset(org.ownerUserId)).toBe(true);

    // Сотрудник — не владелец, даже без временного пароля и ни разу не входивший.
    const [role] = await db.admin.db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(and(eq(roles.orgId, org.orgId), eq(roles.isOwner, false)))
      .limit(1);
    const staffId = await withOrgContext(
      db.app.db,
      { orgId: org.orgId, userId: org.ownerUserId },
      async (tx) => {
        await createEmployee(tx, {
          fullName: 'Петрова Анна',
          shortName: 'Петрова А.',
          login: 'ltg-zeta-staff',
          passwordHash: 'h',
          phone: null,
          role: role!,
        });
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.login, 'ltg-zeta-staff'));
        return u!.id;
      },
    );
    await db.admin.db.update(users).set({ mustChangePassword: false }).where(eq(users.id, staffId));
    await db.admin.db
      .insert(telegramLinks)
      .values({ userId: staffId, orgId: org.orgId, chatId: 7702 });
    expect(await issueSetup(staffId, key())).toBeNull();
    expect(await unset(staffId)).toBe(false);

    await db.admin.db
      .update(users)
      .set({ mustChangePassword: true })
      .where(eq(users.id, org.ownerUserId));
    expect(await issueSetup(org.ownerUserId, key())).toBeNull();
    expect(await unset(org.ownerUserId)).toBe(false);
    await db.admin.db
      .update(users)
      .set({ mustChangePassword: false, lastLoginAt: hour(1) })
      .where(eq(users.id, org.ownerUserId));
    expect(await issueSetup(org.ownerUserId, key())).toBeNull();
    expect(await unset(org.ownerUserId)).toBe(false);
  });

  it('«Повторить» в журнале отправок Админки ссылку «Задать пароль» не повторяет', async () => {
    const [row] = await db.admin.db
      .insert(telegramOutbox)
      .values({
        userId: other.ownerUserId,
        orgId: other.orgId,
        chatId: 7900,
        kind: 'setup_link',
        status: 'error',
      })
      .returning({ id: telegramOutbox.id });
    const queued = await asAdmin(async (tx) => {
      const [r] = await tx.execute<{ n: number }>(
        sql`select app.admin_telegram_retry(array[${row!.id}]::uuid[], ${hour(1).toISOString()}::timestamptz) as n`,
      );
      return r?.n;
    });
    expect(queued).toBe(0);
    const [after] = await db.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.id, row!.id));
    expect(after?.status).toBe('error');
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
    await expect(db.app.db.execute(sql`select app.password_setup_revoke()`)).rejects.toEqual(
      code('42501'),
    );
  });
});
