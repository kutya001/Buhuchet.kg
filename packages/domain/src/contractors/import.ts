import type { Translate, UiTextKey } from '../l10n/texts';
import { phoneProblem, type PhoneCode } from '../staff/rules';
import { CONTRACTOR_TEXT_MAX, innProblem } from './rules';
import type { SocfundFlag, SocfundFlags } from './socfund';

/*
 * Загрузка контрагентов вставкой из Excel (задача 2.16; ТЗ «Контрагенты» → «Загрузка текущих
 * контрагентов при переходе на систему»; прототип modules/contractor-import.js — IMP_COLS, importDlg:
 * parse, check, parsePh, findEmp, findType). Строки вставки разбираются здесь и на экране, и на сервере;
 * проверки, которым нужны справочники платформы и данные организации, получают их параметром. Подбор
 * отчётов для пустой колонки «Виды отчётов» и вопросы о праве на режим по ГКЭД считает сервер — по тем
 * же справочникам, что окно «Подбор отчётов».
 */

/** Колонки по порядку шаблона и выбора колонки (прототип IMP_COLS); `skip` — «— не загружать —». */
export const CP_IMPORT_COLUMNS = [
  'name',
  'inn',
  'phone',
  'types',
  'fee',
  'resp',
  'form',
  'gked',
  'gked2',
  'regime',
  'ugns',
  'head',
  'contact',
  'note',
  'sfc',
  'sfr',
  'sfp',
  'sfg',
  'skip',
] as const;
export type CpImportColumn = (typeof CP_IMPORT_COLUMNS)[number];
export type CpImportField = Exclude<CpImportColumn, 'skip'>;

/** Колонки шаблона без «— не загружать —». */
export const CP_IMPORT_FIELDS = CP_IMPORT_COLUMNS.filter((c): c is CpImportField => c !== 'skip');

/** До 500 строк за одну загрузку (ТЗ «Ограничение»; прототип: `slice(0,500)`). */
export const CP_IMPORT_MAX_ROWS = 500;
/** Колонок во вставке — не больше, чем бывает в шаблоне с запасом. */
export const CP_IMPORT_MAX_COLUMNS = 60;
/**
 * Длина ячейки, которую принимает сервер: самое длинное поле (примечание) и ещё один знак — чтобы строка
 * получила ошибку «длиннее N знаков», а не весь запрос — отказ. Окно обрезает ячейки до этой длины
 * только в запросе (`importRequestRows`); в таблице окна текст остаётся как вставлен.
 */
export const CP_IMPORT_CELL_MAX = CONTRACTOR_TEXT_MAX.note + 1;

/** Как прототип сравнивает тексты (ui/grid.js `norm`): строчными, «ё» как «е», неразрывный пробел как обычный. */
export const importNorm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\u00a0/g, ' ');

/** Заголовки колонок, по которым программа сама находит колонку (прототип IMP_COLS, третье поле). */
const HEADERS: Record<CpImportField, readonly string[]> = {
  name: ['название', 'наименование', 'контрагент', 'компания'],
  inn: ['инн'],
  phone: ['телефон', 'тел', 'номер'],
  types: ['отчёты', 'отчеты', 'виды отчётов', 'виды отчетов', 'отчет'],
  fee: ['стоимость', 'обслуживание', 'тариф', 'ставка'],
  resp: ['ответственный', 'бухгалтер', 'сотрудник'],
  form: ['форма', 'форма собственности'],
  gked: ['основной гкэд', 'основной вид деятельности', 'гкэд'],
  gked2: ['дополнительные гкэд', 'дополнительные виды деятельности', 'доп. гкэд'],
  regime: ['режим', 'режим налогообложения'],
  ugns: ['угнс', 'налоговый орган', 'код угнс', 'гнс'],
  head: ['руководитель', 'директор'],
  contact: ['контакт', 'контактное лицо'],
  note: ['примечание', 'комментарий'],
  sfc: ['зарплата безналично', 'безналичная зарплата', 'зарплата'],
  sfr: ['реестр в салык.кг', 'реестр работников', 'реестр'],
  sfp: ['подтверждён гнс', 'подтвержден гнс', 'тариф подтверждён'],
  sfg: ['госфинансирование', 'бюджет'],
};

