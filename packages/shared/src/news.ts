import { NEWS_AUDIENCES, NEWS_HISTORY_KINDS, NEWS_TYPES } from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordAudit, RecordVersion, Uuid } from './common';
import { listPageSchema } from './list';

/*
 * «Новости» Базы знаний (ТЗ «База знаний» → «Новости», «Окно «Что нового» при входе»; Админка →
 * «База знаний (содержимое)» → «Новости»; задача 2.32, docs/decisions.md п. Г-3). Подробное описание
 * — markdown: экран разбирает его правилами домена (`newsMdBlocks`) и HTML не выполняет.
 */

/** Код новости: `v1` … из refDB.json, у новых — `n` и случайные знаки. */
export const NewsCode = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

export const NewsTypeSchema = z.enum(NEWS_TYPES);
export const NewsAudienceSchema = z.enum(NEWS_AUDIENCES);

/** «Подробнее»: статья (`art`) или модуль (`mod`) Базы знаний. */
export const NewsLinkSchema = z.object({
  kind: z.enum(['art', 'mod']),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});
export type NewsLinkSchema = z.infer<typeof NewsLinkSchema>;

/** Новость в ленте пользователя и в окне «Что нового». */
export const NewsItem = z.object({
  id: NewsCode,
  title: z.string(),
  type: NewsTypeSchema,
  /** «Версия»; у объявлений бывает пустой. */
  release: z.string().nullable(),
  date: IsoDate,
  short: z.string(),
  md: z.string(),
  link: NewsLinkSchema.nullable(),
  pinned: z.boolean(),
  /** «Изменено ДД.ММ.ГГГГ» — опубликованную новость исправили. */
  editedAt: z.iso.datetime().nullable(),
  /** Прочитана: открыта, показана в «Что нового» или «Отметить все прочитанными». */
  read: z.boolean(),
});
export type NewsItem = z.infer<typeof NewsItem>;

/** Лента «Новостей»: от новых к старым. */
export const NewsFeed = z.object({ items: z.array(NewsItem) });
export type NewsFeed = z.infer<typeof NewsFeed>;

/** Непрочитанные новости: счётчик у вкладки «Новости», у «Базы знаний» и точка у «Меню». */
export const NewsUnread = z.object({ unread: z.number().int().nonnegative() });
export type NewsUnread = z.infer<typeof NewsUnread>;

/**
 * Окно «Что нового»: непрочитанные новости «Показывать при входе»; `first` — у пользователя ещё нет
 * прочитанных новостей и он не видел приветствия организации (окно впервые: приветствие и «Открыть
 * Базу знаний»).
 */
export const WhatsNew = z.object({ items: z.array(NewsItem), first: z.boolean() });
export type WhatsNew = z.infer<typeof WhatsNew>;

/** Отметить прочитанными: открытую новость или показанные в «Что нового». */
export const NewsReadRequest = z.object({ ids: z.array(NewsCode).min(1).max(200) });
export type NewsReadRequest = z.infer<typeof NewsReadRequest>;

/** Сколько отметок добавлено и сколько непрочитанных осталось. */
export const NewsReadResult = z.object({
  marked: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
});
export type NewsReadResult = z.infer<typeof NewsReadResult>;

/** Что видно в Админке: черновик, снята с публикации, появится в будущем, опубликована. */
export const NewsStateSchema = z.enum(['draft', 'off', 'scheduled', 'live']);

const adminFields = {
  id: NewsCode,
  title: z.string(),
  type: NewsTypeSchema,
  release: z.string().nullable(),
  date: IsoDate,
  short: z.string(),
  link: NewsLinkSchema.nullable(),
  pinned: z.boolean(),
  showOnLogin: z.boolean(),
  audience: NewsAudienceSchema,
  status: z.enum(['draft', 'published']),
  off: z.boolean(),
  state: NewsStateSchema,
  publishedAt: z.iso.datetime().nullable(),
  editedAt: z.iso.datetime().nullable(),
  version: RecordVersion,
};

