import type { Translate, UiTextKey } from '../l10n/texts';
import type { GkedRule } from './catalog';

/*
 * Админка → «Справочники платформы» → «ГКЭД» (задача 2.38; ТЗ «ГКЭД — виды экономической
 * деятельности», «Виды деятельности (ГКЭД)» у режимов, ставок единого налога, льгот и видов отчётов;
 * прототип admin/gked-admin.js, core/gked.js gkRuleTxt, gkParse, gkRuleIn, gkGrpAct, gkGrpApply):
 * код нового кода и «Входит в», перечни «Виды деятельности (ГКЭД)» текстом и их разбор, общие группы
 * кодов — что каждая делает в едином налоге и в тарифе СПиНО.
 */

/** Уровни классификатора сверху вниз: у контрагента выбирается только подкласс. */
export const GKED_LEVEL_ORDER = [
  'section',
  'subsection',
  'division',
  'group',
  'class',
  'subclass',
] as const;
export type GkedLevel = (typeof GKED_LEVEL_ORDER)[number];

/** Подпись уровня из словаря: «Секция», «Подсекция», «Раздел», «Группа», «Класс», «Подкласс». */
export const gkedLevelKey = (level: string): UiTextKey => `pdicts.gked.level.${level}` as UiTextKey;

/** Код ГКЭД: секция — одна-две буквы, дальше 01, 01.1, 01.11, 01.11.1 (прототип gkEditDlg). */
export const GKED_CODE_PATTERN = /^([A-Z]{1,2}|\d\d(\.\d{1,2}(\.\d)?)?)$/;

/** Самое длинное название кода (в классификаторе — 231 знак) и примечание. */
export const GKED_NAME_MAX = 500;
export const GKED_NOTE_MAX = 2000;

/** Код классификатора для проверки «Входит в»: уровень. */
export interface GkedLevelOf {
  level: string;
}

export type GkedEditProblem =
  | { field: 'code'; code: 'gked_code_required' | 'gked_code_format' | 'gked_code_taken' }
  | {
      field: 'parentCode';
      code:
        | 'gked_parent_section'
        | 'gked_parent_required'
        | 'gked_parent_unknown'
        | 'gked_parent_self'
        | 'gked_parent_level';
    };

/**
 * Что не так с кодом в окне «Новый код ГКЭД» и «Изменить» (прототип gkEditDlg): новый код — в
 * формате классификатора и ещё не занят; у секции нет верхнего уровня, у остальных он обязателен,
 * есть в справочнике, не сам код и выше по классификатору.
 */
export function gkedEditProblems(
  value: { code: string; level: string; parentCode: string | null; isNew: boolean },
  index: ReadonlyMap<string, GkedLevelOf>,
): GkedEditProblem[] {
  const problems: GkedEditProblem[] = [];
  const code = value.code.trim();
  if (value.isNew) {
    if (!code) problems.push({ field: 'code', code: 'gked_code_required' });
    else if (!GKED_CODE_PATTERN.test(code))
      problems.push({ field: 'code', code: 'gked_code_format' });
    else if (index.has(code)) problems.push({ field: 'code', code: 'gked_code_taken' });
  }
  const parent = value.parentCode?.trim() || null;
  const levels: readonly string[] = GKED_LEVEL_ORDER;
  if (value.level === 'section') {
    if (parent) problems.push({ field: 'parentCode', code: 'gked_parent_section' });
  } else if (!parent) {
    problems.push({ field: 'parentCode', code: 'gked_parent_required' });
  } else if (parent === code) {
    problems.push({ field: 'parentCode', code: 'gked_parent_self' });
  } else {
    const up = index.get(parent);
    if (!up) problems.push({ field: 'parentCode', code: 'gked_parent_unknown' });
    else if (levels.indexOf(up.level) >= levels.indexOf(value.level)) {
      problems.push({ field: 'parentCode', code: 'gked_parent_level' });
    }
  }
  return problems;
}

/** Секция кода (прототип gkSec): буква верхнего уровня по цепочке «Входит в». */
export function gkedSectionOf(
  code: string,
  index: ReadonlyMap<string, { parentCode: string | null; level: string }>,
): string {
  let x = index.get(code);
  let at = code;
  for (let n = 0; x && n < 8; n++) {
    if (x.level === 'section') return at;
    if (!x.parentCode) return at;
    at = x.parentCode;
    x = index.get(at);
  }
  return at;
}

/* ───────────── «Виды деятельности (ГКЭД)» текстом ───────────── */

/** Перечни правила, которые правит администратор (служебные признаки сервер сохраняет). */
export const GKED_RULE_LISTS = ['in', 'ex', 'warn', 'ip', 'ipEx', 'itd'] as const;
export type GkedRuleList = (typeof GKED_RULE_LISTS)[number];

/** Правило без ограничения: нет ни перечня, ни «Кроме» (прототип gkEmpty). */
export function gkedRuleEmpty(r: GkedRule | null | undefined): boolean {
  return !r || (!(r.in ?? []).length && !(r.ex ?? []).length);
}

