import type { UiLanguage } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { uiTexts } from './schema';

/**
 * Словарь текстов интерфейса (таблица ui_texts) — общий для всех организаций, поэтому читается без
 * контекста организации: политика RLS разрешает роли приложения только чтение.
 */

/**
 * Отметка словаря языка: сколько текстов и когда правился последний. Меняется с каждой правкой,
 * поэтому по ней API узнаёт, что словарь пора перечитать, не читая его целиком.
 */
export async function uiTextsStamp(db: Db | Tx, lang: UiLanguage): Promise<string> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      last: sql<string | null>`max(${uiTexts.updatedAt})::text`,
    })
    .from(uiTexts)
    .where(eq(uiTexts.lang, lang));
  return `${row?.count ?? 0}|${row?.last ?? ''}`;
}

/** Тексты языка: ключ → текст. */
export async function loadUiTexts(db: Db | Tx, lang: UiLanguage): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: uiTexts.key, text: uiTexts.text })
    .from(uiTexts)
    .where(eq(uiTexts.lang, lang));
  return Object.fromEntries(rows.map((r) => [r.key, r.text]));
}
