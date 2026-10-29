import { searchText } from '../common/list';
import { formatDateRu, isIsoDate, type IsoDate } from '../common/dates';
import { payScheduleText } from '../dicts/report-types';
import type { BenefitDueOverride } from '../dicts/value-guide';
import type { Translate, UiTextKey } from '../l10n/texts';
import { ADMIN_DICT_META, type AdminValueDict } from './admin';
import { NEW_REPORT_TYPE, parsePaySchedule, REPORT_DUE_AFTER_MAX } from './admin-types';
import {
  BANK_KINDS,
  BENEFIT_KINDS,
  BIZ_SIZES,
  DECLARATION_FOR,
  DUE_FROM,
  LAST_DAY_OF_MONTH,
  PAYER_KINDS,
  PICK_GROUPS,
  REGIME_KINDS,
  REPORT_ACTS,
  REPORT_KINDS,
  REPORT_PERIODS,
  type ReportPayment,
} from './catalog';

/*
 * Админка → «Справочники платформы» → «Выгрузить» и «Загрузить» (задача 2.37; ТЗ «Выгрузка и загрузка
 * справочников»; прототип admin/platform-dicts-io.js: DX, dxText, dxRows, importDictDlg): столбцы файла
 * каждого справочника, текст ячейки и её разбор, сравнение загрузки со справочником. Файл загрузки —
 * тот же, что выгрузка: администратор правит его в Excel и загружает обратно; строки сопоставляются по
 * коду, поэтому переименование не создаёт дубль. Удаления через загрузку нет — только «Нет» в
 * «Активно». Проверки значения (связи, повторы, обязательные поля) — те же, что у окна правки: их делают
 * сервер и база при сравнении.
 */

/** Значение справочника в файле: код, название, «Активно» и поля значения (`ADMIN_DICT_META.fields`). */
export interface IoValue {
  code: string;
  name: string;
  active: boolean;
  data: Readonly<Record<string, unknown>>;
}

/** Справочники, на значения которых ссылаются столбцы: в файле — названием, в базе — кодом. */
export type IoRefDict = 'organs' | 'regimes' | 'bases' | 'types' | 'ugns';

/**
 * Значение, на которое ссылаются: код и подпись в файле (у вида отчёта — краткое название, у УГНС —
 * краткое название); `alt` — другие написания, которые тоже узнаются (код ГНС, полное название).
 */
export interface IoRef {
  code: string;
  label: string;
  alt?: readonly string[];
}

export type IoRefs = Readonly<Record<IoRefDict, readonly IoRef[]>>;

export interface IoContext {
  t: Translate;
  refs: IoRefs;
}

type IoField =
  | { type: 'text' }
  /** Число; пустая ячейка — оставить как было (`keep`) или «нет» (`null`). */
  | { type: 'int'; min: number; max: number; empty: 'keep' | 'null' }
  | { type: 'yesno' }
  | { type: 'enum'; values: readonly string[]; label: (v: string) => UiTextKey }
  /** Несколько значений через «;» (размер бизнеса). */
  | { type: 'enums'; values: readonly string[]; label: (v: string) => UiTextKey }
  | { type: 'ref'; ref: IoRefDict }
  | { type: 'refs'; ref: IoRefDict }
  | { type: 'list' }
  | { type: 'date' }
  | { type: 'payments' }
  | { type: 'schedule' }
  | { type: 'contacts' }
  | { type: 'dueRules' };

/** Столбец файла: поле, заголовок (ключ словаря) и как его писать и читать. */
export interface IoColumn {
  /** `code`, `name`, `active` или поле значения. */
  key: string;
  title: UiTextKey;
  field: IoField;
  /** Пустая ячейка — ошибка строки (название, краткое название, орган…). */
  required?: boolean;
  /** Ячейка пишется только у таких значений (у годового вида — «Месяц следующего года», а не «Месяцев после»). */
  shown?: (x: IoValue) => boolean;
}

const yearly = (x: IoValue) => x.data.period === 'Y';
const notYearly = (x: IoValue) => x.data.period !== 'Y';

const enumOf = (values: readonly string[], label: (v: string) => string): IoField => ({
  type: 'enum',
  values,
  label: label as (v: string) => UiTextKey,
});

