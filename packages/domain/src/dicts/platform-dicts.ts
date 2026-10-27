/*
 * «Справочники» → «Справочники платформы» глазами организации (ТЗ «Справочники платформы — только
 * просмотр», прототип modules/dict-guide.js `orgDictDefs`, `orgDictGroups`): плитки по группам из
 * раздела `dictGroups` справочников платформы, без служебных справочников администратора, и запрос
 * «Попросить добавить» (прототип modules/dicts.js `requestDlg`).
 */

/**
 * Справочники, которые видит организация, в порядке прототипа. «Ставки единого налога» — своя плитка
 * сразу после «Налогов и ставок», «Виды отчётов» ведут на вкладку «Виды отчётов».
 */
export const ORG_DICT_IDS = [
  'taxes',
  'en_rates',
  'types',
  'bases',
  'regimes',
  'benefits',
  'gked',
  'forms',
  'phones',
  'organs',
  'ugns',
  'banks',
  'calendar',
  'statuses',
  'cats',
  'templates',
] as const;
export type OrgDictId = (typeof ORG_DICT_IDS)[number];

export function isOrgDictId(value: string): value is OrgDictId {
  return (ORG_DICT_IDS as readonly string[]).includes(value);
}

/**
 * Справочник группы по полю `key` (первое слово: «taxes, enRates, …», «cats, reasons»). Служебных
 * справочников администратора («Шаблоны ролей», «Права ролей», «Загрузки», «Запросы») у организации нет
 * (ТЗ «Служебных справочников администратора у организации нет») — для них null.
 */
const ID_BY_KEY: Readonly<Record<string, OrgDictId>> = {
  taxes: 'taxes',
  reportTypes: 'types',
  bases: 'bases',
  regimes: 'regimes',
  benefits: 'benefits',
  gked: 'gked',
  forms: 'forms',
  phones: 'phones',
  organs: 'organs',
  ugns: 'ugns',
  banks: 'banks',
  calendar: 'calendar',
  statuses: 'statuses',
  cats: 'cats',
  waTemplates: 'templates',
};

export function orgDictIdOfKey(key: string): OrgDictId | null {
  const first = key.split(',')[0]?.trim() ?? '';
  return ID_BY_KEY[first] ?? null;
}

/** Группа справочников платформы (раздел `dictGroups`). */
export interface DictGroupDef {
  group: string;
  tabs: readonly { tab: string; key: string; about?: string; usedIn?: string }[];
}

/** Плитка справочника: название, число значений, «что это» и «где используется». */
export interface OrgDictTile {
  id: OrgDictId;
  tab: string;
  about: string;
  usedIn: string;
  count: number;
}

export interface OrgDictGroup {
  group: string;
  tabs: OrgDictTile[];
}

/**
 * Группы плиток для организации (прототип `orgDictGroups`): справочники групп по порядку, без
 * служебных; «Ставки единого налога» — после «Налогов и ставок» с названием и пояснениями `enRates`
 * (их в `dictGroups` нет); группа без плиток не показывается. `counts` — число значений справочника.
 */
export function orgDictGroups(
  groups: readonly DictGroupDef[],
  counts: Readonly<Record<OrgDictId, number>>,
  enRates: { tab: string; about: string; usedIn: string },
): OrgDictGroup[] {
  const seen = new Set<OrgDictId>();
  const tile = (id: OrgDictId, tab: string, about = '', usedIn = ''): OrgDictTile => {
    seen.add(id);
    return { id, tab, about, usedIn, count: counts[id] };
  };
  return groups
    .map((g) => ({
      group: g.group,
      tabs: g.tabs.flatMap((t) => {
        const id = orgDictIdOfKey(t.key);
        if (!id || seen.has(id)) return [];
        const own = tile(id, t.tab, t.about, t.usedIn);
        return id === 'taxes'
          ? [own, tile('en_rates', enRates.tab, enRates.about, enRates.usedIn)]
          : [own];
      }),
    }))
    .filter((g) => g.tabs.length);
}

/** «Для бухгалтера:» в начале пояснения режима не повторяется (прототип `accTxt`): подпись уже есть. */
export const regimeAccountantNote = (note: string) => note.replace(/^Для бухгалтера:\s*/, '');

/* ───────────── «Попросить добавить» ───────────── */

