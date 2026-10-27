// Эталон для окон значений справочников платформы: «Меняет сроки» льготы (benOvTxt, ovText и tOv из
// прототипа, modules/report-pick.js и core/reference.js) и строки суммы ставки единого налога (rtParts
// из core/tax-lines.js) — на всех льготах и ставках refDB.json и на придуманных случаях, которые проходят
// все ветки. Вход записывается полями продукта — так, как их кладёт наполнение
// (packages/db/src/seed/platform-dicts.ts). Запуск: node packages/domain/scripts/oracle-value-guide.mjs —
// пишет packages/domain/src/dicts/__fixtures__/value-guide.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const ref = JSON.parse(read('spec/data/refDB.json'));

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
const LINES = 'spec/prototype/src/js/core/tax-lines.js';

// «Меняет сроки»: льготы refDB.json со своими сроками и придуманные — на видах каждой ветки (сдача,
// уплата, сдача + уплата, график платежей, годовой, уплата в том же месяце).
const types = ref.reportTypes;
const sample = [
  types.find((t) => t.act === 'sub' && t.per === 'M'),
  types.find((t) => t.act === 'sub' && t.per === 'Y'),
  types.find((t) => t.act === 'pay' && t.after === 0),
  types.find((t) => t.act === 'pay' && Array.isArray(t.inst) && t.inst.length),
  types.find((t) => t.act === 'both' && t.pay),
  types.find((t) => t.act === 'both' && !t.pay && !(t.inst || []).length),
].filter(Boolean);
const overrides = [
  { day: 'last', after: 1 },
  { day: 15 },
  { pay: { day: 25, after: 1 } },
  { day: 10, after: 2, pay: { day: 20 } },
  { day: 30, ym: 4 },
  { after: 0 },
];
const synthetic = overrides.map((o, i) => ({
  name: `Статус ${i + 1}`,
  dueOverride: Object.fromEntries(sample.map((t) => [t.id, o])),
}));
const benefits = [
  ...ref.dictionaries.benefits.items.filter((b) => b.dueOverride),
  ...synthetic,
  { name: 'Вид не из каталога', dueOverride: { 'no-such-type': { day: 5 } } },
];

// Ставки единого налога: все строки refDB.json и придуманные на каждую ветку rtParts.
const rates = [
  ...ref.enRates,
  { code: 'ЕНС-91', rate: 'по ставкам ЕНС-12' },
  { code: 'ЕНС-92', rate: 'по ставкам ЕНС-92' },
  { code: 'ЕНС-93', rate: '1 % с 01.01.2027' },
  { code: 'ЕНС-94', rate: '2 % с 01.01.2020 по 31.12.2021, 3 % с 01.01.2022 по 31.12.2023' },
  { code: 'ЕНС-95', rate: 'без ставки' },
  { code: 'ЕНС-96', rate: 'город — 2 %, село — 1 %, горы — 0,5 %' },
];
const dates = ['2026-10-27', '2025-03-01', '2031-08-01', '2019-01-01'];
const cases = [];
for (const x of rates) for (const date of dates) cases.push({ code: x.code, date, variant: 0 });
for (const code of ['ЕНС-07', 'ЕНС-12', 'ЕНС-96', 'ЕНС-91'])
  for (const variant of [1, 2, 5, -1]) cases.push({ code, date: dates[0], variant });

const context = vm.createContext({ TYPES: types, BENS: benefits, EN_TABLE: rates, CASES: cases });
vm.runInContext(
  `'use strict';
  const TODAY = '2026-10-27';
  ${pick('spec/prototype/src/js/core/utils.js', /^const plural=/)}
  ${pick('spec/prototype/src/js/core/data.js', /^const MONTHS_G=/)}
  ${pick(REF, /^(const ACTF|const instTxt|function payRuleText|const ovDay|const dueBen)\b/)}
  ${block(REF, 'ruleText')}
  ${block(REF, 'tOv')}
  ${block(REF, 'ovText')}
  const benLive = () => true;
  const benOf = (cp) => cp.ben.map((n) => BENS.find((b) => b.name === n)).filter(Boolean);
  const T = Object.fromEntries(TYPES.map((t) => [t.id, Object.assign({}, t, ACTF[t.act])]));
  ${pick('spec/prototype/src/js/modules/report-pick.js', /^const benOvTxt=/)}
  ${pick(LINES, /^(const enRow|const RT_PCT|const rtSegs|const rtIso)\b/)}
  ${block(LINES, 'rtVars')}
  ${block(LINES, 'rtByDate')}
  ${block(LINES, 'rtParts')}
  globalThis.oracle = {
    benefits: BENS.map((b) => benOvTxt(b)),
    rates: CASES.map((c) => rtParts(enRow(c.code), c.variant, c.date).map((p) => ({ name: p.n, pct: p.pct }))),
  };`,
  context,
);

const day = (d) => (d === 'last' ? 31 : d);
const rule = (t) => ({
  shortName: t.short,
  period: t.per,
  dueDay: t.day,
  dueAfter: t.after ?? null,
  dueMonth: t.ym ?? null,
  dueFrom: t.from ?? 'end',
  oneOff: t.oneOff ?? false,
  act: t.act,
  payDay: t.pay?.day ?? null,
  payAfter: t.pay?.after ?? null,
  payMonth: t.pay?.ym ?? null,
  paySchedule: t.inst ?? null,
});
const usedTypes = new Set(benefits.flatMap((b) => Object.keys(b.dueOverride)));
const fixture = {
  source: `${REF}, modules/report-pick.js, core/tax-lines.js`,
  types: Object.fromEntries(types.filter((t) => usedTypes.has(t.id)).map((t) => [t.id, rule(t)])),
  benefits: benefits.map((b, i) => ({
    name: b.name,
    rules: Object.entries(b.dueOverride).map(([reportType, o]) => ({
      reportType,
      dueDay: o.day == null ? null : day(o.day),
      dueAfter: o.after ?? null,
      dueMonth: o.ym ?? null,
      payDay: o.pay ? day(o.pay.day) : null,
      payAfter: o.pay?.after ?? null,
    })),
    expected: context.oracle.benefits[i],
  })),
  rates: rates.map((x) => ({
    code: x.code,
    rate: x.rate,
    rateCashless: x.rateCashless ?? '',
    rateCash: x.rateCash ?? '',
  })),
  rateCases: cases.map((c, i) => ({ ...c, expected: context.oracle.rates[i] })),
};

const out = fileURLToPath(new URL('../src/dicts/__fixtures__/value-guide.json', import.meta.url));
writeFileSync(
  out,
  await format(JSON.stringify(fixture), { ...(await resolveConfig(out)), filepath: out }),
);
console.log(`value-guide.json: ${fixture.benefits.length} льгот, ${cases.length} случаев ставок`);