const col = (
  key: string,
  title: string,
  field: IoField = { type: 'text' },
  extra: Pick<IoColumn, 'required' | 'shown'> = {},
): IoColumn => ({ key, title: title as UiTextKey, field, ...extra });

const CODE = col('code', 'pdicts.io.col.code');
const NAME = col('name', 'pdicts.io.col.name', { type: 'text' }, { required: true });
const ACTIVE = col('active', 'pdicts.io.col.active', { type: 'yesno' });
const day = (empty: 'keep' | 'null'): IoField => ({
  type: 'int',
  min: 1,
  max: LAST_DAY_OF_MONTH,
  empty,
});
const after = (empty: 'keep' | 'null'): IoField => ({
  type: 'int',
  min: 0,
  max: REPORT_DUE_AFTER_MAX,
  empty,
});
const month = (empty: 'keep' | 'null'): IoField => ({ type: 'int', min: 1, max: 12, empty });

/**
 * Столбцы файла справочника — как в прототипе (DX), плюс поля продукта, которых в прототипе нет («Не
 * для режимов», «Размер бизнеса», свой срок оплаты, «Что сверить»…): ТЗ — «выгрузка содержит все поля
 * значения». «Виды деятельности (ГКЭД)» добавит задача 2.38.
 */
export const IO_COLUMNS: Readonly<Record<AdminValueDict, readonly IoColumn[]>> = {
  types: [
    CODE,
    NAME,
    col('shortName', 'pdicts.io.col.short', { type: 'text' }, { required: true }),
    col('formCode', 'pdicts.io.col.form_code'),
    col('authorityCode', 'pdicts.io.col.organ', { type: 'ref', ref: 'organs' }, { required: true }),
    col(
      'period',
      'pdicts.io.col.period',
      enumOf(REPORT_PERIODS, (v) => `report.period.${v.toLowerCase()}`),
    ),
    col('dueDay', 'pdicts.io.col.due_day', day('keep')),
    col('dueAfter', 'pdicts.io.col.due_after', after('keep'), { shown: notYearly }),
    col('dueMonth', 'pdicts.io.col.due_month', month('keep'), { shown: yearly }),
    col(
      'kind',
      'pdicts.io.col.kind',
      enumOf(REPORT_KINDS, (v) => `report.kind.${v}`),
    ),
    col('rates', 'pdicts.io.col.rates', { type: 'list' }),
    col(
      'act',
      'pdicts.io.col.act',
      enumOf(REPORT_ACTS, (v) => `report.act.${v}`),
    ),
    col('payments', 'pdicts.io.col.payments', { type: 'payments' }),
    col(
      'dueFrom',
      'pdicts.io.col.due_from',
      enumOf(DUE_FROM, (v) => `pdicts.type.from.${v}`),
    ),
    col('payDay', 'pdicts.io.col.pay_day', day('null')),
    col('payAfter', 'pdicts.io.col.pay_after', after('null'), { shown: notYearly }),
    col('payMonth', 'pdicts.io.col.pay_month', month('null'), { shown: yearly }),
    col('paySchedule', 'pdicts.io.col.schedule', { type: 'schedule' }),
    col('regimes', 'pdicts.io.col.regimes', { type: 'refs', ref: 'regimes' }),
    col('notForRegimes', 'pdicts.io.col.not_regimes', { type: 'refs', ref: 'regimes' }),
    col(
      'payer',
      'pdicts.io.col.payer',
      enumOf(PAYER_KINDS, (v) => `pdicts.type.payer.${v}`),
    ),
    col('shiftToWorkday', 'pdicts.io.col.shift', { type: 'yesno' }),
    col(
      'pickGroup',
      'pdicts.io.col.group',
      enumOf(PICK_GROUPS, (v) => `pdicts.type.group.${v}`),
    ),
    col('bases', 'pdicts.io.col.bases', { type: 'refs', ref: 'bases' }),
    col('bizSizes', 'pdicts.io.col.biz', {
      type: 'enums',
      values: BIZ_SIZES,
      label: (v) => `pdicts.type.biz.${v}` as UiTextKey,
    }),
    col('notForEnRates', 'pdicts.io.col.not_en', { type: 'list' }),
    col('preselect', 'pdicts.io.col.preselect', { type: 'yesno' }),
    col('choiceNote', 'pdicts.io.col.choice_note'),
    col('oneOff', 'pdicts.io.col.one_off', { type: 'yesno' }),
    col('eventLabel', 'pdicts.io.col.event_label'),
    col('statIndex', 'pdicts.io.col.stat_index'),
    col('respondents', 'pdicts.io.col.respondents'),
    col('source', 'pdicts.io.col.source'),
    col('description', 'pdicts.io.col.description'),
    col('clientNote', 'pdicts.io.col.client_note'),
    col('article', 'pdicts.io.col.article'),
    col('verify', 'pdicts.io.col.verify', { type: 'yesno' }),
    col('verifyNote', 'pdicts.io.col.verify_note'),
    col('active', 'pdicts.io.col.active_type', { type: 'yesno' }),
  ],
  bases: [
    CODE,
    NAME,
    col('description', 'pdicts.io.col.description'),
    col('types', 'pdicts.io.col.types', { type: 'refs', ref: 'types' }),
    col('note', 'pdicts.io.col.remark'),
    ACTIVE,
  ],
  regimes: [
    CODE,
    col('name', 'pdicts.io.col.regime_short', { type: 'text' }, { required: true }),
    col('fullName', 'pdicts.io.col.name', { type: 'text' }, { required: true }),
    col(
      'kind',
      'pdicts.io.col.kind',
      enumOf(REGIME_KINDS, (v) => `dicts.value.regime_kind.${v}`),
    ),
    col('frees', 'pdicts.io.col.frees'),
    col('who', 'pdicts.io.col.who'),
    col('how', 'pdicts.io.col.how'),
    col('combines', 'pdicts.io.col.combines'),
    col('accountantNote', 'pdicts.io.col.acc'),
    col('article', 'pdicts.io.col.article'),
    ACTIVE,
  ],
  benefits: [
    CODE,
    NAME,
    col('gives', 'pdicts.io.col.gives', { type: 'text' }, { required: true }),
    col('article', 'pdicts.io.col.article'),
    col('removes', 'pdicts.io.col.removes', { type: 'refs', ref: 'types' }),
    col('adds', 'pdicts.io.col.adds', { type: 'refs', ref: 'types' }),
    col('validUntil', 'pdicts.io.col.until', { type: 'date' }),
    col(
      'payer',
      'pdicts.io.col.who',
      enumOf(PAYER_KINDS, (v) => `pdicts.benefit.payer.${v}`),
    ),
    col('conditions', 'pdicts.io.col.conditions'),
    col('confirmation', 'pdicts.io.col.confirmation'),
    col('combines', 'pdicts.io.col.combines'),
    col('term', 'pdicts.io.col.term'),
    col('verify', 'pdicts.io.col.verify', { type: 'yesno' }),
    col('verifyNote', 'pdicts.io.col.verify_note'),
    col(
      'kind',
      'pdicts.io.col.kind',
      enumOf(BENEFIT_KINDS, (v) => `pdicts.io.benefit_kind.${v}`),
    ),
    col('dueRules', 'pdicts.io.col.due_rules', { type: 'dueRules' }),
    col('offices', 'pdicts.io.col.offices', { type: 'refs', ref: 'ugns' }),
    ACTIVE,
  ],
  forms: [
    CODE,
    NAME,
    col('fullName', 'pdicts.io.col.full'),
    col('shortName', 'pdicts.io.col.short'),
    col(
      'declarationFor',
      'pdicts.io.col.end',
      enumOf(DECLARATION_FOR, (v) => `dicts.platform.end.${v}`),
    ),
    col('note', 'pdicts.io.col.forms_note'),
    ACTIVE,
  ],
  phones: [
    col('code', 'pdicts.io.col.country_code'),
    col('name', 'pdicts.io.col.country', { type: 'text' }, { required: true }),
    col('dialCode', 'pdicts.io.col.dial_code', { type: 'text' }, { required: true }),
    col('mask', 'pdicts.io.col.mask', { type: 'text' }, { required: true }),
    col('flag', 'pdicts.io.col.flag'),
    ACTIVE,
  ],
  organs: [
    CODE,
    NAME,
    col('description', 'pdicts.io.col.organ_about'),
    col('contacts', 'pdicts.io.col.contacts', { type: 'contacts' }),
    col('hours', 'pdicts.io.col.hours'),
    col('site', 'pdicts.io.col.site'),
    col('contactsNote', 'pdicts.io.col.contacts_note'),
    ACTIVE,
  ],
  ugns: [
    col('code', 'pdicts.io.col.key'),
    col('gnsCode', 'pdicts.io.col.gns_code'),
    col('name', 'pdicts.io.col.full', { type: 'text' }, { required: true }),
    col('shortName', 'pdicts.io.col.short', { type: 'text' }, { required: true }),
    col('region', 'pdicts.io.col.region'),
    ACTIVE,
  ],
  banks: [
    CODE,
    NAME,
    col(
      'kind',
      'pdicts.io.col.kind',
      enumOf(BANK_KINDS, (v) => `pdicts.bank.kind.${v}`),
    ),
    col('byPhone', 'pdicts.io.col.by_phone', { type: 'yesno' }),
    col('note', 'pdicts.io.col.note'),
    ACTIVE,
  ],
  cats: [CODE, NAME, col('note', 'pdicts.io.col.note'), ACTIVE],
  reasons: [CODE, NAME, col('note', 'pdicts.io.col.note'), ACTIVE],
};

