import { gkedAncestors, type GkedIndex } from '@buhuchet/domain';
import { and, count, eq, inArray, or, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { gkedItems } from './schema';

/** Коды ГКЭД и их предки по дереву справочника — для правил «секция буквой» (`gkedHit`). */
export async function gkedIndexOf(tx: Tx, codes: readonly string[]): Promise<GkedIndex> {
  const list = codes.length ? [...codes] : [''];
  const up = (await tx.execute(sql`
    with recursive up as (
      select code, level, parent_code, active from ${gkedItems} where code in (${sql.join(
        list.map((c) => sql`${c}`),
        sql`, `,
      )})
      union
      select g.code, g.level, g.parent_code, g.active from ${gkedItems} g join up on g.code = up.parent_code
    ) select code, level, parent_code, active from up
  `)) as unknown as { code: string; level: string; parent_code: string | null; active: boolean }[];
  return new Map(
    up.map((x) => [
      x.code,
      { code: x.code, level: x.level, parent: x.parent_code, active: x.active },
    ]),
  );
}

/** Код ГКЭД для контрагента в окне выбора: путь — коды предков от секции до класса. */
export interface GkedFound {
  code: string;
  name: string;
  path: string[];
}

const likeEscaped = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Окно выбора ГКЭД (ТЗ «Основной вид деятельности (ГКЭД)»; прототип gkSearch, gkPickDlg): действующие
 * подклассы — нижний уровень — по началу кода или по всем словам названия, без учёта регистра и «ё»;
 * первые `limit` по порядку справочника и сколько найдено всего.
 */
export async function gkedSearch(
  tx: Tx,
  q: string,
  limit: number,
): Promise<{ items: GkedFound[]; total: number }> {
  const s = q
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\u00a0/g, ' ')
    .trim();
  const words = s.split(/\s+/).filter(Boolean);
  // Правило сравнения app.ru_natural (миграция 0019): lower() по-русски, как у списков.
  const name = sql`replace(lower(${gkedItems.name} collate app.ru_natural), 'ё', 'е')`;
  const found = s
    ? or(
        sql`lower(${gkedItems.code}) like ${`${likeEscaped(s)}%`} escape '\\'`,
        and(...words.map((w) => sql`${name} like ${`%${likeEscaped(w)}%`} escape '\\'`)),
      )
    : undefined;
  const where = and(eq(gkedItems.level, 'subclass'), eq(gkedItems.active, true), found);
  const [rows, [all]] = await Promise.all([
    tx
      .select({ code: gkedItems.code, name: gkedItems.name })
      .from(gkedItems)
      .where(where)
      .orderBy(gkedItems.sortOrder)
      .limit(limit),
    tx.select({ n: count() }).from(gkedItems).where(where),
  ]);
  const index = await gkedIndexOf(
    tx,
    rows.map((r) => r.code),
  );
  return {
    // Путь — предки по дереву (прототип gkUp) от секции вниз.
    items: rows.map((r) => ({
      code: r.code,
      name: r.name,
      path: gkedAncestors(r.code, index).reverse(),
    })),
    total: all?.n ?? 0,
  };
}

/** Названия кодов ГКЭД — для текста окна подтверждения права на режим. */
export async function gkedNames(tx: Tx, codes: readonly string[]): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const rows = await tx
    .select({ code: gkedItems.code, name: gkedItems.name })
    .from(gkedItems)
    .where(inArray(gkedItems.code, [...codes]));
  return new Map(rows.map((r) => [r.code, r.name]));
}
