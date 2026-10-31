import { createHash, randomBytes } from 'node:crypto';
import { RecordChangedError } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { readHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import { orgSettings, telegramDigestDays, telegramNotifySettings, telegramOutbox } from './schema';
import { createTelegramLinkToken, useTelegramLink } from './telegram';
import {
  claimOutbox,
  enqueueTelegram,
  finishOutbox,
  getNotifySettings,
  listOutbox,
  logTelegram,
  markDigestDay,
  saveNotifySettings,
  telegramDigestOrgs,
  telegramOutboxOrgs,
} from './telegram-outbox';
import { notifyTarget } from './telegram-reminders';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
});

describe.skipIf(!databaseAvailable())('Журнал отправок и очередь Telegram (задача 2.25)', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  const ctxA = () => ({ orgId: a.orgId, userId: a.ownerUserId });
  const ctxB = () => ({ orgId: b.orgId, userId: b.ownerUserId });
  // 29.10.2026, 10:00 по Бишкеку.
  const NOW = new Date('2026-10-29T04:00:00Z');

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

  it('очередь: ключ не даёт дубля, попытка засчитывается сразу, итоги — отправлено, повтор, ошибка', async () => {
    const message = { userId: a.ownerUserId, chatId: 5001, kind: 'reminders' as const };
    const ids = await withOrgContext(t.app.db, ctxA(), (tx) =>
      enqueueTelegram(tx, [
        { ...message, text: 'Первое', dedupeKey: 'reminders:test:1' },
        { ...message, text: 'Второе' },
      ]),
    );
    expect(ids).toHaveLength(2);
    const again = await withOrgContext(t.app.db, ctxA(), (tx) =>
      enqueueTelegram(tx, [{ ...message, text: 'Повтор', dedupeKey: 'reminders:test:1' }]),
    );
    expect(again).toEqual([]);
    expect(await telegramOutboxOrgs(t.app.db, new Date())).toEqual([a.orgId]);

    const now = new Date();
    const claimed = await withOrgContext(t.app.db, ctxA(), (tx) =>
      claimOutbox(tx, { now, limit: 10, leaseSeconds: 120 }),
    );
    expect(claimed.map((c) => c.tries)).toEqual([1, 1]);
    // Взятые строки до конца аренды не достаются другому запуску.
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) =>
        claimOutbox(tx, { now, limit: 10, leaseSeconds: 120 }),
      ),
    ).toEqual([]);
    const later = new Date(now.getTime() + 60_000);
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      finishOutbox(tx, [
        { id: ids[0]!, result: 'sent', at: now },
        { id: ids[1]!, result: 'retry', at: later, error: '429: Too Many Requests' },
      ]),
    );
    const retry = await withOrgContext(t.app.db, ctxA(), (tx) =>
      claimOutbox(tx, { now: later, limit: 10, leaseSeconds: 120 }),
    );
    expect(retry).toEqual([
      { id: ids[1], chatId: 5001, kind: 'reminders', text: 'Второе', tries: 2 },
    ]);
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      finishOutbox(tx, [
        { id: ids[1]!, result: 'error', error: '403: bot was blocked by the user' },
      ]),
    );
    const rows = await withOrgContext(t.app.db, ctxA(), (tx) => listOutbox(tx));
    // Обе строки записаны в одной транзакции (одно время) — порядок между ними не важен.
    rows.sort((x, y) => (x.text ?? '').localeCompare(y.text ?? ''));
    expect(rows.map((r) => [r.text, r.status, r.tries, r.lastError])).toEqual([
      ['Второе', 'error', 2, '403: bot was blocked by the user'],
      ['Первое', 'sent', 1, null],
    ]);
  });

  it('строки журнала не удаляются, текст и получатель не меняются', async () => {
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) => tx.delete(telegramOutbox)),
    ).rejects.toEqual(permissionDenied);
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) => tx.update(telegramOutbox).set({ text: 'Подмена' })),
    ).rejects.toEqual(permissionDenied);
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) => tx.delete(telegramDigestDays)),
    ).rejects.toEqual(permissionDenied);
  });

  it('служебное сообщение пишется в журнал после отправки; у кода текста нет; не служебное — отказ', async () => {
    await logTelegram(t.app.db, {
      userId: b.ownerUserId,
      chatId: 7001,
      kind: 'code',
      text: 'Код для восстановления пароля: 482913',
      ok: true,
    });
    await logTelegram(t.app.db, {
      userId: b.ownerUserId,
      chatId: 7001,
      kind: 'unlinked',
      text: 'Telegram отвязан',
      ok: false,
      error: '400: chat not found',
    });
    const rows = await withOrgContext(t.app.db, ctxB(), (tx) => listOutbox(tx));
    expect(rows.map((r) => [r.kind, r.text, r.status, r.lastError])).toEqual([
      ['unlinked', 'Telegram отвязан', 'error', '400: chat not found'],
      ['code', null, 'sent', null],
    ]);
    // Код без текста — и прямой записью в таблицу тоже нельзя.
    await expect(
      withOrgContext(t.app.db, ctxB(), (tx) =>
        tx.insert(telegramOutbox).values({
          orgId: b.orgId,
          userId: b.ownerUserId,
          chatId: 7001,
          kind: 'code',
          text: '482913',
        }),
      ),
    ).rejects.toThrow();
    await expect(
      logTelegram(t.app.db, {
        userId: b.ownerUserId,
        chatId: 7001,
        kind: 'reminders',
        text: 'x',
        ok: true,
      }),
    ).rejects.toThrow();
  });

  it('чужая организация не видна: журнал, настройки уведомлений и отметки дня', async () => {
    await withOrgContext(t.app.db, ctxB(), async (tx) => {
      await markDigestDay(tx, '2026-10-01');
      const target = await notifyTarget(tx, b.ownerEmployeeId);
      await saveNotifySettings(tx, {
        userId: b.ownerUserId,
        employeeId: target!.employeeId,
        version: 0,
        mode: 'digest',
        off: [],
        from: 'Уведомления: Все',
        to: 'Уведомления: Только просрочки и сводка',
      });
    });
    await withOrgContext(t.app.db, ctxA(), async (tx) => {
      expect((await listOutbox(tx)).every((r) => r.userId === a.ownerUserId)).toBe(true);
      expect(await tx.select().from(telegramNotifySettings)).toEqual([]);
      expect(await tx.select().from(telegramDigestDays)).toEqual([]);
    });
    // Чужую отметку дня не поставить: строка с чужой организацией не проходит RLS.
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx.insert(telegramDigestDays).values({ orgId: b.orgId, day: '2026-10-02' }),
      ),
    ).rejects.toThrow();
  });

  it('настройки уведомлений: первая запись, правка по версии, устаревшая — «изменена другим пользователем», история', async () => {
    const target = await withOrgContext(t.app.db, ctxA(), (tx) =>
      notifyTarget(tx, a.ownerEmployeeId),
    );
    expect(target).toMatchObject({ boss: true, settings: { mode: 'all', off: [] } });
    const save = (version: number, mode: 'all' | 'digest' | 'manual', off: ('week' | 'over')[]) =>
      withOrgContext(t.app.db, ctxA(), (tx) =>
        saveNotifySettings(tx, {
          userId: a.ownerUserId,
          employeeId: a.ownerEmployeeId,
          version,
          mode,
          off,
          from: 'было',
          to: 'стало',
        }),
      );
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) => getNotifySettings(tx, a.ownerUserId)),
    ).toEqual({
      mode: 'all',
      off: [],
      version: 0,
    });
    expect(await save(0, 'all', ['week'])).toEqual({ mode: 'all', off: ['week'], version: 1 });
    expect(await save(1, 'digest', [])).toEqual({ mode: 'digest', off: [], version: 2 });
    await expect(save(1, 'manual', [])).rejects.toBeInstanceOf(RecordChangedError);
    const history = await withOrgContext(t.app.db, ctxA(), (tx) =>
      readHistory(tx, 'employee', a.ownerEmployeeId),
    );
    expect(history.filter((h) => h.changes.some((c) => c.field === 'notify'))).toHaveLength(2);
  });

  it('кому пора собрать напоминания: «Напоминания в Telegram» включены, есть привязка, время наступило, за день ещё нет', async () => {
    await t.admin.db
      .update(orgSettings)
      .set({ features: sql`${orgSettings.features} || '{"telegram": true}'::jsonb` })
      .where(eq(orgSettings.orgId, a.orgId));
    // Без привязанного Telegram — некому писать.
    expect(await telegramDigestOrgs(t.app.db, NOW)).toEqual([]);
    const token = createHash('sha256').update(randomBytes(32)).digest('hex');
    await withOrgContext(t.app.db, ctxA(), (tx) => createTelegramLinkToken(tx, token));
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      useTelegramLink(tx, { tokenHash: token, chatId: 5001, username: 'owner', firstName: null }),
    );
    expect(await telegramDigestOrgs(t.app.db, NOW)).toEqual([
      { orgId: a.orgId, day: '2026-10-29' },
    ]);
    // До времени сводки (09:00 по Бишкеку) — рано.
    expect(await telegramDigestOrgs(t.app.db, new Date('2026-10-29T02:30:00Z'))).toEqual([]);
    // Отметка дня — один раз: второй запуск ничего не собирает.
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => markDigestDay(tx, '2026-10-29'))).toBe(
      true,
    );
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => markDigestDay(tx, '2026-10-29'))).toBe(
      false,
    );
    expect(await telegramDigestOrgs(t.app.db, NOW)).toEqual([]);
    // Организация Б: «Напоминания в Telegram» выключены.
    expect(
      (await telegramDigestOrgs(t.app.db, new Date('2026-10-30T04:00:00Z'))).map((r) => r.orgId),
    ).toEqual([a.orgId]);
  });
});