/**
 * Код нового значения в файле: латиница, цифры, «-» и «_» у видов отчётов, оснований и УГНС (ключи
 * вроде `nds`, `employees`), у остальных — ещё и кириллица (`РЕЖ-12`, `ФС-25`); до 40 знаков.
 */
export function ioCodeValid(dict: AdminValueDict, code: string): boolean {
  if ('key' in ADMIN_DICT_META[dict].code) return /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(code);
  return /^[\p{L}\d][\p{L}\d_-]{0,39}$/u.test(code);
}

/* ───────────── Текст ячейки ───────────── */

const YES: UiTextKey = 'pdicts.io.yes';
const NO: UiTextKey = 'pdicts.io.no';

/** Подпись ссылки: название значения; неизвестный код — сам код. */
function refLabel(ctx: IoContext, ref: IoRefDict, code: string): string {
  return ctx.refs[ref].find((x) => x.code === code)?.label ?? code;
}

/**
 * «Меняет сроки» одной ячейкой (прототип ovOut): «nds: сдача последний+1; уплата 25+1», несколько видов —
 * через « | ». Число — день (31 — «последний»), после «+» — месяцев после периода, после «.» — месяц
 * следующего года.
 */
function dueRulesText(rules: readonly BenefitDueOverride[], t: Translate): string {
  const dayText = (d: number) => (d >= LAST_DAY_OF_MONTH ? t('pdicts.io.due.last') : String(d));
  return rules
    .map((r) => {
      const parts: string[] = [];
      if (r.dueDay !== null) {
        const plus = r.dueAfter !== null ? `+${r.dueAfter}` : '';
        const mon = r.dueMonth !== null ? `.${String(r.dueMonth).padStart(2, '0')}` : '';
        parts.push(`${t('pdicts.io.due.sub')} ${dayText(r.dueDay)}${plus}${mon}`);
      }
      if (r.payDay !== null) {
        const plus = r.payAfter !== null ? `+${r.payAfter}` : '';
        parts.push(`${t('pdicts.io.due.pay')} ${dayText(r.payDay)}${plus}`);
      }
      return `${r.reportType}: ${parts.join('; ')}`;
    })
    .join(' | ');
}

