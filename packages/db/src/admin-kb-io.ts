import {
  IO_COLUMNS,
  isKbEvent,
  KB_STEP_RULES,
  kbArticleProblems,
  kbEventWorks,
  kbStepProblems,
  newsMdTrim,
  newsProblems,
  type IsoDate,
  type KbArticleAudience,
  type KbIoDict,
  type KbShowItemInput,
  type KbStepInput,
  type NewsAudience,
  type NewsType,
  type UiTextKey,
} from '@buhuchet/domain';
import type { IoRecord } from './admin-dict-io';
import type { SectionSaveResult, SectionWriter } from './admin-io-sections';
import {
  adminKbArticleRemove,
  adminKbArticles,
  adminKbArticleSave,
  adminKbMeta,
  adminKbOwnShows,
  adminKbShowSave,
  adminKbStepDelete,
  adminKbSteps,
  adminKbStepSave,
  showItemOf,
  type AdminKbArticle,
  type AdminKbOwnShow,
  type AdminKbStep,
} from './admin-kb';
import type { Tx } from './client';
import {
  allNewsForAdmin,
  createNews,
  deleteNewsDraft,
  getNews,
  saveNews,
  type NewsInput,
  type NewsRecord,
} from './news';

/*
 * Админка → «База знаний (содержимое)» → «Выгрузить» и «Загрузить» (задача 2.39, часть 2; прототип
 * admin/platform-dicts-io.js: DX.kbsteps, DX.kbshows, DX.kbarts, DX.kbnews): значения для файла, запись
 * строки и её откат — теми же функциями, что у окон вкладок (`adminKbStepSave`, `adminKbShowSave`,
 * `adminKbArticleSave`, `createNews`/`saveNews`), с теми же проверками; история — их же записи.
 * Разбор, сравнение и «Загрузки» — общие (`parseIoRows`, `ioChanges`, `insertDictLoad`).
 */

const str = (v: unknown) => (typeof v === 'string' ? v : '');

const CHANGED: SectionSaveResult = { ok: false, fail: 'changed' };

const fail = (key: UiTextKey, params?: Record<string, string>, col?: UiTextKey) =>
  ({
    ok: false,
    fail: { key, ...(params ? { params } : {}), ...(col ? { col } : {}) },
  }) as const;

/** Столбец файла поля окна: «Название» — столбец `name`. */
const colOf = (dict: KbIoDict, field: string): UiTextKey | undefined =>
  IO_COLUMNS[dict].find((c) => c.key === (field === 't' || field === 'title' ? 'name' : field))
    ?.title;

/** Первая проблема полей — отказ строки «Столбец: что не так». */
function firstProblem(
  dict: KbIoDict,
  problems: Readonly<Record<string, string | undefined>>,
  key: (problem: string) => UiTextKey,
  col: (field: string) => string = (f) => f,
): SectionSaveResult | null {
  const found = Object.entries(problems).find(([, p]) => p);
  return found ? fail(key(found[1]!), undefined, colOf(dict, col(found[0]))) : null;
}

/* ───────────── Шаги уроков ───────────── */

/** Шаг в файле (прототип DX.kbsteps); статья шага в файл не выгружается, но сохраняется. */
const stepRecord = (s: AdminKbStep): IoRecord => ({
  code: s.id,
  name: s.t,
  active: s.active,
  data: {
    g: s.g,
    w: s.w,
    learn: s.learn ? 'look' : 'do',
    star: s.star,
    perm: s.perm,
    featk: s.featk,
    evk: s.evk,
    ord: s.ord,
    mod: s.mod ?? '',
    art: s.art,
  },
  version: s.version,
});

/**
 * Шаги уроков: новая строка — шаг администратора с кодом из файла, «Новое» и местом для «Перейти»
 * (ОТКЛОНЕНИЕ: docs/deviations.md#Д-27); у шага, добавленного администратором, условие — только
 * работающее (ОТКЛОНЕНИЕ: docs/deviations.md#Д-25), как в окне.
 */
