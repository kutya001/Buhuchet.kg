import { BISHKEK_UTC_OFFSET_MINUTES, isIsoDate, type IsoDate } from '../common/dates';
import { newsMdText, newsMdTrim } from './markdown';

/*
 * «Новости» Базы знаний (ТЗ «База знаний» → вкладка «Новости», «Окно «Что нового» при входе»;
 * «База знаний (содержимое)» → «Новости»; прототип modules/kb-news.js, admin/news.js). Ведёт только
 * администратор платформы; видят все пользователи всех организаций (новости «Только режим Админка» —
 * только администраторы платформы).
 */

/** Типы новостей по порядку (прототип NEWS_T): код → цвет метки. Названия — словарь `news.type.<код>`. */
export const NEWS_TYPES = ['update', 'feature', 'fix', 'announce'] as const;
export type NewsType = (typeof NEWS_TYPES)[number];

export const NEWS_TYPE_COLORS: Readonly<Record<NewsType, 'blue' | 'green' | 'orange' | 'purple'>> =
  {
    update: 'blue',
    feature: 'green',
    fix: 'orange',
    announce: 'purple',
  };

/** Типы в refDB.json (прототип хранит названия) → коды. */
export const NEWS_TYPE_BY_NAME: Readonly<Record<string, NewsType>> = {
  Обновление: 'update',
  Нововведение: 'feature',
  Исправление: 'fix',
  Объявление: 'announce',
};

/** «Для кого»: все пользователи или только режим Админка. */
export const NEWS_AUDIENCES = ['all', 'adm'] as const;
export type NewsAudience = (typeof NEWS_AUDIENCES)[number];

/** Статусы (ТЗ «1 Черновик → 2 Опубликовано»); «Снято с публикации» — отдельной отметкой `off`. */
export const NEWS_STATUSES = ['draft', 'published'] as const;
export type NewsStatus = (typeof NEWS_STATUSES)[number];

/** Что видно в Админке о новости: черновик, снята, появится в будущем или опубликована. */
export type NewsState = 'draft' | 'off' | 'scheduled' | 'live';

export const NEWS_TITLE_MAX = 200;
/** «Краткое описание … до 200 знаков» (прототип: maxlength 200). */
export const NEWS_SHORT_MAX = 200;
export const NEWS_VERSION_MAX = 20;
export const NEWS_MD_MAX = 50_000;
/** Картинка в новости — до 2 МБ (прототип: «Картинка больше 2 МБ»). */
export const NEWS_IMAGE_MAX_BYTES = 2 * 1048576;

/** Новость появляется у пользователей в день публикации в 09:00 по Бишкеку (ТЗ). */
export const NEWS_SHOW_TIME = '09:00';

/**
 * Шаблон подробного описания новой новости (прототип NEWS_TPL): разделы «Что нового», «Изменено»,
 * «Исправлено», «Где найти», «Что нужно сделать»; пустые при сохранении убираются (`newsMdTrim`).
 */
export const NEWS_TEMPLATE =
  '## Что нового\n- \n\n## Изменено\n- \n\n## Исправлено\n- \n\n## Где найти\n- \n\n## Что нужно сделать\n- \n';

/** Момент, с которого новость видна: дата публикации в 09:00 по Бишкеку. */
export function newsShowMoment(date: IsoDate): Date {
  if (!isIsoDate(date)) throw new RangeError(`Не дата YYYY-MM-DD: ${date}`);
  return new Date(
    Date.parse(`${date}T${NEWS_SHOW_TIME}:00Z`) - BISHKEK_UTC_OFFSET_MINUTES * 60_000,
  );
}

export interface NewsTiming {
  status: NewsStatus;
  off: boolean;
  date: IsoDate;
}

/**
 * Видна ли новость пользователям (прототип newsLive): опубликована, не снята и наступила дата
 * публикации — в этот день с 09:00 по Бишкеку.
 */
export function newsLive(n: NewsTiming, now: Date): boolean {
  return n.status === 'published' && !n.off && newsShowMoment(n.date).getTime() <= now.getTime();
}

/** Состояние для Админки (прототип newsStTxt): «Черновик», «снято», «появится …» или «Опубликовано». */
export function newsState(n: NewsTiming, now: Date): NewsState {
  if (n.status === 'draft') return 'draft';
  if (n.off) return 'off';
  return newsLive(n, now) ? 'live' : 'scheduled';
}

