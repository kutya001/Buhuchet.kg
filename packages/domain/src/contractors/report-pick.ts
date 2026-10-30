import { formatDateRu, type IsoDate } from '../common/dates';
import { dueRuleText, payRuleText } from '../dicts/report-types';
import type { Translate } from '../l10n/texts';
import type {
  BizSize,
  GkedRule,
  PayerKind,
  PickGroup,
  ReportKind,
} from '../platform-dicts/catalog';
import type { ProductionCalendar } from '../platform-dicts/calendar';
import {
  incompatibilityText,
  typeIncompatibility,
  type CompatibilityRate,
  type CompatibilitySubject,
} from '../reports/compatible';
import {
  effectiveRule,
  reportDue,
  type EffectiveRule,
  type ReportTypeRule,
  type StatusDueRule,
} from '../reports/due';
import { periodFull, periodWindow } from '../reports/periods';
import { gkedFitOf, gkedHit, SINGLE_TAX_REGIME, type GkedForm, type GkedIndex } from './gked';

/*
 * «Подбор отчётов» и окно «Льготы и особые статусы» (ТЗ «Контрагенты» → «Подбор отчётов и налогов, льгот
 * и статусов»; прототип modules/report-pick.js — pkCalc, pkMustWhy, benWarns). Наборы не вводятся
 * вручную, а считаются из справочников платформы: поля вида отчёта (группа подбора, «Применимые режимы» и
 * «Не для режимов», «Для кого», «Размер бизнеса», «Не для ставок ЕН», «Основание», «Отмечать заранее»,
 * ГКЭД), «добавляет» и «делает ненужными» у льгот и статусов. Ответы сверены с прототипом:
 * scripts/oracle-report-pick.mjs.
 */

/** Группы «Рекомендуемых» по порядку (прототип PK_GROUPS). */
export const PICK_SECTIONS = [
  'regime',
  'status',
  'basis',
  'all',
  'stat',
  'choice',
  'gked',
] as const;
export type PickSection = (typeof PICK_SECTIONS)[number];

/** Группы, отчёты которых обязательны, если отмечены заранее (прототип PK_MUST). */
const MUST_SECTIONS: ReadonlySet<PickSection> = new Set(['regime', 'status', 'basis', 'all']);

/** Основание «В списке Нацстаткома»: у его форм своя свёрнутая группа (прототип PK_STAT). */
export const STAT_BASE = 'statSample';

/** Вид отчёта для подбора: поля каталога платформы. */
export interface PickType {
  code: string;
  shortName: string;
  /** Вид действует в каталоге платформы. */
  active: boolean;
  kind: ReportKind;
  payer: PayerKind;
  /** «Применимые режимы» (коды). */
  regimes: readonly string[];
  /** «Не для режимов» (коды). */
  notForRegimes: readonly string[];
  pickGroup: PickGroup;
  preselect: boolean;
  choiceNote: string;
  bizSizes: readonly BizSize[];
  /** «Не для ставок ЕН»: коды строк ЕНС. */
  notForEnRates: readonly string[];
  /** «Основание»: достаточно любого. */
  bases: readonly string[];
  oneOff: boolean;
  gked: GkedRule | null;
}

/** Льгота или особый статус: какие виды добавляет и какие делает ненужными. */
export interface PickBenefit {
  code: string;
  name: string;
  payer: PayerKind;
  /** «Совмещается с» текстом: «не совмещается с ЛЬГ-01 …» — предупреждение при отметке второго. */
  combines: string;
  gked: GkedRule | null;
  adds: readonly string[];
  removes: readonly string[];
}

export interface PickBase {
  code: string;
  name: string;
}

/** Справочники платформы для подбора; `rates` — «Ставки единого налога» (строки-надбавки — `addsTo`). */
export interface PickDict {
  types: readonly PickType[];
  benefits: readonly PickBenefit[];
  bases: readonly PickBase[];
  rates: readonly CompatibilityRate[];
  index: GkedIndex;
}

/**
 * Контрагент или черновик формы: форма собственности, режимы по порядку, коды льгот, основания, размер
 * бизнеса, ГКЭД, строки ЕНС действующего назначения единого налога (`singleTax` — для ЕНД) и строки ЕНС
 * для «Не для ставок ЕН» (`enCodes`: выбранные в форме или в назначении, иначе подобранные по ГКЭД —
 * прототип pkEn), виды, подключённые в организации.
 */
export interface PickSubject extends Omit<CompatibilitySubject, 'form'> {
  form: GkedForm | null;
  benefits: readonly string[];
  bases: readonly string[];
  bizSize: BizSize;
  gked: string | null;
  gkedExtra: readonly string[];
  enCodes: readonly string[];
  connected: readonly string[];
}

