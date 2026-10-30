import { UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminCalendarAdd,
  adminCalendarCopy,
  adminCalendarCopyPlan,
  adminCalendarDelete,
  adminCalendarHistory,
  exportAdminCalendar,
  listAdminCalendarPage,
  listAdminCalendarValues,
} from './admin-calendar';
import { adminDictHistory } from './admin-platform-dicts';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { productionCalendar, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

/** «Сегодня» теста: годы вкладки — 2026 и 2027. */
const TODAY = '2026-10-27';

describe.skipIf(!databaseAvailable())(
  'Админка → «Справочники платформы» → «Календарь»: правит только администратор платформы',
  () => {
    let db: TestDatabase;
    let org: CreatedOrganization;
    let adminId: string;

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAccessReference(db.admin.db);
      await seedAllPlatformDictionaries(db.admin.db);
      const [admin] = await db.admin.db
        .insert(users)
        .values({ login: 'platform', passwordHash: '!', isPlatformAdmin: true })
        .returning({ id: users.id });
      adminId = admin!.id;
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
    const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
      withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, fn);

    it('список: дни текущего и следующего года по дате; праздник «каждый год» — в обоих годах', async () => {
      const page = await asAdmin((tx) => listAdminCalendarPage(tx, query(), t, TODAY));
      expect([page.year, page.nextFilled]).toEqual([2026, true]);
      expect(page.rows.map((x) => x.date)).toEqual([...page.rows.map((x) => x.date)].sort());
      expect(page.rows[0]).toMatchObject({
        key: '01-01',
        date: '2026-01-01',
        kind: 'holiday',
        everyYear: true,
      });
      expect(page.rows[0]!.audit.createdAt).toBeNull();
      expect(page.rows.filter((x) => x.key === '01-01').map((x) => x.date)).toEqual([
        '2026-01-01',
        '2027-01-01',
      ]);
      // Прошлый год не показывается.
      expect(page.rows.some((x) => x.date.startsWith('2025-'))).toBe(false);
      const file = await asAdmin((tx) =>
        exportAdminCalendar(tx, query(), ['date', 'dow', 'name', 'kind', 'rule'], t, TODAY),
      );
      expect(file.rows[0]).toEqual([
        '01.01.2026',
        'четверг',
        'Новый год',
        'Праздник',
        'Каждый год',
      ]);
      const workday = file.rows.find((r) => r[0] === '14.03.2026');
      expect(workday).toEqual([
        '14.03.2026',
        'суббота',
        'Рабочая суббота',
        'Рабочая суббота',
        'Только в этом году',
      ]);
      const kinds = await asAdmin((tx) => listAdminCalendarValues(tx, 'kind', t, TODAY));
      expect(kinds.items.map((x) => x.label).sort()).toEqual([
        'Перенос',
        'Праздник',
        'Рабочая суббота',
      ]);
    });

    it('«Нерабочий день»: дата в годах вкладки, рабочая суббота — суббота, дата ещё не занята', async () => {
      const add = (date: string, type: 'off' | 'workday', name: string) =>
        asAdmin((tx) => adminCalendarAdd(tx, { date, type, name }, TODAY));
      expect(await add('', 'off', 'Праздник')).toMatchObject({
        problems: [{ field: 'date', code: 'date_required' }],
      });
      expect(await add('2028-01-05', 'off', 'Праздник')).toMatchObject({
        problems: [{ field: 'date', code: 'date_year' }],
      });
      expect(await add('2027-03-15', 'workday', '')).toMatchObject({
        problems: [{ field: 'date', code: 'not_saturday' }],
      });
      // 01.01 — праздник «каждый год»: дата 2027 года уже занята.
      expect(await add('2027-01-01', 'off', 'Перенос')).toMatchObject({
        problems: [{ field: 'date', code: 'date_taken' }],
      });
      expect(await add('2027-01-04', 'off', ' ')).toMatchObject({
        problems: [{ field: 'name', code: 'name_required' }],
      });

      expect(await add('2027-01-04', 'off', 'Перенос: Новый год')).toEqual({ ok: true });
      expect(await add('2027-02-27', 'workday', 'не нужно')).toEqual({ ok: true });
      const rows = await db.admin.db
        .select({
          day: productionCalendar.day,
          kind: productionCalendar.kind,
          name: productionCalendar.name,
        })
        .from(productionCalendar)
        .where(sql`${productionCalendar.day} in ('2027-01-04', '2027-02-27')`)
        .orderBy(productionCalendar.day);
      expect(rows).toEqual([
        { day: '2027-01-04', kind: 'transfer', name: 'Перенос: Новый год' },
        { day: '2027-02-27', kind: 'workday', name: '' },
      ]);
      expect(await add('2027-01-04', 'off', 'Ещё раз')).toMatchObject({
        problems: [{ field: 'date', code: 'date_taken' }],
      });
      const history = await asAdmin((tx) => adminDictHistory(tx, 'forms', 12));
      // История календаря — своя, не в справочнике «Формы».
      expect(history.items.some((h) => h.code.startsWith('2027'))).toBe(false);
      const [created] = await asAdmin((tx) =>
        tx.execute<{ action: string; changes: unknown }>(
          sql`select action, changes from platform_audit_log where entity_id = 'calendar:2027-01-04'`,
        ),
      );
      expect(created).toEqual({
        action: 'create',
        changes: [
          { field: 'kind', to: 'transfer' },
          { field: 'name', to: 'Перенос: Новый год' },
        ],
      });
    });

    it('«Удалить»: праздник «каждый год» нельзя; устаревшая версия — changed; удалённое — в истории', async () => {
      const page = await asAdmin((tx) => listAdminCalendarPage(tx, query(), t, TODAY));
      const newYear = page.rows.find((x) => x.key === '01-01')!;
      expect(await asAdmin((tx) => adminCalendarDelete(tx, '01-01', newYear.version))).toEqual({
        ok: false,
        reason: 'fixed',
      });
      // Функция базы тоже не удалит праздник «каждый год».
      const [kept] = await asAdmin((tx) =>
        tx.execute<{ deleted: boolean }>(
          sql`select app.admin_calendar_delete('01-01', ${newYear.version}) as deleted`,
        ),
      );
      expect(kept?.deleted).toBe(false);

      const transfer = page.rows.find((x) => x.key === '2027-01-04')!;
      expect(
        await asAdmin((tx) => adminCalendarDelete(tx, '2027-01-04', transfer.version + 1)),
      ).toEqual({ ok: false, reason: 'changed', version: transfer.version });
      expect(
        await asAdmin((tx) => adminCalendarDelete(tx, '2027-01-04', transfer.version)),
      ).toEqual({ ok: true });
      expect(
        await asAdmin((tx) => adminCalendarDelete(tx, '2027-01-04', transfer.version)),
      ).toEqual({ ok: false, reason: 'not_found' });
      const [deleted] = await asAdmin((tx) =>
        tx.execute<{ action: string }>(
          sql`select action from platform_audit_log where entity_id = 'calendar:2027-01-04' order by at desc, id desc limit 1`,
        ),
      );
      expect(deleted?.action).toBe('delete');
      // «История изменений» календаря: сначала новые; у удалённого дня название — из записи удаления.
      const history = await asAdmin((tx) => adminCalendarHistory(tx, 12));
      expect(history.total).toBe(3);
      expect(history.items.map((h) => [h.action, h.code, h.label])).toEqual([
        ['delete', '2027-01-04', 'Перенос: Новый год'],
        ['create', '2027-02-27', ''],
        ['create', '2027-01-04', 'Перенос: Новый год'],
      ]);
      // Не администратору записи истории не видны (политика platform_audit_log).
      expect((await asOwner((tx) => adminCalendarHistory(tx, 12))).total).toBe(0);
    });

    it('«Календарь на следующий год копированием»: даты «только в этом году» — на год вперёд, занятые — нет', async () => {
      const plan = await asAdmin((tx) => adminCalendarCopyPlan(tx, TODAY));
      expect(plan.year).toBe(2027);
      // Рабочая суббота 14.03.2026 не копируется: 14.03.2027 — воскресенье.
      expect(plan.items.map((x) => [x.from, x.to, x.kind])).toEqual([
        ['2026-03-09', '2027-03-09', 'transfer'],
        ['2026-03-20', '2027-03-20', 'holiday'],
        ['2026-05-27', '2027-05-27', 'holiday'],
      ]);
      const copied = await asAdmin((tx) => adminCalendarCopy(tx, TODAY));
      expect(copied).toEqual({ ok: true, year: 2027, copied: 3 });
      const [orozo] = await db.admin.db
        .select({ name: productionCalendar.name, by: productionCalendar.createdBy })
        .from(productionCalendar)
        .where(eq(productionCalendar.day, '2027-03-20'));
      expect(orozo).toEqual({ name: 'Орозо айт', by: adminId });
      // Повторно копировать нечего.
      expect((await asAdmin((tx) => adminCalendarCopyPlan(tx, TODAY))).items).toEqual([]);
      expect(await asAdmin((tx) => adminCalendarCopy(tx, TODAY))).toEqual({
        ok: true,
        year: 2027,
        copied: 0,
      });
    });

    it('не администратору — функции ничего не делают, таблицу роль приложения не меняет', async () => {
      const [row] = await asOwner((tx) =>
        tx.execute<{ v: number | null; d: boolean | null }>(
          sql`select app.admin_calendar_insert('2027-06-01', 'holiday', 'Взлом') as v,
                     app.admin_calendar_delete('2026-03-20', 1) as d`,
        ),
      );
      expect(row).toEqual({ v: null, d: null });
      expect(
        await asOwner((tx) =>
          adminCalendarAdd(tx, { date: '2027-06-01', type: 'off', name: 'Взлом' }, TODAY),
        ),
      ).toEqual({ ok: false, reason: 'not_found' });
      await expect(
        asOwner((tx) =>
          tx
            .insert(productionCalendar)
            .values({ day: '2027-06-01', kind: 'holiday', name: 'Взлом' }),
        ),
      ).rejects.toEqual(permissionDenied);
      const [day] = await db.admin.db
        .select({ day: productionCalendar.day })
        .from(productionCalendar)
        .where(eq(productionCalendar.day, '2026-03-20'));
      expect(day).toEqual({ day: '2026-03-20' });
    });
  },
);