/** Значение поля: `code`, `name`, `active` — свои, остальное — из полей значения. */
function valueOf(x: IoValue, key: string): unknown {
  if (key === 'code') return x.code;
  if (key === 'name') return x.name;
  if (key === 'active') return x.active;
  return x.data[key];
}

/** Текст ячейки файла — как в выгрузке прототипа (`DX[k].cols[i][2]`). */
export function ioCellText(column: IoColumn, x: IoValue, ctx: IoContext): string {
  if (column.shown && !column.shown(x)) return '';
  const v = valueOf(x, column.key);
  const f = column.field;
  switch (f.type) {
    case 'text':
      return typeof v === 'string' ? v : '';
    case 'int':
      return typeof v === 'number' ? String(v) : '';
    case 'yesno':
      return ctx.t(v === true ? YES : NO);
    case 'enum':
      return typeof v === 'string' && v ? ctx.t(f.label(v)) : '';
    case 'enums':
      return ((v ?? []) as string[]).map((x) => ctx.t(f.label(x))).join('; ');
    case 'ref':
      return typeof v === 'string' && v ? refLabel(ctx, f.ref, v) : '';
    case 'refs':
      return ((v ?? []) as string[]).map((code) => refLabel(ctx, f.ref, code)).join('; ');
    case 'list':
      return ((v ?? []) as string[]).join('; ');
    case 'date':
      return typeof v === 'string' && isIsoDate(v) ? formatDateRu(v) : '';
    case 'payments':
      return ((v ?? []) as ReportPayment[])
        .map((p) =>
          [p.name, refLabel(ctx, 'organs', p.authority), p.kbk].filter(Boolean).join(' / '),
        )
        .join('; ');
    case 'schedule':
      return Array.isArray(v) && v.length ? payScheduleText(v as [number, number][]) : '';
    case 'contacts':
      return ((v ?? []) as { label: string; value: string }[])
        .map((c) => (c.label ? `${c.label}: ${c.value}` : c.value))
        .join('; ');
    case 'dueRules':
      return dueRulesText((v ?? []) as BenefitDueOverride[], ctx.t);
  }
}

