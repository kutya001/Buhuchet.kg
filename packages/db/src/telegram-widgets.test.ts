import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { telegramWidgets } from './schema';
import {
  lockTelegramWidget,
  saveTelegramWidget,
  telegramWidgetsSince,
  updateTelegramWidget,
} from './telegram-widgets';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

// Виджет «Мои отчёты на неделю» (поток Т, задача Т9).
describe.skipIf(!databaseAvailable())('Виджет «Мои отчёты на неделю»: база', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  const ctxA = () => ({ orgId: a.orgId, userId: a.ownerUserId });
  const ctxB = () => ({ orgId: b.orgId, userId: b.ownerUserId });
  const widget = (userId: string, messageId: number, sentOn = '2026-11-16') => ({
    userId,
    chatId: 7001,
    messageId,
    items: ['r1'],
    data: '{"h":"x"}',
    sentOn,
  });

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
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('один виджет на сотрудника: новый возвращает прежний; правка, поиск по чату и сообщению', async () => {
    const save = (messageId: number) =>
      withOrgContext(t.app.db, ctxA(), (tx) =>
        saveTelegramWidget(tx, widget(a.ownerUserId, messageId)),
      );
    expect(await save(10)).toBeNull();
    expect(await save(11)).toEqual({ chatId: 7001, messageId: 10 });
    // Повтор того же сообщения — прежнего нет.
    expect(await save(11)).toBeNull();
    await withOrgContext(t.app.db, ctxA(), async (tx) => {
      const key = { userId: a.ownerUserId, chatId: 7001 };
      expect(await lockTelegramWidget(tx, { ...key, messageId: 10 })).toBeNull();
      await updateTelegramWidget(tx, a.ownerUserId, { items: ['r2', 'r3'], data: '{"h":"y"}' });
      expect(await lockTelegramWidget(tx, { ...key, messageId: 11 })).toMatchObject({
        items: ['r2', 'r3'],
        data: '{"h":"y"}',
        sentOn: '2026-11-16',
      });
      expect(await telegramWidgetsSince(tx, '2026-11-16')).toHaveLength(1);
      expect(await telegramWidgetsSince(tx, '2026-11-17')).toHaveLength(0);
    });
  });

  it('чужая организация не видна, не меняется и не создаётся; данные не больше 1 КБ', async () => {
    await withOrgContext(t.app.db, ctxB(), async (tx) => {
      expect(await telegramWidgetsSince(tx, '2000-01-01')).toEqual([]);
      expect(
        await lockTelegramWidget(tx, { userId: a.ownerUserId, chatId: 7001, messageId: 11 }),
      ).toBeNull();
      await updateTelegramWidget(tx, a.ownerUserId, { items: [], data: '{}' });
    });
    await withOrgContext(t.app.db, ctxA(), async (tx) => {
      expect((await telegramWidgetsSince(tx, '2000-01-01'))[0]?.data).toBe('{"h":"y"}');
    });
    // Сотрудник организации А в контексте Б — не записать (RLS и связка «пользователь — организация»).
    await expect(
      withOrgContext(t.app.db, ctxB(), (tx) => saveTelegramWidget(tx, widget(a.ownerUserId, 20))),
    ).rejects.toThrow();
    await expect(
      withOrgContext(t.app.db, ctxB(), (tx) =>
        saveTelegramWidget(tx, { ...widget(b.ownerUserId, 21), data: 'я'.repeat(600) }),
      ),
    ).rejects.toThrow();
    // Без контекста не видно ничего.
    expect(await t.app.db.select().from(telegramWidgets)).toEqual([]);
  });
});
