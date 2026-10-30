// Эталон для строк суммы отчёта: taxLines и lineTax из прототипа (core/tax-lines.js) — на тех же
// назначениях, что и oracle-rates.mjs (все строки «Ставок единого налога» с вариантами и датами, налог с
// продаж с добавляемыми строками, обычная ставка), у видов «Сдача + уплата» и «Сдача», со строкой,
// которой уже нет в назначении. Запуск: node packages/domain/scripts/oracle-tax-lines.mjs — пишет
// packages/domain/src/reports/__fixtures__/tax-lines.json (скилл prototype-oracle).
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
const LINES = 'spec/prototype/src/js/core/tax-lines.js';

const rates = [
  ...ref.enRates,
  { code: 'ЕНС-91', rate: 'по ставкам ЕНС-12' },
  { code: 'ЕНС-96', rate: 'город — 2 %, село — 1 %, горы — 0,5 %' },
];
const withAdd = ref.reportTypes.filter((t) => (t.rateAdd || []).length);
const types = [
  ...ref.reportTypes.filter((t) => ['enq', 'enm', 'nds', 'soc'].includes(t.id)),
  ...withAdd,
];
const dates = ['2026-10-01', '2025-03-01', '2031-08-01'];
const assignments = [];
for (const x of rates) {
  for (const v of [undefined, 1]) assignments.push({ t: 'enq', en: [{ code: x.code, v }] });
}
assignments.push(
  { t: 'enm', en: [{ code: 'ЕНС-02' }, { code: 'ЕНС-16' }] },
  { t: 'enm', en: [{ code: 'ЕНС-04' }, { code: 'ЕНС-04', v: 1 }] },
  { t: 'enq', en: [{ code: 'ЕНС-12', v: 1 }, { code: 'ЕНС-99' }, { code: 'ЕНС-07', v: 0 }] },
  { t: 'enq', en: [] },
  { t: 'nds', rate: '12 %' },
  { t: 'soc', rate: '10 %' },
);
for (const t of withAdd) {
  const keys = t.rateAdd.map((x) => x.k);
  assignments.push(
    { t: t.id, rate: t.rates?.[0] ?? null, add: keys },
    { t: t.id, rate: null, add: keys.slice(0, 1) },
    { t: t.id, rate: '2 %', add: keys.slice(1) },
    { t: t.id, rate: '2 %', add: [] },
  );
}
// Строка, которой больше нет в назначении, но в отчёте у неё есть значения, и пустая — её нет.
const stored = [
  { key: 'ЕНС-99:r', label: 'ЕНС-99 · выручка, 7 %', pct: '7 %', cash: null, rev: 1000, tax: 70 },
  { key: 'ЕНС-98:r', label: 'ЕНС-98 · выручка, 7 %', pct: '7 %', cash: null, rev: null, tax: null },
];
const cases = [];
for (const a of assignments)
  for (const date of dates)
    for (const act of ['both', 'sub']) cases.push({ a, date, act, lines: date === dates[0] ? stored : [] });
const taxes = [];
for (const rev of [0, 1, 99, 100, 125, 300000, 200000, 1234567.89])
  for (const pct of ['4 %', '6 %', '0,5 %', '0,25 %', '12 %', '0 %', '2 %']) taxes.push({ rev, pct });

const context = vm.createContext({ TYPES: types, EN_TABLE: rates, CASES: cases, TAXES: taxes, GK_EN_ONE: [] });
vm.runInContext(
  `'use strict';
  const T = Object.fromEntries(TYPES.map((t) => [t.id, t]));
  const ACTF = { sub: { sum: false }, pay: { sum: true }, both: { sum: true } };
  const tR = (r) => ACTF[r.act];
  const CPM = { 1: {} };
  let CUR = null;
  const assignOfT = () => CUR;
  ${pick(LINES, /^(const EN_IDS|const isEnT|const enRow|const RT_PCT|const pctNum|const rtSegs|const rtIso|const lineTax)\b/)}
  ${block(LINES, 'rtVars')}
  ${block(LINES, 'rtByDate')}
  ${block(LINES, 'rtParts')}
  ${block(LINES, 'aRows')}
  ${block(LINES, 'taxLines')}
  globalThis.oracle = CASES.map((c) => {
    CUR = c.a;
    return taxLines({ t: c.a.t, cp: 1, act: c.act, pkey: c.date, lines: c.lines });
  });
  globalThis.taxes = TAXES.map((x) => lineTax(x.rev, x.pct));`,
  context,
);

const fixture = {
  source: LINES,
  rates: rates.map((x) => ({
    code: x.code,
    rate: x.rate,
    rateCashless: x.rateCashless ?? '',
    rateCash: x.rateCash ?? '',
  })),
  types: Object.fromEntries(types.map((t) => [t.id, { rateAdditions: t.rateAdd ?? [] }])),
  cases: cases.map((c, i) => ({
    typeCode: c.a.t,
    act: c.act,
    date: c.date,
    assignment: {
      rate: c.a.rate ?? null,
      enRates: (c.a.en ?? []).map((e) => ({ code: e.code, variant: e.v ?? null })),
      rateAdditions: c.a.add ?? [],
    },
    stored: c.lines,
    expected: context.oracle[i].map((l) => ({
      key: l.key,
      label: l.label,
      pct: l.pct,
      cash: l.cash == null ? null : l.cash === 1,
      old: !!l.old,
    })),
  })),
  taxes: taxes.map((x, i) => ({ ...x, expected: context.taxes[i] })),
};

const out = fileURLToPath(new URL('../src/reports/__fixtures__/tax-lines.json', import.meta.url));
writeFileSync(
  out,
  await format(JSON.stringify(fixture), { ...(await resolveConfig(out)), filepath: out }),
);
console.log(`tax-lines.json: ${cases.length} случаев, налогов: ${taxes.length}`);