/**
 * Когда новость «вышла» для пользователя: момент публикации, но не раньше её даты в 09:00. Новости,
 * вышедшие до появления учётной записи, у неё прочитаны (docs/deviations.md п. Г-3).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-3
export function newsReleasedAt(date: IsoDate, publishedAt: Date | null): Date {
  const show = newsShowMoment(date);
  return publishedAt && publishedAt.getTime() > show.getTime() ? publishedAt : show;
}

/** «Показывать при входе» по умолчанию: у «Обновления», «Нововведения» и у закреплённых (ТЗ). */
export function newsLoginDefault(type: NewsType, pinned: boolean): boolean {
  return pinned || type === 'update' || type === 'feature';
}

const versionNumber = (v: string | null) => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
};

/** Сравнение версий как чисел по частям: «1.10» новее «1.9». */
export function compareNewsVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export interface NewsOrderFields {
  date: IsoDate;
  publishedAt: Date | null;
  version: string | null;
}

/**
 * Порядок ленты (ТЗ; прототип newsSort): от новых к старым по дате выхода, в один день — по времени
 * публикации, затем по номеру версии.
 */
export function compareNews(a: NewsOrderFields, b: NewsOrderFields): number {
  return (
    b.date.localeCompare(a.date) ||
    (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) ||
    versionNumber(b.version) - versionNumber(a.version)
  );
}

export interface NewsGroup<T> {
  /** Версия; пусто — объявления без версии. */
  version: string | null;
  /** Дата группы — самая поздняя дата её новостей («Версия 1.4 — 20.10.2026»). */
  date: IsoDate;
  items: T[];
}

/**
 * Лента по группам (прототип renderNews): закреплённые — отдельно сверху, остальные по версиям; группы
 * идут в порядке ленты — выше та, в которой новость вышла позже. Новости должны быть уже упорядочены
 * `compareNews`.
 */
export function newsGroups<T extends { version: string | null; date: IsoDate; pinned: boolean }>(
  items: readonly T[],
): { pinned: T[]; groups: NewsGroup<T>[] } {
  const groups: NewsGroup<T>[] = [];
  for (const n of items) {
    if (n.pinned) continue;
    let g = groups.find((x) => x.version === (n.version || null));
    if (!g) groups.push((g = { version: n.version || null, date: n.date, items: [] }));
    g.items.push(n);
    if (n.date > g.date) g.date = n.date;
  }
  return { pinned: items.filter((n) => n.pinned), groups };
}

/** Версии для фильтра — от новых к старым (прототип: сортировка с numeric). */
export function newsVersions(items: readonly { version: string | null }[]): string[] {
  return [...new Set(items.map((n) => n.version).filter((v): v is string => !!v))].sort((a, b) =>
    compareNewsVersions(b, a),
  );
}

/** Поиск по тексту ленты: заголовок, краткое и подробное описание без разметки, без учёта регистра. */
export function newsMatches(n: { title: string; short: string; md: string }, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  return `${n.title} ${n.short} ${newsMdText(n.md)}`.toLowerCase().includes(query);
}

/** Краткое описание для ленты: своё или начало текста без разметки (прототип newsShort). */
export function newsShortText(n: { short: string; md: string }): string {
  return n.short || newsMdText(n.md).slice(0, NEWS_SHORT_MAX);
}

export interface NewsDraft {
  title: string;
  type: NewsType;
  version: string;
  date: string;
  short: string;
  md: string;
}

export type NewsProblem =
  | 'news_title_required'
  | 'news_title_too_long'
  | 'news_date_required'
  | 'news_short_required'
  | 'news_short_too_long'
  | 'news_md_required'
  | 'news_md_too_long'
  | 'news_version_required'
  | 'news_version_too_long';

export type NewsField = 'title' | 'date' | 'short' | 'md' | 'version';

export const NEWS_MESSAGES: Record<NewsProblem, string> = {
  news_title_required: 'Введите заголовок',
  news_title_too_long: `Заголовок — не больше ${NEWS_TITLE_MAX} знаков`,
  news_date_required: 'Укажите дату',
  news_short_required: 'Введите краткое описание для ленты',
  news_short_too_long: `Краткое описание — не больше ${NEWS_SHORT_MAX} знаков`,
  news_md_required: 'Введите подробное описание',
  news_md_too_long: `Подробное описание — не больше ${NEWS_MD_MAX} знаков`,
  news_version_required: 'Укажите версию: без неё можно только объявление',
  news_version_too_long: `Версия — не больше ${NEWS_VERSION_MAX} знаков`,
};