/**
 * Перечень одной строкой (прототип gkRuleTxt): «47, 56.10; кроме 47.26», только исключения — «все;
 * кроме …»; без ограничения — пусто. Так он и в Excel.
 */
export function gkedRuleText(r: GkedRule | null | undefined, t: Translate): string {
  if (!r || gkedRuleEmpty(r)) return '';
  const head = r.in.length ? r.in.join(', ') : t('pdicts.gked.rule.all');
  const tail = r.ex.length ? `${t('pdicts.gked.rule.except')} ${r.ex.join(', ')}` : '';
  return [head, tail].filter(Boolean).join('; ');
}

/** Коды без повторов, заглавными; разделители — запятая, точка с запятой и пробел (прототип gkParse). */
export function splitGkedCodes(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,;\s]+/)
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

/** Коды через запятую; каждый — из справочника, иначе `unknown` — каких нет. */
export function parseGkedCodes(
  text: string,
  known: ReadonlySet<string>,
): { codes: string[] } | { unknown: string[] } {
  const codes = splitGkedCodes(text);
  const unknown = codes.filter((c) => !known.has(c));
  return unknown.length ? { unknown } : { codes };
}

/**
 * Перечень из Excel (прототип gkRuleIn): «47, 56.10; кроме 47.26»; «все» или «все; кроме …» — только
 * исключения; пусто — без ограничения. Код, которого нет в справочнике, — ошибка (`unknown`).
 */
export function parseGkedRule(
  text: string,
  known: ReadonlySet<string>,
  t: Translate,
): { in: string[]; ex: string[] } | { unknown: string[] } {
  const s = text.trim();
  const all = t('pdicts.gked.rule.all').toLowerCase();
  if (!s || s.toLowerCase() === all) return { in: [], ex: [] };
  const except = t('pdicts.gked.rule.except').toLowerCase();
  const at = s.toLowerCase().search(new RegExp(`;\\s*${except}\\s*`));
  const head = at < 0 ? s : s.slice(0, at);
  const tail = at < 0 ? '' : s.slice(at).replace(new RegExp(`^;\\s*${except}\\s*`, 'i'), '');
  const a = head.trim().toLowerCase() === all ? { codes: [] } : parseGkedCodes(head, known);
  const b = parseGkedCodes(tail, known);
  if ('unknown' in a || 'unknown' in b) {
    return {
      unknown: [...('unknown' in a ? a.unknown : []), ...('unknown' in b ? b.unknown : [])],
    };
  }
  return { in: a.codes, ex: b.codes };
}

/**
 * Новые перечни поверх прежнего правила (прототип gkRuleKeep, gkRuleRead): служебные признаки
 * («только основной», «запрет», «только подсказка», примечание и «Сверить») сохраняются; пустой
 * перечень убирается. Ни перечней, ни признаков — правила нет (null).
 */
export function gkedRuleKeep(
  old: GkedRule | null | undefined,
  lists: Partial<Record<GkedRuleList, readonly string[]>>,
): GkedRule | null {
  const next: Record<string, unknown> = { ...(old ?? {}) };
  for (const k of GKED_RULE_LISTS) {
    if (!(k in lists)) continue;
    const v = [...(lists[k] ?? [])];
    if (k === 'in' || k === 'ex') next[k] = v;
    else if (v.length) next[k] = v;
    else delete next[k];
  }
  next.in ??= [];
  next.ex ??= [];
  const rule = next as unknown as GkedRule;
  const flags = Object.keys(rule).some((k) => !(GKED_RULE_LISTS as readonly string[]).includes(k));
  const listed = GKED_RULE_LISTS.some((k) => (rule[k] ?? []).length);
  return listed || flags ? rule : null;
}

/** Все коды перечней правила — для «Используется» кода и проверки, что коды есть в справочнике. */
export function gkedRuleCodes(r: GkedRule | null | undefined): string[] {
  if (!r) return [];
  return GKED_RULE_LISTS.flatMap((k) => r[k] ?? []);
}

/** Правило помечено «сверить» (прототип gkToVerify): есть «Сверить: …» или «сверить» в примечании. */
export function gkedRuleToVerify(r: GkedRule | null | undefined): boolean {
  return !!r && (!!r.verify || /сверить/i.test(r.note ?? ''));
}

/* ───────────── Общие группы кодов ───────────── */

/** Что делает код группы: «Запрет» или «Предупреждение» (с вопросом и подтверждением). */
export const GKED_GROUP_ACTS = ['ex', 'warn'] as const;
export type GkedGroupAct = (typeof GKED_GROUP_ACTS)[number];

/** Действие группы в законе: одно на всю группу, по кодам или ничего (null). */
export type GkedGroupActs = GkedGroupAct | Readonly<Record<string, GkedGroupAct>> | null;

/** Где действует группа: единый налог (ст. 419) и тариф СПиНО (ЛЬГ-29). */
export const GKED_GROUP_TARGETS = ['en', 'spino'] as const;
export type GkedGroupTarget = (typeof GKED_GROUP_TARGETS)[number];

