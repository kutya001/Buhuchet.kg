import { DEFAULT_UI_LANGUAGE, UI_TEXTS } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import { uiTexts } from '../schema';
import type { SeedOptions, SeedReport } from './platform';

const LocalizationSection = z.array(
  z.object({ key: z.string().min(1), ru: z.string(), sec: z.string().min(1) }),
);

export interface UiTextSeedRow {
  key: string;
  text: string;
  section: string;
}

/**
 * Тексты словаря для наполнения: раздел `localization` refDB.json (тексты прототипа) и тексты экранов
 * продукта `UI_TEXTS`. Ключ из обоих мест берётся из refDB.json: источник истины — spec/.
 */
export function uiTextSeedRows(localization: unknown): UiTextSeedRow[] {
  const fromSpec = LocalizationSection.parse(localization ?? []).map((x) => ({
    key: x.key,
    text: x.ru,
    section: x.sec,
  }));
  const specKeys = new Set(fromSpec.map((x) => x.key));
  const fromProduct = Object.entries(UI_TEXTS)
    .filter(([key]) => !specKeys.has(key))
    .map(([key, value]) => ({ key, text: value.ru, section: value.section }));
  return [...fromSpec, ...fromProduct];
}

/**
 * Словарь текстов интерфейса → ui_texts. Без `update` — только недостающие ключи; с `update` —
 * ещё и изменившиеся тексты, кроме поправленных в Админке (`updated_by` задан): правку
 * администратора платформы наполнение не затирает.
 */
export async function seedUiTexts(
  db: Db,
  localization: unknown,
  options: SeedOptions,
): Promise<SeedReport> {
  const rows = uiTextSeedRows(localization).map((r) => ({ ...r, lang: DEFAULT_UI_LANGUAGE }));
  if (rows.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
  const before = await db.$count(uiTexts);
  const insert = db.insert(uiTexts).values(rows);
  const touched = options.update
    ? await insert
        .onConflictDoUpdate({
          target: [uiTexts.lang, uiTexts.key],
          set: {
            text: sql`excluded.text`,
            section: sql`excluded.section`,
            updatedAt: sql`now()`,
            version: sql`${uiTexts.version} + 1`,
          },
          setWhere: sql`${uiTexts.updatedBy} is null
            and (${uiTexts.text}, ${uiTexts.section}) is distinct from (excluded.text, excluded.section)`,
        })
        .returning({ key: uiTexts.key })
    : await insert.onConflictDoNothing().returning({ key: uiTexts.key });
  const inserted = (await db.$count(uiTexts)) - before;
  return {
    inserted,
    updated: touched.length - inserted,
    unchanged: rows.length - touched.length,
  };
}
