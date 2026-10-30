// Эталон для тарифа Соцфонда у контрагента: sfAuto, sfState, sfBadWhy (core/socfund.js), sfManBad и
// sfApply (modules/socfund-ui.js) и подсказка о пене sfPeniNote из прототипа на справочниках refDB.json и
// gkedDB.json. Случаи — все контрагенты demoDB.json и придуманные контрагенты на каждую ветку: ПВТ / ПКИ,
// запрещающий и предупреждающий ГКЭД, госфинансирование, форма «Учреждение», нет признаков, нет ГКЭД,
// разовый, без наёмных сотрудников; сохранение — без выбора, с выбором по условиям и вручную. Вход
// записывается полями продукта (коды форм, льгот, оснований и видов). Запуск:
// node packages/domain/scripts/oracle-socfund.mjs — пишет
// packages/domain/src/contractors/__fixtures__/socfund.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const ref = JSON.parse(read('spec/data/refDB.json'));
const gkedItems = JSON.parse(read('spec/data/gkedDB.json')).items;
const demo = JSON.parse(read('spec/data/demoDB.json'));
const pick = (file, wanted) =>
  read(file)
    .split('\n')
    .filter((line) => wanted.test(line))
    .join('\n');
// Функция целиком: от «function имя(» до закрывающей скобки её тела (скобки считаются).
const block = (file, name) => {
  const text = read(file);
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`В ${file} не найдена функция ${name}`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`В ${file} не закрыта функция ${name}`);
};
const REF = 'spec/prototype/src/js/core/reference.js';
const SF = 'spec/prototype/src/js/core/socfund.js';
const SFUI = 'spec/prototype/src/js/modules/socfund-ui.js';
const TODAY = '2026-10-27';

const dicts = ref.dictionaries;
const code = (items, name, what) => {
  const x = items.find((i) => i.name === name);
  if (!x) throw new Error(`${what}: нет «${name}»`);
  return x.code;
};
const SPINO = 'Тариф Соцфонда 12,25 % (СПиНО)';
const ALL_YES = { cashless: true, registry: true, confirmed: true, gov: false };
const base = { form: 'ОсОО', kind: 'regular', bases: ['employees'], assign: [], ben: [] };
const invented = [
  { ...base, name: 'п. 38: 47.11, все признаки', gked: '47.11.0', sf: ALL_YES },
  {
    ...base,
    name: 'п. 38: СПиНО определён автоматически',
    gked: '47.11.0',
    sf: ALL_YES,
    sfT: 'spino',
    ben: [SPINO],
  },
  {
    ...base,
    name: 'п. 38: после смены ГКЭД на 64.19.1',
    gked: '64.19.1',
    sf: ALL_YES,
    sfT: 'spino',
    ben: [SPINO],
  },
  { ...base, name: 'п. 39: резидент ПКИ', gked: '62.01.0', ben: ['Резидент ПКИ'] },
  {
    ...base,
    name: 'п. 39: резидент ПКИ, СПиНО вручную',
    gked: '62.01.0',
    ben: ['Резидент ПКИ', SPINO],
    sfT: 'spino',
    sfMan: true,
    sfWhy: 'письмо ГНС',
  },
  {
    ...base,
    name: 'резидент ПВТ и ПКИ',
    gked: '62.01.0',
    ben: ['Резидент ПВТ', 'Резидент ПКИ'],
    sf: ALL_YES,
  },
  { ...base, name: 'предупреждение по ГКЭД 64.92', gked: '64.92.0', sf: ALL_YES },
  { ...base, name: 'предупреждение по разделу 84', gked: '84.11.0', sf: ALL_YES },
  { ...base, name: 'сотовая связь — запрет', gked: '61.20.0', sf: ALL_YES },
  { ...base, name: 'алкоголь — запрет, без признаков', gked: '11.01.0' },
  { ...base, name: 'госфинансирование', gked: '47.11.0', sf: { ...ALL_YES, gov: true } },
  {
    ...base,
    name: 'Учреждение — проверить госфинансирование',
    form: 'Учреждение',
    gked: '85.10.0',
    sf: ALL_YES,
  },
  { ...base, name: 'зарплата не безналично', gked: '47.11.0', sf: { ...ALL_YES, cashless: false } },
  { ...base, name: 'нет подтверждения ГНС и реестра', gked: '47.11.0', sf: { cashless: true } },
  { ...base, name: 'нет ГКЭД', gked: '', sf: ALL_YES },
  { ...base, name: 'нет ни ГКЭД, ни признаков', gked: '' },
  { ...base, name: 'без наёмных сотрудников', bases: [], gked: '47.11.0', sf: ALL_YES },
  {
    ...base,
    name: 'без основания, но со STI-161',
    bases: [],
    assign: [{ t: 'soc' }],
    gked: '47.11.0',
    sf: ALL_YES,
  },
  {
    ...base,
    name: 'снятое STI-161',
    bases: [],
    assign: [{ t: 'soc', to: '2026-09-30' }],
    gked: '47.11.0',
    sf: ALL_YES,
  },
  { ...base, name: 'разовый', kind: 'oneoff', gked: '47.11.0', sf: ALL_YES },
  {
    ...base,
    name: 'базовый вручную при условиях СПиНО',
    gked: '47.11.0',
    sf: ALL_YES,
    sfT: 'general',
    sfMan: true,
    sfWhy: 'так решил',
  },
  {
    ...base,
    name: 'базовый автоматически, условия изменились на СПиНО',
    gked: '47.11.0',
    sf: ALL_YES,
    sfT: 'general',
  },
  { ...base, name: 'ПВТ / ПКИ без статуса', gked: '47.11.0', sf: ALL_YES, sfT: 'pvtpki' },
  {
    ...base,
    name: 'СПиНО при неопределённом тарифе',
    gked: '47.11.0',
    sf: { cashless: true },
    sfT: 'spino',
  },
];
const subjects = [...demo.contractors, ...invented];

