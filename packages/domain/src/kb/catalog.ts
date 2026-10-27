/*
 * Содержимое «Базы знаний» (ТЗ «База знаний», «Админка → База знаний (содержимое)»): шаги уроков,
 * группы, уровни и статьи. До Админки (задача 2.39) оно берётся из refDB.json — разделы `kbSteps`,
 * `kbGroups`, `kbLevels`, `kbArticles`, `kbUi` в `platform_reference`; здесь — их форма.
 */

/** Шаг урока (refDB `kbSteps`, прототип modules/kb-lessons.js, Step). */
export interface KbStepDef {
  id: string;
  /** Название шага. */
  t: string;
  /** Одна строка «зачем это нужно». */
  w?: string;
  /** Основной шаг «★»: без него организация не может работать. */
  star?: boolean | number;
  /** Вид «Посмотреть»; иначе — «Сделать». */
  learn?: boolean | number;
  /** Право, без которого шага нет в программе; пусто — шаг виден всем. */
  perm?: string;
  /** Функция учётной политики, без которой шага нет; пусто — не зависит от функций. */
  featk?: string;
  /** Группа шага — урок модуля (`kbGroups`). */
  g: string;
  /** Порядок в группе. */
  ord: number;
  /** false — шаг выключен администратором. */
  active?: boolean;
  /** Условие отметки (`KB_EV` прототипа): событие, `open`, `use`, `state`. */
  evk?: string;
  /** Экраны шага «Посмотреть» («модуль.вкладка» или «модуль»): на них идёт таймер 3 секунды. */
  at?: string[];
  /** Функция, первое использование которой засчитывает шаг (`ckHit` прототипа). */
  hit?: string;
  /** Статья шага; без неё — статья его модуля. */
  art?: string;
  /** Добавлен администратором позже: «Новое», пока не выполнен. */
  isNew?: boolean;
}

/** Группа шагов — урок модуля (refDB `kbGroups`). */
export interface KbGroupDef {
  id: string;
  t: string;
  /** Экран «Обзора экрана» группы («модуль.вкладка»). */
  scr?: string;
  /** Группа программы администратора платформы. */
  adm?: boolean | number;
}

/** Уровень: название и процент выполненных шагов, с которого он даётся (refDB `kbLevels`). */
export interface KbLevelDef {
  n: string;
  p: number;
}

/** Статья (refDB `kbArticles`): HTML из небольшого набора тегов (`kbArticleBlocks`). */
export interface KbArticleDef {
  id: string;
  /** Раздел: «Общее», «Модули», «Работа с системой», «Админка». */
  sec: string;
  t: string;
  /** Модуль статьи: её видят те, у кого модуль в меню; она же — статья шагов модуля. */
  mod?: string | null;
  /** Кому: `all` — всем, `biz` — сотрудникам организаций, `adm` — администратору платформы. */
  aud?: string;
  perm?: string | null;
  feat?: string | null;
  active?: boolean;
  html: string;
}

/** Польза функции учётной политики для «Можно включить» и окна «Функция включена» (refDB `kbUi.features`). */
export interface KbFeatureInfo {
  benefit?: string;
  /** Статья о функции. */
  art?: string;
  /** Группа шагов (урок) функции — «Пройти урок». */
  g?: string;
}

/** Описание экрана для статей (refDB `kbUi`, прототип kbScreenHtml): только разделы, нужные статьям. */
export interface KbScreenUi {
  /** «модуль.вкладка» → что на вкладке. */
  tabs?: Readonly<Record<string, string>>;
  /** Модуль → ключи элементов экрана по порядку. */
  screens?: Readonly<Record<string, readonly string[]>>;
  els?: readonly { id: string; t: string; x?: string }[];
  plates?: Readonly<Record<string, string>>;
  buttons?: Readonly<Record<string, string>>;
  addItems?: Readonly<Record<string, string>>;
  artForms?: readonly { mod: string; t: string; x?: string; fields: readonly string[] }[];
  fields?: Readonly<Record<string, { n?: string; req?: boolean | number; x?: string }>>;
  features?: Readonly<Record<string, KbFeatureInfo>>;
}

/** Шаги, группы и уровни — всё, из чего строится программа обучения. */
export interface KbCatalog {
  steps: readonly KbStepDef[];
  groups: readonly KbGroupDef[];
  levels: { business: readonly KbLevelDef[]; admin: readonly KbLevelDef[] };
}

/** Флаг из refDB: там встречаются и `1`, и `true`. */
export const kbFlag = (value: boolean | number | undefined): boolean => value === true || value === 1;
