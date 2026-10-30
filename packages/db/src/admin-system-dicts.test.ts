import { defaultUiTexts, RecordChangedError } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminMessageTemplates,
  adminPermissions,
  adminRoleTemplates,
  adminSetMessageTemplates,
  adminSetPeriodName,
  adminSetPermission,
  adminSetRoleTemplate,
  adminSetStatusName,
  adminSetStatusTone,
  adminStatuses,
  adminSystemHistory,
  statusTonesStamp,
  statusToneTexts,
} from './admin-system-dicts';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { loadUiTexts } from './l10n';
import { createOrganization } from './organizations';
import {
  messageTemplateTexts,
  permissions,
  roles,
  roleTemplates,
  statusTones,
  users,
} from './schema';
import {
  seedMessageTemplates,
  seedPermissions,
  seedRoleTemplates,
  seedStatusTones,
  seedUiTexts,
} from './seed';
import { readSpecJson } from './spec-data';
import { messageTemplates } from './telegram';
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

describe.skipIf(!databaseAvailable())(
  'Админка → «Справочники платформы», часть 3: статусы, права ролей, шаблоны ролей и сообщений',
  () => {
    let db: TestDatabase;
    let refDB: Record<string, unknown>;
    let adminId: string;
    let userId: string;

    beforeAll(async () => {
      db = await createTestDatabase();
      refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
      await seedAccessReference(db.admin.db);
      await seedUiTexts(db.admin.db, refDB.localization, { update: false });
      await seedStatusTones(db.admin.db, { update: false });
      await seedMessageTemplates(db.admin.db, refDB.messageTemplates, refDB.templateNotes, {
        update: false,
      });
      const [admin] = await db.admin.db
        .insert(users)
        .values({ login: 'platform', passwordHash: '!', isPlatformAdmin: true })
        .returning({ id: users.id });
      adminId = admin!.id;
      const org = await createOrganization(db.app.db, {
        name: 'ОсОО «Альфа»',
        inn: '01811201810456',
        slug: 'alfa',
        owner: { fullName: 'Асанов Асан', login: 'asanov', passwordHash: '!' },
      });
      userId = org.ownerUserId;
    });

    afterAll(async () => {
      await db?.drop();
    });

    const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => withUserContext(db.app.db, adminId, fn);
    const texts = async () => ({ ...defaultUiTexts(), ...(await loadUiTexts(db.app.db, 'ru')) });
    const translate = async () => {
      const all = await texts();
      return (key: string) => all[key] ?? key;
    };

    it('роль приложения таблицы только читает: правка — функциями администратора платформы', async () => {
      await expect(
        db.app.db.update(statusTones).set({ tone: 'red' }).where(eq(statusTones.scale, 'report')),
      ).rejects.toThrow(permissionDenied);
      await expect(db.app.db.update(messageTemplateTexts).set({ text: 'x' })).rejects.toThrow(
        permissionDenied,
      );
      await expect(db.app.db.update(permissions).set({ name: 'x' })).rejects.toThrow(
        permissionDenied,
      );
      await expect(db.app.db.update(roleTemplates).set({ name: 'x' })).rejects.toThrow(
        permissionDenied,
      );
      // Сотрудник организации функциями ничего не меняет: ответ пустой.
      const calls = [
        sql`select app.admin_set_status_tone('report', 'todo', 'red', 1) as version`,
        sql`select app.admin_set_permission('cpView', 'Взлом', 'Взлом', 1) as version`,
        sql`select app.admin_set_role_template('acc', 'Взлом', array['cpView'], '{}'::jsonb, 1) as version`,
        sql`select app.admin_set_message_template('tgCode', 'Взлом {код}', 1) as version`,
      ];
      for (const call of calls) {
        const [row] = await withUserContext(db.app.db, userId, (tx) =>
          tx.execute<{ version: number | null }>(call),
        );
        expect(row?.version).toBeNull();
      }
    });

    it('«Статусы»: все шкалы с местом на шкале; цвет и название — для всех организаций, в историю', async () => {
      const t = await translate();
      const before = await asAdmin((tx) => adminStatuses(tx, t));
      expect(new Set(before.statuses.map((x) => x.scale)).size).toBe(6);
      const todo = before.statuses.find((x) => x.scale === 'report' && x.code === 'todo')!;
      expect(todo).toMatchObject({ name: 'К сдаче', tone: 'gray', place: { kind: 'step', n: 1 } });
      expect(before.periods.map((p) => [p.code, p.perYear, p.name])).toEqual([
        ['m', 12, 'Месяц'],
        ['q', 4, 'Квартал'],
        ['h', 2, 'Полугодие'],
        ['y', 1, 'Год'],
      ]);

      const stamp = await statusTonesStamp(db.app.db);
      await asAdmin((tx) =>
        adminSetStatusTone(tx, {
          scale: 'report',
          code: 'todo',
          tone: 'blue',
          version: todo.toneVersion,
        }),
      );
      expect(await statusTonesStamp(db.app.db)).not.toBe(stamp);
      expect((await statusToneTexts(db.app.db))['tone.report.todo']).toBe('blue');
      // Устаревшая версия — «запись изменена другим пользователем».
      await expect(
        asAdmin((tx) =>
          adminSetStatusTone(tx, {
            scale: 'report',
            code: 'todo',
            tone: 'red',
            version: todo.toneVersion,
          }),
        ),
      ).rejects.toBeInstanceOf(RecordChangedError);

      await asAdmin((tx) =>
        adminSetStatusName(tx, {
          scale: 'report',
          code: 'todo',
          name: 'К отправке',
          version: todo.nameVersion,
        }),
      );
      const month = before.periods.find((p) => p.code === 'm')!;
      await asAdmin((tx) =>
        adminSetPeriodName(tx, { code: 'm', name: 'Отчётный месяц', version: month.nameVersion }),
      );
      const all = await texts();
      expect(all['status.report.todo']).toBe('К отправке');
      expect(all['report.period.m']).toBe('Отчётный месяц');

      const history = await asAdmin(async (tx) =>
        adminSystemHistory(tx, 'statuses', 10, await translate()),
      );
      expect(history.total).toBe(3);
      expect(history.items.map((h) => [h.code, h.label, h.changes])).toEqual([
        ['period.m', 'Отчётный месяц', [{ field: 'name', from: 'Месяц', to: 'Отчётный месяц' }]],
        ['report.todo', 'К отправке', [{ field: 'name', from: 'К сдаче', to: 'К отправке' }]],
        ['report.todo', 'К отправке', [{ field: 'tone', from: 'gray', to: 'blue' }]],
      ]);
    });

    it('«Права ролей»: название и описание; наполнение правку не затирает', async () => {
      const view = (await asAdmin(adminPermissions)).find((p) => p.id === 'cpView')!;
      await asAdmin((tx) =>
        adminSetPermission(tx, {
          id: 'cpView',
          name: 'Видеть контрагентов',
          description: view.description,
          version: view.version,
        }),
      );
      await seedPermissions(db.admin.db, refDB.permissions, { update: true });
      const after = (await asAdmin(adminPermissions)).find((p) => p.id === 'cpView')!;
      expect(after).toMatchObject({ name: 'Видеть контрагентов', version: view.version + 1 });
      const history = await asAdmin(async (tx) =>
        adminSystemHistory(tx, 'perms', 10, await translate()),
      );
      expect(history.items[0]).toMatchObject({
        code: 'cpView',
        label: 'Видеть контрагентов',
        changes: [{ field: 'name', from: view.name, to: 'Видеть контрагентов' }],
      });
    });

    it('«Шаблоны ролей»: права и область — для новых организаций, роли созданных не меняются', async () => {
      const [tpl] = await asAdmin(adminRoleTemplates);
      const rolesBefore = await db.admin.db
        .select({ name: roles.name })
        .from(roles)
        .where(eq(roles.templateCode, tpl!.code));
      await asAdmin((tx) =>
        adminSetRoleTemplate(tx, {
          code: tpl!.code,
          name: 'Старший бухгалтер',
          permissions: [...tpl!.permissions.filter((p) => p !== 'cpImport'), 'cpView'],
          scopes: { ...tpl!.scopes, cps: 'own' },
          version: tpl!.version,
        }),
      );
      await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: true });
      const [after] = await asAdmin(adminRoleTemplates);
      expect(after).toMatchObject({ name: 'Старший бухгалтер', version: tpl!.version + 1 });
      expect(after!.permissions).not.toContain('cpImport');
      expect(after!.scopes.cps).toBe('own');
      // Роли уже созданной организации — прежние.
      expect(
        await db.admin.db
          .select({ name: roles.name })
          .from(roles)
          .where(eq(roles.templateCode, tpl!.code)),
      ).toEqual(rolesBefore);
      const history = await asAdmin(async (tx) =>
        adminSystemHistory(tx, 'roletpl', 10, await translate()),
      );
      const fields = history.items[0]!.changes.map((c) => c.field);
      expect(fields).toContain('name');
      if (tpl!.permissions.includes('cpImport')) expect(fields).toContain('permissions');
      // Права вне каталога, право только владельца и неверную область функция не примет.
      for (const [perms, scopes] of [
        [sql`array['nope']`, '{}'],
        [sql`array['cpView', 'org']`, '{}'],
        [sql`array['cpView']`, '{"cps": "some"}'],
        [sql`array['cpView']`, '{"staff": "all"}'],
      ] as const) {
        const [row] = await asAdmin((tx) =>
          tx.execute<{ version: number | null }>(
            sql`select app.admin_set_role_template(${tpl!.code}, 'X', ${perms}, ${scopes}::jsonb, ${after!.version}) as version`,
          ),
        );
        expect(row?.version).toBeNull();
      }
    });

    it('«Шаблоны»: текст для Telegram и WhatsApp; наполнение правку не затирает', async () => {
      const list = await asAdmin(adminMessageTemplates);
      expect(list.slice(0, 3).map((x) => x.key)).toEqual(['waTax', 'waFee', 'waPage']);
      const code = list.find((x) => x.key === 'tgCode')!;
      const fee = list.find((x) => x.key === 'waFee')!;
      const changed = await asAdmin((tx) =>
        adminSetMessageTemplates(tx, [
          { key: 'tgCode', text: 'Ваш код: {код}', version: code.version },
          { key: 'waFee', text: fee.text, version: fee.version },
        ]),
      );
      expect(changed).toBe(1);
      await seedMessageTemplates(db.admin.db, refDB.messageTemplates, refDB.templateNotes, {
        update: true,
      });
      expect((await messageTemplates(db.app.db)).tgCode).toBe('Ваш код: {код}');
      // Одна устаревшая версия отменяет всё сохранение.
      await expect(
        asAdmin((tx) =>
          adminSetMessageTemplates(tx, [
            { key: 'waFee', text: 'Новый текст {сумма}', version: fee.version },
            { key: 'tgCode', text: 'Код {код}', version: code.version },
          ]),
        ),
      ).rejects.toBeInstanceOf(RecordChangedError);
      expect((await messageTemplates(db.app.db)).waFee).toBe(fee.text);
      const history = await asAdmin(async (tx) =>
        adminSystemHistory(tx, 'templates', 10, await translate()),
      );
      expect(history.items).toHaveLength(1);
      expect(history.items[0]).toMatchObject({
        code: 'tgCode',
        label: 'Telegram: код восстановления пароля',
      });
    });
  },
);