/** Строка заголовков файла. */
export function ioHeader(dict: AdminValueDict, t: Translate): string[] {
  return IO_COLUMNS[dict].map((c) => t(c.title));
}

/** Строка файла по значению. */
export function ioRow(dict: AdminValueDict, x: IoValue, ctx: IoContext): string[] {
  return IO_COLUMNS[dict].map((c) => ioCellText(c, x, ctx));
}

/**
 * Ячейка для вставки в Excel (прототип dxCell): с переводами строк — в кавычках, как их копирует Excel;
 * табуляция — пробелом.
 */
const tsvCell = (v: string) =>
  v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v.replace(/\t/g, ' ');

/** Таблица текстом через табуляцию — для «Скопировать» и вставки в Excel (прототип dxText). */
export function ioTsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(tsvCell).join('\t')).join('\n');
}

/* ───────────── Разбор файла ───────────── */

/**
 * Строки и ячейки вставки из Excel или файла CSV (прототип dxRows): разделитель — табуляция, иначе
 * точка с запятой, иначе запятая (по строке заголовков); ячейка в кавычках может содержать
 * разделитель и переводы строк, «""» внутри — кавычка. Пустые строки пропускаются.
 */
export function parseIoText(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = t.split('\n').find((l) => l.trim()) ?? '';
  const dl = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && !cell.trim()) {
      quoted = true;
      cell = '';
    } else if (ch === dl) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Сравнение подписей без учёта регистра, «ё» и лишних пробелов. */
const same = (a: string, b: string) =>
  searchText(a.trim().replace(/\s+/g, ' ')) === searchText(b.trim().replace(/\s+/g, ' '));

/** Код по подписи: название, код или другое написание (`alt`). */
function refCode(ctx: IoContext, ref: IoRefDict, text: string): string | null {
  const list = ctx.refs[ref];
  const hit =
    list.find((x) => x.code === text.trim()) ??
    list.find((x) => same(x.label, text) || (x.alt ?? []).some((a) => same(a, text)));
  return hit?.code ?? null;
}

const split = (text: string, by = ';') =>
  text
    .split(by)
    .map((x) => x.trim())
    .filter(Boolean);

const yesWords = ['да', '1', 'yes', 'true', 'активен', 'активно', 'вкл'];
const noWords = ['нет', '0', 'no', 'false', 'отключен', 'отключено', 'выкл'];

/** «Да»/«Нет» (прототип parseYN): пусто — null, непонятное — undefined. */
function parseYesNo(text: string, t: Translate): boolean | null | undefined {
  const n = searchText(text.trim());
  if (!n) return null;
  if (n === searchText(t(YES)) || yesWords.includes(n)) return true;
  if (n === searchText(t(NO)) || noWords.includes(n)) return false;
  return undefined;
}

