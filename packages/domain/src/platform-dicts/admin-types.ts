import { LAST_DAY_OF_MONTH, type ReportAct, type ReportKind } from './catalog';

/*
 * Админка → «Справочники платформы» → «Виды отчётов» (задача 2.36; ТЗ «Справочники платформы» →
 * «Виды отчётов» → «Поля вида отчёта»; прототип admin/platform-dicts-edit.js typeEditDlg и
 * pkTypeFields): поля окна вида отчёта, значения нового вида, «График оплаты» и проверки окна.
 * «Виды деятельности (ГКЭД)» добавит задача 2.38, сверку с ГНС — задача 2.37.
 */

/** Поля вида отчёта, которые правит окно, — в порядке прототипа (typeEditDlg, pkTypeFields). */
export const REPORT_TYPE_FIELDS = [
  'name',
  'shortName',
  'formCode',
  'authorityCode',
  'period',
  'dueFrom',
  'dueDay',
  'dueAfter',
  'dueMonth',
  'payDay',
  'payAfter',
  'payMonth',
  'paySchedule',
  'kind',
  'payer',
  'regimes',
  'pickGroup',
  'bizSizes',
  'bases',
  'notForRegimes',
  'notForEnRates',
  'preselect',
  'choiceNote',
  'description',
  'clientNote',
  'oneOff',
  'eventLabel',
  'statIndex',
  'respondents',
  'source',
  'article',
  'verify',
  'verifyNote',
  'rates',
  'shiftToWorkday',
  'act',
  'payments',
  'gked',
] as const;
export type ReportTypeField = (typeof REPORT_TYPE_FIELDS)[number];

/**
 * Поля правила срока сдачи (прототип `ruleCh`): после их правки сроки несданных отчётов вида
 * пересчитываются.
 */
export const REPORT_TYPE_RULE_FIELDS: readonly ReportTypeField[] = [
  'dueDay',
  'dueAfter',
  'dueMonth',
  'dueFrom',
  'shiftToWorkday',
];

/**
 * Значения нового вида отчёта (прототип typeEditDlg): месячный, срок — 20-е число следующего месяца
 * (у годового — апрель), сквозной, для всех, «По желанию», переносить срок с нерабочего дня.
 * «Отмечать заранее» включено — так в ТЗ.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-11
export const NEW_REPORT_TYPE = {
  period: 'M',
  dueFrom: 'end',
  dueDay: 20,
  dueAfter: 1,
  dueMonth: 4,
  kind: 'cross',
  payer: 'all',
  pickGroup: 'optional',
  preselect: true,
  shiftToWorkday: true,
  oneOff: false,
  verify: false,
} as const;

/** «M-го месяца после периода» и «от начала периода» — от 0 до 6 (прототип: поле до 6). */
export const REPORT_DUE_AFTER_MAX = 6;
/** Платежей в «Что уплачивается» и в «Графике оплаты» — не больше. */
export const REPORT_PAYMENTS_MAX = 10;
export const PAY_SCHEDULE_MAX = 12;

/**
 * «График оплаты» из строки (прототип instIn): «20.03; 20.06» → [[3, 20], [6, 20]] — [месяц, число];
 * разделитель — точка с запятой или запятая; пустая строка — []; ошибка формата — null.
 */
export function parsePaySchedule(text: string): [number, number][] | null {
  if (!text.trim()) return [];
  const parts = text
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out: [number, number][] = [];
  for (const part of parts) {
    const m = /^(\d{1,2})\.(\d{1,2})$/.exec(part);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day < 1 || day > LAST_DAY_OF_MONTH || month < 1 || month > 12) return null;
    out.push([month, day]);
  }
  return out.length > PAY_SCHEDULE_MAX ? null : out;
}

/** Что не так с окном вида отчёта: поле и причина. */
export interface ReportTypeProblem {
  field: 'regimes' | 'payments';
  problem: 'regimes_required' | 'payments_required';
}

/**
 * Проверки окна вида отчёта (прототип typeEditDlg `te-ok`): у режимного — «Выберите хотя бы один
 * режим»; у вида с уплатой — платёж с названием («Укажите название каждого платежа»). Название, краткое
 * название и «Что нужно сделать» проверяет схема формы.
 */
export function reportTypeProblems(x: {
  kind: ReportKind;
  regimes: readonly string[];
  act: ReportAct;
  payments: readonly { name: string }[];
}): ReportTypeProblem[] {
  const problems: ReportTypeProblem[] = [];
  if (x.kind === 'regime' && !x.regimes.length) {
    problems.push({ field: 'regimes', problem: 'regimes_required' });
  }
  if (x.act !== 'sub' && (!x.payments.length || x.payments.some((p) => !p.name.trim()))) {
    problems.push({ field: 'payments', problem: 'payments_required' });
  }
  return problems;
}

/**
 * Выбранные значения, которых нельзя выбрать (режимы, основания и орган вида отчёта; УГНС статуса):
 * только действующие; уже выбранное остаётся, даже если его потом отключили. Нет такого значения —
 * тоже нельзя.
 */
export function inactiveLinks(
  codes: readonly string[],
  options: readonly { code: string; active: boolean }[],
  before: readonly string[],
): string[] {
  const active = new Map(options.map((x) => [x.code, x.active]));
  return codes.filter((code) => !active.has(code) || (!before.includes(code) && !active.get(code)));
}
