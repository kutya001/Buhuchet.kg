import {
  ADMIN_TAX_COLUMNS,
  ADMIN_TAX_SORT,
  propertyRateTyiyn,
  type AdminTaxList,
  type ListQuery,
} from '@buhuchet/domain';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumn,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';
import { listSingleTaxRates } from './platform-dicts';
import { platformReference, reportTypes } from './schema';
import { listTaxes } from './taxes';

/*
 * Админка → «Справочники платформы» → «Налоги и ставки» (задача 2.36, часть 2б; ТЗ «Налоги и
 * ставки»; прототип admin/platform-dicts.js, вкладка `taxes`): справка по НК КР только для просмотра —
 * налоги и обязательные платежи (разделы `taxes`), ставки единого налога (таблица
 * `single_tax_rates`), ставки налога на имущество (`propertyRates`), размер бизнеса и пояснения
 * (`bizSize`, `notes`). Списки — общим механизмом (поиск, фильтры, сортировка, группы, «В Excel») по
 * строкам, собранным здесь. Выгрузку и загрузку из Excel добавит задача 2.37, правку ГКЭД ставок — 2.38.
 */

/** Строка таблицы: постоянный ключ и значения столбцов (`ADMIN_TAX_COLUMNS`). */
export interface AdminTaxRow {
  id: string;
  values: Record<string, string | number>;
}

const text = z.string().catch('');

const PropertyRate = z.object({
  code: z.string(),
  place: text,
  region: text,
  homeA: z.unknown(),
  homeB: z.unknown(),
  homeLand: z.unknown(),
  bizA: z.unknown(),
  bizB: z.unknown(),
  bizLand: z.unknown(),
});

const BizSize = z.object({ code: z.string(), name: text, rule: text, note: text });
const Notes = z.object({
  enRates: z.array(z.string()).catch([]),
  propertyRates: text,
});

async function section(tx: Tx, key: string): Promise<unknown> {
  const [row] = await tx
    .select({ payload: platformReference.payload })
    .from(platformReference)
    .where(eq(platformReference.key, key));
  return row?.payload;
}

/** Записи раздела-массива; запись, которую не разобрать, пропускается (справка не роняет экран). */
const itemsOf = <T>(payload: unknown, schema: z.ZodType<T>): T[] =>
  (Array.isArray(payload) ? payload : []).flatMap((x) => {
    const parsed = schema.safeParse(x);
    return parsed.success ? [parsed.data] : [];
  });

const PROPERTY_MONEY = ['homeA', 'homeB', 'homeLand', 'bizA', 'bizB', 'bizLand'] as const;

/** Строки таблицы по порядку справочника. */
async function taxRows(tx: Tx, list: AdminTaxList, t: ListTexts): Promise<AdminTaxRow[]> {
  if (list === 'taxes') {
    const taxes = await listTaxes(tx, { all: true });
    const codes = [...new Set(taxes.flatMap((x) => x.reportTypes))];
    const shorts = codes.length
      ? await tx
          .select({ code: reportTypes.code, short: reportTypes.shortName })
          .from(reportTypes)
          .where(inArray(reportTypes.code, codes))
      : [];
    const shortOf = new Map(shorts.map((x) => [x.code, x.short]));
    return taxes.map((x) => ({
      id: x.code,
      values: {
        code: x.code,
        name: x.name,
        group: x.group,
        level: x.level,
        about: x.guide.about,
        payers: x.payers,
        rates: x.rates,
        period: x.period,
        reportDue: x.reportDue,
        payDue: x.payDue,
        form: x.form,
        organ: x.organ,
        art: x.art,
        // Виды отчётов каталога — краткими названиями (прототип: T[id].short).
        types: x.reportTypes.map((code) => shortOf.get(code) ?? code).join(', '),
        verify: x.verify ? 'yes' : 'no',
        verify_text: x.verify ? t('pdicts.tax.verify') : '—',
      },
    }));
  }
  if (list === 'en_rates') {
    const rates = await listSingleTaxRates(tx, { all: true });
    return rates.map((x) => ({
      id: x.code,
      values: {
        code: x.code,
        activity: x.activity,
        explain: x.explanation,
        rate: x.rate,
        cond: x.conditions,
        art: x.article,
      },
    }));
  }
  const rates = itemsOf(await section(tx, 'propertyRates'), PropertyRate);
  return rates.map((x) => ({
    id: x.code,
    values: {
      place: x.place,
      region: x.region,
      ...Object.fromEntries(PROPERTY_MONEY.map((k) => [k, propertyRateTyiyn(x[k])])),
    },
  }));
}