/** Колонка по заголовку: первая, у которой заголовок совпал или начинается так же. */
export function importColumnOf(header: string): CpImportField | null {
  const n = importNorm(header);
  return (
    CP_IMPORT_FIELDS.find((c) =>
      HEADERS[c].some((k) => {
        const key = importNorm(k);
        return n === key || n.startsWith(key);
      }),
    ) ?? null
  );
}

/** Вставка, разобранная на строки и ячейки. */
export interface CpImportTable {
  delimiter: '\t' | ';';
  /** Первая строка — заголовки (найдены хотя бы две колонки). */
  hasHeader: boolean;
  /** Что означает каждая колонка вставки. */
  map: CpImportColumn[];
  rows: string[][];
}

/**
 * Разбор вставки (прототип importDlg `parse`): пустые строки пропускаются; разделитель — табуляция, если
 * она есть в первой строке, иначе точка с запятой; первая строка — заголовки, если по ней нашлись хотя бы
 * две колонки, иначе колонки идут по порядку шаблона. null — вставлять нечего.
 */
export function parseImportText(text: string): CpImportTable | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return null;
  const delimiter = lines[0]!.includes('\t') ? '\t' : ';';
  const cells = lines.map((l) => l.split(delimiter).map((x) => x.trim()));
  const head = cells[0]!.map(importColumnOf);
  const hasHeader = head.filter(Boolean).length >= 2;
  const map: CpImportColumn[] = (
    hasHeader
      ? head.map((h) => h ?? 'skip')
      : cells[0]!.map((_, i) => CP_IMPORT_COLUMNS[i] ?? 'skip')
  ).slice(0, CP_IMPORT_MAX_COLUMNS);
  const body = hasHeader ? cells.slice(1) : cells;
  return { delimiter, hasHeader, map, rows: body.slice(0, CP_IMPORT_MAX_ROWS) };
}

/**
 * Строки вставки для запроса «Проверить» и «ОК»: ячейки только под колонками таблицы (лишние справа ни во
 * что не загружаются), недостающие — пустые, каждая не длиннее `CP_IMPORT_CELL_MAX`.
 */
export function importRequestRows(
  map: readonly CpImportColumn[],
  rows: readonly (readonly string[])[],
): string[][] {
  return rows.map((cells) => map.map((_, i) => (cells[i] ?? '').slice(0, CP_IMPORT_CELL_MAX)));
}

/** Значения строки по колонкам (прототип: `v[k] = cells[i] || ''`; у повторённой колонки — последняя). */
export function importValues(
  map: readonly CpImportColumn[],
  cells: readonly string[],
): Record<CpImportField, string> {
  const v = Object.fromEntries(CP_IMPORT_FIELDS.map((k) => [k, ''])) as Record<
    CpImportField,
    string
  >;
  map.forEach((k, i) => {
    if (k !== 'skip') v[k] = (cells[i] ?? '').trim();
  });
  return v;
}

/**
 * Телефон из ячейки (ТЗ: «номер с кодом страны из справочника распознаётся сам; номер без кода считается
 * кыргызским +996»; прототип parsePh): 9 цифр и 10 цифр с ведущим 0 — кыргызский номер без кода; дальше —
 * код страны из справочника и число цифр по его маске.
 */
export function importPhone(
  raw: string,
  codes: readonly PhoneCode[],
): { phone: string } | { problem: 'missing' | 'length' } {
  let d = raw.replace(/\D/g, '');
  if (!d) return { problem: 'missing' };
  if (d.length === 9) d = `996${d}`;
  else if (d.length === 10 && d.startsWith('0')) d = `996${d.slice(1)}`;
  const phone = `+${d}`;
  return phoneProblem(phone, codes) ? { problem: 'length' } : { phone };
}

/**
 * Стоимость обслуживания из ячейки (прототип parseNum): пробелы убираются, запятая — дробная часть;
 * в тыйынах. null — не число или меньше нуля.
 */
export function importFee(raw: string): number | null {
  const s = raw.replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!s || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  const tyiyn = Math.round(n * 100);
  return Number.isSafeInteger(tyiyn) ? tyiyn : null;
}

