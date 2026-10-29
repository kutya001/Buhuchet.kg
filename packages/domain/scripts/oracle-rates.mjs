// Эталон для ставки назначения словами: rtTxt, aRows и aRateTxt из прототипа (core/tax-lines.js) — на
// всех строках «Ставок единого налога» refDB.json с вариантами и датами, придуманных строках на каждую
// ветку rtParts, налоге с продаж с добавляемыми строками и обычной ставке; полностью и коротко. Запуск:
// node packages/domain/scripts/oracle-rates.mjs — пишет packages/domain/src/reports/__fixtures__/rates.json
// (скилл prototype-oracle).
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
  { code: 'ЕНС-92', rate: 'по ставкам ЕНС-92' },
  { code: 'ЕНС-95', rate: 'без ставки' },
  { code: 'ЕНС-96', rate: 'город — 2 %, село — 1 %, горы — 0,5 %' },
];
const withAdd = ref.reportTypes.filter((t) => (t.rateAdd || []).length);
const types = [
  ...ref.reportTypes.filter((t) => ['enq', 'enm', 'nds', 'soc'].includes(t.id)),
  ...withAdd,
];
const dates = ['2026-10-27', '2025-03-01', '2031-08-01'];
const assignments = [];
for (const x of rates) {
  for (const v of [undefined, 1, 2]) assignments.push({ t: 'enq', en: [{ code: x.code, v }] });
}
assignments.push(
  { t: 'enm', en: [{ code: 'ЕНС-02' }, { code: 'ЕНС-16' }] },
  { t: 'enq', en: [{ code: 'ЕНС-12', v: 1 }, { code: 'ЕНС-99' }, { code: 'ЕНС-07', v: 0 }] },
  { t: 'enq', en: [] },
  { t: 'nds', rate: '12 %' },
  { t: 'soc', rate: null },
);
for (const t of withAdd) {
  const keys = t.rateAdd.map((x) => x.k);
  assignments.push(
    { t: t.id, rate: t.rates?.[0] ?? null, add: keys },
    { t: t.id, rate: null, add: keys.slice(0, 1) },
    { t: t.id, rate: '2 %', add: [] },
    { t: t.id, rate: '2 %', add: ['нет-такой'] },
  );
}
const cases = [];
for (const a of assignments)
  for (const date of dates) for (const short of [false, true]) cases.push({ a, date, short });

const context = vm.createContext({ TYPES: types, EN_TABLE: rates, CASES: cases, GK_EN_ONE: [] });
vm.runInContext(
  `'use strict';
  const TODAY = '2026-10-27';
  const T = Object.fromEntries(TYPES.map((t) => [t.id, t]));
  ${pick(LINES, /^(const EN_IDS|const isEnT|const enRow|const RT_PCT|const rtSegs|const rtIso)\b/)}
  ${block(LINES, 'rtVars')}
  ${block(LINES, 'rtByDate')}
  ${block(LINES, 'rtParts')}
  ${block(LINES, 'rtTxt')}
  ${block(LINES, 'aRows')}
  ${block(LINES, 'aRateTxt')}
  globalThis.oracle = CASES.map((c) => aRateTxt(c.a, T[c.a.t], c.short, c.date));`,
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
    assignment: {
      reportTypeCode: c.a.t,
      rate: c.a.rate ?? null,
      enRates: (c.a.en ?? []).map((e) => ({ code: e.code, variant: e.v ?? null })),
      rateAdditions: c.a.add ?? [],
    },
    date: c.date,
    short: c.short,
    expected: context.oracle[i],
  })),
};

const out = fileURLToPath(new URL('../src/reports/__fixtures__/rates.json', import.meta.url));
writeFileSync(
  out,
  await format(JSON.stringify(fixture), { ...(await resolveConfig(out)), filepath: out }),
);
console.log(`rates.json: ${cases.length} случаев`);
