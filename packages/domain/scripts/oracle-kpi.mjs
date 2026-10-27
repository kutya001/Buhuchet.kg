// Эталон для показателей контрагентов: кому и за какие месяцы показатель обязателен, срок и статус
// заполнения месяца, «Не заполнено», индикатор незаполненных, статистика, итоги, разбор и показ значений
// (прототип modules/kpi.js: kOn, kStart, kApplies, kEarly, kReq, kDue, kFilled, kSync, kMissing,
// kMissCnt, kMonCnt, kMonList, kStats, kAgg, kParse, kNum, kFmt, kPeriodBar). Данные — показатели,
// значения и статусы месяцев demoDB.json и тот же набор с правками, которые проходят остальные ветки;
// «сегодня» — несколько дат. Вход записывается полями продукта. Запуск:
// node packages/domain/scripts/oracle-kpi.mjs — пишет packages/domain/src/kpi/__fixtures__/kpi.json
// (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const demo = JSON.parse(read('spec/data/demoDB.json'));

const DATA = 'spec/prototype/src/js/core/data.js';
const KPI = 'spec/prototype/src/js/modules/kpi.js';
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

const source = `
  ${pick(DATA, /^const (D|toIso|mkDate|diffDays|ym|addMonths|parseNum|MONTHS|ymLabel)=/)}
  ${block(DATA, 'fmtM')}
  ${pick('spec/prototype/src/js/core/org.js', /^const inService=/)}
  ${pick('spec/prototype/src/js/core/session.js', /^const visCps=/)}
  ${pick(KPI, /^const (kInds|kNew|kOn|kSvc0|kStartI|kStart|kOpen|kApplies|kEarly|kVal|kNum|kFmt|kMonths|kPrev|kFilled|kCps|K_BACK)=/)}
  let IV = {}, KMI = {};
  ${[
    'kpiIndex',
    'kAgg',
    'kReq',
    'kDue',
    'kMonth',
    'kParse',
    'kStats',
    'kMissing',
    'kMissCnt',
    'kMonCnt',
    'kMonList',
    'kPeriodBar',
  ]
    .map((name) => block(KPI, name))
    .join('\n')}
`;

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Набор B: правки, которые проходят ветки, не задетые демо-данными. */
function variant(db) {
  const x = clone(db);
  const ind = (id) => x.indicators.find((i) => i.id === id);
  ind('k2').dueDay = 5; // срок месяца — ранний из сроков его показателей
  ind('k3').req = true; // обязательный, выключенный у части контрагентов
  Object.assign(ind('k4'), {
    req: true,
    autoNew: true,
    seen: ind('k4').seen.filter((c) => c <= 20),
  });
  ind('k1').from['23'] = '2026-02'; // «с <месяц>» раньше начала обслуживания
  x.indicators.push({
    ...clone(ind('k2')),
    id: 'k5',
    name: 'Архивный',
    archived: true,
    order: 5,
    from: {},
  });
  x.indicators.push({
    ...clone(ind('k2')),
    id: 'k6',
    name: 'Необязательный с поздним стартом',
    req: false,
    start: '2026-06',
    order: 0,
    from: {},
  });
  x.contractors.find((c) => c.id === 28).periods = [];
  return x;
}

// «Сегодня» и чьими глазами (null — владелец, видит всех; иначе — сотрудник с областью «Свои»).
// Дальняя дата — у сотрудника с четырьмя контрагентами: незаполненные месяцы упираются в 35 месяцев.
const SCENARIOS = [
  ['2026-10-18', null],
  ['2026-11-05', null],
  ['2026-11-12', null],
  ['2027-06-15', null],
  ['2026-10-18', 'e3'],
  ['2026-10-18', 'e4'],
  ['2028-12-01', 'e2'],
];
const RANGE = (() => {
  const out = [];
  for (let y = 2025; y <= 2027; y++)
    for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
  return out.filter((m) => m >= '2025-08' && m <= '2027-06');
})();