/* ───────────── Список ───────────── */

/** Столбец строки из `jsonb_to_recordset`: ключи — постоянные имена столбцов, не ввод пользователя. */
const field = (key: string) => sql.raw(`"r"."${key}"`);

const SQL_TYPE: Readonly<Record<string, string>> = { money: 'bigint', int: 'integer' };

/** Описание столбцов записи: служебные `id`, `ord` и столбцы таблицы (у «Сверки» — и подпись). */
function recordDefs(list: AdminTaxList): string {
  const defs = ['"id" text', '"ord" integer'];
  for (const c of ADMIN_TAX_COLUMNS[list]) defs.push(`"${c.key}" ${SQL_TYPE[c.type] ?? 'text'}`);
  if (list === 'taxes') defs.push('"verify_text" text');
  return defs.join(', ');
}

function recordset(list: AdminTaxList, rows: readonly AdminTaxRow[]): SQL {
  const records = rows.map((x, i) => ({ id: x.id, ord: i + 1, ...x.values }));
  return sql`jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as r(${sql.raw(recordDefs(list))})`;
}

export function adminTaxListColumns(list: AdminTaxList): ListColumns {
  const columns: Record<string, ListColumn> = {};
  for (const c of ADMIN_TAX_COLUMNS[list]) {
    const column: ListColumn = { type: c.type, label: c.label, value: field(c.key) };
    // «Сверка»: код «yes»/«no», на экране — «Сверить» или «—».
    if (c.key === 'verify') {
      column.display = field('verify_text');
      column.sort = { value: field('verify_text'), text: true };
    }
    columns[c.key] = column;
  }
  return columns;
}

const NATURAL = [field('ord')];

const sorted = (list: AdminTaxList, query: ListQuery): ListQuery =>
  query.sort === undefined ? { ...query, sort: ADMIN_TAX_SORT[list] } : query;

async function listSource(tx: Tx, list: AdminTaxList, t: ListTexts) {
  const rows = await taxRows(tx, list, t);
  return { rows, source: recordset(list, rows) };
}

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

/** Страница таблицы «Налогов и ставок»: поиск, фильтры, сортировка и группы — общим механизмом. */
export async function listAdminTaxPage(tx: Tx, list: AdminTaxList, query: ListQuery, t: ListTexts) {
  const { rows, source } = await listSource(tx, list, t);
  const byId = new Map(rows.map((x) => [x.id, x]));
  const page = await selectListPage({
    query: sorted(list, query),
    columns: adminTaxListColumns(list),
    natural: NATURAL,
    defaultSort: ADMIN_TAX_SORT[list],
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ id: sql<string>`${field('id')}`, ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
  return { ...page, rows: page.rows.map((r) => byId.get(r.id)!) };
}

/** Значения столбца таблицы для фильтра-галочек; `q` — «Найти значение». */
export async function listAdminTaxValues(
  tx: Tx,
  list: AdminTaxList,
  key: string,
  t: ListTexts,
  q?: string,
) {
  const { source } = await listSource(tx, list, t);
  return selectListValues({
    columns: adminTaxListColumns(list),
    key,
    scope: undefined,
    from: fromOf(tx, source),
    q,
  });
}

/** Таблица для выгрузки в Excel: все строки под поиском и фильтрами, столбцы `keys`. */
export async function exportAdminTaxes(
  tx: Tx,
  list: AdminTaxList,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
) {
  const { source } = await listSource(tx, list, t);
  return selectListExport({
    query: sorted(list, query),
    columns: adminTaxListColumns(list),
    keys,
    natural: NATURAL,
    defaultSort: ADMIN_TAX_SORT[list],
    scope: undefined,
    from: fromOf(tx, source),
  });
}

/* ───────────── Пояснения вкладки ───────────── */

export interface AdminTaxInfo {
  /** «Размер бизнеса (ст. 4)»: название, правило и примечание. */
  bizSize: { code: string; name: string; rule: string; note: string }[];
  /** Пояснения над ставками единого налога (кто не может применять, размер бизнеса). */
  enRates: string[];
  /** Пояснение над ставками налога на имущество. */
  propertyRates: string;
}

export async function adminTaxInfo(tx: Tx): Promise<AdminTaxInfo> {
  const [bizSize, notes] = await Promise.all([section(tx, 'bizSize'), section(tx, 'notes')]);
  const parsed = Notes.safeParse(notes ?? {});
  return {
    bizSize: itemsOf(bizSize, BizSize),
    enRates: parsed.success ? parsed.data.enRates : [],
    propertyRates: parsed.success ? parsed.data.propertyRates : '',
  };
}
