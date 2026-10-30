import { rateVariants } from '../dicts/value-guide';
import type { Translate } from '../l10n/texts';
import type { GkedRule, ReportKind } from '../platform-dicts/catalog';

/*
 * Сверка контрагента с ГКЭД (ТЗ «Справочники платформы» → «Режимы налогообложения», «ГКЭД»; прототип
 * core/gked.js, gkCheck): режимы, льготы и статусы, ставка единого налога и назначенные отчёты по
 * основному и дополнительным видам деятельности. Ничего не меняет, только отвечает: запрет режима
 * (ошибка поля, контрагент не сохраняется), вопрос с подтверждением (после него — жёлтая отметка и запись
 * в историю), предупреждения и подсказка ставки. Ответы сверены с прототипом: scripts/oracle-gked.mjs.
 */

/** Код ГКЭД в справочнике: уровень, родитель и «Действует». */
export interface GkedNode {
  code: string;
  level: string;
  parent: string | null;
  active: boolean;
}

/** Справочник ГКЭД по коду: коды контрагента и их предки (для правил «секция буквой»). */
export type GkedIndex = ReadonlyMap<string, GkedNode>;

/** Режим налогообложения: код, название (так режим назван в тексте), статья и правило ГКЭД. */
export interface GkedRegime {
  code: string;
  name: string;
  article: string;
  gked: GkedRule | null;
}

/** Льгота или особый статус с правилом ГКЭД. */
export interface GkedBenefit {
  code: string;
  name: string;
  gked: GkedRule | null;
}

/** Строка «Ставок единого налога» (ст. 423) с правилом ГКЭД. */
export interface GkedRate {
  code: string;
  rate: string;
  activity: string;
  gked: GkedRule | null;
}

/** Вид отчёта: тип, коды «Применимых режимов» и правило ГКЭД. */
export interface GkedReportType {
  code: string;
  shortName: string;
  kind: ReportKind;
  regimes: readonly string[];
  gked: GkedRule | null;
}

/** Общая группа кодов (refDB → gkedGroups): название и «Вопрос при предупреждении». */
export interface GkedGroup {
  id: string;
  name: string;
  codes: readonly string[];
  ask: string;
}

/** Справочники для сверки. */
export interface GkedDicts {
  index: GkedIndex;
  regimes: readonly GkedRegime[];
  benefits: readonly GkedBenefit[];
  rates: readonly GkedRate[];
  types: readonly GkedReportType[];
  groups: readonly GkedGroup[];
}

/** Форма собственности: «Для ЕНД» (организация или ИП) и код — ФС-22 означает физлицо на патенте. */
export interface GkedForm {
  code: string;
  declarationFor: 'org' | 'ip';
}

/**
 * Подтверждение права на режим, данное при наборе данных `sig` (`gkedSignature`): кто (имя для текста),
 * когда (дата по Бишкеку) и на какой вопрос ответил «нет».
 */
export interface GkedConfirmation {
  sig: string;
  by: string;
  at: string;
  ask: string;
}

/** Контрагент для сверки: основной и дополнительные ГКЭД, форма, режимы (основной, дополнительный), льготы. */
export interface GkedSubject {
  gked: string | null;
  gkedExtra: readonly string[];
  form: GkedForm | null;
  regimes: readonly string[];
  benefits: readonly string[];
}

/** Перечень по форме собственности у режима с перечнями (патент): организации, ИП, физлица на ИТД. */
export type GkedList = 'org' | 'ip' | 'itd';

/** Пометка перечня: «сверить» — перечень ещё сверяется, `verify` — часть перечня ещё сверяется. */
export type GkedVerify = '' | 'list' | 'partial';

/** Режим нельзя применять при основном ГКЭД (ст. 419): ошибка у поля режима. */
export interface GkedBlock {
  regime: string;
  regimeName: string;
  code: string;
  article: string;
}

/** Вопрос с подтверждением: основной ГКЭД из «Предупреждать при ГКЭД» или вне перечня режима. */
export interface GkedConfirmNeed {
  regime: string;
  regimeName: string;
  code: string;
  /** Перечень по форме собственности; null — «Предупреждать при ГКЭД». */
  list: GkedList | null;
  group: GkedGroup | null;
  /** «Вопрос при предупреждении» группы кода (например, «Оказывает услуги интернета?»). */
  ask: string;
  article: string;
}