function run(db) {
  const context = vm.createContext({
    IND: db.indicators,
    IVALS: db.indicatorValues,
    KMS: clone(db.indicatorMonths),
    CPS: db.contractors,
    SCENARIOS,
    RANGE,
  });
  vm.runInContext(
    `'use strict';
    let TODAY = SCENARIOS[0][0];
    const IHIST = [], HIST = [];
    const S = { me: 'e1' };
    let ALL = true;
    const seeAll = () => ALL;
    ${source}
    kpiIndex();
    const fresh = () => { kMissing.key = null; kMissCnt.rows = null; };
    const mis = () => kMissing().map((r) => [r.c.id, r.m, r.miss.map((i) => i.id).join(','), r.due, r.over].join('|'));
    const cnt = () => { const k = kMissCnt(); return { count: k.n, overdue: k.over, byContractor: Object.values(k.by).map((x) => [x.c.id, x.ms.join(','), x.over ? 1 : 0].join('|')) }; };
    const presets = () => [...kPeriodBar({ from: '', to: '' }, 'p').matchAll(/data-kq="([^|]+)\\|([^"]+)"/g)].map((m) => ({ from: m[1], to: m[2] }));
    const scenario = (me) => {
      fresh();
      const last = kPrev();
      return {
        today: TODAY,
        employee: me,
        fillMonth: last,
        missing: mis(),
        summary: cnt(),
        byMonth: kMonCnt(),
        monthChoices: kMonList(),
        stats: Object.fromEntries([addMonths(last, -1), last, ym(TODAY)].map((m) => [m, kStats(m)])),
        presets: presets(),
      };
    };
    const grid = CPS.flatMap((c) => kInds(true).map((i) => [c.id, i.id, kOn(i, c) ? 1 : 0, kStart(i, c)].join('|')));
    const ids = (list) => list.map((i) => i.id).join(',');
    const months = [];
    CPS.forEach((c) => RANGE.forEach((m) => {
      const applies = kInds().filter((i) => kApplies(i, c, m)), early = kInds().filter((i) => kEarly(i, c, m));
      if (!applies.length && !early.length) return;
      months.push([c.id, m, ids(applies), ids(early), ids(kReq(c, m)), kDue(c, m), kFilled(c, m) ? 1 : 0].join('|'));
    }));
    const scenarios = [];
    for (const [t, me] of SCENARIOS) { TODAY = t; ALL = !me; S.me = me || 'e1'; scenarios.push(scenario(me)); }
    globalThis.oracle = { grid, months, scenarios };`,
    context,
  );
  return context.oracle;
}

// Поля продукта: показатели, «Кому вести» по контрагентам (запись есть только там, где прототип её
// хранит: выключение, свой «с <месяц>», отметка при «Выбранным»), контрагенты.
const scope = (s) => (s === 'sel' ? 'selected' : 'all');
function input(db) {
  const indicators = db.indicators.map((i) => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    type: i.type,
    required: i.req,
    dueDay: i.dueDay,
    start: i.start,
    archived: i.archived,
    scope: scope(i.scope),
    autoNew: i.autoNew,
    order: i.order,
  }));
  const targets = [];
  for (const i of db.indicators)
    for (const c of db.contractors) {
      const id = c.id;
      const from = i.from?.[id] ?? null;
      const offSince = i.off && id in i.off ? i.off[id] : null;
      let on;
      if (offSince !== null) on = false;
      else if (i.scope === 'all') on = from !== null ? true : undefined;
      else if ((i.cps ?? []).includes(id)) on = true;
      else if ((i.seen ?? []).includes(id)) on = false;
      if (on === undefined) continue;
      targets.push({ indicatorId: i.id, contractorId: String(id), on, from, offSince });
    }
  const contractors = db.contractors.map((c) => ({
    id: String(c.id),
    oneOff: c.kind === 'oneoff',
    archived: !!c.archived,
    responsible: c.resp ?? null,
    periods: c.periods ?? [],
  }));
  return { indicators, targets, contractors };
}

const STATUS = { 'Не заполнено': 'empty', Заполнено: 'filled', Проверено: 'checked' };
const datasets = [
  { name: 'демо', db: demo },
  { name: 'демо с правками', db: variant(demo) },
].map(({ name, db }) => ({ name, ...input(db), expected: run(db) }));