/** Общая группа кодов (раздел `gkedGroups`): коды, действие в едином налоге и СПиНО, вопрос и «Почему». */
export interface GkedGroupValue {
  id: string;
  name: string;
  codes: readonly string[];
  en: GkedGroupActs;
  spino: GkedGroupActs;
  ask: string;
  why: string;
}

/** Ключ группы: латиница, цифры, «-» и «_» (прототип DX.gkgroups). */
export const GKED_GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** Действие кода группы в едином налоге или СПиНО (прототип gkGrpAct); ничего — пусто. */
export function gkedGroupAct(
  g: Pick<GkedGroupValue, GkedGroupTarget>,
  k: GkedGroupTarget,
  code: string,
): GkedGroupAct | '' {
  const a = g[k];
  if (!a) return '';
  return typeof a === 'string' ? a : (a[code] ?? '');
}

const actKey = (a: GkedGroupAct): UiTextKey => `pdicts.gked.act.${a}` as UiTextKey;

/**
 * Действие текстом (прототип gkActTxt): «Запрет», «Предупреждение», по кодам — «64.91 — предупреждение;
 * 66.12.9 — запрет», ничего — «—». Так и в Excel.
 */
export function gkedGroupActText(
  g: Pick<GkedGroupValue, GkedGroupTarget>,
  k: GkedGroupTarget,
  t: Translate,
): string {
  const a = g[k];
  if (!a) return '—';
  if (typeof a === 'string') return t(actKey(a));
  const parts = Object.entries(a).map(([c, x]) => `${c} — ${t(actKey(x)).toLowerCase()}`);
  return parts.join('; ') || '—';
}

/**
 * Действие из Excel (прототип gkActIn): «запрет», «предупреждение», пусто или «—» — на всю группу; «64.91
 * — предупреждение; 66.12.9 — запрет» — по кодам (коды — из справочника). Не разобрать — `error`.
 */
export function parseGkedGroupActs(
  text: string,
  known: ReadonlySet<string>,
  t: Translate,
): { value: GkedGroupActs } | { error: 'whole' | 'codes' } {
  const s = text.trim().toLowerCase();
  if (!s || s === '—' || s === '-') return { value: null };
  const one = (x: string): GkedGroupAct | '' => {
    const v = x.trim();
    if (!v) return '';
    if (t(actKey('ex')).toLowerCase().startsWith(v) || v.startsWith('запрет')) return 'ex';
    if (t(actKey('warn')).toLowerCase().startsWith(v) || v.startsWith('предупр')) return 'warn';
    return '';
  };
  if (!/[—:]/.test(s)) {
    const a = one(s);
    return a ? { value: a } : { error: 'whole' };
  }
  const out: Record<string, GkedGroupAct> = {};
  for (const part of s
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)) {
    const [c, a] = part.split(/\s*[—:]\s*/);
    const act = one(a ?? '');
    const code = (c ?? '').trim().toUpperCase();
    if (!code || !act || !known.has(code)) return { error: 'codes' };
    out[code] = act;
  }
  return { value: Object.keys(out).length ? out : null };
}

/**
 * Действия по кодам из окна группы (прототип gkGrpDlg `pack`): у всех кодов одно — одним словом (или
 * ничего), иначе — по кодам, без кодов без действия.
 */
export function packGkedGroupActs(
  codes: readonly string[],
  acts: Readonly<Record<string, GkedGroupAct | ''>>,
): GkedGroupActs {
  const list = codes.map((c) => acts[c] ?? '');
  if (list.every((x) => x === list[0])) return list[0] || null;
  return Object.fromEntries(
    codes.flatMap((c, i) => (list[i] ? [[c, list[i] as GkedGroupAct] as const] : [])),
  );
}

/**
 * Перечни «Кроме» и «Предупреждать при ГКЭД» правила после правки группы (прототип gkGrpApply): коды
 * прежней группы убираются из обоих, коды новой добавляются по действию в едином налоге или СПиНО.
 */
export function gkedGroupApply(
  rule: GkedRule | null,
  old: Pick<GkedGroupValue, 'codes' | GkedGroupTarget> | null,
  next: Pick<GkedGroupValue, 'codes' | GkedGroupTarget> | null,
  k: GkedGroupTarget,
): GkedRule {
  const r: GkedRule = rule ?? { in: [], ex: [] };
  const drop = new Set(old?.codes ?? []);
  const ex = new Set(r.ex.filter((c) => !drop.has(c)));
  const warn = new Set((r.warn ?? []).filter((c) => !drop.has(c)));
  for (const c of next?.codes ?? []) {
    const a = next ? gkedGroupAct(next, k, c) : '';
    if (a === 'ex') ex.add(c);
    else if (a === 'warn') warn.add(c);
  }
  const out: GkedRule = { ...r, ex: [...ex] };
  if (warn.size) out.warn = [...warn];
  else delete out.warn;
  return out;
}

/** Подпись перечня (ключи — ex и warn) одной строкой: по ней видно, что правило «как у единого налога». */
export const gkedGroupSignature = (r: GkedRule | null | undefined): string =>
  JSON.stringify([r?.ex ?? [], r?.warn ?? []]);
