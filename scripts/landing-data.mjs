#!/usr/bin/env node
// Картинки лендинга из spec/ (ТЗ «Лендинг»: картинки — экраны демо-организации, нарисованные из
// демо-данных; прототип modules/landing.js, landDemo): короткая выборка demoDB.json для уменьшенных
// экранов программы. Числа полосы цифр и коды стран формы — не отсюда, а из действующих справочников
// платформы при показе страницы (`landingDicts`). Пишет apps/web/src/landing/landing-data.json;
// тест apps/web (landing.test.ts) сверяет файл с spec/, поэтому после `pnpm spec:sync` —
// `pnpm landing:data`.
//
//   pnpm landing:data            — пересобрать файл
//   pnpm landing:data --check    — только сверить (выход 1, если файл устарел)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LANDING_DATA_FILE = path.join(ROOT, 'apps/web/src/landing/landing-data.json');

/** Открытые статусы отчёта — ещё не сдан (прототип core/derive.js, OPEN). */
const OPEN = new Set(['К сдаче', 'В работе', 'Требует исправления']);

const read = (name) => JSON.parse(readFileSync(path.join(ROOT, 'spec/data', name), 'utf8'));

/** Картинки лендинга из refDB.json и demoDB.json — как считает их прототип (modules/landing.js). */
export function landingData(refDB = read('refDB.json'), demoDB = read('demoDB.json')) {
  const types = Object.fromEntries(refDB.reportTypes.map((t) => [t.id, t.short]));
  const look = refDB.statuses.report;
  const contractors = Object.fromEntries(
    demoDB.contractors.map((c) => [
      c.id,
      {
        name: c.name,
        inn: c.inn ?? '',
        regime: c.regime ?? '',
        head: c.head ?? '',
        start: c.start ?? null,
        resp: c.resp ?? null,
      },
    ]),
  );
  const employees = Object.fromEntries(demoDB.employees.map((e) => [e.id, e.short]));
  // Как landDemo прототипа: без «Не требуется», без заменённых версий, только известные контрагент и вид.
  // Последнее поле — состояние для плиток: 'open' — ещё не сдан (OPEN прототипа, core/derive.js),
  // 'done' — «Сдан», '' — остальные.
  const reports = demoDB.reports
    .filter((r) => r.status !== 'Не требуется' && !r.superseded && contractors[r.cp] && types[r.t])
    .map((r) => [
      r.cp,
      r.t,
      r.due,
      r.status,
      r.sum ?? null,
      r.plabel ?? '',
      r.subDate ?? null,
      OPEN.has(r.status) ? 'open' : r.status === 'Сдан' ? 'done' : '',
    ]);
  return {
    demo: {
      contractors,
      employees,
      types: Object.fromEntries(
        [...new Set(reports.map((r) => r[1]))].sort().map((t) => [t, types[t]]),
      ),
      statusLook: look,
      reports,
    },
  };
}

export function landingDataText() {
  return JSON.stringify(landingData(), null, 1) + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = landingDataText();
  if (process.argv.includes('--check')) {
    const current = readFileSync(LANDING_DATA_FILE, 'utf8');
    if (current !== text) {
      console.error('apps/web/src/landing/landing-data.json устарел: выполните pnpm landing:data');
      process.exit(1);
    }
    console.log('Данные лендинга совпадают с spec/.');
  } else {
    writeFileSync(LANDING_DATA_FILE, text);
    console.log(`Данные лендинга: ${path.relative(ROOT, LANDING_DATA_FILE)}`);
  }
}