const stepsWriter: SectionWriter = {
  async records(tx) {
    return (await adminKbSteps(tx)).map(stepRecord);
  },
  async save(tx, value, base) {
    const now = (await adminKbSteps(tx)).find((s) => s.id === value.code);
    if (base ? !now : now) return CHANGED;
    const d = value.data;
    const input: KbStepInput = {
      g: str(d.g),
      t: value.name.trim(),
      w: str(d.w).trim(),
      learn: d.learn === 'look',
      art: str(d.art),
      star: d.star === true,
      perm: str(d.perm),
      featk: str(d.featk),
      evk: str(d.evk),
      active: value.active,
      ...(now ? (now.mod ? { mod: now.mod } : {}) : { mod: str(d.mod) }),
    };
    if (!now && !input.mod)
      return fail('kbadm.io.err.step_mod', undefined, colOf('kbsteps', 'mod'));
    const meta = await adminKbMeta(tx);
    const problem = firstProblem(
      'kbsteps',
      kbStepProblems(input, {
        groups: new Set(meta.groups.map((g) => g.id)),
        articles: new Set(meta.articles.map((a) => a.id)),
        isNew: !now,
      }),
      (p) => `kbadm.err.${p}` as UiTextKey,
    );
    if (problem) return problem;
    // ОТКЛОНЕНИЕ: docs/deviations.md#Д-25
    const own = Object.hasOwn(KB_STEP_RULES, value.code);
    if ((!now || now.evk !== input.evk) && isKbEvent(input.evk) && !kbEventWorks(input.evk, own)) {
      return fail('kbadm.io.err.step_event', undefined, colOf('kbsteps', 'evk'));
    }
    const ord = typeof d.ord === 'number' ? d.ord : undefined;
    const saved = await adminKbStepSave(
      tx,
      now ? now.id : null,
      input,
      now?.version ?? 0,
      now ? (ord !== undefined && ord !== now.ord ? { ord } : {}) : { code: value.code, ord },
    );
    return saved.ok ? { ok: true, record: stepRecord(saved.value) } : CHANGED;
  },
  async remove(tx, record) {
    const removed = await adminKbStepDelete(tx, record.code);
    return removed.ok || removed.reason === 'not_found' ? { ok: true } : CHANGED;
  },
};

/* ───────────── Показы ───────────── */

/**
 * Облачко в файле (прототип shFlat): код — «сценарий#номер», название — шаг (номер к нему добавляет
 * сравнение: «Шаг · облачко 4»); что подсвечивает — словами, у «Автоматически» заголовка, текста и
 * «Общего элемента» нет. «Сценарий активен» — общий у облачков сценария.
 */
function cloudRecord(h: AdminKbOwnShow, raw: Record<string, unknown>, k: number): IoRecord {
  const p = showItemOf(raw);
  return {
    code: `${h.id}#${k + 1}`,
    name: h.stepTitle,
    active: h.active,
    data: {
      step: h.stepTitle,
      what: { auto: p.auto, txt: p.txt, s: p.el ? 'el' : null, tab: p.tab },
      auto: p.auto,
      t: p.auto ? '' : p.t,
      x: p.auto ? '' : p.x,
      common: p.auto ? false : p.common,
    },
    version: h.version,
  };
}

/** Код облачка: сценарий и номер облачка с 1. */
function cloudOf(code: string): { id: string; k: number } {
  const at = code.lastIndexOf('#');
  return { id: code.slice(0, at), k: Number(code.slice(at + 1)) - 1 };
}

/** Облачка сценария для `adminKbShowSave`: прежние — по номеру, тексты — как есть. */
const keepItems = (h: AdminKbOwnShow): KbShowItemInput[] =>
  h.items.map((raw, i) =>
    typeof raw.auto === 'string'
      ? { from: i }
      : { from: i, t: str(raw.t), x: str(raw.x), common: raw.common === true },
  );

/**
 * Показы (прототип DX.kbshows): строка меняет заголовок, текст и «Общий элемент» облачка своего
 * сценария и «Сценарий активен»; строка с новым номером своего сценария — облачко с текстом в конце
 * сценария, какой бы номер ни стоял в файле (у шага без своего сценария облачков в файле нет). Запись
 * — как окном сценария, с его проверками: строку, которую прототип молча пропускает (своего сценария
 * нет, пустой заголовок), сравнение показывает ошибкой.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-27
const showsWriter: SectionWriter = {
  async records(tx) {
    return (await adminKbOwnShows(tx)).flatMap((h) =>
      h.items.map((raw, k) => cloudRecord(h, raw, k)),
    );
  },
  async save(tx, value, base, today) {
    const { id, k } = cloudOf(value.code);
    const show = (await adminKbOwnShows(tx)).find((h) => h.id === id);
    if (!show) return base ? CHANGED : fail('kbadm.io.err.show_none', { id });
    if (base && !(k >= 0 && k < show.items.length)) return CHANGED;
    const d = value.data;
    const text = { t: str(d.t), x: str(d.x), common: d.common === true };
    const items = keepItems(show).map((p, i) =>
      i === k && p.t !== undefined ? { ...p, ...text } : p,
    );
    if (!base) items.push(text);
    const saved = await adminKbShowSave(
      tx,
      show.step,
      { active: value.active, items },
      show.version,
    );
    if (!saved.ok) {
      return saved.reason === 'invalid' ? fail(`kbadm.err.${saved.problem}`) : CHANGED;
    }
    const code = base ? value.code : `${id}#${items.length}`;
    const record = (await this.records(tx, today)).find((r) => r.code === code);
    return record ? { ok: true, record } : CHANGED;
  },
  async remove(tx, record) {
    const { id, k } = cloudOf(record.code);
    const show = (await adminKbOwnShows(tx)).find((h) => h.id === id);
    if (!show || k < 0 || k >= show.items.length) return { ok: true };
    const items = keepItems(show).filter((_, i) => i !== k);
    const saved = await adminKbShowSave(
      tx,
      show.step,
      { active: show.active, items },
      show.version,
    );
    return saved.ok ? { ok: true } : CHANGED;
  },
};

/* ───────────── Статьи ───────────── */

