import type { GkedIndex } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
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