/** Замечание по режиму. */
export type GkedRegimeIssue =
  | (GkedConfirmNeed & { kind: 'confirm'; confirmed: GkedConfirmation | null; verify: GkedVerify })
  | { kind: 'unfit'; regime: string; regimeName: string; verify: GkedVerify }
  | {
      kind: 'excluded';
      regime: string;
      regimeName: string;
      codes: string[];
      verify: GkedVerify;
    };

/** Подсказка ставки единого налога. */
export type GkedRateHint =
  | { kind: 'main'; code: string; rates: GkedRate[] }
  | { kind: 'one' }
  | { kind: 'extra'; code: string; rate: GkedRate; one: GkedRate[] };

export interface GkedCheck {
  block: GkedBlock[];
  regime: GkedRegimeIssue[];
  /** Вопросы с подтверждением (одно подтверждение закрывает все — оно привязано к набору данных). */
  confirm: GkedConfirmNeed[];
  benefits: { benefit: string; name: string; verify: GkedVerify }[];
  rate: GkedRateHint[];
  /** Назначенные виды отчётов, которые не подходят по ГКЭД (краткие названия). */
  types: string[];
  /** Коды контрагента, которых нет в справочнике или которые больше не действуют. */
  off: string[];
}

/** Режим «Единый налог»: у него подсказка ставки по ГКЭД. */
export const SINGLE_TAX_REGIME = 'РЕЖ-03';
/** Сколько найденных кодов показывает окно выбора ГКЭД (ТЗ: «показываются первые 80 найденных»; прототип GK_MAX). */
export const GKED_PICK_LIMIT = 80;
/** Физическое лицо на патенте (ИТД) — по коду формы собственности (ТЗ: «определяется по коду ФС-22»). */
export const ITD_FORM = 'ФС-22';
/** Особые ставки ЕН (реэкспорт, ввоз в СЭЗ, деятельность вне КР) — признаки контрагента, а не вида деятельности. */
const EN_SPECIAL = ['ЕНС-05', 'ЕНС-07', 'ЕНС-14'];
/** Ставки для особого статуса: только контрагенту с этим статусом, и тогда — первой (ЕНС-13 — «Резидент ПКИ»). */
const EN_BENEFIT: Readonly<Record<string, string>> = { 'ЕНС-13': 'ЛЬГ-01' };
/** Одна ставка на всю деятельность: дополнительные виды отдельно не облагаются (ст. 423 ч. 7). */
const EN_ONE = ['ЕНС-01', 'ЕНС-05', 'ЕНС-13', 'ЕНС-15'];
/** Ставки на всю деятельность (ст. 423 ч. 7) — для замечания к строкам ЕНС формы (прототип enWarn). */
export const SINGLE_TAX_ONE_RATES: readonly string[] = EN_ONE;
/** «Остальные виды деятельности» — ставка, если ни одна строка не совпала. */
const EN_OTHER = 'ЕНС-04';
/** Код «Остальных видов деятельности» — строка, которую форма добавляет, когда предложить нечего. */
export const SINGLE_TAX_OTHER_RATE = EN_OTHER;

const SECTION = /^[A-Z]+$/;

/** Коды выше по дереву (прототип gkUp): «47.11.0» → «47.11», «47.1», «47», «G». */
export function gkedAncestors(code: string, index: GkedIndex): string[] {
  const out: string[] = [];
  let x = index.get(code);
  for (let n = 0; x?.parent && n < 8; n++) {
    x = index.get(x.parent);
    if (x) out.push(x.code);
  }
  return out;
}

/** Код подходит под начало кода (прототип gkHit): «47» — раздел, «47.1» — группа, «G» — секция. */
export function gkedHit(code: string, prefix: string, index: GkedIndex): boolean {
  if (code === prefix) return true;
  return SECTION.test(prefix)
    ? gkedAncestors(code, index).includes(prefix)
    : code.startsWith(prefix);
}

const codesOf = (s: Pick<GkedSubject, 'gked' | 'gkedExtra'>) =>
  [s.gked, ...s.gkedExtra].filter((c): c is string => !!c);

const isEmptyRule = (r: GkedRule | null | undefined): boolean =>
  !r || (!(r.in ?? []).length && !(r.ex ?? []).length);

/** У правила есть перечни по форме собственности («Для ИП», «Для ИТД») — у патента. */
const hasLists = (r: GkedRule | null | undefined): boolean =>
  !!r && !!((r.ip ?? []).length || (r.itd ?? []).length);

const isIp = (s: GkedSubject) => s.form?.declarationFor === 'ip';

