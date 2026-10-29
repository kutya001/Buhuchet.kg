import {
  KB_HOWS,
  KB_KNOWN_BATCH,
  KB_KNOWN_KEY_MAX,
  KB_SHOW_AUTOS,
  kbKnownKeyOk,
  kbScreenOk,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, Uuid } from './common';
import { listPageSchema } from './list';

/*
 * «База знаний» (ТЗ «База знаний», задача 2.30, docs/decisions.md п. Г-2): программа обучения
 * пользователя, уровень, статьи и уровни сотрудников.
 */

/** Код шага или статьи из refDB.json (`kbSteps`, `kbArticles`). */
export const KbCode = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

/** Как засчитан шаг: действием, действием раньше, показом, статьёй, первым использованием, экраном. */
export const KbHowSchema = z.enum(KB_HOWS);

/** Шаг урока (прототип modules/kb.js, строка урока). */
export const KbStep = z.object({
  id: KbCode,
  title: z.string(),
  /** Зачем это нужно — подсказка под шагом. */
  why: z.string(),
  /** ★ — основной шаг: без него организация не может работать. */
  star: z.boolean(),
  /** «Посмотреть» (true) или «Сделать». */
  learn: z.boolean(),
  /** «Новое»: добавлен позже или его функция недавно включена. */
  isNew: z.boolean(),
  /** Модуль шага: «Перейти» ведёт в него. */
  module: z.string().nullable(),
  /** Экраны шага «Посмотреть» («модуль.вкладка»): после «Перейти» — 3 секунды на одном из них. */
  screens: z.array(z.string()),
  /** Статья шага (своя или его модуля); null — нет. */
  articleId: KbCode.nullable(),
  /** Засчитан: как и когда; null — нет. */
  done: z.object({ how: KbHowSchema, at: z.iso.datetime() }).nullable(),
  /** «Пропустить»: серый, в уровень не засчитывается. */
  skipped: z.boolean(),
});
export type KbStep = z.infer<typeof KbStep>;

/** Урок — группа шагов модуля. */
export const KbLesson = z.object({
  id: z.string(),
  title: z.string(),
  /** Экран для «Показать экран» («модуль.вкладка»); null — нет. */
  screen: z.string().nullable(),
  /** «Пройден» (все шаги выполнены, `doneAt` — последний) или «Пройден частично». */
  status: z.enum(['done', 'partial']).nullable(),
  doneAt: z.iso.datetime().nullable(),
  steps: z.array(KbStep),
});
export type KbLesson = z.infer<typeof KbLesson>;

/** Уровень программы: название, порог в процентах и когда получен (null — ещё не получен). */
export const KbLevel = z.object({
  name: z.string(),
  percent: z.number().int(),
  reachedAt: z.iso.datetime().nullable(),
});
export type KbLevel = z.infer<typeof KbLevel>;

/** Уровень и прогресс (прототип kbStat). */
export const KbProgress = z.object({
  /** Шагов в программе и выполнено. */
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  /** Процент вниз до целого. */
  pct: z.number().int().min(0).max(100),
  /** Текущий уровень — номер в `levels` (не ниже полученного раньше). */
  level: z.number().int().nonnegative(),
  /** Следующий уровень; null — высший. */
  next: z.number().int().nullable(),
  /** Шагов до следующего уровня. */
  need: z.number().int().nonnegative(),
  stars: z.object({ done: z.number().int(), total: z.number().int() }),
  /** Прогресс по модулям. */
  groups: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      done: z.number().int(),
      total: z.number().int(),
    }),
  ),
  levels: z.array(KbLevel),
});
export type KbProgress = z.infer<typeof KbProgress>;

/** Своя программа обучения: уровень, уроки, следующий шаг, статьи, «Можно включить». */
export const KbState = z.object({
  /** Программа администратора платформы. */
  admin: z.boolean(),
  progress: KbProgress,
  lessons: z.array(KbLesson),
  /** «Продолжить»: первый не выполненный и не пропущенный шаг. */
  nextStepId: KbCode.nullable(),
  /** Прочитано статей из видимых. */
  articles: z.object({ total: z.number().int(), read: z.number().int() }),
  /** «Можно включить»: выключенные функции, у которых есть уроки, и польза от них. */
  offers: z.array(z.object({ feature: z.string(), benefit: z.string() })),
  /** Урок функции учётной политики в программе («Пройти урок» в окне «Функция … включена»). */
  featureLessons: z.record(z.string(), KbCode),
});
export type KbState = z.infer<typeof KbState>;