// Итоги по заполненным месяцам: значения 2026 года по каждому контрагенту и показателю, с пустыми.
const val = new Map(demo.indicatorValues.map((v) => [`${v.cp}|${v.ind}|${v.m}`, v.v]));
const year = RANGE.filter((m) => m.startsWith('2026'));
const series = demo.contractors
  .flatMap((c) =>
    demo.indicators.map((i) => year.map((m) => val.get(`${c.id}|${i.id}|${m}`) ?? null)),
  )
  .filter((vals) => vals.some((v) => v !== null));
series.push([1.5, null, -2.25, 0], [3, 4], [1, 2, 2]);

// Разбор и показ значений: kParse, kNum, kFmt.
const texts = [
  '',
  ' ',
  '1 250 000',
  '1250000,50',
  '12,5 %',
  '12,5%',
  '0',
  '0,004',
  '0,005',
  '-300',
  '2,5',
  '-2,5',
  '1 234,567',
  ',5',
  '5,',
  'abc',
  '1,2,3',
  '12 %%',
];
const types = ['int', 'dec', 'som', 'pct'];
const nums = [
  0, 1, 37, 2.5, -2.5, 1250000, 1250000.5, 12.25, -300, 1234567.89, 37.333333333333336, 2.495,
];
const units = ['сом', 'чел.', '%', ''];
const ctx = vm.createContext({ types, texts, nums, units });
vm.runInContext(
  `'use strict';
  ${pick(DATA, /^const (parseNum)=/)}
  ${block(DATA, 'fmtM')}
  ${pick(KPI, /^const (kNum|kFmt)=/)}
  ${['kAgg', 'kParse'].map((n) => block(KPI, n)).join('\n')}
  globalThis.oracle = {
    parse: types.flatMap((type) => texts.map((text) => { const v = kParse({ type }, text); return { type, text, expected: v === null ? null : Number.isNaN(v) ? 'error' : v }; })),
    show: types.flatMap((type, j) => nums.map((value) => ({ type, unit: units[j], value, number: kNum({ type }, value), text: kFmt({ type, unit: units[j] }, value) }))),
  };
  globalThis.agg = (list) => list.map((values) => ({ values, expected: kAgg(values) }));`,
  ctx,
);

