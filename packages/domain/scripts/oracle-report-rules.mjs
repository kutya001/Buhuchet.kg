// Эталон для сроков видов отчётов словами: ruleText, payRuleText и paysTxt из прототипа
// (spec/prototype/src/js/core/reference.js) на всех видах отчётов refDB.json и на придуманных правилах,
// которые проходят все ветки (периодичность × месяц после × от начала периода × что сделать × день).
// Вход записывается полями продукта — так, как их кладёт наполнение (packages/db/src/seed/platform-dicts.ts). Запуск:
// node packages/domain/scripts/oracle-report-rules.mjs — пишет
// packages/domain/src/dicts/__fixtures__/report-rules.json (скилл prototype-oracle).
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
const reference = read('spec/prototype/src/js/core/reference.js');
const ruleText = /^function ruleText\(t\)\{[\s\S]*?^\}$/m.exec(reference)?.[0];
if (!ruleText) throw new Error('В reference.js не найдена функция ruleText');

// Придуманные правила на все ветки: периодичность × «месяц после» × от начала периода, «Уплата» в том
// же месяце, последний день месяца, своя оплата и график платежей, разовые.
const synthetic = [];
for (const per of ['M', 'Q', 'H'])
  for (const from of [undefined, 'start'])
    for (const after of [0, 1, 2, 3]) synthetic.push({ per, from, after, day: 10, act: 'both' });
for (const from of [undefined, 'start'])
  for (const act of ['sub', 'pay']) synthetic.push({ per: 'Y', from, ym: 4, day: 30, act });
for (const per of ['M', 'Q'])
  for (const after of [0, 1]) synthetic.push({ per, after, day: 31, act: 'pay' });
for (const pay of [{ day: 15, after: 2 }, { day: 31 }, { day: 5, after: 0 }]) {
  synthetic.push({ per: 'M', after: 1, day: 20, act: 'both', pay });
  synthetic.push({ per: 'Q', from: 'start', after: 1, day: 20, act: 'both', pay });
  synthetic.push({ per: 'Y', ym: 3, day: 31, act: 'both', pay: { ...pay, ym: 6 } });
}
synthetic.push(
  { per: 'M', day: 1, oneOff: true, act: 'both' },
  { per: 'M', day: 21, oneOff: true, act: 'sub' },
  { per: 'Y', day: 20, ym: 3, act: 'pay', inst: [[3, 20]] },
  {
    per: 'Y',
    day: 20,
    ym: 3,
    act: 'pay',
    inst: [
      [2, 5],
      [5, 25],
      [11, 1],
    ],
  },
);

const all = [...ref.reportTypes, ...synthetic];
const context = vm.createContext({ TYPES: all });
vm.runInContext(
  `'use strict';
  ${pick('spec/prototype/src/js/core/utils.js', /^const plural=/)}
  ${pick('spec/prototype/src/js/core/data.js', /^const MONTHS_G=/)}
  ${pick('spec/prototype/src/js/core/reference.js', /^(const ACTF|const paysTxt|const instTxt|function payRuleText)\b/)}
  ${ruleText}
  globalThis.oracle = TYPES.map((t) => {
    const x = Object.assign({}, t, ACTF[t.act]);
    return { due: ruleText(x), pay: payRuleText(x), pays: paysTxt(x) };
  });`,
  context,
);

const types = all.map((t, i) => ({
  code: t.id ?? `case-${i - ref.reportTypes.length + 1}`,
  rule: {
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
  },
  authority: t.organ,
  payments: (t.pays ?? []).map((p) => ({ name: p.n, authority: p.to })),
  expected: context.oracle[i],
}));

const out = fileURLToPath(new URL('../src/dicts/__fixtures__/report-rules.json', import.meta.url));
const json = JSON.stringify({ source: 'spec/prototype/src/js/core/reference.js', types });
writeFileSync(out, await format(json, { ...(await resolveConfig(out)), filepath: out }));
console.log(`report-rules.json: ${types.length} видов отчётов`);