/** Только что засчитанный шаг: «Готово: шаг выполнен» или уведомление. */
export const KbFreshStep = z.object({
  id: KbCode,
  title: z.string(),
  learn: z.boolean(),
  how: KbHowSchema,
});
export type KbFreshStep = z.infer<typeof KbFreshStep>;

/** Ответ на отметку: программа после неё, новые шаги и новый уровень («Новый уровень: …»). */
export const KbMarkResult = z.object({
  state: KbState,
  fresh: z.array(KbFreshStep),
  /** Название нового уровня; null — уровень не изменился. */
  congrats: z.string().nullable(),
});
export type KbMarkResult = z.infer<typeof KbMarkResult>;

/**
 * Сверить шаги «Сделать» с историей своих действий: `saved` — после сохранения (недавние действия
 * засчитываются «действием»), `open` — при входе.
 */
export const KbSyncRequest = z.object({ reason: z.enum(['open', 'saved']) });
export type KbSyncRequest = z.infer<typeof KbSyncRequest>;

/** Первое использование функции (поиск, столбцы, группировка, «В Excel», свайп, тема…). */
export const KbHit = z.string().regex(/^[a-z][a-z0-9.]{0,31}$/);

/* ───────────── Статьи ───────────── */

/** Статья в списке: текст без разметки — для поиска и отрывка. */
export const KbArticleItem = z.object({
  id: KbCode,
  section: z.string(),
  title: z.string(),
  module: z.string().nullable(),
  text: z.string(),
  read: z.boolean(),
});
export type KbArticleItem = z.infer<typeof KbArticleItem>;

export const KbArticleList = z.object({ items: z.array(KbArticleItem) });
export type KbArticleList = z.infer<typeof KbArticleList>;

const KbInline = z.array(z.object({ text: z.string(), bold: z.literal(true).optional() }));

/** Блок статьи: заголовок, абзац, цитата, список (пункты с глубиной) или описание экрана модуля. */
export const KbBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['h4', 'h5', 'p', 'quote']), inline: KbInline }),
  z.object({
    type: z.literal('list'),
    items: z.array(
      z.object({ depth: z.number().int().nonnegative(), ordered: z.boolean(), inline: KbInline }),
    ),
  }),
  z.object({ type: z.literal('screen'), module: z.string() }),
]);

/** Описание экрана модуля из `kbUi`: подписи вкладок, элементы и формы с полями. */
export const KbScreen = z.object({
  tabs: z.record(z.string(), z.string()),
  items: z.array(
    z.object({ kind: z.enum(['el', 'plate', 'button']), name: z.string(), text: z.string() }),
  ),
  forms: z.array(
    z.object({
      title: z.string(),
      text: z.string(),
      fields: z.array(z.object({ name: z.string(), required: z.boolean(), text: z.string() })),
    }),
  ),
});

/** Статья целиком: блоки и описания экранов модулей, на которые она ссылается. */
export const KbArticle = z.object({
  id: KbCode,
  section: z.string(),
  title: z.string(),
  module: z.string().nullable(),
  read: z.boolean(),
  blocks: z.array(KbBlockSchema),
  screens: z.record(z.string(), KbScreen),
});
export type KbArticle = z.infer<typeof KbArticle>;

/** Статья прочитана; `stepId` — шаг, из которого её открыли (его «Посмотреть» засчитается). */
export const KbArticleReadRequest = z.object({ stepId: KbCode.optional() });

export const KbArticleReadResult = KbMarkResult.extend({
  /** Прочитана впервые. */
  first: z.boolean(),
});
export type KbArticleReadResult = z.infer<typeof KbArticleReadResult>;

/* ───────────── Уровни сотрудников ───────────── */

/** Сотрудник в «Уровнях сотрудников» (прототип modules/kb.js, вкладка team). */
export const KbTeamMember = z.object({
  id: Uuid,
  fullName: z.string(),
  role: z.string(),
  active: z.boolean(),
  /** Номер уровня и название. */
  level: z.number().int().nonnegative(),
  levelName: z.string(),
  /** Уровней в лесенке — «Уровень знаний 2 из 5». */
  of: z.number().int(),
  pct: z.number().int(),
  done: z.number().int(),
  total: z.number().int(),
  /** Дата последнего полученного уровня (по Бишкеку); null — уровней ещё нет. */
  levelAt: IsoDate.nullable(),
});
export type KbTeamMember = z.infer<typeof KbTeamMember>;

export const KbTeamList = listPageSchema(KbTeamMember);
export type KbTeamList = z.infer<typeof KbTeamList>;

