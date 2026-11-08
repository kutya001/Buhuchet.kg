import { MENU_MODULE_IDS } from '../org/modules';

/*
 * Видео платформы (решение заказчика 08.11.2026; прототип v79 modules/video.js и admin/video-admin.js;
 * ТЗ «Окно видео», «База знаний» → «Видео» и «Просмотры видео», «Админка → База знаний (содержимое)» →
 * «Видео», «Лендинг» → «Видео о Buhuchet.kg»): виды, источники, пределы, учёт просмотренных секунд,
 * кому видно видео, порядок и проверка загруженного файла.
 */

/** Вид: «Видеоинструкция» (просмотры учитываются по людям) или «Презентация». */
export const VIDEO_KINDS = ['instr', 'pres'] as const;
export type VideoKind = (typeof VIDEO_KINDS)[number];

/** Источник: файл в хранилище платформы или ссылка YouTube. */
export const VIDEO_SOURCES = ['file', 'yt'] as const;
export type VideoSource = (typeof VIDEO_SOURCES)[number];

/** «Для кого»: все пользователи или «Только режим Админка». */
export const VIDEO_AUDIENCES = ['all', 'adm'] as const;
export type VideoAudience = (typeof VIDEO_AUDIENCES)[number];

/** 1 Черновик → 2 Опубликовано; «Снято с публикации» — отдельной отметкой `off`, как у новостей. */
export const VIDEO_STATUSES = ['draft', 'published'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const VIDEO_TITLE_MAX = 120;
export const VIDEO_DESC_MAX = 1000;
/** Файл видео — до 500 МБ (прототип `VID_MAX`). */
export const VIDEO_FILE_MAX_BYTES = 500 * 1024 * 1024;
/** Обложка — PNG или JPG до 2 МБ; хранится JPEG-копией шириной до 960 px. */
export const VIDEO_COVER_MAX_BYTES = 2 * 1024 * 1024;
export const VIDEO_COVER_WIDTH = 960;
/**
 * Файл уходит в хранилище частями по 10 МБ (у S3 часть, кроме последней, — не меньше 5 МБ): при обрыве
 * связи загрузка продолжается с последней загруженной части.
 */
export const VIDEO_PART_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_PARTS = Math.ceil(VIDEO_FILE_MAX_BYTES / VIDEO_PART_BYTES);
/** Ссылка на загрузку части живёт 15 минут, на просмотр — 2 часа (с перемоткой). */
export const VIDEO_PART_LINK_SECONDS = 15 * 60;
export const VIDEO_LINK_SECONDS = 2 * 60 * 60;
/** Незаконченная загрузка или неиспользованная обложка убираются через сутки. */
export const VIDEO_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
/** «Просмотрено» — не меньше 90 % секунд видео. */
export const VIDEO_DONE_SHARE = 0.9;
/** Скорости плеера (прототип `VID_RATES`): на 1,5 и 2 проигранные секунды засчитываются. */
export const VIDEO_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
export const VIDEO_MAX_RATE = 2;
/** Прогресс уходит на сервер каждые 15 секунд просмотра, при паузе и при закрытии окна. */
export const VIDEO_SAVE_SECONDS = 15;
/** Отрезков в одном открытии — не больше (каждая перемотка — новый отрезок). */
export const VIDEO_SEGMENTS_MAX = 2000;
/** Длительность видео — не больше 12 часов. */
export const VIDEO_DURATION_MAX = 12 * 60 * 60;

export type VideoContentType = 'video/mp4' | 'video/webm';

/** Тип файла видео по имени: только .mp4 и .webm (заявленный браузером тип должен с ним совпасть). */
export function videoContentType(name: string, declared?: string | null): VideoContentType | null {
  const ext = /\.(mp4|webm)$/i.exec(name.trim())?.[1]?.toLowerCase();
  const type: VideoContentType | null =
    ext === 'mp4' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : null;
  if (!type) return null;
  if (declared && declared !== type) return null;
  return type;
}

/** Длительность «2:15», «1:02:05» (прототип `vidT`). */
export function videoTime(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const c = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${c}` : `${m}:${c}`;
}

const YT_LINK =
  /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([\w-]{11})(?:[?&#/][^\s]*)?$/;

/**
 * Код видео YouTube из ссылки (прототип `ytId`): youtube.com/watch?v=…, youtu.be/…, youtube.com/shorts/…,
 * youtube.com/live/…, youtube.com/embed/… и youtube-nocookie.com/embed/…; другая ссылка — null.
 */
export function videoYtId(link: string | null | undefined): string | null {
  return YT_LINK.exec(String(link ?? '').trim())?.[1] ?? null;
}

/** Код видео YouTube — 11 знаков из латинских букв, цифр, «_» и «-». */
export const VIDEO_YT_ID = /^[\w-]{11}$/;

/* ───────────── Учёт просмотренных секунд ───────────── */

/** Отрезок видео [с какой секунды, по какую], который проигрался. */
export type VideoSegment = readonly [number, number];

const tenth = (x: number) => Math.round(x * 10) / 10;

/**
 * Слить списки отрезков за один проход (прототип `segAdd`): концы округляются до 0,1 с, отрезки короче
 * 0,1 с отбрасываются, соседние и перекрытые (разрыв до 0,25 с) сливаются — каждая секунда видео
 * считается один раз. Одна сортировка на всё: время растёт как n·log n при любом числе отрезков.
 */
function mergeSegments(
  parts: readonly (readonly (readonly number[])[] | null | undefined)[],
): VideoSegment[] {
  const all: [number, number][] = [];
  for (const part of parts) {
    for (const x of part ?? []) {
      const a = tenth(x[0]!);
      const b = tenth(x[1]!);
      if (b > a) all.push([a, b]);
    }
  }
  all.sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const x of all) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1] + 0.25) last[1] = Math.max(last[1], x[1]);
    else out.push(x);
  }
  return out;
}

/** Добавить отрезок к списку (прототип `segAdd`). */
export function videoSegAdd(
  list: readonly VideoSegment[] | null | undefined,
  a: number,
  b: number,
): VideoSegment[] {
  return mergeSegments([list, [[a, b]]]);
}

/** Слить два списка отрезков. */
export function videoSegMerge(
  list: readonly VideoSegment[] | null | undefined,
  more: readonly VideoSegment[] | null | undefined,
): VideoSegment[] {
  return mergeSegments([list, more]);
}

/** Сколько секунд в отрезках (прототип `segLen`). */
export function videoSegLen(list: readonly VideoSegment[] | null | undefined): number {
  return (list ?? []).reduce((sum, x) => sum + Math.max(0, x[1] - x[0]), 0);
}

/** Просмотренные секунды: не больше длительности (прототип `vidSecs`). */
export function videoSecs(
  duration: number | null | undefined,
  segs: readonly VideoSegment[] | null | undefined,
): number {
  return Math.min(duration || Infinity, videoSegLen(segs));
}

/**
 * Процент просмотра, вниз до целого (прототип `vidPct`); пока длительность неизвестна (YouTube до
 * первого запуска) — 0, секунды копятся и пересчитываются, как только она известна.
 */
export function videoPct(
  duration: number | null | undefined,
  segs: readonly VideoSegment[] | null | undefined,
): number {
  if (!duration) return 0;
  return Math.min(100, Math.floor((videoSecs(duration, segs) / duration) * 100 + 1e-6));
}

/** Набралось 90 % секунд видео — «Просмотрено» (ставится один раз и не снимается). */
export function videoReachedDone(
  duration: number | null | undefined,
  segs: readonly VideoSegment[] | null | undefined,
): boolean {
  return !!duration && videoSegLen(segs) >= duration * VIDEO_DONE_SHARE;
}

/** Статус просмотра: «Не смотрел», «Начал» (с первой проигранной секунды), «Просмотрено». */
export const VIDEO_VIEW_STATUSES = ['none', 'started', 'done'] as const;
export type VideoViewStatus = (typeof VIDEO_VIEW_STATUSES)[number];

/** Статус просмотра по записи (прототип `vidSt`). */
export function videoViewStatus(
  record: { done: boolean; segs: readonly VideoSegment[] } | null | undefined,
): VideoViewStatus {
  if (record?.done) return 'done';
  return record && videoSegLen(record.segs) >= 1 ? 'started' : 'none';
}

export type VideoProgressProblem = 'video_progress_invalid';

/**
 * Проверка отрезков одного сохранения от браузера: концы — числа от 0 до длительности (пока она
 * неизвестна — до 12 часов), начало меньше конца, отрезков не больше 2 000. Отрезки этого открытия
 * вместе с уже сохранёнными (`earlier`) и секунды других открытий этого видео за то же время
 * (`others`, каждое открытие — отдельно) — не больше, чем могло проиграться со времени самого раннего
 * из них (`openedAt`) на скорости 2 и 5 секунд запаса: ни серией сохранений, ни несколькими окнами
 * сразу накрутить просмотр нельзя (в фоне вкладки видео встаёт на паузу — два окна сразу не играют).
 */
export function videoProgressProblem(input: {
  segs: readonly (readonly number[])[];
  duration: number | null;
  openedAt: Date;
  now: Date;
  earlier?: readonly VideoSegment[] | null;
  others?: number;
}): VideoProgressProblem | null {
  const { segs, duration, openedAt, now } = input;
  if (segs.length > VIDEO_SEGMENTS_MAX) return 'video_progress_invalid';
  const end = (duration ?? VIDEO_DURATION_MAX) + 1;
  for (const s of segs) {
    if (s.length !== 2) return 'video_progress_invalid';
    const [a, b] = s as [number, number];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a || b > end) {
      return 'video_progress_invalid';
    }
  }
  const elapsed = Math.max(0, (now.getTime() - openedAt.getTime()) / 1000);
  const merged = mergeSegments([input.earlier, segs]);
  if (merged.length > VIDEO_SEGMENTS_MAX) return 'video_progress_invalid';
  const played = Math.max(0, input.others ?? 0) + videoSegLen(merged);
  return played > elapsed * VIDEO_MAX_RATE + 5 ? 'video_progress_invalid' : null;
}

/* ───────────── Кому видно ───────────── */

/** Поля видео, от которых зависит, кому оно видно. */
export interface VideoVisibility {
  status: VideoStatus;
  off: boolean;
  deleted: boolean;
  audience: VideoAudience;
  /** Модуль меню; null — «Общее». */
  module: string | null;
  landing?: boolean;
}

/** Опубликовано, не снято и не удалено (прототип `vidLive`). */
export function videoLive(v: VideoVisibility): boolean {
  return !v.deleted && v.status === 'published' && !v.off;
}

/**
 * Видно вошедшему (прототип `vidOk`): администратору платформы — любое опубликованное; остальным — не
 * «только режим Админка» и «Общее» или модуль из его меню (включён в учётной политике и разрешён
 * правами).
 */
export function videoVisible(
  v: VideoVisibility,
  access: { admin: boolean; modules: ReadonlySet<string> },
): boolean {
  if (!videoLive(v)) return false;
  if (access.admin) return true;
  if (v.audience === 'adm') return false;
  return !v.module || access.modules.has(v.module);
}

/** На лендинге (прототип `vidLand`): опубликовано, отмечено «Показывать на лендинге», для всех. */
export function videoOnLanding(v: VideoVisibility): boolean {
  return videoLive(v) && !!v.landing && v.audience !== 'adm';
}

/** Модули, к которым можно привязать видео: режим Бизнес и Админка (порядок — как в меню). */
export const VIDEO_MODULES: readonly string[] = MENU_MODULE_IDS;

/**
 * Место группы модуля (прототип `vidModOrd`): «Общее» — первым, дальше в порядке левой панели
 * пользователя, модули не из его меню — после, в порядке всех модулей.
 */
export function videoModuleOrder(module: string | null, menu: readonly string[]): number {
  if (!module) return -1;
  const i = menu.indexOf(module);
  return i >= 0 ? i : 500 + VIDEO_MODULES.indexOf(module);
}

/** Порядок видео: группа модуля, «Порядок» внутри группы, название (прототип `vidSortF`). */
export function compareVideos(
  a: { module: string | null; ord: number; title: string },
  b: { module: string | null; ord: number; title: string },
  menu: readonly string[],
): number {
  return (
    videoModuleOrder(a.module, menu) - videoModuleOrder(b.module, menu) ||
    a.ord - b.ord ||
    a.title.localeCompare(b.title, 'ru')
  );
}

/** Порядок на лендинге: «Порядок на лендинге», затем «Порядок» (прототип `vidLand`). */
export function compareLandingVideos(
  a: { landingOrd: number; ord: number },
  b: { landingOrd: number; ord: number },
): number {
  return (a.landingOrd || 99) - (b.landingOrd || 99) || a.ord - b.ord;
}

/* ───────────── Форма видео в Админке ───────────── */

export type VideoField = 'title' | 'kind' | 'source' | 'file' | 'yt' | 'module' | 'description';

/** Тексты ошибок формы видео и отказов API (прототип admin/video-admin.js `vidEditDlg`). */
export const VIDEO_MESSAGES = {
  title_required: 'Введите название',
  title_long: 'Название — до 120 знаков',
  module_required: 'Выберите модуль: видеоинструкция относится к модулю',
  module_unknown: 'Такого модуля нет',
  yt: 'Вставьте ссылку на видео YouTube, например https://youtu.be/…',
  file: 'Загрузите видео MP4 или WebM до 500 МБ',
  description_long: 'Описание — до 1 000 знаков',
  video_file: 'Загрузите видео MP4 или WebM до 500 МБ',
  video_not_video: 'Файл не похож на видео MP4 или WebM',
  video_not_uploaded: 'Файл не дошёл до хранилища. Загрузите его ещё раз',
  video_upload_wait: 'Дождитесь окончания загрузки',
  video_cover: 'Загрузите картинку PNG или JPG до 2 МБ',
  video_off: 'Видео снято с публикации',
  video_denied: 'Это видео вам недоступно: модуль выключен или нет прав',
  video_delete_live: 'Удалить можно черновик или снятое с публикации видео',
  video_not_draft: 'Видео уже опубликовано',
  video_not_published: 'Видео ещё не опубликовано',
  video_landing_draft: 'Показывать на лендинге можно только опубликованное видео',
  video_progress_invalid: 'Неверные данные просмотра видео',
  video_upload_limit: 'Слишком много загрузок подряд. Попробуйте через несколько минут',
  video_guest_limit: 'Слишком много запросов. Попробуйте через несколько минут',
} as const;
export type VideoMessage = keyof typeof VIDEO_MESSAGES;

/** Поля формы видео, которые проверяются до сохранения. */
export interface VideoFormInput {
  title: string;
  kind: VideoKind;
  source: VideoSource;
  /** Ссылка YouTube (у источника «Ссылка YouTube»). */
  yt?: string | null;
  /** Есть загруженный и проверенный файл (новый или прежний). */
  hasFile: boolean;
  module: string | null;
  description: string;
}

/** Ошибки формы видео по полям (прототип `vidEditDlg` → `save`); пусто — можно сохранять. */
export function videoFormProblems(
  input: VideoFormInput,
): Partial<Record<VideoField, VideoMessage>> {
  const out: Partial<Record<VideoField, VideoMessage>> = {};
  const title = input.title.trim();
  if (!title) out.title = 'title_required';
  else if (title.length > VIDEO_TITLE_MAX) out.title = 'title_long';
  if (input.module && !VIDEO_MODULES.includes(input.module)) out.module = 'module_unknown';
  else if (input.kind === 'instr' && !input.module) out.module = 'module_required';
  if (input.source === 'yt' && !videoYtId(input.yt)) out.yt = 'yt';
  if (input.source === 'file' && !input.hasFile) out.file = 'file';
  if (input.description.trim().length > VIDEO_DESC_MAX) out.description = 'description_long';
  return out;
}

/** Обложка — JPEG-копия, которую браузер уменьшил до 960 px (PNG и JPG он переводит в JPEG). */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Записи истории видео в карточке (прототип `vidLog`): «Загружено», «Добавлена ссылка YouTube»,
 * «Опубликовано», «Снято с публикации», «Возвращено в публикацию», «Видео заменено», «Изменено»,
 * «Удалено». Тексты — словарь `video.hist.<вид>`.
 */
export const VIDEO_HISTORY_KINDS = [
  'upload',
  'yt',
  'publish',
  'off',
  'on',
  'replace',
  'edit',
  'delete',
] as const;
export type VideoHistoryKind = (typeof VIDEO_HISTORY_KINDS)[number];

/* ───────────── Проверка файла после загрузки ───────────── */

/** Что за файл лежит в хранилище: MP4 или WebM и длительность (null — в файле её нет). */
export interface VideoProbe {
  type: VideoContentType;
  duration: number | null;
}

/** Чтение куска файла из хранилища: с какого байта и сколько. */
export type VideoReader = (offset: number, length: number) => Promise<Uint8Array>;

const HEAD_BYTES = 64 * 1024;

const u32 = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u64 = (b: Uint8Array, i: number) => u32(b, i) * 2 ** 32 + u32(b, i + 4);
const ascii = (b: Uint8Array, i: number, n: number) =>
  String.fromCharCode(...Array.from(b.subarray(i, i + n)));

/** Длительность в секундах, если она разумная. */
function seconds(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const s = Math.round(value);
  return s >= 1 && s <= VIDEO_DURATION_MAX ? s : null;
}

/** Длительность из `mvhd`: версия 0 — 32-битные поля, версия 1 — 64-битные. */
function mvhdDuration(b: Uint8Array, i: number, end: number): number | null {
  const version = b[i];
  if (version === 0 && i + 20 <= end) {
    const scale = u32(b, i + 12);
    return scale ? seconds(u32(b, i + 16) / scale) : null;
  }
  if (version === 1 && i + 32 <= end) {
    const scale = u32(b, i + 20);
    return scale ? seconds(u64(b, i + 24) / scale) : null;
  }
  return null;
}

/**
 * MP4: первый блок — `ftyp`, дальше блоки верхнего уровня до `moov` (у файла без «быстрого старта»
 * он в конце — читаются только заголовки блоков), в `moov` — `mvhd` с длительностью.
 */
async function probeMp4(
  read: VideoReader,
  size: number,
  head: Uint8Array,
): Promise<VideoProbe | null> {
  if (head.length < 16 || ascii(head, 4, 4) !== 'ftyp') return null;
  let offset = 0;
  for (let n = 0; n < 1000 && offset + 8 <= size; n++) {
    const h =
      offset + 16 <= head.length ? head.subarray(offset, offset + 16) : await read(offset, 16);
    if (h.length < 8) return null;
    let box = u32(h, 0);
    const type = ascii(h, 4, 4);
    let body = 8;
    if (box === 1) {
      if (h.length < 16) return null;
      box = u64(h, 8);
      body = 16;
    } else if (box === 0) box = size - offset;
    if (box < body) return null;
    if (type === 'moov') {
      const len = Math.min(box, 1024 * 1024);
      const moov = await read(offset, len);
      let i = body;
      while (i + 8 <= moov.length) {
        const child = u32(moov, i);
        if (child < 8) break;
        if (ascii(moov, i + 4, 4) === 'mvhd') {
          return { type: 'video/mp4', duration: mvhdDuration(moov, i + 8, moov.length) };
        }
        i += child;
      }
      return { type: 'video/mp4', duration: null };
    }
    offset += box;
  }
  return null;
}

/** Номер элемента EBML (с маркером длины) и его длина в байтах. */
function ebmlId(b: Uint8Array, i: number): { id: number; len: number } | null {
  const first = b[i];
  if (first === undefined) return null;
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4 || i + len > b.length) return null;
  let id = 0;
  for (let k = 0; k < len; k++) id = id * 256 + b[i + k]!;
  return { id, len };
}

/** Размер элемента EBML: null — «неизвестный» (все единицы), длина поля в байтах. */
function ebmlSize(b: Uint8Array, i: number): { size: number | null; len: number } | null {
  const first = b[i];
  if (first === undefined) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || i + len > b.length) return null;
  let value = first & (0xff >> len);
  let allOnes = value === 0xff >> len;
  for (let k = 1; k < len; k++) {
    value = value * 256 + b[i + k]!;
    if (b[i + k] !== 0xff) allOnes = false;
  }
  return { size: allOnes ? null : value, len };
}

function ebmlUint(b: Uint8Array, i: number, n: number): number {
  let v = 0;
  for (let k = 0; k < n; k++) v = v * 256 + b[i + k]!;
  return v;
}

function ebmlFloat(b: Uint8Array, i: number, n: number): number | null {
  const view = new DataView(b.buffer, b.byteOffset + i, n);
  if (n === 4) return view.getFloat32(0);
  if (n === 8) return view.getFloat64(0);
  return null;
}

const EBML = 0x1a45dfa3;
const DOC_TYPE = 0x4282;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const CLUSTER = 0x1f43b675;

/**
 * WebM: заголовок EBML с типом документа «webm», дальше `Segment`, в нём `Info` — `TimecodeScale`
 * (по умолчанию 1 мс) и `Duration`. У записи из браузера длительности может не быть — тогда null.
 */
async function probeWebm(
  read: VideoReader,
  size: number,
  head: Uint8Array,
): Promise<VideoProbe | null> {
  const top = ebmlId(head, 0);
  if (!top || top.id !== EBML) return null;
  const hs = ebmlSize(head, top.len);
  if (!hs || hs.size === null) return null;
  const headerEnd = top.len + hs.len + hs.size;
  if (headerEnd > head.length) return null;
  let i = top.len + hs.len;
  let doc = '';
  while (i < headerEnd) {
    const id = ebmlId(head, i);
    const sz = id && ebmlSize(head, i + id.len);
    if (!id || !sz || sz.size === null) return null;
    const at = i + id.len + sz.len;
    if (id.id === DOC_TYPE) doc = ascii(head, at, sz.size);
    i = at + sz.size;
  }
  if (doc !== 'webm') return null;
  const seg = ebmlId(head, headerEnd);
  if (!seg || seg.id !== SEGMENT) return null;
  const ss = ebmlSize(head, headerEnd + seg.len);
  if (!ss) return null;
  let offset = headerEnd + seg.len + ss.len;
  const segEnd = ss.size === null ? size : Math.min(size, offset + ss.size);
  for (let n = 0; n < 200 && offset < segEnd; n++) {
    const h =
      offset + 12 <= head.length ? head.subarray(offset, offset + 12) : await read(offset, 12);
    const id = ebmlId(h, 0);
    const sz = id && ebmlSize(h, id.len);
    if (!id || !sz) return null;
    if (id.id === CLUSTER) break;
    const at = offset + id.len + sz.len;
    if (sz.size === null) return { type: 'video/webm', duration: null };
    if (id.id === INFO) {
      const info =
        at + sz.size <= head.length
          ? head.subarray(at, at + sz.size)
          : await read(at, Math.min(sz.size, 64 * 1024));
      let k = 0;
      let scale = 1_000_000;
      let duration: number | null = null;
      while (k < info.length) {
        const cid = ebmlId(info, k);
        const cs = cid && ebmlSize(info, k + cid.len);
        if (!cid || !cs || cs.size === null) break;
        const v = k + cid.len + cs.len;
        if (v + cs.size > info.length) break;
        if (cid.id === TIMECODE_SCALE) scale = ebmlUint(info, v, cs.size);
        if (cid.id === DURATION) duration = ebmlFloat(info, v, cs.size);
        k = v + cs.size;
      }
      return {
        type: 'video/webm',
        duration: duration === null ? null : seconds((duration * scale) / 1e9),
      };
    }
    offset = at + sz.size;
  }
  return { type: 'video/webm', duration: null };
}

/**
 * Проверка файла в хранилище после загрузки (ТЗ «После загрузки сервер проверяет, что файл
 * действительно видео MP4 или WebM допустимого размера, и узнаёт длительность»): по содержимому, а не
 * по имени. Не видео — null; тип по содержимому должен совпасть с заявленным.
 */
export async function probeVideo(
  read: VideoReader,
  size: number,
  declared: VideoContentType,
): Promise<VideoProbe | null> {
  if (size < 16 || size > VIDEO_FILE_MAX_BYTES) return null;
  const head = await read(0, Math.min(size, HEAD_BYTES));
  const probe =
    declared === 'video/mp4' ? await probeMp4(read, size, head) : await probeWebm(read, size, head);
  return probe && probe.type === declared ? probe : null;
}
