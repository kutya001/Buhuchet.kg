// Эталон для периодов и сроков отчётов: pstart, pend, plabel, ruleDate, dueOf, payDueOf, periodList, tOv и
// tEff из прототипа (spec/prototype/src/js/core/reference.js) на каталоге видов отчётов refDB.json, его
// производственном календаре и статусе «Крупный налогоплательщик»; рядом — какие периоды прототип
// создаёт при назначении (modules/contractors.js `assignTypes`). Запуск: node
// packages/domain/scripts/oracle-due.mjs — пишет packages/domain/src/reports/__fixtures__/due.json
// (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const ref = JSON.parse(read('spec/data/refDB.json'));

/** Объявление верхнего уровня целиком: от строки `function name(` / `const name=` до следующего. */
function blocks(file, names) {
  const lines = read(file).split('\n');
  const top = /^(function |const |let |\/\*|\/\/|$)/;
  return names
    .map((name) => {
      const start = lines.findIndex((l) =>
        new RegExp(`^(function ${name}\\(|const ${name}=)`).test(l),
      );
      if (start < 0) throw new Error(`${file}: нет ${name}`);
      let end = start + 1;
      while (end < lines.length && !top.test(lines[end])) end++;
      return lines.slice(start, end).join('\n');
    })
    .join('\n');
}

const data = blocks('spec/prototype/src/js/core/data.js', [
  'D',
  'toIso',
  'mkDate',
  'addDays',
  'fmtD',
  'MONTHS',
  'ym',
  'addMonths',
]);
const reference = blocks('spec/prototype/src/js/core/reference.js', [
  'DICT',
  'HOLIDAYS',
  'WORK_SAT',
  'holidayName',
  'isWorking',
  'shiftWork',
  'PER_LABEL',
  'ROM',
  'evName',
  'plabel',
  'pstart',
  'pend',
  'ruleDate',
  'dueOf',
  'payDueOf',
  'periodList',
  'perOwn',
  'ovDay',
  'benLive',
  'dueBen',
  'tOv',
  'tEff',
  'benOf',
]);

const context = vm.createContext({ REF: ref });
vm.runInContext(
  `'use strict';
  const DB = { ref: REF };
  var TODAY = '2026-10-18';
  ${data}
  ${reference}
  globalThis.oracle = {
    setToday: (d) => { TODAY = d; },
    pstart, pend, plabel, dueOf, payDueOf, periodList, perOwn, tEff, shiftWork,
  };`,
  context,
);
const o = context.oracle;

const types = ref.reportTypes;
const LARGE = 'Крупный налогоплательщик';
const TODAYS = ['2026-01-05', '2026-03-31', '2026-07-01', '2026-10-18', '2026-12-31', '2027-02-27'];

/** Периоды прототипа — без лишних полей, как у продукта: вид периода, начало, конец, подпись, сроки. */
function row(t, p) {
  const { base, due } = o.dueOf(t, p);
  return {
    start: o.pstart(t, p),
    end: o.pend(t, p),
    label: o.plabel(t, p),
    base,
    due,
    payDue: t.act === 'sub' ? null : o.payDueOf(t, p, due),
  };
}

/**
 * Какие периоды прототип создаёт при назначении (`assignTypes`): окно `periodList`, у месячных — с
 * текущего месяца, у остальных — пока срок не прошёл; «до какого периода» отсекает поздние.
 */
function created(t, until) {
  const today = TODAY_NOW;
  const first = today.slice(0, 8) + '01';
  return o
    .periodList(t)
    .filter((p) => o.pend(t, p) >= first || t.per !== 'M')
    .filter((p) => !until || o.pstart(t, p).slice(0, 7) <= until)
    .filter((p) => !(t.per === 'M' && o.pstart(t, p) < first))
    .filter((p) => t.per === 'M' || o.dueOf(t, p).due >= today)
    .map((p) => o.pstart(t, p));
}

