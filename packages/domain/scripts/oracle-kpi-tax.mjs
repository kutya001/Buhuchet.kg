// Эталон для «Расчёта по показателям» (прототип v80 modules/kpi-tax.js): kTaxNeed, kRepMs, kTaxSoc,
// kRevPct и налог от выручки по ставке — из прототипа на тарифах refDB.json. Случаи придуманы на каждую
// ветку: все тарифы Соцфонда, ФОТ с пропусками, предел базы на работника, без численности; виды отчётов
// с выручкой, без суммы и прочие; ставки назначения. Суммы прототипа — в сомах, в фикстуре — тыйыны;
// численность прототипа — человек, в фикстуре — сотые (как значения показателей продукта). Запуск:
// node packages/domain/scripts/oracle-kpi-tax.mjs — пишет
// packages/domain/src/kpi/__fixtures__/kpi-tax.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const ref = JSON.parse(read('spec/data/refDB.json'));
const line = (file, start) => {
  const found = read(file)
    .split('\n')
    .find((l) => l.startsWith(start));
  if (!found) throw new Error(`В ${file} нет строки «${start}»`);
  return found;
};
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
const KTAX = 'spec/prototype/src/js/modules/kpi-tax.js';
const DATA = 'spec/prototype/src/js/core/data.js';

const tariffs = ref.taxes.find((x) => x.code === 'ПЛТ-01').guide.tariffs;
const types = ref.reportTypes;

const source = [
  line('spec/prototype/src/js/core/tax-lines.js', 'const pctNum='),
  line(DATA, 'const parseNum='),
  line(DATA, 'const toIso=').replace(/^const toIso=/, 'var toIso='),
  line(DATA, 'const addMonths='),
  line('spec/prototype/src/js/modules/kpi.js', 'const kMonths='),
  line('spec/prototype/src/js/core/reference.js', 'const ACTF='),
  line('spec/prototype/src/js/core/reference.js', 'function tR('),
  line(KTAX, 'const KTX_REV='),
  line(KTAX, 'function kTaxNeed('),
  line(KTAX, 'const kRepMs='),
  block(KTAX, 'kTaxSoc'),
  line(KTAX, 'function kRevPct('),
  // Заглушки данных прототипа: тариф контрагента, назначение, вид отчёта.
  'let CUR=null,ASSIGN=null;const sfState=()=>CUR?{cur:CUR,auto:{t:null}}:null;',
  'const assignOfT=()=>ASSIGN;const CPM=new Proxy({},{get:()=>({})});',
  'globalThis.run=(fn)=>fn();',
  'globalThis.soc=(tf,ms,fot,emp)=>{CUR=tf;const x=kTaxSoc({},ms,{vals:fot},emp?{vals:emp}:null);return x.err?{err:true}:{wr:x.wr,pnRate:x.pnRate,sf:x.sf,pn:x.pn,capped:x.capped,cap:x.cap}};',
  'globalThis.need=(t,act)=>kTaxNeed({t,act});',
  'globalThis.months=(t,pkey)=>kRepMs({t,pkey});',
  'globalThis.pct=(t,rate)=>{ASSIGN=rate===null?null:{rate};return kRevPct({t,cp:1})};',
  'globalThis.byPct=(sum,p)=>Math.round(sum*pctNum(p)/100);',
].join('\n');

const context = vm.createContext({
  console,
  Date,
  T: Object.fromEntries(types.map((t) => [t.id, t])),
  TAXES: ref.taxes,
});
context.globalThis = context;
vm.runInContext(source, context);

const month3 = ['2026-07', '2026-08', '2026-09'];
// ФОТ в сомах, численность — человек; null — месяц не заполнен.
const socCases = [
  { fot: [100000, 120000.5, 95000], emp: [5, 6, 5] },
  { fot: [100000, null, 95000], emp: [5, 6, 5] },
  { fot: [3000000, 1500000, 800000], emp: [2, 2, 2] },
  { fot: [3000000, 1500000, 800000], emp: [2, null, 0] },
  { fot: [3000000, 1500000, 800000], emp: null },
  { fot: [0, 0, 0], emp: [1, 1, 1] },
  { fot: [1234567.89], emp: [1] },
  { fot: [720940, 720941, 1441880.01], emp: [1, 1, 2] },
  { fot: [33333.33, 66666.67, 12345.67], emp: null },
];
const toTyiyn = (v) => (v === null ? null : Math.round(v * 100));
const soc = [];
for (const tf of [...tariffs, null]) {
  for (const c of socCases) {
    const ms = month3.slice(0, c.fot.length);
    const x = context.soc(tf, ms, c.fot, c.emp);
    soc.push({
      tariff: tf ? tf.id : null,
      fot: c.fot.map(toTyiyn),
      emp: c.emp ? c.emp.map(toTyiyn) : null,
      expected: x.err
        ? null
        : {
            incomeTax: x.pn * 100,
            contributions: x.sf * 100,
            incomeRate: x.pnRate,
            workerRate: x.wr,
            capped: x.capped,
            cap: Math.round(x.cap * 100),
          },
    });
  }
}

const acts = ['both', 'sub', 'pay'];
const need = types.flatMap((t) =>
  acts.map((act) => ({ type: t.id, act, expected: context.need(t.id, act) })),
);
const starts = ['2026-01-01', '2026-07-01', '2026-10-01', '2026-11-15', '2025-12-01', ''];
// По одному виду на каждую периодичность (месяц, квартал, полугодие, год) и виды блока.
const perSeen = new Set();
const months = types
  .filter((t) => {
    if (['soc', 'enq', 'nds'].includes(t.id)) return true;
    if (perSeen.has(t.per)) return false;
    perSeen.add(t.per);
    return true;
  })
  .flatMap((t) =>
    starts.map((s) => ({
      type: t.id,
      period: t.per,
      periodStart: s,
      expected: [...context.months(t.id, s)],
    })),
  );
const rates = [null, '', '2 %', '0,5 %', 'по ставкам ЕНС-04', '12 %'];
const pct = ['nspm', 'nspq', 'pvt', 'nds', 'enq'].flatMap((t) =>
  rates.map((rate) => ({ type: t, rate, expected: context.pct(t, rate) })),
);
const sums = [0, 1, 49.99, 50, 1250000, 333333.33, 987654.32];
const byPct = ['1 %', '2 %', '0,5 %', '0,25 %', '12,25 %'].flatMap((p) =>
  sums.map((s) => ({ revenue: toTyiyn(s), pct: p, expected: context.byPct(s, p) * 100 })),
);

const out = fileURLToPath(new URL('../src/kpi/__fixtures__/kpi-tax.json', import.meta.url));
writeFileSync(
  out,
  await format(JSON.stringify({ soc, need, months, pct, byPct }), {
    ...(await resolveConfig(out)),
    filepath: out,
  }),
);
console.log(
  `kpi-tax.json: ${soc.length} расчётов Соцфонда, ${need.length} видов, ${months.length} периодов, ${pct.length} ставок, ${byPct.length} сумм`,
);