/** Колонки «Да / Нет» для тарифа Соцфонда и их признаки (прототип: sfc, sfr, sfp, sfg). */
export const IMPORT_SOCFUND_COLUMNS: readonly (readonly [CpImportField, SocfundFlag])[] = [
  ['sfc', 'cashless'],
  ['sfr', 'registry'],
  ['sfp', 'confirmed'],
  ['sfg', 'gov'],
];

const YES = ['да', 'yes', '1', 'true'];
const NO = ['нет', 'no', '0', 'false'];

/** Справочники и данные организации для проверки строк. Значения справочников — только действующие. */
export interface CpImportDicts {
  phoneCodes: readonly PhoneCode[];
  /** ИНН, которые уже есть у контрагентов организации (и в архиве). */
  takenInns: ReadonlySet<string>;
  /** Действующие сотрудники. */
  employees: readonly { id: string; login: string; shortName: string; fullName: string }[];
  /** Виды, подключённые в организации и не отключённые в каталоге. */
  types: readonly { code: string; name: string; shortName: string }[];
  offices: readonly { code: string; gnsCode: string | null; name: string; shortName: string }[];
  regimes: readonly { code: string; name: string }[];
  forms: readonly { code: string; name: string }[];
  /** Коды ГКЭД из вставки, которые есть в справочнике. */
  gked: ReadonlyMap<string, { level: string; active: boolean }>;
  /** Видит плату за обслуживание: колонка стоимости загружается и обязательна. */
  fee: boolean;
}

/** Что создаст строка без ошибок. */
export interface CpImportDraft {
  name: string;
  inn: string;
  phone: string;
  /** Виды отчётов из ячейки по порядку, без повторов; пусто — подберёт сервер. */
  typeCodes: string[];
  /** Стоимость обслуживания в месяц, тыйыны; null — колонка не загружается. */
  fee: number | null;
  responsibleEmployeeId: string | null;
  formCode: string | null;
  regimeCode: string | null;
  gked: string | null;
  gkedExtra: string[];
  taxOfficeCode: string | null;
  head: string;
  contact: string;
  note: string;
  socfund: SocfundFlags;
}

export interface CpImportRowCheck {
  errors: string[];
  warnings: string[];
  draft: CpImportDraft;
}

/** Форма собственности пустой ячейки: по началу названия («ИП …» → «ИП», иначе «ОсОО»). */
const defaultFormName = (name: string) => (name.startsWith('ИП') ? 'ИП' : 'ОсОО');

/**
 * Проверка строк (ТЗ «Что проверяется»; прототип importDlg `check`) — ошибки и предупреждения словами по
 * порядку прототипа. ИНН повторяется в списке — по строкам выше. Ответственный обязателен (в прототипе
 * пустая ячейка находила первого сотрудника — docs/deviations.md п. А-9); длина текстов — пределы базы.
 */
