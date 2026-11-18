import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { withOrgContext } from './context';
import {
  adminCpHelp,
  adminCpHelpEdit,
  applyCpHelpEdit,
  cpCodeHelp,
  cpHelpForPage,
  parseCpHelp,
  readCpHelp,
} from './contractor-page-help';
import { createOrganization, type CreatedOrganization } from './organizations';
import { platformAuditLog, users } from './schema';
import { referenceSections } from './seed/platform';
import { readSpecJson } from './spec-data';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedKbReference,
  type TestDatabase,
} from './testing';

/*
 * Подсказки страницы контрагента (доработки 15.11.2026; прототип v120 cp-help.js, cp-help-admin.js):
 * раздел `cpHelp` отдельной строкой справочника, правка администратором платформы с версией раздела и
 * историей, нестрогое чтение.
 */

describe('наполнение: `kbUi.cpHelp` — своей строкой `cpHelp`', () => {
  it('kbUi без cpHelp, cpHelp — тот же, что в refDB', async () => {
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    const s = referenceSections(refDB);
    const ui = refDB.kbUi as Record<string, unknown>;
    expect(s.cpHelp).toEqual(ui.cpHelp);
    expect(Object.keys(s.kbUi as object)).toEqual(Object.keys(ui).filter((k) => k !== 'cpHelp'));
    // Без cpHelp в kbUi — разделы как были.
    expect(referenceSections({ kbUi: { page: {} } })).toEqual({ kbUi: { page: {} } });
  });
});

describe('нестрогое чтение раздела', () => {
  it('записи, которые не читаются, пропускаются; «Готово!» — всегда активно', () => {
    const h = parseCpHelp({
      welcome: { t: 'Привет', bad: 'x', lead: 5 },
      tour: [
        { id: 'a', sec: 'main', t: 'Главное', x: 'текст', on: false },
        { id: 'b', sec: 'nope', t: 'x', x: 'y' },
        { id: 'end', sec: 'end', t: 'Готово', x: 'конец', on: false },
        'мусор',
      ],
      faq: [{ id: 'q', q: 'Вопрос?', a: 'Ответ', sec: 'zzz', act: 'paid', ord: 'x' }],
      gloss: [{ w: 'чек', x: 'Бумажка', also: 7 }, { x: 'без слова' }],
      hints: { helpBtn: 'Помощь', nope: 'x' },
    });
    expect(h.welcome).toEqual({ t: 'Привет' });
    expect(h.tour.map((s) => [s.id, s.on])).toEqual([
      ['a', false],
      ['end', true],
    ]);
    expect(h.faq).toEqual([
      { id: 'q', q: 'Вопрос?', a: 'Ответ', sec: '', act: 'paid', ord: 0, on: true },
    ]);
    expect(h.gloss).toEqual([{ w: 'чек', x: 'Бумажка' }]);
    expect(h.hints).toEqual({ helpBtn: 'Помощь' });
    expect(parseCpHelp(null)).toEqual({ welcome: {}, tour: [], faq: [], gloss: [], hints: {} });
    expect(parseCpHelp('строка').tour).toEqual([]);
  });

  it('странице — только включённые облачка и вопросы', () => {
    const h = parseCpHelp({
      tour: [
        { id: 'a', sec: 'main', t: 't', x: 'x', on: false },
        { id: 'b', sec: 'acc', t: 't', x: 'x' },
      ],
      faq: [
        { id: 'q1', q: 'Да?', a: 'a', on: false },
        { id: 'q2', q: '', a: 'a' },
        { id: 'q3', q: 'Нет?', a: 'a' },
      ],
    });
    const p = cpHelpForPage(h);
    expect(p.tour.map((s) => s.id)).toEqual(['b']);
    expect(p.faq.map((q) => q.id)).toEqual(['q3']);
  });
});

