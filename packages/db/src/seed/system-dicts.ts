import { defaultStatusTones } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import { messageTemplateTexts, statusTones } from '../schema';
import type { SeedOptions, SeedReport } from './platform';

/*
 * Справочники Админки части 3 задачи 2.36: цвета статусов и шаблоны сообщений. Состав задаёт система
 * (статусы шкал — код, шаблоны — refDB.json), значения меняет администратор платформы; поправленное в
 * Админке («Изменил» задан) `--update` не затирает.
 */

/** Цвета статусов по умолчанию (`STATUS_SCALE_DEFS`): недостающие строки, с `update` — и цвет. */
export async function seedStatusTones(db: Db, options: SeedOptions): Promise<SeedReport> {
  const rows = defaultStatusTones();
  const insert = db.insert(statusTones).values(rows);
  const before = await db.$count(statusTones);
  const touched = options.update
    ? await insert
        .onConflictDoUpdate({
          target: [statusTones.scale, statusTones.status],
          set: {
            tone: sql`excluded.tone`,
            updatedAt: sql`now()`,
            version: sql`${statusTones.version} + 1`,
          },
          setWhere: sql`${statusTones.updatedBy} is null and ${statusTones.tone} <> excluded.tone`,
        })
        .returning({ status: statusTones.status })
    : await insert.onConflictDoNothing().returning({ status: statusTones.status });
  const inserted = (await db.$count(statusTones)) - before;
  return { inserted, updated: touched.length - inserted, unchanged: rows.length - touched.length };
}

const Texts = z.record(z.string(), z.string());

/**
 * Шаблоны сообщений из refDB.json: тексты — раздел `messageTemplates`, пояснения и порядок — раздел
 * `templateNotes` (шаблоны без пояснения — в конце). Пояснение и порядок задаёт система, текст —
 * администратор платформы.
 */
export async function seedMessageTemplates(
  db: Db,
  section: unknown,
  notesSection: unknown,
  options: SeedOptions,
): Promise<SeedReport> {
  const texts = Texts.parse(section ?? {});
  const notes = Texts.parse(notesSection ?? {});
  const order = Object.keys(notes);
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  const rows = Object.entries(texts)
    .filter(([, text]) => text.trim() !== '')
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, text], i) => ({ key, text, note: notes[key] ?? '', sortOrder: i + 1 }));
  if (!rows.length) return { inserted: 0, updated: 0, unchanged: 0 };
  const t = messageTemplateTexts;
  const insert = db.insert(t).values(rows);
  const before = await db.$count(t);
  const touched = options.update
    ? await insert
        .onConflictDoUpdate({
          target: t.key,
          set: {
            text: sql`case when ${t.updatedBy} is null then excluded.text else ${t.text} end`,
            note: sql`excluded.note`,
            sortOrder: sql`excluded.sort_order`,
            updatedAt: sql`now()`,
            version: sql`${t.version} + 1`,
          },
          setWhere: sql`(${t.note}, ${t.sortOrder}) is distinct from (excluded.note, excluded.sort_order)
            or (${t.updatedBy} is null and ${t.text} <> excluded.text)`,
        })
        .returning({ key: t.key })
    : await insert.onConflictDoNothing().returning({ key: t.key });
  const inserted = (await db.$count(t)) - before;
  return { inserted, updated: touched.length - inserted, unchanged: rows.length - touched.length };
}