// «Кому вести»: kSetOn (галочка, переключатель «Вести», массово) и kWhoApply (окно показателя) на
// показателях demoDB.json; каждый случай — на свежей копии. После — у каждого неразового контрагента:
// вёлся ли до, ведётся ли после, «с <месяц>», «Не ведётся с <месяц>», свой «с <месяц>» и поставлен ли он сейчас.
const NEW = {
  id: 'k9',
  name: 'Новый',
  unit: 'шт.',
  type: 'int',
  main: 'sum',
  desc: '',
  req: true,
  dueDay: 10,
  start: '2026-10',
  archived: false,
  order: 5,
  scope: 'all',
  cps: [],
  off: {},
  from: {},
  seen: [],
  autoNew: true,
};
const WHO_TODAY = '2026-10-18';
const whoCases = [
  ...[
    ['k1', 25, false],
    ['k1', 3, false],
    ['k1', 3, true],
    ['k3', 3, true],
    ['k3', 8, false],
    ['k4', 12, false],
    ['k4', 5, true],
    ['k4', 12, true],
    ['k2', 10, false],
  ].map(([ind, cp, on]) => ({ kind: 'toggle', ind, cp, on })),
  { kind: 'who', ind: 'k1', scope: 'all', sel: [], autoNew: true },
  { kind: 'who', ind: 'k3', scope: 'all', sel: [], autoNew: true },
  { kind: 'who', ind: 'k3', scope: 'sel', sel: [1, 2, 3, 8, 20], autoNew: false },
  { kind: 'who', ind: 'k4', scope: 'all', sel: [], autoNew: false },
  { kind: 'who', ind: 'k4', scope: 'sel', sel: [12, 5, 6], autoNew: true },
  { kind: 'who', ind: 'k9', scope: 'sel', sel: [1, 2], autoNew: false },
  { kind: 'who', ind: 'k9', scope: 'all', sel: [], autoNew: false },
];
const who = whoCases.map((w) => {
  const db = clone(demo);
  const context = vm.createContext({
    IND: db.indicators,
    CPS: db.contractors,
    NEW: clone(NEW),
    W: w,
  });
  vm.runInContext(
    `'use strict';
    const TODAY = '${WHO_TODAY}';
    const S = { me: 'e1' };
    const touch = () => {}, log = () => {}, kResync = () => {};
    ${pick(DATA, /^const (D|toIso|ym|addMonths)=/)}
    ${pick('spec/prototype/src/js/core/org.js', /^const inService=/)}
    ${pick(KPI, /^const (kNew|kOn|kSvc0|kStartI|kStart|kPrev)=/)}
    ${block(KPI, 'kSetOn')}
    ${block(KPI, 'kWhoApply')}
    const isNew = W.ind === NEW.id;
    const i = isNew ? NEW : IND.find((x) => x.id === W.ind);
    const cs = CPS.filter((c) => c.kind !== 'oneoff');
    const before = new Map(cs.map((c) => [c.id, isNew ? '' : kOn(i, c) ? 1 : 0]));
    const fromBefore = new Map(cs.map((c) => [c.id, (i.from || {})[c.id]]));
    let changed = null;
    if (W.kind === 'toggle') changed = kSetOn(i, CPS.find((c) => c.id === W.cp), W.on, true);
    else kWhoApply(i, { scope: W.scope, sel: new Set(W.sel), autoNew: W.autoNew }, isNew);
    globalThis.oracle = {
      changed,
      autoNew: !!i.autoNew,
      rows: cs.map((c) => {
        const on = kOn(i, c), from = (i.from || {})[c.id];
        const off = !on && i.off && i.off[c.id] ? i.off[c.id] : '';
        return [c.id, before.get(c.id), on ? 1 : 0, kStart(i, c), off, from || '', from && from !== fromBefore.get(c.id) ? 1 : 0].join('|');
      }),
    };`,
    context,
  );
  return {
    ...w,
    sel: (w.sel ?? []).map(String),
    cp: w.cp === undefined ? undefined : String(w.cp),
    expected: context.oracle,
  };
});

// Статус месяца после изменения: kSync на всех сочетаниях статуса, «всё внесено» и «значение изменено».
const sync = vm.createContext({});
vm.runInContext(
  `'use strict';
  let CUR, FILLED;
  const kMonth = () => ({ status: CUR }), kReq = () => [1], kFilled = () => FILLED, log = () => {};
  ${block(KPI, 'kSync')}
  const S = { 'Не заполнено': 'empty', 'Заполнено': 'filled', 'Проверено': 'checked' };
  globalThis.oracle = [];
  for (const st of Object.keys(S)) for (const f of [false, true]) for (const e of [false, true]) {
    CUR = st; FILLED = f;
    oracle.push({ current: S[st], filled: f, edited: e, expected: S[kSync({}, '', e).status] });
  }`,
  sync,
);

const fixture = {
  source: 'modules/kpi.js',
  values: demo.indicatorValues.map((v) => `${v.cp}|${v.ind}|${v.m}|${Math.round(v.v * 100)}`),
  statuses: demo.indicatorMonths.map((k) => `${k.cp}|${k.m}|${STATUS[k.status]}`),
  datasets,
  totals: ctx.agg(series),
  parse: ctx.oracle.parse,
  show: ctx.oracle.show,
  sync: sync.oracle,
  who: {
    today: WHO_TODAY,
    newIndicator: input({ indicators: [NEW], contractors: [] }).indicators[0],
    cases: who,
  },
};

const out = fileURLToPath(new URL('../src/kpi/__fixtures__/kpi.json', import.meta.url));
writeFileSync(
  out,
  await format(JSON.stringify(fixture), { ...(await resolveConfig(out)), filepath: out }),
);
console.log(
  `kpi.json: ${datasets.length} набора, ${datasets.map((d) => d.expected.months.length).join(' + ')} месяцев, ` +
    `${fixture.totals.length} рядов итогов, ${fixture.parse.length} разборов`,
);
