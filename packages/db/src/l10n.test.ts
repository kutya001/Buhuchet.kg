import { UI_TEXTS } from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadUiTexts, uiTextsStamp } from './l10n';
import { uiTexts, users } from './schema';
import { seedUiTexts, uiTextSeedRows } from './seed';
import { readSpecJson } from './spec-data';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

/** Нет права на действие с таблицей (у drizzle ошибка базы — в cause). */
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

type LocalizationEntry = { key: string; ru: string; sec: string };

const localization = async () =>
  (await readSpecJson<{ localization: LocalizationEntry[] }>('data/refDB.json')).localization;

describe('наполнение словаря текстов', () => {
  it('тексты refDB.json и тексты экранов продукта, каждый ключ — один раз', async () => {
    const spec = await localization();
    const rows = uiTextSeedRows(spec);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of [...spec.map((x) => x.key), ...Object.keys(UI_TEXTS)]) {
      expect(keys).toContain(key);
    }
    expect(rows.find((r) => r.key === 'grid.shown')).toEqual({
      key: 'grid.shown',
      text: 'Показано {from} – {to} из {total}',
      section: 'Списки',
    });
  });

  it('ключ, который есть и в refDB.json, в UI_TEXTS записан с тем же текстом', async () => {
    const spec = new Map((await localization()).map((x) => [x.key, x.ru]));
    for (const [key, value] of Object.entries(UI_TEXTS)) {
      if (spec.has(key)) expect(value.ru, key).toBe(spec.get(key));
    }
  });
});

describe.skipIf(!databaseAvailable())('словарь текстов в базе', () => {
  let t: TestDatabase;
  let total: number;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t?.drop();
  });

  const textOf = async (key: string) => {
    const [row] = await t.admin.db
      .select()
      .from(uiTexts)
      .where(and(eq(uiTexts.lang, 'ru'), eq(uiTexts.key, key)));
    return row;
  };

  it('наполняется один раз; повтор ничего не дублирует', async () => {
    const spec = await localization();
    total = uiTextSeedRows(spec).length;
    expect(await seedUiTexts(t.admin.db, spec, { update: false })).toEqual({
      inserted: total,
      updated: 0,
      unchanged: 0,
    });
    expect(await seedUiTexts(t.admin.db, spec, { update: true })).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: total,
    });
    expect(await textOf('nav.home')).toMatchObject({
      text: 'Главная',
      section: 'Меню',
      updatedBy: null,
      version: 1,
    });
  });

  it('--update обновляет текст из наполнения, но не правку администратора платформы', async () => {
    const spec = (await localization()).map((x) =>
      x.key === 'nav.home' || x.key === 'btn.save' ? { ...x, ru: `${x.ru} (новое)` } : x,
    );
    const [admin] = await t.admin.db
      .insert(users)
      .values({ login: 'l10n-admin', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    await t.admin.db
      .update(uiTexts)
      .set({ text: 'Сохранить изменения', updatedBy: admin!.id })
      .where(eq(uiTexts.key, 'btn.save'));

    expect(await seedUiTexts(t.admin.db, spec, { update: false })).toMatchObject({ updated: 0 });
    expect(await seedUiTexts(t.admin.db, spec, { update: true })).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: total - 1,
    });
    expect(await textOf('nav.home')).toMatchObject({ text: 'Главная (новое)', version: 2 });
    expect(await textOf('btn.save')).toMatchObject({ text: 'Сохранить изменения', version: 1 });
  });

  it('прямая правка, новый и удалённый текст меняют отметку словаря', async () => {
    const before = await uiTextsStamp(t.app.db, 'ru');
    expect(before).toMatch(new RegExp(`^${total}\\|`));
    // Правка без updated_at и version, как запросом в редакторе SQL.
    await t.admin.db.update(uiTexts).set({ text: 'Главная!' }).where(eq(uiTexts.key, 'nav.home'));
    const edited = await uiTextsStamp(t.app.db, 'ru');
    expect(edited).not.toBe(before);
    expect((await loadUiTexts(t.app.db, 'ru'))['nav.home']).toBe('Главная!');

    await t.admin.db.insert(uiTexts).values({ key: 'x.tmp', text: 'Временный', section: 'Тест' });
    const added = await uiTextsStamp(t.app.db, 'ru');
    expect(added).not.toBe(edited);
    await t.admin.db.delete(uiTexts).where(eq(uiTexts.key, 'x.tmp'));
    expect(await uiTextsStamp(t.app.db, 'ru')).not.toBe(added);
    await t.admin.db
      .update(uiTexts)
      .set({ text: 'Главная (новое)' })
      .where(eq(uiTexts.key, 'nav.home'));
  });

  it('роль приложения словарь читает, но не меняет: прав на запись у неё нет', async () => {
    expect(await t.app.db.$count(uiTexts)).toBe(total);
    await expect(
      t.app.db.insert(uiTexts).values({ key: 'x.new', text: 'Новый', section: 'Тест' }),
    ).rejects.toThrow(permissionDenied);
    await expect(
      t.app.db.update(uiTexts).set({ text: 'Взлом' }).where(eq(uiTexts.key, 'nav.home')),
    ).rejects.toThrow(permissionDenied);
    await expect(t.app.db.delete(uiTexts)).rejects.toThrow(permissionDenied);
    // Без прав на запись нельзя и заблокировать таблицу (иначе встали бы все страницы сайта).
    await expect(
      t.app.db.transaction((tx) => tx.execute(sql`lock table ui_texts in access exclusive mode`)),
    ).rejects.toThrow(permissionDenied);
    expect(await t.admin.db.$count(uiTexts)).toBe(total);
  });
});
