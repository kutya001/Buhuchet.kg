import type { UiLanguage } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { uiTexts } from './schema';

/**
 * Словарь текстов интерфейса (таблица ui_texts) — общий для всех организаций, поэтому читается без
 * контекста организации: политика RLS разрешает роли приложения только чтение.
 */

/**
 * Отметка словаря языка: число текстов и хеш всех пар «ключ — текст». Меняется с любой правкой —
 * через Админку, наполнение или прямо в таблице, — поэтому по ней API узнаёт, что словарь пора
 * перечитать, не перенося его по сети целиком.
 */
export async function uiTextsStamp(db: Db | Tx, lang: UiLanguage): Promise<string> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      hash: sql<string>`md5(coalesce(string_agg(${uiTexts.key} || chr(31) || ${uiTexts.text}, chr(30) order by ${uiTexts.key}), ''))`,
    })
    .from(uiTexts)
    .where(eq(uiTexts.lang, lang));
  return `${row?.count ?? 0}|${row?.hash ?? ''}`;
}

/** Тексты языка: ключ → текст. */
export async function loadUiTexts(db: Db | Tx, lang: UiLanguage): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: uiTexts.key, text: uiTexts.text })
    .from(uiTexts)
    .where(eq(uiTexts.lang, lang));
  return Object.fromEntries(rows.map((r) => [r.key, r.text]));
}