/** Новость в списке Админки: без подробного описания, с числом прочитавших. */
export const AdminNews = z.object({
  ...adminFields,
  /** «Прочитали» — сколько пользователей прочитали новость. */
  reads: z.number().int().nonnegative(),
  audit: RecordAudit,
});
export type AdminNews = z.infer<typeof AdminNews>;

export const AdminNewsList = listPageSchema(AdminNews);
export type AdminNewsList = z.infer<typeof AdminNewsList>;

/** Новость целиком — для окна «Новость» и «Предпросмотра». */
export const AdminNewsRecord = z.object({ ...adminFields, md: z.string() });
export type AdminNewsRecord = z.infer<typeof AdminNewsRecord>;

/**
 * Поля окна «Новость». Пределы здесь — только от злоупотреблений: ошибки под полями даёт проверка
 * домена `newsProblems` (та же на экране и на сервере).
 */
export const NewsInputSchema = z.object({
  title: z.string().max(2000),
  type: NewsTypeSchema,
  release: z.string().max(200),
  date: z.string().max(20),
  short: z.string().max(2000),
  md: z.string().max(60_000),
  link: NewsLinkSchema.nullable(),
  pinned: z.boolean(),
  showOnLogin: z.boolean(),
  audience: NewsAudienceSchema,
});
export type NewsInputSchema = z.infer<typeof NewsInputSchema>;

/** «Сохранить черновик» (`publish: false`) или «Опубликовать» новой новости. */
export const CreateNewsRequest = NewsInputSchema.extend({ publish: z.boolean() });
export type CreateNewsRequest = z.infer<typeof CreateNewsRequest>;

/** Сохранить правку: версия, которую видел администратор; у черновика — сразу и опубликовать. */
export const SaveNewsRequest = NewsInputSchema.extend({
  version: RecordVersion,
  publish: z.boolean(),
});
export type SaveNewsRequest = z.infer<typeof SaveNewsRequest>;

/** «Опубликовать» черновик из меню записи. */
export const NewsVersionRequest = z.object({ version: RecordVersion });
export type NewsVersionRequest = z.infer<typeof NewsVersionRequest>;

/** «Снять с публикации» (`off: true`) и «Вернуть в публикацию». */
export const NewsOffRequest = z.object({ version: RecordVersion, off: z.boolean() });
export type NewsOffRequest = z.infer<typeof NewsOffRequest>;

/** Удалить черновик: версия в параметрах запроса. */
export const NewsVersionQuery = z.object({ version: z.coerce.number().int().nonnegative() });
export type NewsVersionQuery = z.infer<typeof NewsVersionQuery>;

/** Статьи для «Ссылки «Подробнее»» в окне «Новость»: все активные статьи Базы знаний. */
export const NewsArticleOptions = z.object({
  items: z.array(z.object({ id: z.string(), title: z.string() })),
});
export type NewsArticleOptions = z.infer<typeof NewsArticleOptions>;

/** Картинка загружена: адрес для markdown `![имя](адрес)`. */
export const NewsImageUploaded = z.object({ id: Uuid, url: z.string() });
export type NewsImageUploaded = z.infer<typeof NewsImageUploaded>;

/**
 * «История изменений · N» под списком новостей в Админке (прототип pdHistHtml): всего записей и последние
 * 12, новые сверху. Текст строки — словарь `news.hist.<kind>` с заголовком новости.
 */
export const NewsAdminHistory = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      id: z.number().int(),
      at: z.iso.datetime(),
      kind: z.enum(NEWS_HISTORY_KINDS),
      title: z.string(),
      /** Кто — «Администратор платформы» (историю платформы пишут только они). */
      actor: z.string(),
    }),
  ),
});
export type NewsAdminHistory = z.infer<typeof NewsAdminHistory>;
