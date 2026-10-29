import { NEWS_TYPE_BY_NAME, newsShowMoment, isIsoDate } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import { news } from '../schema';
import type { SeedOptions, SeedReport } from './platform';

const NewsSection = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    t: z.string().min(1),
    type: z.string(),
    ver: z.string().nullish(),
    date: z.string().refine(isIsoDate),
    short: z.string().nullish(),
    md: z.string().nullish(),
    status: z.string(),
    aud: z.string().nullish(),
    off: z.boolean().nullish(),
    pin: z.boolean().nullish(),
    login: z.boolean().nullish(),
    link: z
      .object({ k: z.enum(['art', 'mod']), id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) })
      .nullish(),
    hist: z.array(z.object({ at: z.string(), to: z.string() })).nullish(),
  }),
);

/** Момент «Опубликовано» из истории прототипа («2026-10-12 09:00» по Бишкеку) или дата в 09:00. */
function publishedAt(item: z.infer<typeof NewsSection>[number]): Date {
  const at = (item.hist ?? []).filter((h) => h.to === 'Опубликовано').pop()?.at;
  const m = at ? /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(at) : null;
  if (!m) return newsShowMoment(item.date);
  return new Date(Date.parse(`${m[1]}T${m[2]}:${m[3]}:00+06:00`));
}

/** Строки наполнения: только опубликованные новости (черновики прототипа — его рабочие записи). */
export function newsSeedRows(section: unknown) {
  return NewsSection.parse(section ?? [])
    .filter((n) => n.status === 'Опубликовано')
    .map((n) => {
      const type = NEWS_TYPE_BY_NAME[n.type];
      if (!type) throw new Error(`Новость ${n.id}: неизвестный тип «${n.type}»`);
      return {
        id: n.id,
        title: n.t,
        type,
        release: n.ver?.trim() || null,
        publishDate: n.date,
        short: n.short?.trim() ?? '',
        md: n.md ?? '',
        linkKind: n.link?.k ?? null,
        linkId: n.link?.id ?? null,
        pinned: n.pin ?? false,
        showOnLogin: n.login ?? false,
        audience: n.aud === 'adm' ? 'adm' : 'all',
        status: 'published',
        off: n.off ?? false,
        publishedAt: publishedAt(n),
        // История версий: «Создано» — момент публикации (список Админки — от новых к старым по «Создано»).
        createdAt: publishedAt(n),
        updatedAt: publishedAt(n),
      };
    });
}

/**
 * Начальное наполнение «Новостей» историей версий (ТЗ: «При запуске вкладка уже заполнена историей
 * версий v1 … текущей»; раздел `news` refDB.json). Без `update` — только недостающие; с `update` —
 * ещё и изменившиеся, кроме тех, что правил администратор платформы (`updated_by` задан).
 */
export async function seedNews(
  db: Db,
  section: unknown,
  options: SeedOptions,
): Promise<SeedReport> {
  const rows = newsSeedRows(section);
  if (rows.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
  const before = await db.$count(news);
  const insert = db.insert(news).values(rows);
  const touched = options.update
    ? await insert
        .onConflictDoUpdate({
          target: news.id,
          set: {
            title: sql`excluded.title`,
            type: sql`excluded.type`,
            release: sql`excluded.release`,
            publishDate: sql`excluded.publish_date`,
            short: sql`excluded.short`,
            md: sql`excluded.md`,
            linkKind: sql`excluded.link_kind`,
            linkId: sql`excluded.link_id`,
            pinned: sql`excluded.pinned`,
            showOnLogin: sql`excluded.show_on_login`,
            updatedAt: sql`now()`,
            version: sql`${news.version} + 1`,
          },
          setWhere: sql`${news.updatedBy} is null and (${news.title}, ${news.type}, ${news.release}, ${news.publishDate}, ${news.short}, ${news.md}, ${news.linkKind}, ${news.linkId}, ${news.pinned}, ${news.showOnLogin}) is distinct from (excluded.title, excluded.type, excluded.release, excluded.publish_date, excluded.short, excluded.md, excluded.link_kind, excluded.link_id, excluded.pinned, excluded.show_on_login)`,
        })
        .returning({ id: news.id })
    : await insert.onConflictDoNothing().returning({ id: news.id });
  const inserted = (await db.$count(news)) - before;
  return { inserted, updated: touched.length - inserted, unchanged: rows.length - touched.length };
}