/**
 * Проверка новости перед сохранением (прототип newsEditDlg → save): заголовок, дата, краткое и
 * подробное описание обязательны; версия нужна всем, кроме объявлений, — но черновик можно сохранить и
 * без неё (`publish` — новость публикуется или уже опубликована).
 */
export function newsProblems(
  draft: NewsDraft,
  options: { publish: boolean },
): Partial<Record<NewsField, NewsProblem>> {
  const out: Partial<Record<NewsField, NewsProblem>> = {};
  const title = draft.title.trim();
  if (!title) out.title = 'news_title_required';
  else if (title.length > NEWS_TITLE_MAX) out.title = 'news_title_too_long';
  if (!isIsoDate(draft.date)) out.date = 'news_date_required';
  const short = draft.short.trim();
  if (!short) out.short = 'news_short_required';
  else if (short.length > NEWS_SHORT_MAX) out.short = 'news_short_too_long';
  // Пустые разделы шаблона не считаются текстом (прототип: проверка после mdTrim).
  if (!newsMdText(newsMdTrim(draft.md))) out.md = 'news_md_required';
  else if (draft.md.length > NEWS_MD_MAX) out.md = 'news_md_too_long';
  const version = draft.version.trim();
  if (version.length > NEWS_VERSION_MAX) out.version = 'news_version_too_long';
  else if (!version && draft.type !== 'announce' && options.publish)
    out.version = 'news_version_required';
  return out;
}

/** Типы картинок в новости: то, что показывают все браузеры, без SVG (в нём бывает сценарий). */
export type NewsImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const startsWith = (bytes: Uint8Array, sig: readonly number[], at = 0) =>
  bytes.length > at + sig.length && sig.every((b, i) => bytes[at + i] === b);

/** Тип картинки по первым байтам файла, а не по имени и заголовку запроса. null — не картинка. */
export function newsImageType(bytes: Uint8Array): NewsImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  // RIFF….WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  return null;
}

export type NewsImageProblem = 'news_image_too_large' | 'news_image_type';

export const NEWS_IMAGE_MESSAGES: Record<NewsImageProblem, string> = {
  news_image_too_large: 'Картинка больше 2 МБ',
  news_image_type: 'Картинка — PNG, JPG, GIF или WebP',
};

/** Что не так с картинкой для новости (прототип: «Картинка больше 2 МБ»): размер, затем тип. */
export function newsImageProblem(bytes: Uint8Array): NewsImageProblem | null {
  if (bytes.length > NEWS_IMAGE_MAX_BYTES) return 'news_image_too_large';
  return newsImageType(bytes) ? null : 'news_image_type';
}

/**
 * Запись «Истории изменений» под списком новостей в Админке (прототип admin/news.js: `newsLog`, `pdLog`):
 * черновик заведён, опубликована, исправлена опубликованная, сохранён черновик, снята с публикации,
 * возвращена, черновик удалён. Тексты — словарь `news.hist.<вид>`.
 */
export const NEWS_HISTORY_KINDS = [
  'draft',
  'published',
  'edited',
  'draft_saved',
  'off',
  'back',
  'deleted',
] as const;
export type NewsHistoryKind = (typeof NEWS_HISTORY_KINDS)[number];

/**
 * Строки истории по одной записи истории новости, новые сверху — по действию, изменённым полям и
 * состоянию до правки (`statusBefore`: последнее записанное в истории `status`; новостей из начального
 * наполнения в истории нет — для них передаётся их состояние). Публикация, снятие и возврат важнее правки
 * полей в той же записи. Новость, созданная сразу кнопкой «Опубликовать», — две строки, как в прототипе
 * (`newsLog(o,'Черновик')`, затем `newsLog(o,'Опубликовано')`): «Опубликовано» и под ней «Черновик».
 */
export function newsHistoryKinds(
  action: string,
  changes: readonly { field: string; from?: unknown; to?: unknown }[],
  statusBefore: NewsStatus | null,
): NewsHistoryKind[] {
  const to = (field: string) => changes.find((c) => c.field === field)?.to;
  if (action === 'delete') return ['deleted'];
  if (action === 'create') return to('status') === 'published' ? ['published', 'draft'] : ['draft'];
  if (to('status') === 'published') return ['published'];
  const off = to('off');
  if (off === true) return ['off'];
  if (off === false) return ['back'];
  return [statusBefore === 'published' ? 'edited' : 'draft_saved'];
}
