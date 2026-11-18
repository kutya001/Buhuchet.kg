import {
  NEWS_TYPE_BY_NAME,
  newsMdTrim,
  newsModulesOrdered,
  newsModulesProblem,
  newsShowMoment,
  isIsoDate,
} from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import { news, newsAdminTexts } from '../schema';
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
    // «Для кого» обязательно, и незнакомое значение останавливает наполнение: `--update` переписывает и
    // залитые новости, и опечатка или пропуск открыли бы новость «Только режим Админка» всем организациям
    // (в прототипе такая новость не видна никому, кроме Админки).
    aud: z.enum(['all', 'adm']),
    off: z.boolean().nullish(),
    pin: z.boolean().nullish(),
    login: z.boolean().nullish(),
    link: z
      .object({
        k: z.enum(['art', 'mod', 'video']),
        id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      })
      .nullish(),
    hist: z.array(z.object({ at: z.string(), to: z.string() })).nullish(),
    // Доработки 16.11.2026, блок 4 (прототип v123): «Модули» и текст «Для администратора платформы».
    mods: z.array(z.string()).nullish(),
    admMd: z.string().nullish(),
  }),
);

/** Опубликованные новости наполнения без `NEWS_NOT_YET`. */
const seedItems = (section: unknown) =>
  NewsSection.parse(section ?? []).filter(
    (n) => n.status === 'Опубликовано' && !NEWS_NOT_YET.has(n.id),
  );

/** Момент «Опубликовано» из истории прототипа («2026-10-12 09:00» по Бишкеку) или дата в 09:00. */
function publishedAt(item: z.infer<typeof NewsSection>[number]): Date {
  const at = (item.hist ?? []).filter((h) => h.to === 'Опубликовано').pop()?.at;
  const m = at ? /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(at) : null;
  if (!m) return newsShowMoment(item.date);
  return new Date(Date.parse(`${m[1]}T${m[2]}:${m[3]}:00+06:00`));
}

/**
 * Новости версий прототипа, работа которых ещё не перенесена в продукт: пока её нет, они не
 * наполняются — иначе «Что нового» при входе описывало бы то, чего на сайте нет (справочник «БИК
 * банков» v107–v108, docs/deviations.md п. Т-14). PR переноса версии убирает её отсюда (v110 потока К
 * убрана с «Напомнить в Telegram», п. К-10; блок «Telegram-уведомления» v111 — п. Т-15; «Файлы от
 * контрагентов» v112 — п. И-7; Telegram заявителя и пароль по ссылке v113 — п. Т-17, Т-18; регистрация
 * организации по выписке и свидетельству v114 — п. И-8, И-9; «К оплате» по дням, файлы и чеки через бота
 * v115 — п. К-11, К-12: все три перенесены общей сборкой этапа 2; «Я оплатил», оплата по месяцам
 * и код на странице контрагента v116 — п. К-13, К-14, и принятый чек сразу в окне денег v119 — п. К-14,
 * О-80, и проверка всех сообщений бота v118 потока Т — п. Т-13, О-80: общей сборкой этапа 3). Тексты
 * лендинга v117 (поток И) перенесены вместе с синхронизацией spec/. Подсказки и обучение на странице
 * контрагента v120 (доработки 15.11.2026, поток К) — своим PR после синхронизации, п. К-15, К-16; чек
 * принимается только вместе с деньгами v121 (доработки 16.11.2026, блок 1, поток К) — так же, п. К-17,
 * К-18. Колокольчик v122 (поток Т), колокольчик в верхней панели и новости по модулям v123 (поток И),
 * один файл — несколько ссылок v124 (поток К) — доработки 16.11.2026, этап 1: синхронизация spec/ шла
 * перед общей сборкой этапа, перенесены самой сборкой. Новости только о том, что касается человека
 * v125 и колокольчик — то же, что присылает бот, v128 (поток Т), окно просмотра файлов v126 (поток И),
 * файлы от контрагентов и страница контрагента в окне просмотра v127 (поток К) — доработки 16.11.2026,
 * этап 2: так же, перенесены общей сборкой этапа 2. «Задачи» без отчётов v129 (доработки 17.11.2026) —
 * перенесена своим PR после синхронизации (docs/decisions.md п. О-58). v131–v146 (доработки 17.11 и
 * 18.11.2026: «Меньше текста, понятнее, плавнее», Админка «Запуски» и переписка бота, простая
 * страница контрагента, карточки в окне контрагента, лендинг со спиралью) — до их переноса на стенд
 * (слово заказчика «На тестовый стенд» 18.11.2026): перенос каждой части убирает свои версии отсюда.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-14
export const NEWS_NOT_YET: ReadonlySet<string> = new Set([
  'v107',
  'v108',
  'v131',
  'v132',
  'v133',
  'v134',
  'v135',
  'v136',
  'v137',
  'v138',
  'v139',
  'v140',
  'v141',
  'v142',
  'v143',
  'v144',
  'v145',
  'v146',
]);

/**
 * Строки наполнения: только опубликованные новости (черновики прототипа — его рабочие записи) без
 * `NEWS_NOT_YET`. Ссылка
 * «▶ Смотреть видео» на видео из refDB.videos не переносится: видео прототипа в базу продукта не
 * заливаются, их файлов нет (docs/deviations.md п. О-53).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-53
export function newsSeedRows(section: unknown) {
  return seedItems(section).map((n) => {
    const type = NEWS_TYPE_BY_NAME[n.type];
    if (!type) throw new Error(`Новость ${n.id}: неизвестный тип «${n.type}»`);
    const modules = n.mods ?? [];
    const problem = newsModulesProblem(modules);
    if (problem) throw new Error(`Новость ${n.id}: модули ${modules.join(', ')} — ${problem}`);
    const link = n.link && n.link.k !== 'video' ? n.link : null;
    return {
      id: n.id,
      title: n.t,
      type,
      release: n.ver?.trim() || null,
      publishDate: n.date,
      short: n.short?.trim() ?? '',
      md: n.md ?? '',
      linkKind: link?.k ?? null,
      linkId: link?.id ?? null,
      pinned: n.pin ?? false,
      showOnLogin: n.login ?? false,
      audience: n.aud,
      modules: newsModulesOrdered(modules),
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
/** Второй текст новостей наполнения; пустой — у новости его нет. */
export function newsAdminTextSeedRows(section: unknown): { newsId: string; md: string }[] {
  return seedItems(section).map((n) => ({ newsId: n.id, md: newsMdTrim(n.admMd ?? '') }));
}