/** Перечень по форме собственности: организация, ИП или физлицо на ИТД (прототип gkListKey). */
function listOf(s: GkedSubject): GkedList {
  if (!isIp(s)) return 'org';
  return s.form?.code === ITD_FORM ? 'itd' : 'ip';
}

/** Правило для контрагента (прототип gkFor): у режима с перечнями — перечень его формы собственности. */
function ruleFor(r: GkedRule, s: GkedSubject | null): GkedRule {
  const list = s && hasLists(r) ? listOf(s) : 'org';
  if (list === 'org') return r;
  return { ...r, in: r[list] ?? [], ex: list === 'ip' ? (r.ipEx ?? []) : [] };
}

/**
 * Какие из кодов подходят под правило (прототип gkFit); null — правило пустое (без ограничения). С
 * контрагентом у правила «только основной ГКЭД» проверяется только основной.
 */
function fit(
  rule: GkedRule | null,
  codes: readonly string[],
  index: GkedIndex,
  s: GkedSubject | null = null,
): string[] | null {
  if (!rule) return null;
  const r = ruleFor(rule, s);
  if (isEmptyRule(r)) return null;
  const list = r.main && s ? (s.gked ? [s.gked] : []) : codes;
  return list.filter(
    (k) =>
      (!r.in.length || r.in.some((p) => gkedHit(k, p, index))) &&
      !r.ex.some((p) => gkedHit(k, p, index)),
  );
}

/**
 * Правило для контрагента и подходящие под него коды ГКЭД контрагента (прототип gkFor, gkFit ∘ cpCodes):
 * `fit` — null, если правило пустое (без ограничения). Для подбора отчётов и окна льгот (2.07).
 */
export function gkedFitOf(
  rule: GkedRule | null,
  s: GkedSubject,
  index: GkedIndex,
): { rule: GkedRule | null; fit: string[] | null } {
  return { rule: rule && ruleFor(rule, s), fit: fit(rule, codesOf(s), index, s) };
}

/** Пометка «сверить» у перечня (прототип gkVer). */
function verifyOf(r: GkedRule | null | undefined): GkedVerify {
  if (!r) return '';
  if (r.verify) return 'partial';
  return /сверить/i.test(r.note ?? '') ? 'list' : '';
}

/** Статья для текста: «ст. 419» из примечания к перечню, иначе статья режима, иначе «НК КР». */
const articleOf = (rule: GkedRule, regime: GkedRegime) =>
  /ст\. \d+/.exec(rule.note ?? '')?.[0] ?? (regime.article || 'НК КР');

/**
 * Набор данных, к которому привязано подтверждение (прототип gkEnSig): основной ГКЭД и режимы, а у
 * режима с перечнями по форме собственности (патент) — ещё все ГКЭД и форма. Изменились — вопрос
 * задаётся заново.
 */
export function gkedSignature(s: GkedSubject, regimes: readonly GkedRegime[]): string {
  const lists = s.regimes.some((code) => hasLists(regimes.find((r) => r.code === code)?.gked));
  return JSON.stringify([
    s.gked ?? '',
    [...s.regimes],
    ...(lists ? [codesOf(s), s.form?.code ?? ''] : []),
  ]);
}

/**
 * Ставки единого налога по коду (прототип gkEnRows): строки ст. 423 с самым точным совпадением начала
 * кода (несколько — если ставка зависит от выручки или признаков контрагента); особые ставки — только
 * когда обычной нет; ставка статуса (ПКИ) — только контрагенту с ним, и тогда первой; без совпадения —
 * «Остальные виды деятельности».
 */
export function gkedRates(
  code: string,
  benefits: readonly string[],
  rates: readonly GkedRate[],
  index: GkedIndex,
): GkedRate[] {
  const own = rates.filter((x) => {
    const benefit = EN_BENEFIT[x.code];
    return benefit && benefits.includes(benefit) && !!fit(x.gked, [code], index)?.length;
  });
  if (own.length) return own;
  let best: GkedRate[] = [];
  let length = -1;
  for (const x of rates) {
    const r = x.gked;
    if (EN_BENEFIT[x.code] || isEmptyRule(r) || !r!.in.length) continue;
    if (!fit(r, [code], index)?.length) continue;
    const l = Math.max(
      ...r!.in.filter((p) => gkedHit(code, p, index)).map((p) => (SECTION.test(p) ? 0 : p.length)),
    );
    if (l > length) {
      length = l;
      best = [x];
    } else if (l === length) best.push(x);
  }
  const usual = best.filter((x) => !EN_SPECIAL.includes(x.code));
  if (usual.length) best = usual;
  if (!best.length) {
    const other = rates.find((x) => x.code === EN_OTHER);
    if (other) best = [other];
  }
  return best;
}