/** Отчёт в «Рекомендуемых»: группа, отмечается ли заранее, причина подбора и почему обязателен. */
export interface PickRec {
  section: PickSection;
  pre: boolean;
  why: string;
  /** «обязателен по режиму «ОНР»» — для предупреждения при снятии; '' — не обязателен. */
  must: string;
}

/**
 * Итог подбора: `rec` — «Рекомендуемые» по порядку каталога; `no` — не нужен по статусу (названия
 * статусов); `off` — нельзя назначить (причина); `hidden` — подходят, но не подключены в организации;
 * `stat` — формы Нацстаткома без основания «В списке Нацстаткома» (во «Все» — «Если в списке Нацстаткома»).
 */
export interface PickResult {
  rec: Map<string, PickRec>;
  no: Map<string, string[]>;
  off: Map<string, string>;
  hidden: string[];
  stat: Set<string>;
}

/** Вид — форма Нацстаткома (прототип pkStat). */
export const isStatForm = (t: Pick<PickType, 'bases'>) => t.bases.includes(STAT_BASE);

/** Вид отключён в каталоге платформы (прототип pkOffT). */
export const isTypeOff = (t: Pick<PickType, 'active' | 'pickGroup'>) =>
  !t.active || t.pickGroup === 'disabled';

/** Основание строчными без «Есть»: «наёмные сотрудники» (прототип baseLow). */
function baseLow(dict: PickDict, code: string): string {
  const b = dict.bases.find((x) => x.code === code);
  return b ? b.name.replace(/^Есть /, '').replace(/^./, (x) => x.toLowerCase()) : code;
}

/** «Для кого» словами (прототип whoText). */
export const payerText = (payer: PayerKind, t: Translate) => t(`cp.pick.payer.${payer}`);

/** Причина «Подходит по ГКЭД 94»: начало кода из перечня вида, под которое попал ГКЭД контрагента. */
function gkedCode(type: PickType, s: PickSubject, index: GkedIndex): string {
  const { rule, fit } = gkedFitOf(type.gked, gkedSubject(s), index);
  if (!rule || !rule.in.length || !fit?.length) return '';
  return rule.in.find((p) => gkedHit(fit[0]!, p, index)) ?? fit[0]!;
}

const gkedSubject = (s: PickSubject) => ({
  gked: s.gked,
  gkedExtra: s.gkedExtra,
  form: s.form,
  regimes: s.regimes.map((r) => r.code),
  benefits: s.benefits,
});

/**
 * «Не для ставок ЕН» (только у плательщиков единого налога): все строки ЕНС контрагента из списка вида;
 * строка-надбавка не считается.
 */
function enRatesExclude(type: PickType, s: PickSubject, dict: PickDict): boolean {
  if (!type.notForEnRates.length || !s.regimes.some((r) => r.code === SINGLE_TAX_REGIME))
    return false;
  const codes = s.enCodes.filter((c) => !dict.rates.find((r) => r.code === c)?.addsTo.length);
  return codes.length > 0 && codes.every((c) => type.notForEnRates.includes(c));
}

/**
 * Подбор отчётов контрагенту (прототип pkCalc). `date` — на какую дату ставка единого налога (ЕНД при
 * нулевой ставке).
 */