/**
 * Второй текст «Для администратора платформы» (доработки 16.11.2026, блок 4, пункт 1): только у
 * новостей, которые администратор платформы не правил (`news.updated_by` пуст). Без `update` —
 * недостающие; с `update` — ещё изменившиеся и убранные из наполнения; у изменённой новости
 * поднимается версия (открытое окно правки не затрёт новый текст).
 */
async function seedNewsAdminTexts(db: Db, section: unknown, update: boolean): Promise<void> {
  const rows = newsAdminTextSeedRows(section);
  const filled = rows.filter((r) => r.md);
  const changed = new Set<string>();
  if (filled.length) {
    const values = sql.join(
      filled.map((r) => sql`(${r.newsId}, ${r.md})`),
      sql`, `,
    );
    const done = await db.execute<{ news_id: string }>(sql`
      insert into ${newsAdminTexts} (news_id, md, updated_by)
      select v.id, v.md, null from (values ${values}) as v(id, md)
        join ${news} n on n.id = v.id and n.updated_by is null
      on conflict (news_id) do ${
        update
          ? sql`update set md = excluded.md, updated_at = now(), updated_by = null
              where ${newsAdminTexts}.md is distinct from excluded.md`
          : sql`nothing`
      }
      returning news_id`);
    for (const r of done) changed.add(r.news_id);
  }
  const empty = rows.filter((r) => !r.md).map((r) => r.newsId);
  if (update && empty.length) {
    const ids = sql.join(
      empty.map((id) => sql`${id}`),
      sql`, `,
    );
    const gone = await db.execute<{ news_id: string }>(sql`
      delete from ${newsAdminTexts} t using ${news} n
      where n.id = t.news_id and n.updated_by is null and t.news_id in (${ids})
      returning t.news_id`);
    for (const r of gone) changed.add(r.news_id);
  }
  if (changed.size) {
    const ids = sql.join(
      [...changed].map((id) => sql`${id}`),
      sql`, `,
    );
    await db.execute(
      sql`update ${news} set version = version + 1, updated_at = now() where id in (${ids})`,
    );
  }
}

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
            // «Для кого» — тоже: разбор выпущенных новостей (доработки 16.11.2026, блок 4, пункт 5)
            // переводит новости в «Только режим Админка».
            audience: sql`excluded.audience`,
            modules: sql`excluded.modules`,
            updatedAt: sql`now()`,
            version: sql`${news.version} + 1`,
          },
          setWhere: sql`${news.updatedBy} is null and (${news.title}, ${news.type}, ${news.release}, ${news.publishDate}, ${news.short}, ${news.md}, ${news.linkKind}, ${news.linkId}, ${news.pinned}, ${news.showOnLogin}, ${news.audience}, ${news.modules}) is distinct from (excluded.title, excluded.type, excluded.release, excluded.publish_date, excluded.short, excluded.md, excluded.link_kind, excluded.link_id, excluded.pinned, excluded.show_on_login, excluded.audience, excluded.modules)`,
        })
        .returning({ id: news.id })
    : await insert.onConflictDoNothing().returning({ id: news.id });
  const inserted = (await db.$count(news)) - before;
  await seedNewsAdminTexts(db, section, options.update === true);
  return { inserted, updated: touched.length - inserted, unchanged: rows.length - touched.length };
}