/** Контрагент для строк ЕНС по умолчанию: ГКЭД, статусы и место деятельности. */
export interface SingleTaxSubject {
  gked: string | null;
  gkedExtra: readonly string[];
  benefits: readonly string[];
  /** Город УГНС и юридический адрес (прототип enPlace). */
  place: string;
}

/** Города в названии варианта: «Бишкек и Ош» → «Бишкек», «Ош»; «остальная территория» — без городов. */
const placeNames = (name: string) => (/^[А-ЯЁ]/.test(name) ? name.split(/\s+и\s+|,\s*/) : []);

/**
 * Вариант ставки по месту (прототип enVarAuto): у вариантов по городам («Бишкек и Ош — 5 %, остальная
 * территория — 3 %») — вариант с городом места деятельности, иначе вариант без городов; у вариантов не
 * по месту и без места — первый; у ставки без вариантов — пусто.
 */
export function placeVariant(rate: string, place: string): number | null {
  const variants = rateVariants(rate);
  if (variants.length < 2) return null;
  if (!place || !variants.some((v) => placeNames(v.name).length)) return 0;
  const word = (w: string) =>
    new RegExp(`(^|[^А-Яа-яЁё])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^А-Яа-яЁё]|$)`);
  const hit = variants.findIndex((v) => placeNames(v.name).some((w) => word(w).test(place)));
  return hit >= 0
    ? hit
    : Math.max(
        0,
        variants.findIndex((v) => !placeNames(v.name).length),
      );
}

/**
 * Строки «Ставок единого налога» по умолчанию в назначении (прототип enAuto, enItem): основная — по
 * основному ГКЭД и статусам (резидент ПКИ — ЕНС-13), без ГКЭД — «Остальные виды деятельности»;
 * дополнительные ГКЭД с другой ставкой — свои строки, кроме ставок на всю деятельность (ЕНС-01, 05, 13,
 * 15); вариант — по месту деятельности.
 */
export function defaultSingleTaxRates(
  s: SingleTaxSubject,
  rates: readonly GkedRate[],
  index: GkedIndex,
): { code: string; variant: number | null }[] {
  const main = s.gked
    ? gkedRates(s.gked, s.benefits, rates, index)[0]
    : rates.find((x) => x.code === EN_OTHER);
  if (!main) return [];
  const out = [main];
  if (!EN_ONE.includes(main.code)) {
    for (const code of s.gkedExtra) {
      const x = gkedRates(code, s.benefits, rates, index).find((y) => !EN_ONE.includes(y.code));
      if (x && !out.some((e) => e.code === x.code)) out.push(x);
    }
  }
  return out.map((x) => ({ code: x.code, variant: placeVariant(x.rate, s.place) }));
}

/**
 * Сверка контрагента с ГКЭД (прототип gkCheck). `confirmed` — сохранённое подтверждение: действует,
 * только если набор данных не менялся (`gkedSignature`). `assigned` — коды назначенных видов отчётов.
 */