// Сохранение (sfApply): состояние формы — признаки, выбранный тариф, трогал ли пользователь выбор, причина.
const saves = [];
for (const [i, c] of subjects.entries()) {
  saves.push({ i, st: { sf: c.sf ?? {}, sfT: c.sfT ?? '', sfTouch: false, sfWhy: '' } });
  saves.push({ i, st: { sf: c.sf ?? {}, sfT: '', sfTouch: true, sfWhy: '' } });
  for (const t of ['spino', 'general', 'pvtpki'])
    saves.push({ i, st: { sf: c.sf ?? {}, sfT: t, sfTouch: true, sfWhy: ' причина ' } });
}
// п. 38 с тарифом СПиНО: признак сменился, выбор не трогали (тариф сам не меняется); признаки стёрли.
const p38 = subjects.findIndex((c) => c.name === 'п. 38: СПиНО определён автоматически');
saves.push(
  { i: p38, st: { sf: { ...ALL_YES, cashless: false }, sfT: 'spino', sfTouch: false, sfWhy: '' } },
  { i: p38, st: { sf: {}, sfT: 'spino', sfTouch: false, sfWhy: '' } },
);
// Не тронутый выбор в форме — всегда сохранённый тариф (прототип sfInit): иначе случай невозможен.
for (const { i, st } of saves) {
  if (!st.sfTouch && st.sfT !== (subjects[i].sfT ?? '')) {
    throw new Error(`Сохранение «${subjects[i].name}»: не тронутый выбор не совпадает с тарифом`);
  }
}

// Пеня: просроченный неоплаченный STI-161 на сегодня с суммой и без; сданный, но с просроченной оплатой.
const penalties = [
  {
    t: 'soc',
    due: '2026-10-20',
    payDue: '2026-10-20',
    overdue: false,
    payOverdue: true,
    sum: 10000,
    paid: 0,
  },
  { t: 'soc', due: '2026-10-20', payDue: '2026-10-20', overdue: true, sum: 10000, paid: 0 },
  { t: 'soc', due: '2026-10-20', payDue: '2026-10-20', overdue: true, sum: null, paid: 0 },
  { t: 'soc', due: '2026-10-20', payDue: '2026-10-20', overdue: true, sum: 10000, paid: 10000 },
  { t: 'soc', due: '2026-10-20', payDue: '2026-10-20', overdue: true, sum: 10000, paid: 2500.5 },
  { t: 'soc', due: '2025-01-20', payDue: '2025-01-20', overdue: true, sum: 100, paid: 0 },
  {
    t: 'soc',
    due: '2026-11-20',
    payDue: '2026-11-20',
    overdue: false,
    payOverdue: false,
    sum: 10000,
    paid: 0,
  },
  { t: 'nds', due: '2026-10-20', payDue: '2026-10-20', overdue: true, sum: 10000, paid: 0 },
];

