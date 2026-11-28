// Эталон для повторяющихся задач: tsText, tsNext, tsInMonth, tsUpcoming и tsRun из прототипа
// (spec/prototype/src/js/modules/task-series.js) на наборе правил: все единицы, 31-е и 29 февраля,
// «На месяц», окончание по дате и числу, ночи подряд и с пропусками. Запуск:
// node packages/domain/scripts/oracle-series.mjs — пишет packages/domain/src/tasks/__fixtures__/series.json
// (скилл prototype-oracle).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const dataJs = read('spec/prototype/src/js/core/data.js');
// Даты прототипа (core/data.js) — те же строки, без загрузки всей базы.
const pick = (name) => {
  const line = dataJs.split('\n').find((l) => l.startsWith(`const ${name}=`));
  if (!line) throw new Error(`нет ${name} в core/data.js`);
  return line;
};
const utils = read('spec/prototype/src/js/core/utils.js')
  .split('\n')
  .find((l) => l.startsWith('const plural='));

const context = vm.createContext({ structuredClone });
vm.runInContext(
  `'use strict';
  ${['D', 'toIso', 'mkDate', 'addDays', 'diffDays', 'fmtD', 'minIso', 'MONTHS_G', 'ym', 'addMonths', 'lastDay'].map(pick).join('\n')}
  ${utils}
  let TODAY = '2026-10-18';
  let TSER = [];
  let TASKS = [];
  let TID = 1;
  const EM = { e1: { id: 'e1', active: true } };
  const CPM = {};
  const PROJECTS = [];
  const ORG = { name: 'Демо' };
  const TG_LOG = [];
  const S = { me: 'e1' };
  const feat = () => true;
  const cpStatus = () => 'Активен';
  const born = (x) => x;
  const touch = () => {};
  const log = () => {};
  const bellTask = () => {};
  const bellTo = () => false;
  ${read('spec/prototype/src/js/modules/task-series.js').replace(/^'use strict';/, '')}
  globalThis.oracle = {
    tsText, tsNext, tsInMonth, tsUpcoming, tsRun,
    reset: (s, today) => { TSER = [s]; TASKS = []; TID = 1; TODAY = today; },
    setToday: (d) => { TODAY = d; },
    made: () => TASKS.map((t) => t.date),
  };`,
  context,
);
const { tsText, tsNext, tsInMonth, tsUpcoming, tsRun, reset, setToday, made } = context.oracle;

const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lastDay = (s) => {
  const [y, m] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

// Начала: 31-е, 29 февраля, 28 февраля, последний день, середина, вторник 24-го, воскресенье.
const STARTS = [
  '2026-01-31',
  '2024-02-29',
  '2026-02-28',
  '2026-11-30',
  '2026-11-05',
  '2026-03-24',
  '2026-10-18',
  '2026-12-30',
];
const RULES = [
  { n: 1, u: 'day' },
  { n: 3, u: 'day' },
  { n: 1, u: 'week', wd: 'start' },
  { n: 1, u: 'week', wd: [0, 2] },
  { n: 1, u: 'week', wd: [0, 1, 2, 3, 4] },
  { n: 1, u: 'week', wd: [0, 1, 2, 3, 4, 5, 6] },
  { n: 2, u: 'week', wd: [4, 6] },
  { n: 21, u: 'week', wd: [1] },
  { n: 1, u: 'month', mm: 'date' },
  { n: 2, u: 'month', mm: 'date' },
  { n: 1, u: 'month', mm: 'nth' },
  { n: 3, u: 'month', mm: 'last' },
  { n: 1, u: 'year' },
  { n: 2, u: 'year' },
  { n: 11, u: 'day' },
  { n: 5, u: 'month', mm: 'date' },
];
const ENDS = (start) => [
  { k: 'never' },
  { k: 'date', date: addDays(start, 120) },
  { k: 'count', count: 3 },
  { k: 'count', count: 1 },
];
const wdOf = (s) => (new Date(`${s}T00:00:00Z`).getUTCDay() + 6) % 7;

const cases = [];
for (const kind of ['day', 'month']) {
  for (const s0 of STARTS) {
    const start = kind === 'month' ? lastDay(s0) : s0;
    for (const r0 of RULES) {
      if (kind === 'month' && !['month', 'year'].includes(r0.u)) continue;
      if (r0.mm === 'nth' && +start.slice(8) > 28) continue;
      if (r0.mm === 'last' && +start.slice(8) + 7 <= +lastDay(start).slice(8)) continue;
      for (const end of ENDS(start)) {
        const rule = { n: r0.n, u: r0.u, end };
        if (r0.u === 'week') rule.wd = r0.wd === 'start' ? [wdOf(start)] : r0.wd;
        if (r0.u === 'month' && kind !== 'month') rule.mm = r0.mm;
        const s = {
          id: 's1',
          by: 'e1',
          start,
          state: 'Действует',
          why: '',
          rule,
          tpl: { title: 'Повтор', kind, exec: 'e1', cp: null, proj: null },
        };
        const froms = [
          null,
          addDays(start, -3),
          addDays(start, 1),
          addDays(start, 40),
          addDays(start, 800),
        ];
        const next = froms.map((f) => tsNext(s, f));
        const months =
          kind === 'month' || ['month', 'year'].includes(r0.u)
            ? ['2026-02', '2028-02', '2026-04', '2026-11'].map((m) =>
                tsInMonth(rule, start, m, kind === 'month'),
              )
            : null;
        // Ночи подряд с начала и с пропусками (каждая девятая ночь), 200 дней; даты задач — одной строкой.
        const nights = (stepDays) => {
          const ser = structuredClone(s);
          reset(ser, addDays(start, -2));
          const out = [];
          for (let d = 0; d <= 200; d += stepDays) {
            const today = addDays(start, d - 2);
            setToday(today);
            tsRun();
            if (ser.state !== 'Действует') {
              out.push(`fin:${today}`);
              break;
            }
          }
          return {
            made: made().join(' '),
            end: out[0] ?? null,
            upcoming: ser.state === 'Действует' ? tsUpcoming(ser) : null,
          };
        };
        cases.push({
          kind,
          start,
          rule,
          text: tsText(rule, start, kind),
          froms,
          next,
          months,
          daily: nights(1),
          gaps: nights(9),
        });
      }
    }
  }
}

const out = new URL('packages/domain/src/tasks/__fixtures__/series.json', root);
mkdirSync(new URL('.', out), { recursive: true });
const path = fileURLToPath(out);
writeFileSync(
  path,
  await format(JSON.stringify({ cases }), { ...(await resolveConfig(path)), filepath: path }),
);
console.log(`series: ${cases.length} правил`);
