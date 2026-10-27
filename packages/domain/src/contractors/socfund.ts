import { diffDays, type IsoDate } from '../common/dates';
import { formatSomWithUnit, type Tyiyn } from '../common/money';
import type { Translate } from '../l10n/texts';
import { gkedHit, type GkedIndex } from './gked';
import type { ContractorKind } from './rules';

/*
 * Тариф страховых взносов в Соцфонд у контрагента (ТЗ «Контрагенты» → «Тариф страховых взносов в
 * Соцфонд (СПиНО)»; прототип core/socfund.js — sfAuto, sfState, sfBadWhy, sfPeniNote — и
 * modules/socfund-ui.js — sfManBad, sfApply). Тариф — признак контрагента: зарплату платформа не
 * считает. Цифры (ставки, предельная база, пеня) и ограничения по ГКЭД — только из справочника:
 * налог-взнос с тарифами (ПЛТ-01) и статус СПиНО (ЛЬГ-29). Ответы сверены с прототипом:
 * scripts/oracle-socfund.mjs.
 */

/** Тарифы, которые бывают у контрагента (пенсионеров и инвалидов — по работнику, здесь не выбираются). */
export const SOCFUND_TARIFFS = ['spino', 'general', 'pvtpki'] as const;
export type SocfundTariffId = (typeof SOCFUND_TARIFFS)[number];

/** Признаки контрагента для тарифа: зарплата безналично, реестр в Салык.кг, подтверждение ГНС, госфинансирование. */
export const SOCFUND_FLAGS = ['cashless', 'registry', 'confirmed', 'gov'] as const;
export type SocfundFlag = (typeof SOCFUND_FLAGS)[number];
/** Указанные признаки: да или нет; не указанного признака в объекте нет (как `sf` прототипа). */
export type SocfundFlags = Partial<Record<SocfundFlag, boolean>>;

/** Тариф из справочника (guide.tariffs налога-взноса). */
export interface SocfundTariff {
  id: SocfundTariffId;
  name: string;
  /** Кратко — в списках и карточке («СПиНО»). */
  short: string;
  total: string;
  /** Коды статусов тарифа: у СПиНО — его статус (ЛЬГ-29), у ПВТ / ПКИ — статусы резидентов. */
  statuses: readonly string[];
  parts: readonly { payer: string; rate: string }[];
  cap: { base: string; amount: string; since: string } | null;
  /** «Сверить»: ставки ещё сверяет тема по налогам. */
  verify: boolean;
}

/** Статус СПиНО в «Налоговых льготах и особых статусах»: запрещающие коды, коды с предупреждением, формы. */
export interface SocfundStatus {
  code: string;
  name: string;
  /** «Кроме» — тариф не предлагается. */
  ex: readonly string[];
  /** «Предупреждать при ГКЭД». */
  warn: readonly string[];
  /** Формы собственности, при которых напомнить о признаке «Госфинансирование». */
  warnForms: readonly string[];
}

/** Справочные данные для тарифа. */
export interface SocfundDict {
  /** Тарифы по порядку: СПиНО, базовый, ПВТ / ПКИ — какие есть в справочнике. */
  tariffs: readonly SocfundTariff[];
  status: SocfundStatus | null;
  /** Названия статусов по коду — для статусов резидентов. */
  statusNames: ReadonlyMap<string, string>;
  /** Исключения закона по ГКЭД (guide.exceptionsGked): текст и коды — запрещающие и с предупреждением. */
  exceptions: readonly { text: string; codes: readonly string[] }[];
  /** Названия кодов ГКЭД — для кода из списков статуса без текста исключения. */
  gkedNames: ReadonlyMap<string, string>;
  /** Основной ГКЭД контрагента и его предки — для правил «секция буквой». */
  index: GkedIndex;
  /** Виды отчётов, по которым сдаются взносы (guide.reportTypes: STI-161). */
  reportTypes: readonly string[];
}

/** Контрагент для тарифа. */
export interface SocfundSubject {
  kind: ContractorKind;
  /** Основания для сквозных отчётов. */
  bases: readonly string[];
  /** Виды отчётов действующих назначений. */
  activeTypes: readonly string[];
  gked: string | null;
  form: { code: string; name: string } | null;
  /** Коды льгот и статусов. */
  benefits: readonly string[];
  flags: SocfundFlags;
}

/** Выбранный у контрагента тариф: вручную ли и почему. */
export interface SocfundChoice {
  id: SocfundTariffId;
  manual: boolean;
  reason: string | null;
}

