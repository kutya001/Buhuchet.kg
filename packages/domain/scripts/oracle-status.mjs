// Эталон для шкал статусов: scSteps, scPos, scNext, scBack и durTxt из прототипа
// (spec/prototype/src/js/ui/status-scale.js) на всех статусах справочника «Статусы» refDB.json. Запуск:
// node packages/domain/scripts/oracle-status.mjs — пишет
// packages/domain/src/common/__fixtures__/status-scales.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const ref = JSON.parse(read('spec/data/refDB.json'));

// Из status-scale.js — только описание шкал и чистые функции: остальной файл тянет данные прототипа.
// Берутся строки от начала объявления до следующего объявления верхнего уровня.
const lines = read('spec/prototype/src/js/ui/status-scale.js').split('\n');
const wanted =
  /^(const SCALES|const REP_MK|const repConfOn|const taskConfSt|function scSteps|function scPos|function scNext|function scBack|const stAt|function durTxt)\b/;
const top = /^(const|let|function|document|\/[/*])/;
const picked = [];
let on = false;
for (const line of lines) {
  if (top.test(line)) on = wanted.test(line);
  if (on) picked.push(line);
}
const source = picked.join('\n');

const context = vm.createContext({ REF: ref.statuses, OPS: [], CLOSED: new Set() });
vm.runInContext(
  `'use strict';
  const ST = REF.report, PST = REF.payment, TST = REF.task, SVST = REF.service, PRS = REF.project, KST = REF.indicator;
  const ORG = { repConfirm: true };
  const tR = () => ({ payOnly: false });
  const ym = (d) => d.slice(0, 7);
  const ymLabel = (x) => x;
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k > 1 && k < 5 ? b : k === 1 ? a : c; };
  ${source}
  globalThis.oracle = { SCALES, scSteps, scPos, scNext, scBack, durTxt };`,
  context,
);
const { scPos, scNext, scBack, durTxt } = context.oracle;

// Шкала прототипа → шкала продукта и раздел справочника «Статусы».
const SCALES = {
  rep: ['report', 'report'],
  pay: ['payment', 'payment'],
  task: ['task', 'task'],
  svc: ['service', 'service'],
  proj: ['project', 'project'],
  ind: ['indicator', 'indicator'],
};

const position = [];
const next = [];
for (const [k, [scale, section]] of Object.entries(SCALES)) {
  for (const status of Object.keys(ref.statuses[section])) {
    for (const confirm of k === 'task' ? [false, true] : [false]) {
      const o = { confirm };
      const p = scPos(k, status, o);
      position.push([
        scale,
        status,
        confirm,
        p.i < 0 ? null : { index: p.i, steps: p.steps, side: p.side ? p.side.cls : null },
      ]);
      next.push([scale, status, confirm, scNext(k, status, o)]);
    }
  }
}

// Откат: у отчёта — с подтверждённой сдачей и без; у оплаты — после отмены последней оплаты
// останется 0, больше 0 или меньше 0 (оплат больше суммы); без оплат — откатывать нечего.
const back = [];
for (const [k, [scale, section]] of Object.entries(SCALES)) {
  for (const status of Object.keys(ref.statuses[section])) {
    if (k === 'pay') {
      context.OPS.length = 0;
      back.push([scale, status, { paidRest: null }, scBack(k, status, { id: 1, paid: 0 })]);
      for (const [paid, amount] of [
        [5, 5],
        [10, 4],
        [3, 8],
      ]) {
        context.OPS.length = 0;
        context.OPS.push({ kind: 'pay', report: 1, amount, date: '2026-10-10' });
        back.push([scale, status, { paidRest: paid - amount }, scBack(k, status, { id: 1, paid })]);
      }
      continue;
    }
    back.push([scale, status, {}, scBack(k, status, {})]);
    if (k === 'rep')
      back.push([scale, status, { confirmed: true }, scBack(k, status, { confAt: 'x' })]);
  }
}

const HOUR = 3_600_000;
const durations = [
  0,
  59 * 60_000,
  HOUR,
  1.4 * HOUR,
  1.5 * HOUR,
  23.4 * HOUR,
  23.6 * HOUR,
  24 * HOUR,
  36 * HOUR,
  47 * HOUR,
  5 * 24 * HOUR,
  21 * 24 * HOUR,
  22 * 24 * HOUR,
  -5 * HOUR,
].map((ms) => [ms, durTxt(ms)]);

const target = new URL('packages/domain/src/common/__fixtures__/status-scales.json', root);
const text = JSON.stringify({ position, next, back, durations });
const options = await resolveConfig(fileURLToPath(target));
writeFileSync(target, await format(text, { ...options, parser: 'json' }));
console.log(
  `status-scales.json: ${position.length} positions, ${next.length} next, ${back.length} back, ${durations.length} durations`,
);
