import type { ListQuery } from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSetUiText,
  countUiTexts,
  getUiText,
  listUiTextsPage,
  listUiTextValues,
} from './admin-ui-texts';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { readPlatformHistory } from './platform-history';
import { platformAuditLog, uiTexts, users } from './schema';
import { seedUiTexts, uiTextSeedRows } from './seed';
import { readSpecJson } from './spec-data';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

/** Нет права на действие с таблицей (у drizzle ошибка базы — в cause). */
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

/** Строка не прошла политику RLS (у drizzle ошибка базы — в cause). */
const rlsViolation = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
});

const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  sort: undefined,
  page: 1,
  size: 25,
  filters: {},
  ...over,
});

describe.skipIf(!databaseAvailable())(
  'Админка → «Локализация»: словарь правит только администратор платформы',
  () => {
    let db: TestDatabase;
    let org: CreatedOrganization;
    let adminId: string;
    let blockedAdminId: string;
    let total: number;

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAccessReference(db.admin.db);
      const { localization } = await readSpecJson<{ localization: unknown }>('data/refDB.json');
      total = uiTextSeedRows(localization).length;
      await seedUiTexts(db.admin.db, localization, { update: false });
      const [admin, blocked] = await db.admin.db
        .insert(users)
        .values([
          { login: 'platform', passwordHash: '!', isPlatformAdmin: true },
          { login: 'platform-old', passwordHash: '!', isPlatformAdmin: true, blocked: true },
        ])
        .returning({ id: users.id });
      adminId = admin!.id;
      blockedAdminId = blocked!.id;
      org = await createOrganization(db.app.db, {
        name: 'ОсОО «Альфа»',
        inn: '01811201810456',
        slug: 'alfa',
        owner: { fullName: 'Асанов Асан', login: 'asanov', passwordHash: '!' },
      });
    });

    afterAll(async () => {
      await db?.drop();
    });

    const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => withUserContext(db.app.db, adminId, fn);

    it('список словаря: все тексты языка, поиск, фильтр по разделу и значения раздела', async () => {
      const page = await asAdmin((tx) =>
        listUiTextsPage(tx, 'ru', query({ sort: { key: 'key', dir: 'asc' } })),
      );
      expect(page.total).toBe(total);
      expect(await countUiTexts(db.app.db, 'ru')).toBe(total);
      const found = await asAdmin((tx) =>
        listUiTextsPage(
          tx,
          'ru',
          query({
            search: { q: 'nav.home', keys: ['key'] },
            filters: { section: { type: 'enum', vals: ['Меню'] } },
          }),
        ),
      );
      expect(found.rows.map((r) => [r.key, r.text, r.section])).toEqual([
        ['nav.home', 'Главная', 'Меню'],
      ]);
      expect(found.rows[0]!.audit).toMatchObject({ createdBy: null, updatedBy: null });
      const sections = await asAdmin((tx) => listUiTextValues(tx, 'ru', 'section'));
      expect(sections.items.map((i) => i.value)).toContain('Админка');
    });

    it('правка: новый текст, версия и «Изменил»; история «было → стало»; тот же текст — без новой версии', async () => {
      const before = (await getUiText(db.app.db, 'ru', 'nav.home'))!;
      const saved = await asAdmin((tx) =>
        adminSetUiText(tx, { lang: 'ru', key: 'nav.home', text: 'Рабочий стол', version: 1 }),
      );
      expect(saved).toMatchObject({
        ok: true,
        record: {
          text: 'Рабочий стол',
          version: 2,
          audit: { updatedBy: 'Администратор платформы' },
        },
      });
      const [row] = await db.admin.db
        .select()
        .from(uiTexts)
        .where(and(eq(uiTexts.lang, 'ru'), eq(uiTexts.key, 'nav.home')));
      expect(row).toMatchObject({ updatedBy: adminId, createdBy: null });
      expect(row!.updatedAt.getTime()).toBeGreaterThanOrEqual(before.audit.updatedAt.getTime());

      const history = await asAdmin((tx) => readPlatformHistory(tx, 'ui_text', 'ru:nav.home'));
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        action: 'update',
        actorUserId: adminId,
        changes: [{ field: 'text', from: 'Главная', to: 'Рабочий стол' }],
      });

      const same = await asAdmin((tx) =>
        adminSetUiText(tx, { lang: 'ru', key: 'nav.home', text: 'Рабочий стол', version: 2 }),
      );
      expect(same).toMatchObject({ ok: true, record: { version: 2 } });
      const stale = await asAdmin((tx) =>
        adminSetUiText(tx, { lang: 'ru', key: 'nav.home', text: 'Главная', version: 1 }),
      );
      expect(stale).toEqual({ ok: false, reason: 'changed' });
      const missing = await asAdmin((tx) =>
        adminSetUiText(tx, { lang: 'ru', key: 'nav.none', text: 'Нет', version: 1 }),
      );
      expect(missing).toEqual({ ok: false, reason: 'not_found' });
      expect(await asAdmin((tx) => readPlatformHistory(tx, 'ui_text', 'ru:nav.home'))).toHaveLength(
        1,
      );
    });

    it('правку администратора наполнение (--update) не затирает', async () => {
      const { localization } = await readSpecJson<{ localization: unknown }>('data/refDB.json');
      await seedUiTexts(db.admin.db, localization, { update: true });
      expect(await getUiText(db.app.db, 'ru', 'nav.home')).toMatchObject({
        text: 'Рабочий стол',
        version: 2,
      });
    });

    it('сотрудник организации, заблокированный администратор и запрос без контекста текст не меняют', async () => {
      const set = sql`select app.admin_set_ui_text('ru', 'btn.save', 'Взлом', 1) as v`;
      const viaOwner = await withOrgContext(
        db.app.db,
        { orgId: org.orgId, userId: org.ownerUserId },
        (tx) => tx.execute<{ v: number | null }>(set),
      );
      expect(viaOwner[0]!.v).toBeNull();
      const viaBlocked = await withUserContext(db.app.db, blockedAdminId, (tx) =>
        tx.execute<{ v: number | null }>(set),
      );
      expect(viaBlocked[0]!.v).toBeNull();
      const bare = await db.app.db.transaction((tx) => tx.execute<{ v: number | null }>(set));
      expect(bare[0]!.v).toBeNull();
      // Пустой текст не сохраняет и администратор.
      const empty = await asAdmin((tx) =>
        tx.execute<{ v: number | null }>(
          sql`select app.admin_set_ui_text('ru', 'btn.save', '   ', 1) as v`,
        ),
      );
      expect(empty[0]!.v).toBeNull();
      // И слишком длинный (больше 2000 знаков).
      const long = await asAdmin((tx) =>
        tx.execute<{ v: number | null }>(
          sql`select app.admin_set_ui_text('ru', 'btn.save', ${'а'.repeat(2001)}, 1) as v`,
        ),
      );
      expect(long[0]!.v).toBeNull();
      expect(await getUiText(db.app.db, 'ru', 'btn.save')).toMatchObject({
        text: 'Сохранить',
        version: 1,
      });
      // Напрямую словарь роль приложения не меняет и у администратора.
      await expect(
        asAdmin((tx) =>
          tx.update(uiTexts).set({ text: 'Взлом' }).where(eq(uiTexts.key, 'btn.save')),
        ),
      ).rejects.toThrow(permissionDenied);
    });

    it('история платформы: видит и пишет только администратор; записи не меняются и не удаляются', async () => {
      const entry = { entity: 'ui_text', entityId: 'ru:btn.save', action: 'update' };
      const ownerRows = await withOrgContext(
        db.app.db,
        { orgId: org.orgId, userId: org.ownerUserId },
        (tx) => tx.select().from(platformAuditLog),
      );
      expect(ownerRows).toEqual([]);
      await expect(
        withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
          tx.insert(platformAuditLog).values(entry),
        ),
      ).rejects.toThrow(rlsViolation);
      await expect(
        withUserContext(db.app.db, blockedAdminId, (tx) =>
          tx.insert(platformAuditLog).values(entry),
        ),
      ).rejects.toThrow(rlsViolation);
      // Другого автора не подставить.
      await expect(
        asAdmin((tx) =>
          tx.insert(platformAuditLog).values({ ...entry, actorUserId: blockedAdminId }),
        ),
      ).rejects.toThrow(rlsViolation);
      expect(await db.app.db.select().from(platformAuditLog)).toEqual([]);
      await expect(
        asAdmin((tx) => tx.update(platformAuditLog).set({ reason: 'правка' })),
      ).rejects.toThrow(permissionDenied);
      await expect(asAdmin((tx) => tx.delete(platformAuditLog))).rejects.toThrow(permissionDenied);
    });
  },
);