export function checkImportRows(
  map: readonly CpImportColumn[],
  rows: readonly (readonly string[])[],
  dicts: CpImportDicts,
  t: Translate,
): CpImportRowCheck[] {
  const seen = new Set<string>();
  return rows.map((cells) => {
    const v = importValues(map, cells);
    const errors: string[] = [];
    const warnings: string[] = [];
    const err = (key: UiTextKey, params?: Record<string, string | number>) =>
      errors.push(t(key, params));
    const tooLong = (field: CpImportField, max: number) => {
      if (v[field].length > max)
        err('cp.import.err.too_long', { col: t(`cp.import.col.${field}`), max });
    };

    if (!v.name) err('cp.import.err.name');
    tooLong('name', CONTRACTOR_TEXT_MAX.name);

    const inn = innProblem(v.inn);
    if (inn === 'inn_format') err('cp.import.err.inn_format');
    else if (inn === 'inn_start') err('cp.import.err.inn_start');
    else if (dicts.takenInns.has(v.inn)) err('cp.import.err.inn_taken');
    else if (seen.has(v.inn)) err('cp.import.err.inn_repeat');
    seen.add(v.inn);

    const ph = importPhone(v.phone, dicts.phoneCodes);
    if ('problem' in ph)
      err(ph.problem === 'missing' ? 'cp.import.err.phone' : 'cp.import.err.phone_length');

    const names = v.types
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const typeCodes: string[] = [];
    for (const n of names) {
      const q = importNorm(n).replace(/\.$/, '');
      const type = dicts.types.find(
        (x) =>
          importNorm(x.shortName).replace(/\.$/, '') === q ||
          importNorm(x.name) === q ||
          importNorm(x.code) === q,
      );
      if (!type) err('cp.import.err.type', { name: n });
      else if (!typeCodes.includes(type.code)) typeCodes.push(type.code);
    }

    const fee = dicts.fee ? importFee(v.fee) : null;
    if (dicts.fee && fee === null) err('cp.import.err.fee');

    const ug = v.ugns;
    const ugCode = ug.replace(/\D/g, '').padStart(3, '0');
    const office = ug
      ? dicts.offices.find(
          (x) =>
            (!!x.gnsCode && x.gnsCode === ugCode) ||
            x.code === ug ||
            importNorm(x.shortName) === importNorm(ug) ||
            importNorm(x.name) === importNorm(ug),
        )
      : undefined;
    if (ug && !office) err('cp.import.err.ugns', { name: ug });

    const q = importNorm(v.resp).replace(/\./g, '').trim();
    const emp = q
      ? dicts.employees.find(
          (e) =>
            importNorm(e.login) === q ||
            importNorm(e.login) === importNorm(v.resp).trim() ||
            importNorm(e.shortName).replace(/\./g, '') === q ||
            importNorm(e.fullName) === q ||
            importNorm(e.fullName).startsWith(q),
        )
      : undefined;
    if (!q) err('cp.import.err.resp_missing');
    else if (!emp) err('cp.import.err.resp', { name: v.resp });

    let gked: string | null = null;
    const gk = v.gked;
    const node = gk ? dicts.gked.get(gk) : undefined;
    if (!gk) warnings.push(t('cp.import.warn.no_gked'));
    else if (!node) err('cp.import.err.gked', { code: gk });
    else if (node.level !== 'subclass') err('cp.import.err.gked_level', { code: gk });
    else if (!node.active) err('cp.import.err.gked_inactive', { code: gk });
    else gked = gk;

    const extra = v.gked2
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);
    const gkedExtra: string[] = [];
    for (const k of extra) {
      const x = dicts.gked.get(k);
      if (!x) err('cp.import.err.gked', { code: k });
      else if (x.level !== 'subclass') err('cp.import.err.gked2_level', { code: k });
      else if (!x.active) err('cp.import.err.gked_inactive', { code: k });
      else if (k !== gked && !gkedExtra.includes(k)) gkedExtra.push(k);
    }

    const socfund: SocfundFlags = {};
    for (const [col, flag] of IMPORT_SOCFUND_COLUMNS) {
      const x = importNorm(v[col]).trim();
      if (!x) continue;
      if (YES.includes(x)) socfund[flag] = true;
      else if (NO.includes(x)) socfund[flag] = false;
      else err('cp.import.err.flag', { col: t(`cp.import.col.${col}`) });
    }

    const regime = v.regime ? dicts.regimes.find((x) => x.name === v.regime) : undefined;
    if (v.regime && !regime) err('cp.import.err.regime');
    const formName = v.form || defaultFormName(v.name);
    const form = dicts.forms.find((x) => x.name === formName);
    if (!form) err('cp.import.err.form');

    tooLong('head', CONTRACTOR_TEXT_MAX.person);
    tooLong('contact', CONTRACTOR_TEXT_MAX.person);
    tooLong('note', CONTRACTOR_TEXT_MAX.note);

    return {
      errors,
      warnings,
      draft: {
        name: v.name,
        inn: v.inn,
        phone: 'phone' in ph ? ph.phone : '',
        typeCodes,
        fee,
        responsibleEmployeeId: emp?.id ?? null,
        formCode: form?.code ?? null,
        regimeCode: regime?.code ?? null,
        gked,
        gkedExtra,
        taxOfficeCode: office?.code ?? null,
        head: v.head,
        contact: v.contact,
        note: v.note,
        socfund,
      },
    };
  });
}

/** Сколько строк готово к загрузке: проверены и без ошибок. */
export const importReady = (rows: readonly { errors: readonly string[] }[]) =>
  rows.filter((r) => !r.errors.length).length;