describe('правка без записи (applyCpHelpEdit)', () => {
  const base = parseCpHelp({
    tour: [
      { id: 'pay', sec: 'pay', t: 'Оплата', x: 'x', x2: 'x2' },
      { id: 'acc', sec: 'acc', t: 'Бухгалтер', x: 'x' },
      { id: 'end', sec: 'end', t: 'Готово', x: 'x' },
    ],
    faq: [{ id: 'q1', q: 'Вопрос?', a: 'Ответ', sec: '', act: '', ord: 1, on: true }],
    gloss: [{ w: 'отчёт', x: 'Документ' }],
  });

  it('у облачка без «действие недоступно» второго текста нет; «Готово!» не выключается', () => {
    const a = applyCpHelpEdit(
      base,
      { op: 'tour', id: 'acc', t: 'Б', x: 'y', x2: 'z', on: true, version: 1 },
      0,
    );
    expect('help' in a && a.help.tour[1]).toEqual({
      id: 'acc',
      sec: 'acc',
      t: 'Б',
      x: 'y',
      on: true,
    });
    const e = applyCpHelpEdit(
      base,
      { op: 'tour', id: 'end', t: 'Готово', x: 'x', on: false, version: 1 },
      0,
    );
    expect('help' in e && e.help.tour[2]?.on).toBe(true);
    expect('help' in e && e.changes).toEqual([]);
  });

  it('новый вопрос — свободный код и «Порядок» после наибольшего, ответ без пустых строк', () => {
    const a = applyCpHelpEdit(
      base,
      {
        op: 'faq',
        q: 'Новый?',
        a: ' шаг 1 \n\n шаг 2 ',
        sec: 'tg',
        act: 'tg',
        on: true,
        version: 1,
      },
      36,
    );
    expect('help' in a && a.help.faq[1]).toEqual({
      id: 'q10',
      q: 'Новый?',
      a: 'шаг 1\nшаг 2',
      sec: 'tg',
      act: 'tg',
      ord: 2,
      on: true,
    });
    expect('help' in a && a.action).toBe('create');
  });

  it('слово «Словарика»: повтор без регистра и ё — отказ; «Другие формы» чистятся', () => {
    expect(
      applyCpHelpEdit(base, { op: 'gloss', w: 'ОТЧЕТ', x: 'x', also: '', version: 1 }, 0),
    ).toEqual({ ok: false, reason: 'invalid', problem: 'cph_word_taken', field: 'w' });
    const a = applyCpHelpEdit(
      base,
      { op: 'gloss', was: 'отчёт', w: 'отчёт', x: 'Документ', also: ' отчётность,, ', version: 1 },
      0,
    );
    expect('help' in a && a.help.gloss).toEqual([
      { w: 'отчёт', x: 'Документ', also: 'отчётность' },
    ]);
    expect('help' in a && a.changes).toEqual([{ field: 'also', from: '', to: 'отчётность' }]);
    expect(applyCpHelpEdit(base, { op: 'glossDelete', w: 'нет', version: 1 }, 0)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe.skipIf(!databaseAvailable())(
  'Админка → «Страница контрагента»: пишет только администратор платформы, с версией и историей',
  () => {
    let db: TestDatabase;
    let org: CreatedOrganization;
    let adminId: string;

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAccessReference(db.admin.db);
      await seedKbReference(db.admin.db);
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
    const history = (entityId: string) =>
      db.admin.db
        .select()
        .from(platformAuditLog)
        .where(
          and(
            eq(platformAuditLog.entity, 'platform_dict'),
            eq(platformAuditLog.entityId, entityId),
          ),
        );

    it('наполнение: 9 облачков, 12 вопросов, 25 слов; экран кода — только два текста', async () => {
      const h = await readCpHelp(db.app.db);
      expect([h.tour.length, h.faq.length, h.gloss.length]).toEqual([9, 12, 25]);
      expect(await cpCodeHelp(db.app.db)).toEqual({
        what: 'Что это за страница?',
        whatX: h.hints.codeWhatX,
      });
    });

    it('текст «Приветствия»: версия +1, строка истории «было → стало»; правка без изменений не пишет', async () => {
      const before = (await asAdmin((tx) => adminCpHelp(tx)))!;
      const r = await asAdmin((tx) =>
        adminCpHelpEdit(
          tx,
          { op: 'welcome', key: 't', text: 'Здравствуйте!', version: before.version },
          0,
        ),
      );
      expect(r).toMatchObject({ ok: true, value: { version: before.version + 1 } });
      expect((await readCpHelp(db.app.db)).welcome.t).toBe('Здравствуйте!');
      const [row] = await history('cpwel:t');
      expect(row).toMatchObject({
        action: 'update',
        actorUserId: adminId,
        // С прототипа v135 у «Приветствия» нет своего заголовка: экран берёт его из словаря.
        changes: [{ field: 'text', from: before.help.welcome.t ?? '', to: 'Здравствуйте!' }],
      });
      const again = await asAdmin((tx) =>
        adminCpHelpEdit(
          tx,
          { op: 'welcome', key: 't', text: 'Здравствуйте!', version: before.version + 1 },
          0,
        ),
      );
      expect(again).toMatchObject({ ok: true, value: { version: before.version + 1 } });
      expect(await history('cpwel:t')).toHaveLength(1);
    });

    it('устаревшая версия — «запись изменена другим пользователем», ничего не пишется', async () => {
      const r = await asAdmin((tx) =>
        adminCpHelpEdit(tx, { op: 'hint', key: 'helpBtn', text: 'Справка', version: 1 }, 0),
      );
      expect(r).toEqual({ ok: false, reason: 'changed' });
      expect((await readCpHelp(db.app.db)).hints.helpBtn).toBe('Помощь');
    });

    it('сотрудник организации раздел не пишет — функция базы отвечает пусто', async () => {
      const v = (await asAdmin((tx) => adminCpHelp(tx)))!.version;
      const r = await asOwner((tx) =>
        adminCpHelpEdit(tx, { op: 'hint', key: 'helpBtn', text: 'Справка', version: v }, 0),
      );
      expect(r).toEqual({ ok: false, reason: 'changed' });
      expect((await readCpHelp(db.app.db)).hints.helpBtn).toBe('Помощь');
      // Прямой вызов функции — тоже пусто.
      const [row] = await asOwner((tx) =>
        tx.execute<{ v: number | null }>(
          sql`select app.admin_set_reference('cpHelp', '{}'::jsonb, 'x', ${v}) as v`,
        ),
      );
      expect(row?.v).toBeNull();
    });

    it('вопрос: добавить, выше, удалить — каждое действие строкой истории', async () => {
      const v0 = (await asAdmin((tx) => adminCpHelp(tx)))!.version;
      const add = await asAdmin((tx) =>
        adminCpHelpEdit(
          tx,
          {
            op: 'faq',
            q: 'Где чек?',
            a: 'В «Файлах».',
            sec: 'files',
            act: 'goFiles',
            on: true,
            version: v0,
          },
          1000,
        ),
      );
      if (!add.ok) throw new Error('не добавлен');
      const q = add.value.help.faq.at(-1)!;
      expect(q).toMatchObject({ id: 'qrs', ord: 13 });
      const up = await asAdmin((tx) =>
        adminCpHelpEdit(tx, { op: 'faqMove', id: q.id, dir: -1, version: add.value.version }, 0),
      );
      if (!up.ok) throw new Error('не перемещён');
      expect(up.value.help.faq.find((x) => x.id === q.id)?.ord).toBe(12);
      const del = await asAdmin((tx) =>
        adminCpHelpEdit(tx, { op: 'faqDelete', id: q.id, version: up.value.version }, 0),
      );
      expect(del.ok && del.value.help.faq.some((x) => x.id === q.id)).toBe(false);
      expect((await history(`cpfaq:${q.id}`)).map((r) => r.action).sort()).toEqual([
        'create',
        'delete',
        'update',
      ]);
    });

    it('облачко «Готово!» не двигается, облачко раздела — двигается', async () => {
      const v = (await asAdmin((tx) => adminCpHelp(tx)))!.version;
      expect(
        await asAdmin((tx) =>
          adminCpHelpEdit(tx, { op: 'tourMove', id: 'end', dir: -1, version: v }, 0),
        ),
      ).toEqual({ ok: false, reason: 'not_found' });
      const r = await asAdmin((tx) =>
        adminCpHelpEdit(tx, { op: 'tourMove', id: 'main', dir: -1, version: v }, 0),
      );
      expect(r.ok && r.value.help.tour.slice(0, 2).map((s) => s.id)).toEqual(['main', 'state']);
      const [row] = await history('cptour:main');
      expect(row?.changes).toEqual([{ field: 'n', from: 2, to: 1 }]);
    });
  },
);