/** Дата ячейки: «31.12.2026», «2026-12-31» или число дней Excel (ячейка с форматом даты). */
function parseDate(text: string): IsoDate | null {
  const s = text.trim();
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  const iso = ru ? `${ru[3]}-${ru[2]!.padStart(2, '0')}-${ru[1]!.padStart(2, '0')}` : s;
  if (isIsoDate(iso)) return iso;
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

type Parsed = { value: unknown } | { error: string };

const bad = (ctx: IoContext, key: UiTextKey, params?: Record<string, string | number>): Parsed => ({
  error: ctx.t(key, params),
});

/** Ссылки через «;» — коды; не найденное — ошибка с первым неизвестным. */
function parseRefs(ctx: IoContext, ref: IoRefDict, text: string): Parsed {
  const out: string[] = [];
  for (const part of split(text)) {
    const code = refCode(ctx, ref, part);
    if (!code) return bad(ctx, `pdicts.io.err.ref.${ref}`, { value: part });
    if (!out.includes(code)) out.push(code);
  }
  return { value: out };
}

/** «Что уплачивается» (прототип `pays`): «Платёж / Орган / КБК» через «;»; без органа — орган вида. */
function parsePayments(ctx: IoContext, text: string): Parsed {
  const out: ReportPayment[] = [];
  for (const part of split(text)) {
    const [name = '', organ = '', kbk = '', ...rest] = part.split(/\s\/\s/).map((x) => x.trim());
    if (rest.length || !name) return bad(ctx, 'pdicts.io.err.payments');
    // Получатель не из справочника органов остаётся текстом: у вида из наполнения он бывает таким
    // («ПКИ (взнос 1 %)»), а изменённую строку сервер проверит, как окно вида.
    const authority = organ ? (refCode(ctx, 'organs', organ) ?? organ) : '';
    out.push({ name, authority, kbk });
  }
  return { value: out };
}

/** Телефоны органа: «Подпись: номер» через «;». */
function parseContacts(text: string): Parsed {
  return {
    value: split(text).map((part) => {
      const at = part.indexOf(':');
      return at < 0
        ? { label: '', value: part }
        : { label: part.slice(0, at).trim(), value: part.slice(at + 1).trim() };
    }),
  };
}

/** Часть «Меняет сроки»: «сдача 20+1», «уплата последний», «сдача 30.04». */
const DUE_PART = /^(\S+)\s+(\S+?)(?:\s*\+\s*(\d{1,2}))?(?:\s*\.\s*(\d{1,2}))?$/;

/** «Меняет сроки» (прототип ovIn): «nds: сдача последний+1; уплата 25+1 | soc: …». */
function parseDueRules(ctx: IoContext, text: string): Parsed {
  const out: BenefitDueOverride[] = [];
  const fail = bad(ctx, 'pdicts.io.err.due_rules');
  const word = (key: UiTextKey) => searchText(ctx.t(key));
  for (const part of split(text, '|')) {
    const m = /^([^:]+):\s*(.+)$/.exec(part);
    if (!m) return fail;
    const type = refCode(ctx, 'types', m[1]!);
    if (!type) return bad(ctx, 'pdicts.io.err.ref.types', { value: m[1]!.trim() });
    const rule: BenefitDueOverride = {
      reportType: type,
      dueDay: null,
      dueAfter: null,
      dueMonth: null,
      payDay: null,
      payAfter: null,
    };
    for (const q of split(m[2]!)) {
      const d = DUE_PART.exec(q);
      if (!d) return fail;
      const what = searchText(d[1]!);
      if (what !== word('pdicts.io.due.sub') && what !== word('pdicts.io.due.pay')) return fail;
      const last = searchText(d[2]!) === word('pdicts.io.due.last');
      if (!last && !/^\d{1,2}$/.test(d[2]!)) return fail;
      const dayValue = last ? LAST_DAY_OF_MONTH : Number(d[2]);
      const plus = d[3] === undefined ? null : Number(d[3]);
      const mon = d[4] === undefined ? null : Number(d[4]);
      if (dayValue < 1 || dayValue > LAST_DAY_OF_MONTH) return fail;
      if (plus !== null && plus > REPORT_DUE_AFTER_MAX) return fail;
      if (mon !== null && (mon < 1 || mon > 12)) return fail;
      if (what === word('pdicts.io.due.sub')) {
        rule.dueDay = dayValue;
        rule.dueAfter = plus;
        rule.dueMonth = mon;
      } else {
        if (mon !== null) return fail;
        rule.payDay = dayValue;
        rule.payAfter = plus;
      }
    }
    out.push(rule);
  }
  return { value: out };
}

/**
 * Значение ячейки. `undefined` — оставить как было (пустое число срока, пустое «да/нет», пустой «Тип»):
 * так в прототипе (`v[f] != null`). Пустой текст и пустой список очищают поле.
 */
export function parseIoCell(column: IoColumn, text: string, ctx: IoContext): Parsed {
  const s = text.trim();
  const f = column.field;
  if (!s && column.required) return bad(ctx, 'pdicts.io.err.empty');
  switch (f.type) {
    case 'text':
      return { value: s };
    case 'int': {
      if (!s) return { value: f.empty === 'keep' ? undefined : null };
      const n = Number(s);
      return Number.isInteger(n) && n >= f.min && n <= f.max
        ? { value: n }
        : bad(ctx, 'pdicts.io.err.int', { min: f.min, max: f.max });
    }
    case 'yesno': {
      const b = parseYesNo(s, ctx.t);
      return b === undefined ? bad(ctx, 'pdicts.io.err.yesno') : { value: b ?? undefined };
    }
    case 'enum':
    case 'enums': {
      const pick = (part: string) =>
        f.values.find((v) => v === part || same(ctx.t(f.label(v)), part));
      const list = { list: f.values.map((v) => ctx.t(f.label(v))).join(', ') };
      if (f.type === 'enums') {
        const out: string[] = [];
        for (const part of split(s)) {
          const v = pick(part);
          if (!v) return bad(ctx, 'pdicts.io.err.enum', list);
          out.push(v);
        }
        return { value: f.values.filter((v) => out.includes(v)) };
      }
      if (!s) return { value: undefined };
      const v = pick(s);
      return v ? { value: v } : bad(ctx, 'pdicts.io.err.enum', list);
    }
    case 'ref': {
      const code = refCode(ctx, f.ref, s);
      return code ? { value: code } : bad(ctx, `pdicts.io.err.ref.${f.ref}`, { value: s });
    }
    case 'refs':
      return parseRefs(ctx, f.ref, s);
    case 'list':
      return { value: [...new Set(split(s))] };
    case 'date': {
      if (!s) return { value: null };
      const d = parseDate(s);
      return d ? { value: d } : bad(ctx, 'pdicts.io.err.date');
    }
    case 'payments':
      return parsePayments(ctx, s);
    case 'schedule': {
      const v = parsePaySchedule(s);
      if (v === null) return bad(ctx, 'pdicts.err.schedule');
      return { value: v.length ? v : null };
    }
    case 'contacts':
      return parseContacts(s);
    case 'dueRules':
      return parseDueRules(ctx, s);
  }
}

/** Строка загрузки: номер строки файла, код и разобранные поля (только из столбцов файла). */
export interface IoParsedRow {
  line: number;
  code: string;
  values: Record<string, unknown>;
  errors: string[];
}

export type IoParseResult =
  { fatal: 'no_rows' | 'no_code' } | { columns: readonly IoColumn[]; rows: IoParsedRow[] };

/**
 * Разбор таблицы файла (прототип importDictDlg `compare`): первая строка — заголовки; столбцы узнаются по
 * заголовку без учёта регистра, лишние пропускаются. Без столбца «Код» строки не сопоставить — ошибка
 * файла; без строк данных — тоже. Ошибка ячейки — «Столбец: что не так»; код повторяется в файле — ошибка
 * строки.
 */
export function parseIoRows(
  dict: AdminValueDict,
  table: readonly (readonly string[])[],
  ctx: IoContext,
): IoParseResult {
  if (table.length < 2) return { fatal: 'no_rows' };
  const head = table[0]!.map((h) => searchText(h.trim()));
  const all = IO_COLUMNS[dict];
  const at = all.map((c) => head.indexOf(searchText(ctx.t(c.title))));
  if (at[0]! < 0) return { fatal: 'no_code' };
  const columns = all.filter((_, i) => at[i]! >= 0);
  const seen = new Set<string>();
  const rows = table.slice(1).map((cells, i): IoParsedRow => {
    const values: Record<string, unknown> = {};
    const errors: string[] = [];
    all.forEach((c, ci) => {
      if (at[ci]! < 0 || ci === 0) return;
      const parsed = parseIoCell(c, cells[at[ci]!] ?? '', ctx);
      if ('error' in parsed)
        errors.push(ctx.t('pdicts.io.err.cell', { col: ctx.t(c.title), text: parsed.error }));
      else if (parsed.value !== undefined) values[c.key] = parsed.value;
    });
    const code = (cells[at[0]!] ?? '').trim();
    if (!code) errors.unshift(ctx.t('pdicts.io.err.no_code'));
    else if (seen.has(code)) errors.unshift(ctx.t('pdicts.io.err.code_twice'));
    seen.add(code);
    return { line: i + 2, code, values, errors };
  });
  return { columns, rows };
}

/* ───────────── Сравнение со справочником ───────────── */

/**
 * Новое значение до разбора строки: поля по умолчанию — как у окна «+ Добавить» (у вида отчёта —
 * `NEW_REPORT_TYPE`, «Тип» — тип нового значения, «Для ЕНД» — организация), действующее.
 */
export function ioNewValue(dict: AdminValueDict, code: string): IoValue {
  const meta = ADMIN_DICT_META[dict];
  const data: Record<string, unknown> = {};
  for (const c of IO_COLUMNS[dict]) {
    if (c.key === 'code' || c.key === 'name' || c.key === 'active') continue;
    const f = c.field;
    const fallback =
      dict === 'types' ? NEW_REPORT_TYPE[c.key as keyof typeof NEW_REPORT_TYPE] : undefined;
    if (fallback !== undefined) data[c.key] = fallback;
    else if (f.type === 'int' || f.type === 'date' || f.type === 'schedule') data[c.key] = null;
    else if (f.type === 'yesno') data[c.key] = false;
    else if (f.type === 'text') data[c.key] = '';
    else if (f.type === 'enum') data[c.key] = f.values[0];
    else if (f.type === 'ref') data[c.key] = '';
    else data[c.key] = [];
  }
  if (meta.kind) data.kind = meta.kind.default;
  if ('payer' in data && dict !== 'types') data.payer = 'all';
  if ('declarationFor' in data) data.declarationFor = 'org';
  return { code, name: '', active: true, data };
}

/** Значение после строки файла: поля из файла поверх прежних (у нового — поверх полей по умолчанию). */
export function ioMerge(base: IoValue, values: Readonly<Record<string, unknown>>): IoValue {
  const data = Object.fromEntries(
    Object.entries(values).filter(([k]) => k !== 'code' && k !== 'name' && k !== 'active'),
  );
  return {
    code: base.code,
    name: typeof values.name === 'string' ? values.name : base.name,
    active: typeof values.active === 'boolean' ? values.active : base.active,
    data: { ...base.data, ...data },
  };
}

/** Изменённое поле: заголовок столбца, было и стало — текстом ячейки. */
export interface IoChange {
  key: string;
  title: string;
  from: string;
  to: string;
}

/**
 * Что меняет строка (прототип: `ch` — столбцы файла, у которых текст ячейки стал другим); у срока —
 * только столбец, который у этой периодичности есть.
 */
export function ioChanges(
  columns: readonly IoColumn[],
  before: IoValue,
  after: IoValue,
  ctx: IoContext,
): IoChange[] {
  return columns
    .filter((c) => c.key !== 'code')
    .flatMap((c) => {
      const from = ioCellText(c, before, ctx);
      const to = ioCellText(c, after, ctx);
      if (c.shown && !c.shown(after) && !c.shown(before)) return [];
      return from === to ? [] : [{ key: c.key, title: ctx.t(c.title), from, to }];
    });
}