export function reportPick(s: PickSubject, dict: PickDict, date: string, t: Translate): PickResult {
  const out: PickResult = {
    rec: new Map(),
    no: new Map(),
    off: new Map(),
    hidden: [],
    stat: new Set(),
  };
  const regimes = s.regimes.map((r) => r.code);
  const benefits = s.benefits
    .map((code) => dict.benefits.find((b) => b.code === code))
    .filter((b): b is PickBenefit => !!b);
  const bases = new Set(s.bases);
  const connected = new Set(s.connected);
  const quote = (names: readonly string[]) => names.join('», «');
  const basesText = (codes: readonly string[], sep: string) =>
    codes.map((k) => baseLow(dict, k)).join(sep);
  // must — «обязателен по …» у отмеченных заранее обязательных групп (прототип pkMustWhy).
  const put = (type: PickType, section: PickSection, pre: boolean, why: string, must = '') => {
    if (!connected.has(type.code) || !type.active) {
      out.hidden.push(type.code);
      return;
    }
    out.rec.set(type.code, {
      section,
      pre,
      why,
      must: MUST_SECTIONS.has(section) && pre ? must : '',
    });
  };
  const byGked = (type: PickType) => {
    const k = gkedCode(type, s, dict.index);
    if (k) put(type, 'gked', false, t('cp.pick.why.gked', { code: k }));
  };
  const ifBases = (type: PickType) =>
    t('cp.pick.why.basis_if', { bases: basesText(type.bases, t('cp.pick.or')) });

  for (const type of dict.types) {
    if (isTypeOff(type)) continue;
    const bad = typeIncompatibility(type, s, dict.rates, date, t);
    if (bad) {
      out.off.set(type.code, incompatibilityText(bad, t));
      continue;
    }
    if (type.payer !== 'all' && s.form && s.form.declarationFor !== type.payer) {
      out.off.set(type.code, t('cp.pick.off.payer', { who: payerText(type.payer, t) }));
      continue;
    }
    const removes = benefits.filter((b) => b.removes.includes(type.code));
    if (removes.length) {
      out.no.set(
        type.code,
        removes.map((b) => b.name),
      );
      continue;
    }
    const adds = benefits.filter((b) => b.adds.includes(type.code));
    if (adds.length) {
      const names = quote(adds.map((b) => b.name));
      put(
        type,
        'status',
        type.preselect,
        t('cp.pick.why.status', { names }),
        t('cp.pick.must.status', { names }),
      );
      continue;
    }
    if (type.oneOff && type.bases.length) {
      const on = type.bases.some((k) => bases.has(k));
      put(
        type,
        on ? 'choice' : 'basis',
        false,
        on ? type.choiceNote || t('cp.pick.why.oneoff') : ifBases(type),
      );
      continue;
    }
    if (type.pickGroup === 'status' || type.pickGroup === 'optional') {
      byGked(type);
      continue;
    }
    if (type.regimes.length && !regimes.some((r) => type.regimes.includes(r))) {
      byGked(type);
      continue;
    }
    if (regimes.some((r) => type.notForRegimes.includes(r))) continue;
    if (type.bizSizes.length && !type.bizSizes.includes(s.bizSize)) continue;
    if (enRatesExclude(type, s, dict)) continue;
    if (type.pickGroup === 'regime') {
      if (type.preselect) {
        const own = s.regimes.filter((r) => type.regimes.includes(r.code)).map((r) => r.name);
        const names = quote(own.length ? own : s.regimes.slice(0, 1).map((r) => r.name));
        put(
          type,
          'regime',
          true,
          t('cp.pick.why.regime', { names }),
          t('cp.pick.must.regime', { names }),
        );
      } else put(type, 'choice', false, type.choiceNote || t('cp.pick.why.choice'));
      continue;
    }
    if (type.pickGroup === 'basis') {
      const on = type.bases.filter((k) => bases.has(k));
      if (isStatForm(type)) {
        const k = gkedCode(type, s, dict.index);
        if (k) put(type, 'gked', false, t('cp.pick.why.gked', { code: k }));
        else if (!bases.has(STAT_BASE)) out.stat.add(type.code);
        else
          put(
            type,
            'stat',
            type.preselect,
            t(type.preselect ? 'cp.pick.why.stat_on' : 'cp.pick.why.stat_if'),
          );
        continue;
      }
      if (on.length && !type.preselect) {
        put(type, 'choice', false, type.choiceNote || ifBases(type));
        continue;
      }
      put(
        type,
        'basis',
        on.length > 0,
        on.length ? t('cp.pick.why.basis_on', { bases: basesText(on, ', ') }) : ifBases(type),
        t('cp.pick.must.basis', { bases: basesText(on, ', ') }),
      );
      continue;
    }
    if (type.pickGroup === 'all') {
      if (type.preselect) put(type, 'all', true, t('cp.pick.why.all'), t('cp.pick.must.all'));
      else put(type, 'choice', false, type.choiceNote || t('cp.pick.why.choice'));
      continue;
    }
    byGked(type);
  }
  return out;
}

/** Отчёты, которые отмечаются сами: отмеченные заранее в «Рекомендуемых» (прототип pkAuto). */
export const reportPickAuto = (r: PickResult): string[] =>
  [...r.rec].filter(([, x]) => x.pre).map(([code]) => code);

/**
 * Причина строки во вкладке «Все» (прототип pkView): нельзя назначить, не нужен по статусу, причина
 * подбора, «Если в списке Нацстаткома», пояснение выбора или «Не подобран для этого контрагента».
 */