/** Основание «Есть наёмные сотрудники». */
export const EMPLOYEES_BASE = 'employees';

export type SocfundWhy =
  | { reason: 'resident'; statuses: string[] }
  | { reason: 'gked_block'; gked: string; text: string }
  | { reason: 'gov' | 'cashless' | 'registry' | 'confirmed' | 'all_met' };

/** Чего не хватает, чтобы определить тариф. */
export type SocfundMissing = 'gked' | 'cashless' | 'registry' | 'confirmed';

export type SocfundWarning =
  | { reason: 'resident_verify' }
  | { reason: 'gked_warn'; gked: string; text: string }
  | { reason: 'form'; form: string };

/** Тариф по условиям: `tariff` null — не определён (не хватает `miss`). */
export interface SocfundAuto {
  tariff: SocfundTariffId | null;
  why: SocfundWhy[];
  miss: SocfundMissing[];
  warn: SocfundWarning[];
}

/**
 * Состояние у контрагента: выбранный тариф, тариф по условиям, `bad` — выбранный не совпадает с
 * условиями, `none` — не выбран, `ask` — «Тариф под вопросом» (не выбран или выбран вручную вопреки
 * условиям).
 */
export interface SocfundState {
  auto: SocfundAuto;
  choice: SocfundChoice | null;
  bad: boolean;
  none: boolean;
  ask: boolean;
}

const tariffOf = (dict: SocfundDict, id: SocfundTariffId | null | undefined) =>
  id ? (dict.tariffs.find((t) => t.id === id) ?? null) : null;

/**
 * true — тариф нужен и без основания «Есть наёмные сотрудники», если у контрагента действует назначение
 * вида со взносами (STI-161), как в прототипе (sfNeed); false — только по основанию, как в ТЗ.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#А-5 — до решения заказчика по ТЗ.
export const SOCFUND_BY_REPORT = false;

/**
 * Признаки показываются и тариф определяется: постоянный контрагент с основанием «Есть наёмные
 * сотрудники» (и с действующим STI-161, если `SOCFUND_BY_REPORT`).
 */
export function socfundNeeded(
  s: Pick<SocfundSubject, 'kind' | 'bases' | 'activeTypes'>,
  dict: Pick<SocfundDict, 'reportTypes'>,
): boolean {
  return (
    s.kind !== 'oneoff' &&
    (s.bases.includes(EMPLOYEES_BASE) ||
      (SOCFUND_BY_REPORT && s.activeTypes.some((t) => dict.reportTypes.includes(t))))
  );
}

/** Основной ГКЭД в списках статуса СПиНО: `block` — запрещающий код, иначе предупреждение. */
export function socfundGkedHit(
  gked: string | null,
  dict: SocfundDict,
): { block: boolean; code: string; text: string } | null {
  const st = dict.status;
  if (!st || !gked) return null;
  const hit = (p: string) => gkedHit(gked, p, dict.index);
  const ex = st.ex.find(hit);
  const code = ex ?? st.warn.find(hit);
  if (!code) return null;
  const e = dict.exceptions.find((x) => x.codes.some((k) => k === code || hit(k)));
  return {
    block: !!ex,
    code,
    text: e ? e.text : (dict.gkedNames.get(code) ?? '').toLowerCase(),
  };
}

/** Тариф по условиям (прототип sfAuto); null — тариф контрагенту не нужен или его нет в справочнике. */
export function socfundAuto(s: SocfundSubject, dict: SocfundDict): SocfundAuto | null {
  if (!socfundNeeded(s, dict)) return null;
  const sp = tariffOf(dict, 'spino');
  const gen = tariffOf(dict, 'general');
  const res = tariffOf(dict, 'pvtpki');
  if (!sp || !gen) return null;
  const residents = res
    ? s.benefits
        .filter((b) => res.statuses.includes(b) && dict.statusNames.has(b))
        .map((b) => dict.statusNames.get(b)!)
        .sort((a, b) => a.localeCompare(b, 'ru'))
    : [];
  if (res && residents.length) {
    return {
      tariff: 'pvtpki',
      why: [{ reason: 'resident', statuses: residents }],
      miss: [],
      warn: res.verify ? [{ reason: 'resident_verify' }] : [],
    };
  }
  const why: SocfundWhy[] = [];
  const miss: SocfundMissing[] = [];
  const warn: SocfundWarning[] = [];
  if (!s.gked) miss.push('gked');
  else {
    const h = socfundGkedHit(s.gked, dict);
    if (h?.block) why.push({ reason: 'gked_block', gked: s.gked, text: h.text });
    else if (h) warn.push({ reason: 'gked_warn', gked: s.gked, text: h.text });
  }
  if (s.form && dict.status?.warnForms.includes(s.form.code)) {
    warn.push({ reason: 'form', form: s.form.name });
  }
  if (s.flags.gov === true) why.push({ reason: 'gov' });
  for (const k of ['cashless', 'registry', 'confirmed'] as const) {
    const v = s.flags[k];
    if (v === false) why.push({ reason: k });
    else if (v === undefined) miss.push(k);
  }
  if (why.length) return { tariff: 'general', why, miss, warn: [] };
  if (miss.length) return { tariff: null, why: [], miss, warn };
  return { tariff: 'spino', why: [{ reason: 'all_met' }], miss: [], warn };
}