/**
 * В какой справочник просят добавить значение — как в окне прототипа: «Виды отчётов» и справочники
 * раздела `dictionaries` (режимы, формы, органы, льготы, банки, категории задач, причины изменения
 * срока, УГНС, основания).
 */
export const DICT_REQUEST_DICTS = [
  'types',
  'regimes',
  'forms',
  'organs',
  'benefits',
  'banks',
  'cats',
  'reasons',
  'ugns',
  'bases',
] as const;
export type DictRequestDict = (typeof DICT_REQUEST_DICTS)[number];

/** Статус запроса: «Новый», «Добавлено», «Отклонено» (рассматривает администратор платформы). */
export const DICT_REQUEST_STATUSES = ['new', 'added', 'rejected'] as const;
export type DictRequestStatus = (typeof DICT_REQUEST_STATUSES)[number];

/** «Что добавить» — не длиннее, «Комментарий» — не длиннее. */
export const DICT_REQUEST_WHAT_MAX = 300;
export const DICT_REQUEST_COMMENT_MAX = 2000;

/* ───────────── Окно справочника и «Поиск по всем значениям» ───────────── */

/** Справочник со своим окном значений: все, кроме «Видов отчётов» (плитка ведёт на их вкладку). */
export type OrgDictWindowId = Exclude<OrgDictId, 'types'>;

export const ORG_DICT_WINDOW_IDS = ORG_DICT_IDS.filter(
  (id): id is OrgDictWindowId => id !== 'types',
);

export function isOrgDictWindowId(value: string): value is OrgDictWindowId {
  return (ORG_DICT_WINDOW_IDS as readonly string[]).includes(value);
}

/** Тип столбца окна справочника: текст, значение из списка (фильтр-галочки) или дата. */
export type OrgDictColumnType = 'text' | 'enum' | 'date';

export interface OrgDictColumn {
  key: string;
  type: OrgDictColumnType;
}

const col = (key: string, type: OrgDictColumnType = 'text'): OrgDictColumn => ({ key, type });

/**
 * Столбцы окна справочника — как в прототипе (`orgDictDefs`); подпись — текст словаря
 * `dicts.platform.col.<справочник>.<ключ>`. Пояснение значения — в своём столбце («Для бухгалтера» у
 * режимов, «Что меняет в налогах» у форм, «Что это и что туда сдают» у органов, «Что означает» у
 * статусов, «Когда применяется» у ставок единого налога).
 */
export const ORG_DICT_COLUMNS: Readonly<Record<OrgDictWindowId, readonly OrgDictColumn[]>> = {
  taxes: [col('code'), col('name'), col('about'), col('period', 'enum')],
  en_rates: [col('code'), col('rate'), col('activity'), col('explain')],
  bases: [col('name'), col('desc')],
  regimes: [col('name'), col('full'), col('acc')],
  benefits: [col('name'), col('gives')],
  gked: [col('code'), col('name')],
  forms: [col('name'), col('full'), col('end', 'enum'), col('note')],
  phones: [col('name'), col('code'), col('mask')],
  organs: [col('name'), col('note'), col('contacts')],
  ugns: [col('code'), col('name'), col('city', 'enum')],
  banks: [col('name'), col('code')],
  calendar: [col('d', 'date'), col('name'), col('kind', 'enum')],
  statuses: [col('name'), col('note')],
  cats: [col('kind', 'enum'), col('code'), col('name')],
  templates: [col('name'), col('text')],
};

/**
 * Справочники в своём порядке, без сортировки по умолчанию (прототип `sort: null`): статусы — по шкале,
 * шаблоны — как в справочнике. Остальные — по первому столбцу (у календаря — по дате).
 */
export const ORG_DICT_NATURAL_ORDER: ReadonlySet<OrgDictWindowId> = new Set([
  'statuses',
  'templates',
]);

/**
 * Справочники «Поиска по всем значениям» (прототип: все справочники раздела `dictionaries`, коды стран
 * и календарь текущего года) — в столбце «Справочник» их полные названия.
 */
export const ALL_VALUES_DICTS = [
  'regimes',
  'forms',
  'organs',
  'benefits',
  'banks',
  'cats',
  'reasons',
  'ugns',
  'bases',
  'phones',
  'calendar',
] as const;
export type AllValuesDict = (typeof ALL_VALUES_DICTS)[number];