export function gkedCheck(
  s: GkedSubject,
  dicts: GkedDicts,
  confirmed: GkedConfirmation | null = null,
  assigned: readonly string[] = [],
): GkedCheck {
  const { index } = dicts;
  const codes = codesOf(s);
  const out: GkedCheck = {
    block: [],
    regime: [],
    confirm: [],
    benefits: [],
    rate: [],
    types: [],
    off: codes.filter((k) => index.get(k)?.active !== true),
  };
  if (!codes.length) return out;
  const regimeOf = (code: string) => dicts.regimes.find((r) => r.code === code);
  const ok = confirmed && confirmed.sig === gkedSignature(s, dicts.regimes) ? confirmed : null;

  for (const code of s.regimes) {
    const r = regimeOf(code);
    if (!r?.gked || (isEmptyRule(r.gked) && !hasLists(r.gked))) continue;
    const g0 = r.gked;
    // who:'org' — перечень задан только для организаций: ИП без своего перечня не проверяется.
    if (g0.who === 'org' && isIp(s) && !hasLists(g0)) continue;
    const g = ruleFor(g0, s);
    const base = { regime: r.code, regimeName: r.name };
    // Перечень по форме собственности (патент): ни один ГКЭД не входит — вопрос с подтверждением.
    if (hasLists(g0)) {
      const f = fit(g, codes, index);
      if (f && !f.length) {
        const need: GkedConfirmNeed = {
          ...base,
          code: s.gked ?? codes[0]!,
          list: listOf(s),
          group: null,
          ask: '',
          article: r.article || 'НК КР',
        };
        out.confirm.push(need);
        out.regime.push({ ...need, kind: 'confirm', confirmed: ok, verify: verifyOf(g) });
        continue;
      }
    }
    if (g.strict === 'main' && s.gked && g.ex.some((p) => gkedHit(s.gked!, p, index))) {
      out.block.push({ ...base, code: s.gked, article: articleOf(g, r) });
      continue;
    }
    // Основной ГКЭД из «Предупреждать при ГКЭД»: код не отличает запрещённую деятельность от
    // разрешённой — вопрос с подтверждением.
    if (s.gked && (g.warn ?? []).some((p) => gkedHit(s.gked!, p, index))) {
      const group =
        dicts.groups.find((x) => x.codes.some((p) => gkedHit(s.gked!, p, index))) ?? null;
      const need: GkedConfirmNeed = {
        ...base,
        code: s.gked,
        list: null,
        group,
        ask: group?.ask ?? '',
        article: articleOf(g, r),
      };
      out.confirm.push(need);
      out.regime.push({ ...need, kind: 'confirm', confirmed: ok, verify: verifyOf(g) });
    }
    const excluded = codes.filter((k) => g.ex.some((p) => gkedHit(k, p, index)));
    const f = fit(g, codes, index, s);
    if (f && !f.length) out.regime.push({ ...base, kind: 'unfit', verify: verifyOf(g) });
    else if (excluded.length) {
      out.regime.push({ ...base, kind: 'excluded', codes: excluded, verify: verifyOf(g) });
    }
  }

  // Правило «только подсказка»: несовпадение ни на что не влияет.
  for (const code of s.benefits) {
    const b = dicts.benefits.find((x) => x.code === code);
    if (!b || b.gked?.hint) continue;
    const f = fit(b.gked, codes, index, s);
    if (f && !f.length)
      out.benefits.push({ benefit: b.code, name: b.name, verify: verifyOf(b.gked) });
  }

  if (s.regimes.includes(SINGLE_TAX_REGIME) && s.gked) {
    const main = gkedRates(s.gked, s.benefits, dicts.rates, index);
    const first = main[0];
    if (first) out.rate.push({ kind: 'main', code: s.gked, rates: main });
    const one = main.filter((x) => EN_ONE.includes(x.code));
    if (one.length === main.length) {
      if (s.gkedExtra.length) out.rate.push({ kind: 'one' });
    } else {
      for (const k of s.gkedExtra) {
        const x = gkedRates(k, s.benefits, dicts.rates, index)[0];
        if (x && first && x.rate !== first.rate)
          out.rate.push({ kind: 'extra', code: k, rate: x, one });
      }
    }
  }

  // Режимный вид при режиме с перечнем ГКЭД (патент) проверяется перечнем режима — второй раз не
  // предупреждаем.
  const byRegimeList = (t: GkedReportType) =>
    t.kind === 'regime' &&
    t.regimes.some((code) => s.regimes.includes(code) && !isEmptyRule(regimeOf(code)?.gked));
  for (const id of assigned) {
    const t = dicts.types.find((x) => x.code === id);
    if (!t || t.gked?.hint || byRegimeList(t)) continue;
    const f = fit(t.gked, codes, index, s);
    if (f && !f.length) out.types.push(t.shortName);
  }
  return out;
}

/** Тексты сверки по разделам — как в форме и карточке контрагента (прототип gkCheck, gkNote). */
export interface GkedCheckTexts {
  block: string[];
  regime: string[];
  benefits: string[];
  rate: string[];
  types: string[];
  off: string[];
}

const verifyText = (text: string, v: GkedVerify, t: Translate) =>
  v ? `${text} ${t(v === 'list' ? 'cp.gked.verify.list' : 'cp.gked.verify.partial')}` : text;