/** Состояние у контрагента (прототип sfState); null — тариф не нужен. */
export function socfundState(
  s: SocfundSubject,
  choice: SocfundChoice | null,
  dict: SocfundDict,
): SocfundState | null {
  const auto = socfundAuto(s, dict);
  if (!auto) return null;
  const cur = choice && tariffOf(dict, choice.id) ? choice : null;
  const bad = !!cur && !!auto.tariff && cur.id !== auto.tariff;
  return { auto, choice: cur, bad, none: !cur, ask: !cur || (bad && cur.manual) };
}

/** Тексты причин, недостающих признаков и предупреждений — как в прототипе. */
export function socfundAutoTexts(
  auto: SocfundAuto,
  dict: SocfundDict,
  t: Translate,
): { why: string[]; miss: string[]; warn: string[] } {
  const spino = socfundShort(tariffOf(dict, 'spino'));
  return {
    why: auto.why.map((w) => {
      switch (w.reason) {
        case 'resident':
          return t('cp.socfund.why.resident', { names: w.statuses.join('», «') });
        case 'gked_block':
          return t('cp.socfund.why.gked_block', { gked: w.gked, tariff: spino, text: w.text });
        default:
          return t(`cp.socfund.why.${w.reason}`);
      }
    }),
    miss: auto.miss.map((m) => t(`cp.socfund.miss.${m}`)),
    warn: auto.warn.map((w) => {
      switch (w.reason) {
        case 'resident_verify':
          return t('cp.socfund.warn.resident_verify', {
            tariff: socfundShort(tariffOf(dict, 'pvtpki')),
          });
        case 'gked_warn':
          return t('cp.socfund.warn.gked_warn', { gked: w.gked, tariff: spino, text: w.text });
        case 'form':
          return t('cp.socfund.warn.form', { form: w.form });
      }
    }),
  };
}

/** Почему выбранный тариф расходится с условиями (прототип sfBadWhy); '' — не расходится. */
export function socfundBadWhy(st: SocfundState, dict: SocfundDict, t: Translate): string {
  if (!st.bad || !st.choice || !st.auto.tariff) return '';
  if (st.choice.id === 'spino' || st.auto.tariff === 'pvtpki') {
    return socfundAutoTexts(st.auto, dict, t).why.join('; ');
  }
  if (st.choice.id === 'pvtpki') return t('cp.socfund.bad.no_resident');
  return t('cp.socfund.bad.fits', { tariff: socfundShort(tariffOf(dict, st.auto.tariff)) });
}

/** Кратко: «СПиНО». */
export function socfundShort(t: SocfundTariff | null): string {
  return t ? t.short || t.name : '';
}

/** Название: у СПиНО — название статуса из справочника, у остальных — краткое (прототип sfTitle). */
export function socfundTitle(t: SocfundTariff | null, dict: SocfundDict): string {
  if (!t) return '';
  return t.id === 'spino' && dict.status ? dict.status.name : socfundShort(t);
}