let TODAY_NOW = '2026-10-18';
const catalog = [];
for (const today of TODAYS) {
  o.setToday(today);
  TODAY_NOW = today;
  for (const t of types) {
    if (t.oneOff || o.perOwn(t)) continue;
    catalog.push({
      today,
      type: t.id,
      periods: o.periodList(t).map((p) => row(t, p)),
      created: created(t),
    });
  }
}

// «До какого периода» и вариант срока в назначении (у вида каталога — `dueDay`), статус «Крупный
// налогоплательщик» (`dueOverride` НДС) и что из них важнее.
o.setToday('2026-10-18');
TODAY_NOW = '2026-10-18';
const T = Object.fromEntries(types.map((t) => [t.id, t]));
const cp = (ben, benDates) => ({ ben, benDates: benDates ?? {} });
const variants = [];
for (const [type, assign, contractor] of [
  ['nds', null, cp([LARGE])],
  ['nds', { dueDay: 15 }, cp([LARGE])],
  ['nds', { dueDay: 31 }, cp([])],
  ['nds', { dueDay: 10 }, cp([])],
  ['nds', null, cp([LARGE], { [LARGE]: { from: '2026-11-01' } })],
  ['nds', null, cp([LARGE], { [LARGE]: { to: '2026-10-01' } })],
  ['nspm', { dueDay: 31 }, cp([LARGE])],
  ['soc', { dueDay: 20 }, cp([])],
  ['sv1q', { dueDay: 31 }, cp([])],
  ['inv1q', { dueDay: 10 }, cp([])],
]) {
  const t = o.tEff(T[type], assign, contractor);
  variants.push({
    type,
    assign,
    benefits: contractor.ben,
    benDates: contractor.benDates,
    periods: o.periodList(t).map((p) => row(t, p)),
  });
}
const until = [
  { type: 'nds', until: '2026-10', created: created(T.nds, '2026-10') },
  { type: 'inv1q', until: '2026-09', created: created(T.inv1q, '2026-09') },
];

// Периодичность и срок в назначении (внутренняя финансовая отчётность, патент): `per`, `day`, `mo` —
// месяц после конца периода, у годовых — месяц срока.
const own = [];
for (const type of types.filter((t) => o.perOwn(t)).map((t) => t.id)) {
  for (const cfg of [
    { per: 'M', day: 10, mo: 1 },
    { per: 'Q', day: 31, mo: 1 },
    { per: 'H', day: 20, mo: 2 },
    { per: 'Y', day: 1, mo: 4 },
    { per: 'Y', day: 31, mo: 3 },
  ]) {
    const t = o.tEff(T[type], cfg, cp([]));
    own.push({
      type,
      cfg,
      periods: o.periodList(t).map((p) => row(t, p)),
      created: created(t),
    });
  }
}

// Разовые виды: период — месяц даты события, срок — от неё (п. 55 приёмки: ввоз 05.11.2026 и 18.11.2026).
const oneOff = [];
for (const t of types.filter((x) => x.oneOff)) {
  for (const ev of ['2026-11-05', '2026-11-18', '2026-12-25', '2026-05-01', '2027-01-02']) {
    const p = { y: +ev.slice(0, 4), m: +ev.slice(5, 7), ev };
    oneOff.push({ type: t.id, event: ev, ...row(t, p) });
  }
}

const out = fileURLToPath(new URL('../src/reports/__fixtures__/due.json', import.meta.url));
const json = JSON.stringify({
  source: 'spec/prototype/src/js/core/reference.js, modules/contractors.js',
  holidays: ref.holidays,
  workingSaturdays: ref.workingSaturdays,
  catalog,
  variants,
  until,
  own,
  oneOff,
});
writeFileSync(out, await format(json, { ...(await resolveConfig(out)), filepath: out }));
console.log(
  `due.json: ${catalog.length} видов × дат, ${variants.length} вариантов, ${own.length} назначений с периодичностью, ${oneOff.length} разовых`,
);