export function reportPickAllWhy(
  type: Pick<PickType, 'code' | 'choiceNote' | 'active' | 'pickGroup'>,
  r: PickResult,
  t: Translate,
): { why: string; disabled: boolean } {
  if (isTypeOff(type)) return { why: t('cp.pick.why.type_off'), disabled: true };
  const off = r.off.get(type.code);
  if (off) return { why: off, disabled: true };
  const no = r.no.get(type.code);
  if (no) return { why: t('cp.pick.why.not_needed', { names: no.join('», «') }), disabled: false };
  const rec = r.rec.get(type.code);
  if (rec) return { why: rec.why, disabled: false };
  if (r.stat.has(type.code)) return { why: t('cp.pick.why.stat_all'), disabled: false };
  return { why: type.choiceNote || t('cp.pick.why.none'), disabled: false };
}

/**
 * Основание «В списке Нацстаткома» включается само, когда отмечена форма Нацстаткома (прототип pkMount,
 * toggle): тогда отмечаются и заранее отмечаемые формы группы «Формы Нацстаткома».
 */
export function statBaseAuto(
  code: string,
  s: PickSubject,
  dict: PickDict,
  date: string,
  t: Translate,
): { bases: string[]; select: string[] } | null {
  const type = dict.types.find((x) => x.code === code);
  if (!type || !isStatForm(type) || s.bases.includes(STAT_BASE)) return null;
  const bases = [...s.bases, STAT_BASE];
  const r = reportPick({ ...s, bases }, dict, date, t);
  return {
    bases,
    select: [...r.rec].filter(([, x]) => x.section === 'stat' && x.pre).map(([c]) => c),
  };
}

/**
 * Основание включили или выключили в шапке подбора (прототип pkMount, #pk-bases): отмеченные заранее виды
 * этого основания отмечаются; при выключении снимаются виды, которым больше не на что опереться.
 */
export function baseToggle(
  base: string,
  on: boolean,
  selected: readonly string[],
  s: PickSubject,
  dict: PickDict,
  date: string,
  t: Translate,
): { bases: string[]; selected: string[] } {
  const bases = on ? [...s.bases, base] : s.bases.filter((x) => x !== base);
  const r = reportPick({ ...s, bases }, dict, date, t);
  const sel = new Set(selected);
  for (const type of dict.types) {
    if (!type.bases.includes(base)) continue;
    const rec = r.rec.get(type.code);
    if (!rec && !r.stat.has(type.code)) continue;
    if (on && rec?.pre) sel.add(type.code);
    if (
      !on &&
      !type.bases.some((x) => bases.includes(x)) &&
      (r.stat.has(type.code) || rec?.section === 'basis')
    )
      sel.delete(type.code);
  }
  return { bases, selected: [...sel] };
}

/** Назначенные отчёты, которые статусы контрагента делают ненужными (прототип pkNotNeeded). */
export function reportsNotNeeded(
  benefits: readonly string[],
  assigned: readonly string[],
  dict: Pick<PickDict, 'benefits'>,
): { benefit: string; name: string; types: string[] }[] {
  return benefits
    .map((code) => dict.benefits.find((b) => b.code === code))
    .filter((b): b is PickBenefit => !!b)
    .map((b) => ({
      benefit: b.code,
      name: b.name,
      types: b.removes.filter((id) => assigned.includes(id)),
    }))
    .filter((x) => x.types.length);
}

/** Добавятся и снимутся при «Применить»: новые отмеченные и снятые назначенные (прототип pkConfirm). */
export function reportPickChanges(
  before: readonly string[],
  selected: readonly string[],
): { add: string[]; remove: string[] } {
  return {
    add: selected.filter((x) => !before.includes(x)),
    remove: before.filter((x) => !selected.includes(x)),
  };
}

/**
 * «Основания изменились» после «Изменить» контрагента (прототип pkBaseDiff; ТЗ «Основания для сквозных
 * отчётов»: при включении основания система предлагает добавить его отчёты, при выключении — снять;
 * docs/deviations.md п. А-7, решение А). `s` — контрагент после правки, `before` — основания до неё.
 * Добавить — отмечаемые сами при новых основаниях, которых не было при прежних и которые ещё не
 * назначены; снять — назначенные виды выключенного основания, у которых не осталось включённого.
 */
export function reportPickBaseDiff(
  before: readonly string[],
  s: PickSubject,
  assigned: readonly string[],
  dict: PickDict,
  date: string,
  t: Translate,
): { on: string[]; off: string[]; add: string[]; remove: string[] } {
  const on = s.bases.filter((b) => !before.includes(b));
  const off = before.filter((b) => !s.bases.includes(b));
  let add: string[] = [];
  if (on.length) {
    const was = new Set(reportPickAuto(reportPick({ ...s, bases: before }, dict, date, t)));
    add = reportPickAuto(reportPick(s, dict, date, t)).filter(
      (code) => !assigned.includes(code) && !was.has(code),
    );
  }
  const remove = off.length
    ? assigned.filter((code) => {
        const bases = dict.types.find((x) => x.code === code)?.bases ?? [];
        return bases.some((b) => off.includes(b)) && !bases.some((b) => s.bases.includes(b));
      })
    : [];
  return { on, off, add, remove };
}