const context = vm.createContext({
  REFDB: { ...ref, gked: gkedItems },
  SUBJECTS: subjects,
  SAVES: saves,
  PENALTIES: penalties,
  structuredClone,
});
vm.runInContext(
  `'use strict';
  const DB = { ref: REFDB };
  const TODAY = '${TODAY}';
  ${pick(REF, /^(const DICT=|const TAXES=|const RT=|const T=|const benOf=|const formEnd=)/)}
  ${pick('spec/prototype/src/js/core/data.js', /^(const (D|toIso|diffDays|addDays|som)=|function fmtM\()/)}
  const esc = (s) => String(s);
  const ic = () => '';
  const LOG = [];
  const log = (kind, id, text) => LOG.push(text);
  ${read('spec/prototype/src/js/core/gked.js')}
  ${read(SF)}
  ${block(SFUI, 'sfManBad')}
  ${pick(SFUI, /^const sfDraft=/)}
  ${block(SFUI, 'sfApply')}
  ${pick(SFUI, /^const sfTypeIds=/)}
  ${block(SFUI, 'sfTypeNote')}
  const state = (c) => {
    const a = sfAuto(c);
    const s = sfState(c);
    return {
      needed: sfNeed(c),
      auto: a && { t: a.t ? a.t.id : null, why: a.why, miss: a.miss, warn: a.warn },
      state: s && { bad: s.bad, none: s.none, ask: s.ask, why: sfBadWhy(s) },
      typeNote: sfTypeNote({ id: sfTypeIds()[0] }, c).replace(/<[^>]+>/g, ''),
    };
  };
  globalThis.oracle = {
    states: SUBJECTS.map((c) => state({ assign: [], ben: [], ...c })),
    saves: SAVES.map(({ i, st }) => {
      const c = structuredClone({ assign: [], ben: [], ...SUBJECTS[i] });
      const cx = structuredClone(c);
      const bad = sfManBad(cx, { ...st });
      LOG.length = 0;
      sfApply(c, { ...st });
      return {
        manBad: bad,
        sfT: c.sfT ?? null,
        sfMan: !!c.sfMan,
        sfWhy: c.sfWhy ?? '',
        spino: (c.ben || []).includes(sfSpBen().name),
        log: [...LOG],
      };
    }),
    penalties: PENALTIES.map((r) => sfPeniNote(r).replace(/<[^>]+>/g, '')),
    titles: sfTariffs().map((t) => ({ id: t.id, title: sfTitle(t), short: sfShort(t), rates: sfRatesTxt(t), cap: sfCapTxt(t) })),
  };`,
  context,
);
const { oracle } = context;

const formOf = (name) => {
  const f = dicts.forms.items.find((x) => x.name === name);
  if (!f) throw new Error(`Нет формы «${name}»`);
  return { code: f.code, name: f.name };
};
const flag = (sf, k) => (sf && typeof sf[k] === 'boolean' ? sf[k] : null);
const flagsOf = (sf) => ({
  cashless: flag(sf, 'cashless'),
  registry: flag(sf, 'registry'),
  confirmed: flag(sf, 'confirmed'),
  gov: flag(sf, 'gov'),
});

/** Контрагент прототипа → вход продукта: коды вместо названий. */
function subject(c) {
  return {
    kind: c.kind ?? 'regular',
    bases: c.bases ?? [],
    activeTypes: (c.assign ?? []).filter((a) => !a.to).map((a) => a.t),
    gked: c.gked || null,
    form: formOf(c.form),
    benefits: (c.ben ?? []).map((n) => code(dicts.benefits.items, n, 'Льгота')),
    flags: flagsOf(c.sf),
  };
}
const current = (c) => ({ tariff: c.sfT ?? null, manual: !!c.sfMan, reason: c.sfWhy ?? '' });