/** Ставки одной строкой: «работодатель 2,25 %, работник 10 %; итого 12,25 %» (прототип sfRatesTxt). */
export function socfundRatesText(x: SocfundTariff | null, t: Translate): string {
  if (!x) return '';
  return [
    x.parts.map((p) => `${p.payer.replace(/\s*\(.*\)$/, '').toLowerCase()} ${p.rate}`).join(', '),
    x.total ? t('cp.socfund.rates_total', { total: x.total }) : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/** Предельная база и наибольшие взносы на работника (прототип sfCapTxt); '' — нет. */
export function socfundCapText(x: SocfundTariff | null, t: Translate): string {
  const c = x?.cap;
  if (!c) return '';
  return [
    c.base ? t('cp.socfund.cap.base', { base: c.base }) : '',
    c.amount ? t('cp.socfund.cap.amount', { amount: c.amount }) : '',
    c.since ? t('cp.socfund.cap.since', { since: c.since }) : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** Подсказка под тарифом в карточке отчёта (прототип report-card.js); '' — у тарифа нет предельной базы. */
export function socfundCapHint(x: SocfundTariff | null, t: Translate): string {
  const cap = socfundCapText(x, t);
  return cap ? t('cp.socfund.cap_hint', { cap }) : '';
}

/**
 * Пояснение к виду со взносами в «Подборе отчётов» (прототип sfTypeNote): выбранный тариф, без него —
 * тариф по условиям со ставками и предельной базой; нет ни того ни другого — предупреждение. `title`
 * экран выделяет, `text` идёт следом.
 */
export function socfundTypeNote(
  cur: SocfundTariff | null,
  auto: SocfundTariff | null,
  t: Translate,
): { warn: boolean; title: string; text: string } {
  const x = cur ?? auto;
  if (!x) return { warn: true, title: '', text: t('cp.socfund.type_note.none') };
  const cap = socfundCapText(x, t);
  return {
    warn: false,
    title: t('cp.socfund.type_note.title', { tariff: socfundShort(x) }),
    text:
      (cur ? '' : ` ${t('cp.socfund.type_note.auto')}`) +
      ` — ${socfundRatesText(x, t)}.` +
      (cap ? ` ${t('cp.socfund.type_note.cap', { cap: cap.replace(/^база /, '') })}` : ''),
  };
}

/**
 * Что пришло из формы: признаки, выбранный тариф (`undefined` — выбор не трогали, `null` — «Определить
 * автоматически») и причина ручного выбора.
 */
export interface SocfundInput {
  flags: SocfundFlags;
  tariff?: SocfundTariffId | null;
  reason?: string;
}

/** Только указанные признаки, по порядку. */
export function socfundFlagsOf(flags: Readonly<Record<string, unknown>>): SocfundFlags {
  const out: SocfundFlags = {};
  for (const k of SOCFUND_FLAGS) if (typeof flags[k] === 'boolean') out[k] = flags[k];
  return out;
}

/**
 * Выбор вручную расходится с условиями или условия не позволяют определить тариф (прототип sfManBad):
 * нужны причина и подтверждение. `s` — контрагент с новыми признаками.
 */
export function socfundManualMismatch(
  s: SocfundSubject,
  input: SocfundInput,
  dict: SocfundDict,
): boolean {
  if (!input.tariff) return false;
  const a = socfundAuto(s, dict);
  return !!a && (!a.tariff || a.tariff !== input.tariff);
}

/**
 * Что сохранить (прототип sfApply): признаки и, если тариф меняется, новый выбор. Без выбора — тариф
 * по условиям, но только если тарифа не было или выбор сбросили на «Определить автоматически»: уже
 * выбранный тариф сам не меняется (вместо этого — «Тариф … больше не применим»). Выбор, совпавший с
 * условиями, — не ручной. `s` — контрагент с новыми признаками; `choice` — сохранённый выбор.
 */
export function socfundDecide(
  s: SocfundSubject,
  choice: SocfundChoice | null,
  input: SocfundInput,
  dict: SocfundDict,
): { flags: SocfundFlags; choice: SocfundChoice | null; changed: boolean } {
  const flags = socfundFlagsOf(input.flags);
  const keep = { flags, choice, changed: false };
  const a = socfundAuto({ ...s, flags }, dict);
  if (!a) return keep;
  if (!input.tariff) {
    const touched = input.tariff === null;
    const go = a.tariff && (!choice || touched) && (choice?.id !== a.tariff || choice.manual);
    return go
      ? { flags, choice: { id: a.tariff!, manual: false, reason: null }, changed: true }
      : keep;
  }
  const manual = !a.tariff || a.tariff !== input.tariff;
  if (input.tariff === choice?.id && manual === !!choice?.manual) return keep;
  const reason = manual ? (input.reason ?? '').trim() || null : null;
  return { flags, choice: { id: input.tariff, manual, reason }, changed: true };
}

/** Запись истории «Признаки для тарифа Соцфонда: … — да; …» (прототип sfApply). */
export function socfundFlagsHistoryText(flags: SocfundFlags, t: Translate): string {
  return t('cp.socfund.history.flags', {
    flags: SOCFUND_FLAGS.filter((k) => typeof flags[k] === 'boolean')
      .map((k) =>
        t('cp.socfund.history.flag', {
          flag: t(`cp.socfund.flag.${k}`),
          value: t(flags[k] ? 'cp.socfund.yes' : 'cp.socfund.no'),
        }),
      )
      .join('; '),
  });
}

/**
 * Запись истории о смене тарифа (прототип sfSet): «Тариф Соцфонда: СПиНО → Базовый тариф (выбран
 * вручную: …)». null — записи нет: тариф тот же и выбран не вручную.
 */
export function socfundTariffHistoryText(
  from: SocfundChoice | null,
  to: SocfundChoice | null,
  dict: SocfundDict,
  t: Translate,
): string | null {
  if (from?.id === to?.id && !to?.manual) return null;
  const name = (c: SocfundChoice | null) =>
    socfundShort(tariffOf(dict, c?.id)) || t('cp.socfund.undetermined');
  const how = to?.manual
    ? to.reason
      ? t('cp.socfund.manual_reason', { reason: to.reason })
      : t('cp.socfund.manual')
    : t('cp.socfund.auto');
  return t('cp.socfund.history.tariff', { from: name(from), to: name(to), how });
}

/** Текст подтверждения ручного выбора, который расходится с условиями (прототип sfConfirm). */
export function socfundConfirmText(
  s: SocfundSubject,
  choice: SocfundChoice | null,
  input: SocfundInput,
  dict: SocfundDict,
  t: Translate,
): string {
  const draft = { ...s, flags: socfundFlagsOf(input.flags) };
  const tariff = input.tariff ?? null;
  const st = socfundState(
    draft,
    tariff ? { id: tariff, manual: true, reason: null } : choice,
    dict,
  );
  const a = socfundAuto(draft, dict);
  const why =
    (st && socfundBadWhy(st, dict, t)) ||
    t('cp.socfund.confirm_miss', {
      miss: a ? socfundAutoTexts(a, dict, t).miss.join(', ') : '',
    });
  return t('cp.socfund.confirm', { tariff: socfundShort(tariffOf(dict, tariff)), why });
}

/** Пеня по налогу-взносу (guide.penalty): с какого дня, ставка в день, предел. */
export interface SocfundPenalty {
  start: string;
  rate: string;
  cap: string;
}

/**
 * Отчёт для подсказки о пене: срок, срок оплаты, просрочена ли сдача и оплата, сумма к уплате и
 * оплачено (тыйыны).
 */
export interface PenaltyReport {
  dueDate: IsoDate;
  payDue: IsoDate | null;
  overdue: boolean;
  payOverdue: boolean;
  amount: Tyiyn | null;
  paid: Tyiyn;
}

/**
 * Подсказка о пене у просроченного неоплаченного отчёта (прототип sfPeniNote): ставка из справочника,
 * примерная сумма на сегодня от неуплаченного. В суммы к уплате и деньги контрагента пеня не попадает.
 * '' — подсказки нет (не просрочен, оплачен полностью, у вида нет пени).
 */
export function penaltyText(
  r: PenaltyReport,
  p: SocfundPenalty | null,
  today: IsoDate,
  t: Translate,
): string {
  if (!p || !(r.overdue || r.payOverdue)) return '';
  const pct = parseFloat(p.rate.replace(',', '.'));
  // Как прототип: сомы с копейками, округление пени до копейки.
  const sum = r.amount === null ? 0 : r.amount / 100;
  const left = sum > 0 ? Math.max(0, sum - r.paid / 100) : 0;
  if (sum > 0 && !left) return '';
  const days = Math.max(0, diffDays(today, r.payDue ?? r.dueDate));
  let amt = left ? Math.round(((left * pct) / 100) * days * 100) / 100 : 0;
  if (/100 %/.test(p.cap) && amt > left) amt = left;
  const start = (p.start || t('cp.socfund.penalty.start')).replace(/^./, (x) => x.toUpperCase());
  const parts = [
    t('cp.socfund.penalty.rate', { start, rate: String(pct).replace('.', ',') }) +
      (p.cap ? ` (${p.cap})` : '') +
      '.',
  ];
  if (left && days) {
    parts.push(
      t('cp.socfund.penalty.estimate', {
        amount: formatSomWithUnit(Math.round(amt * 100)),
        days,
        left: formatSomWithUnit(Math.round(left * 100)),
      }),
    );
  }
  parts.push(t('cp.socfund.penalty.hint'));
  return parts.join(' ');
}