/** Уровень знаний сотрудника: карточка, окно «Прогресс по модулям». */
export const KbMemberProgress = z.object({
  employeeId: Uuid,
  fullName: z.string(),
  role: z.string(),
  progress: KbProgress,
});
export type KbMemberProgress = z.infer<typeof KbMemberProgress>;

/** Уровень знаний в строке списка сотрудников. */
export const KbLevelBadge = z.object({
  level: z.number().int().nonnegative(),
  name: z.string(),
  pct: z.number().int(),
  of: z.number().int(),
});
export type KbLevelBadge = z.infer<typeof KbLevelBadge>;

/* ───────────── «Показать как» и «Обзор экрана» ───────────── */

/** Действие перед облачком: `row`, `menu`, `cols`… или `{ tab }`, `{ click, in, pop }`, `{ row }`. */
export const KbShowAction = z.union([
  z.string(),
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
]);

/** Облачко сценария (refDB `kbShows[].items`). */
export const KbShowItem = z.object({
  s: z.string().nullable().optional(),
  m: z.string().nullable().optional(),
  t: z.string().optional(),
  x: z.string().optional(),
  in: z.string().optional(),
  txt: z.string().optional(),
  up: z.string().optional(),
  ctx: z.string().optional(),
  pre: z.array(KbShowAction).optional(),
  sub: z.array(KbShowAction).optional(),
  auto: z.enum(KB_SHOW_AUTOS).optional(),
  common: z.boolean().optional(),
  noBody: z.boolean().optional(),
});

/** Сценарий «Показать как» шага. */
export const KbShow = z.object({
  id: KbCode,
  step: KbCode,
  scr: z.string().optional(),
  items: z.array(KbShowItem),
  doit: z.array(KbShowAction).optional(),
  active: z.boolean().optional(),
});
export type KbShow = z.infer<typeof KbShow>;

const KbDict = z.record(z.string(), z.string()).optional();

/** Тексты облачков (refDB `kbUi`): служебные, модулей, вкладок, кнопок, плашек, полей, элементов. */
export const KbShowUi = z.object({
  ui: KbDict,
  plateMode: KbDict,
  mods: KbDict,
  tabs: KbDict,
  add: KbDict,
  addItems: KbDict,
  plates: KbDict,
  boxes: KbDict,
  ctabs: KbDict,
  cards: KbDict,
  buttons: KbDict,
  acts: KbDict,
  forms: KbDict,
  rows: KbDict,
  fields: z
    .record(
      z.string(),
      z.object({
        n: z.string().optional(),
        req: z.union([z.boolean(), z.number()]).optional(),
        x: z.string().optional(),
      }),
    )
    .optional(),
  /** Особые элементы экранов: где («модуль» или «модуль.вкладка», `*` — везде) и в каком месте обзора. */
  els: z
    .array(
      z.object({
        id: z.string(),
        scr: z.string(),
        s: z.string().nullable().optional(),
        m: z.string().nullable().optional(),
        in: z.string().optional(),
        txt: z.string().optional(),
        up: z.string().optional(),
        t: z.string(),
        x: z.string().optional(),
        at: z.string().optional(),
      }),
    )
    .optional(),
});
export type KbShowUi = z.infer<typeof KbShowUi>;

/** Сценарии и тексты для показов. */
export const KbShowContent = z.object({ ui: KbShowUi, shows: z.array(KbShow) });
export type KbShowContent = z.infer<typeof KbShowContent>;

/** Ключ знакомого элемента (`kbKnownKey` из @buhuchet/domain). */
export const KbKnownKey = z
  .string()
  .max(KB_KNOWN_KEY_MAX)
  .refine(kbKnownKeyOk, { message: 'Неверный ключ элемента' });

/** Свои знакомые элементы: ключи и предел. */
export const KbKnownList = z.object({
  keys: z.array(z.string()),
  limit: z.number().int(),
});
export type KbKnownList = z.infer<typeof KbKnownList>;

/** Запомнить знакомые элементы (ушёл с облачка «Далее» или «Готово»). */
export const KbKnownAddRequest = z.object({
  keys: z.array(KbKnownKey).min(1).max(KB_KNOWN_BATCH),
});

/** Сколько знакомых элементов теперь; у «Показывать всё заново» — и сколько было забыто. */
export const KbKnownCount = z.object({
  count: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative().optional(),
});
export type KbKnownCount = z.infer<typeof KbKnownCount>;

/** «Обзор экрана» пройден до конца: экран «модуль» или «модуль.вкладка». */
export const KbScreenShowRequest = z.object({
  screen: z.string().refine(kbScreenOk, { message: 'Неверный экран' }),
});