// Справочные данные полями продукта (SocfundDict): тарифы, статус СПиНО, названия статусов
// резидентов, исключения по ГКЭД, названия кодов статуса и коды контрагентов с предками.
const sfTax = ref.taxes.find((x) => (x.guide?.tariffs ?? []).some((t) => t.id === 'spino'));
const codesOf = (s) =>
  String(s ?? '')
    .split(/[,;\s]+/)
    .filter(Boolean);
const tariffs = ['spino', 'general', 'pvtpki'].map((id) => {
  const t = sfTax.guide.tariffs.find((x) => x.id === id);
  return {
    id,
    name: t.name,
    short: t.short ?? '',
    total: t.total ?? '',
    statuses: codesOf(t.status),
    parts: (t.parts ?? []).map((p) => ({ payer: p.payer, rate: p.rate })),
    cap: t.cap
      ? { base: t.cap.base ?? '', amount: t.cap.amount ?? '', since: t.cap.since ?? '' }
      : null,
    verify: !!t.verify,
  };
});
const spinoBen = dicts.benefits.items.find((b) => b.code === tariffs[0].statuses[0]);
const gkedByCode = new Map(gkedItems.map((g) => [g.code, g]));
const indexCodes = new Set();
for (const c of subjects) {
  for (let g = gkedByCode.get(c.gked); g && !indexCodes.has(g.code); g = gkedByCode.get(g.parent))
    indexCodes.add(g.code);
}
const dict = {
  tariffs,
  status: {
    code: spinoBen.code,
    name: spinoBen.name,
    ex: spinoBen.gked?.ex ?? [],
    warn: spinoBen.gked?.warn ?? [],
    warnForms: spinoBen.suggest?.warnForms ?? [],
  },
  statusNames: tariffs
    .find((t) => t.id === 'pvtpki')
    .statuses.map((code) => [code, dicts.benefits.items.find((b) => b.code === code).name]),
  exceptions: (sfTax.guide.exceptionsGked ?? []).map((e) => ({
    text: e.text,
    codes: [...(e.gkedBlock ?? []), ...(e.gked ?? [])],
  })),
  gkedNames: [...(spinoBen.gked?.ex ?? []), ...(spinoBen.gked?.warn ?? [])]
    .filter((code) => gkedByCode.has(code))
    .map((code) => [code, gkedByCode.get(code).name]),
  index: [...indexCodes].map((code) => {
    const g = gkedByCode.get(code);
    return { code, level: g.level, parent: g.parent ?? null, active: g.active !== false };
  }),
  reportTypes: sfTax.guide.reportTypes ?? [],
  penalties: ref.taxes
    .filter((x) => x.guide?.penalty)
    .flatMap((x) =>
      (x.guide.reportTypes ?? []).map((type) => ({
        type,
        start: x.guide.penalty.start ?? '',
        rate: x.guide.penalty.rate ?? '',
        cap: x.guide.penalty.cap ?? '',
      })),
    ),
};

const fixture = {
  source: SF,
  today: TODAY,
  dict,
  titles: oracle.titles,
  cases: subjects.map((c, i) => ({
    name: c.name,
    subject: subject(c),
    current: current(c),
    expected: oracle.states[i],
  })),
  saves: saves.map(({ i, st }, k) => ({
    case: i,
    input: {
      flags: flagsOf(st.sf),
      tariff: st.sfT || null,
      touched: st.sfTouch,
      reason: st.sfWhy,
    },
    expected: oracle.saves[k],
  })),
  penalties: penalties.map((r, k) => ({
    report: {
      reportTypeCode: r.t,
      dueDate: r.due,
      payDue: r.payDue,
      overdue: !!r.overdue,
      payOverdue: !!r.payOverdue,
      amount: r.sum === null ? null : Math.round(r.sum * 100),
      paid: Math.round(r.paid * 100),
    },
    expected: oracle.penalties[k],
  })),
};

const out = fileURLToPath(new URL('../src/contractors/__fixtures__/socfund.json', import.meta.url));
writeFileSync(
  out,
  await format(JSON.stringify(fixture), { ...(await resolveConfig(out)), filepath: out }),
);
console.log(`socfund.json: ${subjects.length} контрагентов, ${saves.length} сохранений`);