/** Коды льгот, с которыми статус не совмещается: «не совмещается с ЛЬГ-01 (ПКИ) …» (прототип benConflicts). */
function benefitConflicts(b: PickBenefit): string[] {
  const m = /не совмещается с ([^;.]+)/i.exec(b.combines);
  return m ? (m[1]!.match(/ЛЬГ-\d+/g) ?? []) : [];
}

/** Статус подходит по ГКЭД контрагента — вкладка «Подходят по ГКЭД» (прототип benPickDlg, fits). */
export function benefitFits(b: PickBenefit, s: PickSubject, index: GkedIndex): boolean {
  if (!b.gked?.in.length || !(s.gked || s.gkedExtra.length)) return false;
  return (gkedFitOf(b.gked, gkedSubject(s), index).fit ?? []).length > 0;
}

/**
 * Предупреждения у отмеченного статуса (прототип benWarns): ГКЭД контрагента не входит в перечень
 * статуса; не совмещается с другим отмеченным; не для этой формы собственности. `chosen` — коды отмеченных.
 */
export function benefitWarnings(
  b: PickBenefit,
  s: PickSubject,
  chosen: readonly string[],
  dict: Pick<PickDict, 'benefits' | 'index'>,
  t: Translate,
): string[] {
  const out: string[] = [];
  if (b.gked && !b.gked.hint && b.gked.in.length && (s.gked || s.gkedExtra.length)) {
    const { fit } = gkedFitOf(b.gked, gkedSubject(s), dict.index);
    if (!fit?.length) out.push(t('cp.pick.ben.gked', { name: b.name }));
  }
  for (const code of chosen) {
    const x = dict.benefits.find((y) => y.code === code);
    if (!x || x.code === b.code) continue;
    if (benefitConflicts(b).includes(x.code) || benefitConflicts(x).includes(b.code)) {
      out.push(
        t('cp.pick.ben.conflict', { name: b.name, other: x.name, why: b.combines || x.combines }),
      );
    }
  }
  if (b.payer !== 'all' && s.form && s.form.declarationFor !== b.payer) {
    out.push(t('cp.pick.ben.payer', { who: payerText(b.payer, t) }));
  }
  return out;
}

/**
 * «Ближайший срок» в описании вида для контрагента (прототип pkNear): первый период окна, срок которого
 * не прошёл, — «25.01.2027 — за IV квартал 2026». `rule` — с учётом срока по статусу; у разового — ''.
 */
export function nearestDueText(
  rule: EffectiveRule,
  today: IsoDate,
  calendar: ProductionCalendar,
  t: Translate,
): string {
  if (rule.oneOff) return '';
  for (const start of periodWindow(rule.period, today, rule.skipQuarters)) {
    const ref = { period: rule.period, start };
    const { due } = reportDue(rule, ref, calendar);
    if (due >= today) {
      return t('cp.pick.near', { date: formatDateRu(due), period: periodFull(ref, t) });
    }
  }
  return '';
}

/**
 * «Срок по статусу» в описании вида (прототип ovText): «Сдача — до последнего дня следующего месяца
 * (статус «Крупный налогоплательщик»)», у вида со сдачей и уплатой и своим сроком оплаты у статуса —
 * ещё «; уплата — …»; у вида «Уплата» — срок оплаты статуса. '' — статус срок не меняет.
 */
export function statusDueText(
  type: ReportTypeRule,
  status: StatusDueRule | null,
  benefit: string,
  t: Translate,
): string {
  if (!status) return '';
  const e = effectiveRule(type, null, status);
  const ownPay = status.payDay !== null;
  const rule =
    type.act === 'pay' && ownPay
      ? dueRuleText(
          { ...e, dueDay: e.payDay!, dueAfter: e.payAfter, dueMonth: e.payMonth ?? e.dueMonth },
          t,
        )
      : dueRuleText(e, t);
  const pay =
    type.act === 'both' && ownPay ? t('cp.pick.status_due.pay', { rule: payRuleText(e, t) }) : '';
  return t('cp.pick.status_due', {
    what: t(type.act === 'pay' ? 'cp.pick.status_due.what_pay' : 'cp.pick.status_due.what_sub'),
    rule,
    pay,
    name: benefit,
  });
}