/** Название группы для текста: «Прочие финансово-кредитные (МФО…)» → «прочие финансово-кредитные». */
const groupText = (g: GkedGroup) => g.name.replace(/ \(.*$/, '').toLowerCase();

const dateText = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

function confirmState(
  issue: GkedConfirmNeed & { confirmed: GkedConfirmation | null },
  t: Translate,
): string {
  const ok = issue.confirmed;
  if (!ok) return t('cp.gked.state.need');
  const who = t('cp.gked.state.ok', { who: ok.by, date: dateText(ok.at) });
  // Вопрос с ответом «нет» — только у предупреждения по коду; у перечня патента вопроса нет.
  return ok.ask && !issue.list ? `${who}${t('cp.gked.state.ask', { ask: ok.ask })}` : who;
}

function regimeText(issue: GkedRegimeIssue, t: Translate): string {
  const regime = issue.regimeName;
  switch (issue.kind) {
    case 'confirm': {
      const state = confirmState(issue, t);
      const text = issue.list
        ? t('cp.gked.list', { regime, list: t(`cp.gked.list.${issue.list}`), state })
        : t('cp.gked.warn', {
            regime,
            code: issue.code,
            group: issue.group
              ? ` ${t('cp.gked.warn.group', { group: groupText(issue.group) })}`
              : '',
            article: issue.article,
            state,
          });
      return verifyText(text, issue.verify, t);
    }
    case 'unfit':
      return verifyText(t('cp.gked.unfit', { regime }), issue.verify, t);
    case 'excluded':
      return verifyText(
        t('cp.gked.excluded', { regime, codes: issue.codes.join(', ') }),
        issue.verify,
        t,
      );
  }
}

const rateItem = (x: GkedRate, t: Translate) =>
  t('cp.gked.rate.item', { rate: x.rate, activity: x.activity });

function rateText(hint: GkedRateHint, t: Translate): string {
  switch (hint.kind) {
    case 'main':
      return t('cp.gked.rate.main', {
        code: hint.code,
        rates: hint.rates.map((x) => rateItem(x, t)).join(` ${t('cp.gked.rate.or')} `),
      });
    case 'one':
      return t('cp.gked.rate.one');
    case 'extra':
      return t('cp.gked.rate.extra', {
        code: hint.code,
        rate: rateItem(hint.rate, t),
        one: hint.one.length
          ? t('cp.gked.rate.extra_one', { rates: hint.one.map((x) => x.rate).join(', ') })
          : '',
      });
  }
}

/** Окно «Проверьте право на режим «…»» (прототип gkEnOk): заголовок, текст и кнопка подтверждения. */
export interface GkedConfirmDialog {
  title: string;
  text: string;
  ok: string;
}

/**
 * Текст окна подтверждения права на режим — как в прототипе gkEnOk: у перечня патента — все коды
 * контрагента, у «Предупреждать при ГКЭД» — основной код, группа и вопрос группы (тогда кнопка «Нет, не
 * оказывает»). `codes` — основной и дополнительные ГКЭД, `names` — их названия.
 */
export function gkedConfirmDialog(
  need: GkedConfirmNeed,
  codes: readonly string[],
  names: ReadonlyMap<string, string>,
  t: Translate,
): GkedConfirmDialog {
  const regime = need.regimeName;
  const code = (k: string) => t('cp.gked.confirm.code', { code: k, name: names.get(k) ?? '' });
  const ask = need.list ? '' : need.ask;
  const text = need.list
    ? t('cp.gked.confirm.list', {
        codes: codes.map(code).join(', '),
        regime,
        list: t(`cp.gked.list.${need.list}`),
        article: need.article,
      })
    : t(ask ? 'cp.gked.confirm.ask' : 'cp.gked.confirm.warn', {
        code: code(need.code),
        group: need.group ? ` (${groupText(need.group)})` : '',
        regime,
        article: need.article,
      });
  return {
    title: ask || t('cp.gked.confirm.title', { regime }),
    text: `${text}\n\n${t('cp.gked.confirm.tail')}`,
    ok: t(ask ? 'cp.gked.confirm.ok_ask' : 'cp.gked.confirm.ok'),
  };
}

/** Сверка словами: тексты из словаря (прототип — те же строки). */
export function gkedCheckTexts(check: GkedCheck, t: Translate): GkedCheckTexts {
  return {
    block: check.block.map((b) =>
      t('cp.gked.block', { regime: b.regimeName, code: b.code, article: b.article }),
    ),
    regime: check.regime.map((r) => regimeText(r, t)),
    benefits: check.benefits.map((b) =>
      verifyText(t('cp.gked.benefit', { benefit: b.name }), b.verify, t),
    ),
    rate: check.rate.map((r) => rateText(r, t)),
    types: check.types,
    off: check.off,
  };
}