const articleRecord = (a: AdminKbArticle): IoRecord => ({
  code: a.id,
  name: a.t,
  active: a.active,
  data: { sec: a.sec, mod: a.mod, perm: a.perm, aud: a.aud, html: a.html },
  version: a.version,
});

/** Статьи Базы знаний (прототип DX.kbarts): новая строка — статья с кодом из файла. */
const articlesWriter: SectionWriter = {
  async records(tx) {
    return (await adminKbArticles(tx)).map(articleRecord);
  },
  async save(tx, value, base) {
    const now = (await adminKbArticles(tx)).find((a) => a.id === value.code);
    if (base ? !now : now) return CHANGED;
    const d = value.data;
    const input = {
      sec: str(d.sec).trim(),
      t: value.name.trim(),
      mod: str(d.mod),
      perm: str(d.perm),
      aud: str(d.aud) as KbArticleAudience,
      active: value.active,
      html: str(d.html),
    };
    const problem = firstProblem(
      'kbarts',
      kbArticleProblems(input),
      (p) => `kbadm.err.${p}` as UiTextKey,
    );
    if (problem) return problem;
    const saved = now
      ? await adminKbArticleSave(tx, now.id, input, now.version)
      : await adminKbArticleSave(tx, null, input, 0, value.code);
    return saved.ok ? { ok: true, record: articleRecord(saved.value) } : CHANGED;
  },
  async remove(tx, record) {
    const removed = await adminKbArticleRemove(tx, record.code);
    return removed.ok || removed.reason === 'not_found' ? { ok: true } : CHANGED;
  },
};

/* ───────────── Новости ───────────── */

/**
 * Новость в файле (прототип DX.kbnews). Состояние (черновик, опубликована, снята) в файле не меняется,
 * но входит в значение: откат не удалит новость, которую после загрузки опубликовали.
 */
const newsRecord = (n: NewsRecord): IoRecord => ({
  code: n.id,
  name: n.title,
  active: true,
  data: {
    type: n.type,
    release: n.release ?? '',
    date: n.date,
    aud: n.audience,
    pinned: n.pinned,
    showOnLogin: n.showOnLogin,
    short: n.short,
    md: n.md,
    status: n.status,
    off: n.off,
  },
  version: n.version,
});

/** Поле проверки новости → столбец файла. */
const NEWS_COLUMN: Readonly<Record<string, string>> = { version: 'release' };

/**
 * Новости (прототип DX.kbnews): новая строка — черновик с кодом из файла; правка опубликованной — с
 * отметкой «Изменено», как в окне; ссылка «Подробнее» сохраняется. Проверка — окна новости.
 */
const newsWriter: SectionWriter = {
  async records(tx) {
    return (await allNewsForAdmin(tx)).map(newsRecord);
  },
  async save(tx, value, base) {
    const now = await getNews(tx, value.code);
    if (base ? !now : now) return CHANGED;
    const d = value.data;
    const input: NewsInput = {
      title: value.name.trim(),
      type: str(d.type) as NewsType,
      release: str(d.release).trim() || null,
      date: str(d.date) as IsoDate,
      short: str(d.short).trim(),
      md: newsMdTrim(str(d.md)),
      link: now?.link ?? null,
      pinned: d.pinned === true,
      showOnLogin: d.showOnLogin === true,
      audience: str(d.aud) as NewsAudience,
    };
    const problem = firstProblem(
      'kbnews',
      newsProblems(
        {
          title: input.title,
          type: input.type,
          version: input.release ?? '',
          date: input.date,
          short: input.short,
          md: str(d.md),
        },
        { publish: now?.status === 'published' },
      ),
      (p) => `err.${p}` as UiTextKey,
      (f) => NEWS_COLUMN[f] ?? f,
    );
    if (problem) return problem;
    if (!now) {
      const created = await createNews(tx, input, { publish: false, id: value.code });
      return { ok: true, record: newsRecord(created) };
    }
    const saved = await saveNews(tx, now.id, now.version, input, { publish: false });
    return saved.ok ? { ok: true, record: newsRecord(saved.record) } : CHANGED;
  },
  async remove(tx, record) {
    const now = await getNews(tx, record.code);
    if (!now) return { ok: true };
    const deleted = await deleteNewsDraft(tx, now.id, now.version);
    return deleted.ok || deleted.reason === 'not_found' ? { ok: true } : CHANGED;
  },
};

export const KB_SECTION_WRITERS: Readonly<Record<KbIoDict, SectionWriter>> = {
  kbsteps: stepsWriter,
  kbshows: showsWriter,
  kbarts: articlesWriter,
  kbnews: newsWriter,
};
