// Эталон для производственного календаря: holidayName, isWorking и shiftWork из прототипа
// (spec/prototype/src/js/core/reference.js) на праздниках и рабочих субботах refDB.json — каждый день
// с 15.12.2025 по 15.01.2027; рядом — сами праздники и рабочие субботы. Запуск: node packages/domain/scripts/oracle-calendar.mjs — пишет
// packages/domain/src/platform-dicts/__fixtures__/calendar.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const ref = JSON.parse(read('spec/data/refDB.json'));

// Из reference.js — только строки календаря (HOLIDAYS … shiftWork), из data.js — арифметика дат.
const pick = (file, wanted) =>
  read(file)
    .split('\n')
    .filter((line) => wanted.test(line))
    .join('\n');
const dates = pick('spec/prototype/src/js/core/data.js', /^const (D|toIso|addDays)=/);
const calendar = pick(
  'spec/prototype/src/js/core/reference.js',
  /^(const HOLIDAYS|const WORK_SAT|const holidayName|function isWorking|function shiftWork)\b/,
);

const context = vm.createContext({ REF: ref });
vm.runInContext(
  `'use strict';
  const DB = { ref: REF };
  ${dates}
  ${calendar}
  globalThis.oracle = { holidayName, isWorking, shiftWork, addDays };`,
  context,
);
const { holidayName, isWorking, shiftWork, addDays } = context.oracle;

const days = [];
for (let d = '2025-12-15'; d <= '2027-01-15'; d = addDays(d, 1)) {
  days.push([d, isWorking(d), shiftWork(d), holidayName(d)]);
}

const out = fileURLToPath(
  new URL('../src/platform-dicts/__fixtures__/calendar.json', import.meta.url),
);
const json = JSON.stringify({
  source: 'spec/prototype/src/js/core/reference.js',
  holidays: ref.holidays,
  workingSaturdays: ref.workingSaturdays,
  days,
});
writeFileSync(out, await format(json, { ...(await resolveConfig(out)), filepath: out }));
console.log(`calendar.json: ${days.length} дней`);
