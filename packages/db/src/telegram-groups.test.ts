import { createHash, randomBytes } from 'node:crypto';
import { RecordChangedError } from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { auditLog, telegramGroups, telegramGroupTokens, users } from './schema';
import {
  createTelegramGroupToken,
  linkTelegramGroup,
  markTelegramGroupGone,
  moveTelegramGroup,
  readTelegramGroup,
  setTelegramGroupSummary,
  telegramGroupOrg,
  telegramGroupToken,
  unlinkTelegramGroup,
} from './telegram-groups';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const newHash = () => createHash('sha256').update(randomBytes(32)).digest('hex');

// Общий рабочий чат фирмы (поток Т, задача Т8; docs/decisions.md п. Т-8).
describe.skipIf(!databaseAvailable())('Общий чат фирмы в Telegram: база', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  const ctxA = () => ({ orgId: a.orgId, userId: a.ownerUserId });
  const ctxB = () => ({ orgId: b.orgId, userId: b.ownerUserId });
  const now = () => new Date();
  const tokenFor = async (ctx: { orgId: string; userId: string }, minutes = 15) => {
    const hash = newHash();
    await withOrgContext(t.app.db, ctx, (tx) =>
      createTelegramGroupToken(tx, { tokenHash: hash, userId: ctx.userId, minutes }),
    );
    return hash;
  };
  const link = (ctx: { orgId: string; userId: string }, hash: string, chatId: number) =>
    withOrgContext(t.app.db, ctx, (tx) =>
      linkTelegramGroup(tx, { tokenHash: hash, chatId, title: 'Бухгалтерия', now: now() }),
    );

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    a = await createOrganization(t.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'org-a',
      owner: { fullName: 'Токтомаматов Бекзат', login: 'owner-a', passwordHash: 'hash-a' },
    });
    b = await createOrganization(t.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'org-b',
      owner: { fullName: 'Абдыкадырова Айгуль', login: 'owner-b', passwordHash: 'hash-b' },
    });
    await t.admin.db.update(users).set({ mustChangePassword: false });
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('ссылка одноразовая: организация по ключу, подключение, повтор — отказ', async () => {
    const hash = await tokenFor(ctxA());
    expect(await telegramGroupToken(t.app.db, hash)).toEqual({
      orgId: a.orgId,
      createdBy: a.ownerUserId,
      expired: false,
      used: false,
      orgActive: true,
    });
    expect(await telegramGroupToken(t.app.db, newHash())).toBeNull();
    expect(await link(ctxA(), hash, -1001)).toEqual({ status: 'ok', previousChatId: null });
    expect(await link(ctxA(), hash, -1001)).toEqual({ status: 'invalid' });
    expect((await telegramGroupToken(t.app.db, hash))!.used).toBe(true);
    expect(await telegramGroupOrg(t.app.db, -1001)).toEqual({ orgId: a.orgId, gone: false });
    expect(await telegramGroupOrg(t.app.db, -1002)).toBeNull();
    const group = await withOrgContext(t.app.db, ctxA(), readTelegramGroup);
    expect(group).toMatchObject({
      chatId: -1001,
      title: 'Бухгалтерия',
      linkedBy: a.ownerUserId,
      summary: true,
      goneAt: null,
      version: 1,
    });
  });

  it('истёкшая ссылка не подключает; новая группа заменяет прежнюю', async () => {
    const old = await tokenFor(ctxA(), -1);
    expect((await telegramGroupToken(t.app.db, old))!.expired).toBe(true);
    expect(await link(ctxA(), old, -1003)).toEqual({ status: 'invalid' });
    const hash = await tokenFor(ctxA());
    expect(await link(ctxA(), hash, -1003)).toEqual({ status: 'ok', previousChatId: -1001 });
    expect(await telegramGroupOrg(t.app.db, -1001)).toBeNull();
    expect((await withOrgContext(t.app.db, ctxA(), readTelegramGroup))!.chatId).toBe(-1003);
  });

  it('группа другой организации не становится общим чатом второй', async () => {
    const hash = await tokenFor(ctxB());
    await expect(link(ctxB(), hash, -1003)).rejects.toMatchObject({
      cause: { code: '23505' },
    });
    expect(await withOrgContext(t.app.db, ctxB(), readTelegramGroup)).toBeNull();
  });

  it('чужая организация не видна: ни группы, ни ссылок; без контекста — ничего', async () => {
    const hash = await tokenFor(ctxA());
    const rowsB = await withOrgContext(t.app.db, ctxB(), async (tx) => ({
      groups: await tx.select().from(telegramGroups),
      tokens: await tx.select().from(telegramGroupTokens),
    }));
    expect(rowsB.groups).toEqual([]);
    expect(rowsB.tokens.every((x) => x.orgId === b.orgId)).toBe(true);
    expect(rowsB.tokens.some((x) => x.tokenHash === hash)).toBe(false);
    // Ссылку организации А нельзя использовать в контексте Б.
    expect(await link(ctxB(), hash, -1009)).toEqual({ status: 'invalid' });
    // Изменить запись А из Б — ни одной строки.
    const changed = await withOrgContext(t.app.db, ctxB(), (tx) =>
      tx
        .update(telegramGroups)
        .set({ title: 'Чужая' })
        .where(eq(telegramGroups.orgId, a.orgId))
        .returning(),
    );
    expect(changed).toEqual([]);
    await expect(
      withOrgContext(t.app.db, ctxB(), (tx) =>
        tx.insert(telegramGroups).values({
          orgId: a.orgId,
          chatId: -1010,
          title: 'Чужая',
          linkedBy: a.ownerUserId,
        }),
      ),
    ).rejects.toThrow();
    expect(await t.app.db.select().from(telegramGroups)).toEqual([]);
  });

  it('сводка, «бота удалили», новый номер группы и отключение — с историей и версией', async () => {
    const g = (await withOrgContext(t.app.db, ctxA(), readTelegramGroup))!;
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        setTelegramGroupSummary(tx, {
          version: g.version + 5,
          summary: false,
          userId: a.ownerUserId,
        }),
      ),
    ).rejects.toBeInstanceOf(RecordChangedError);
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      setTelegramGroupSummary(tx, { version: g.version, summary: false, userId: a.ownerUserId }),
    );
    expect(
      await withOrgContext(t.app.db, { orgId: a.orgId, userId: null }, (tx) =>
        moveTelegramGroup(tx, { from: -1003, to: -1004 }),
      ),
    ).toBe(true);
    expect(
      await withOrgContext(t.app.db, { orgId: a.orgId, userId: null }, (tx) =>
        markTelegramGroupGone(tx, { chatId: -1004, now: now() }),
      ),
    ).toBe(true);
    // Повторное «удалили» — без второй записи истории.
    expect(
      await withOrgContext(t.app.db, { orgId: a.orgId, userId: null }, (tx) =>
        markTelegramGroupGone(tx, { chatId: -1004, now: now() }),
      ),
    ).toBe(false);
    expect(await telegramGroupOrg(t.app.db, -1004)).toEqual({ orgId: a.orgId, gone: true });
    const after = (await withOrgContext(t.app.db, ctxA(), readTelegramGroup))!;
    expect(after).toMatchObject({ summary: false, chatId: -1004 });
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) =>
        unlinkTelegramGroup(tx, { version: after.version }),
      ),
    ).toEqual({ chatId: -1004, gone: true });
    expect(await withOrgContext(t.app.db, ctxA(), readTelegramGroup)).toBeNull();
    const fields = (
      await t.admin.db
        .select({ changes: auditLog.changes })
        .from(auditLog)
        .where(eq(auditLog.entityId, a.orgId))
    )
      .flatMap((r) => r.changes.map((c) => c.field))
      .filter((f) => f.startsWith('telegramGroup'));
    expect(fields).toEqual([
      'telegramGroup',
      'telegramGroup',
      'telegramGroupSummary',
      'telegramGroupGone',
      'telegramGroup',
    ]);
  });
});
