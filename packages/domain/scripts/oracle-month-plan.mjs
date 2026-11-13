// Эталон правила «к сдаче и к оплате по месяцам» (прототип v90 modules/report-months.js: `rmYm`,
// `rmItem`, `rmGroup`, `rmPlan`). Данные — отчёты demoDB.json и тот же набор с правками, которые проходят
// остальные ветки (прежняя версия отчёта, «Не требуется», сумма не указана и нулевая, «Уплата» у вида
// «Сдача + уплата», отчёт по событию, частичная оплата и переплата); «сегодня» — две даты, «Учёт оплаты
// налогов» включён и выключен. Вход записывается полями продукта. Запуск:
// node packages/domain/scripts/oracle-month-plan.mjs — пишет
// packages/domain/src/reports/__fixtures__/month-plan.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const ref = JSON.parse(read('spec/data/refDB.json'));
const demo = JSON.parse(read('spec/data/demoDB.json'));

const DATA = 'spec/prototype/src/js/core/data.js';
const ORG = 'spec/prototype/src/js/core/org.js';
const MONTHS_JS = 'spec/prototype/src/js/modules/report-months.js';
const CARD = 'spec/prototype/src/js/modules/contractor-card.js';
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

const source = `
  ${pick(DATA, /^const (D|toIso|mkDate|diffDays|addDays|ym|addMonths|lastDay|MONTHS|MONTHS_G|minIso|som)=/)}
  ${block(DATA, 'fmtM')}
  ${read('spec/prototype/src/js/core/reference.js').replace("'use strict';", '')}
  ${pick(ORG, /^const (inService|cpStatus|curTariff)=/)}
  ${['schedule', 'tariffAt', 'feeDue', 'feeMonths', 'feeCharge'].map((n) => block(ORG, n)).join('\n')}
  ${read('spec/prototype/src/js/core/derive.js').replace("'use strict';", '')}
  ${pick(CARD, /^const OPK=/)}
  ${pick(MONTHS_JS, /^const RM_ADD=/)}
  ${['rmYm', 'rmItem', 'rmPlan', 'rmGroup'].map((n) => block(MONTHS_JS, n)).join('\n')}
`;

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Набор B: ветки, которых нет в демо-данных. */
function variant(db) {
  const x = clone(db);
  const open = x.reports.filter((r) => r.status === 'К сдаче' && r.sum > 0 && r.paid === 0);
  const [a, b, c, d, e, f] = open;
  // Частичная оплата и переплата.
  a.paid = Math.round(a.sum / 2);
  b.paid = b.sum + 150;
  // «Уплата» по отчёту вида «Сдача + уплата» (отчёт сохранил «Что сделать» прежнего вида).
  c.act = 'pay';
  // Сумма не указана и нулевая сумма.
  d.sum = null;
  e.sum = 0;
  // Отчёт по событию: месяц плана — месяц события, а не периода.
  f.p = { ...f.p, ev: true, y: 2026, m: 5 };
  // Уточнённый: первичный заменён и в план не входит.
  const s = x.reports.find((r) => r.status === 'Сдан' && r.sum > 0 && r.paid >= r.sum);
  s.superseded = true;
  x.reports.push({
    ...clone(s),
    id: 9000,
    ver: 1,
    status: 'К сдаче',
    superseded: false,
    sum: s.sum + 500,
    due: '2026-10-28',
    dueBase: '2026-10-28',
  });
  // Сдан, но не оплачен; «Не требуется» с суммой.
  const g = x.reports.find((r) => r.status === 'Сдан' && r.sum > 0 && r.id !== s.id);
  g.paid = 0;
  open[6].status = 'Не требуется';
  return x;
}

const STATUS = {
  'К сдаче': 'todo',
  'В работе': 'in_progress',
  Сдан: 'submitted',
  'Требует исправления': 'needs_fix',
  'Не требуется': 'not_required',
};
const t100 = (v) => (v == null ? null : Math.round(v * 100));

function run(db, today, taxpay) {
  const context = vm.createContext({
    DB: { ref },
    CPS: db.contractors,
    REPORTS: db.reports,
    OPS: db.moneyOps,
    FEEPAYS: db.feePayments,
    ORG: db.organization,
    TODAY0: today,
    TAXPAY: taxpay,
  });
  vm.runInContext(
    `'use strict';
    const TODAY = TODAY0;
    const S = { me: 'e1' };
    const feat = (k) => (k === 'taxpay' ? TAXPAY : true);
    const kpiIndex = () => {}, enNorm = () => {};
    const CPM = Object.fromEntries(CPS.map((c) => [c.id, c]));
    ${source}
    derive();
    const t = (v) => (v == null ? null : Math.round(v * 100));
    const j = (...a) => a.map((v) => (v == null ? '' : v === true ? 1 : v === false ? 0 : v)).join('|');
    const plans = CPS.map((c) => [c.id, rmPlan(REPORTS.filter((r) => r.cp === c.id))]);
    globalThis.oracle = {
      // сроки и просрочка — как их посчитал прототип на эту дату
      // отчёт | срок сдачи | срок оплаты | просрочена сдача | просрочена оплата
      dues: REPORTS.map((r) => j(r.id, r.due, r.payDue, !!r.overdue, !!r.payOverdue)),
      // отчёт | сдать | уплатить | сдано | оплачено | без суммы | к уплате | оплачено | осталось | просрочка | ближайший срок
      items: plans.flatMap(([, plan]) => plan.flatMap((g) => g.items)).map((x) =>
        j(x.r.id, x.sub, x.pay, x.subDone, x.payDone, x.noSum, t(x.sum), t(x.paid), t(x.left), x.late, x.when)),
      // контрагент | месяц | отчёты по порядку | сдать | сдано | уплатить | оплачено | без суммы | к уплате | оплачено | осталось | просрочено | закрыт | первый срок | последний срок
      groups: plans.flatMap(([cp, plan]) => plan.map((g) =>
        j(cp, g.m, g.items.map((x) => x.r.id).join(','), g.subN, g.subDone, g.payN, g.payDone, g.noSum, t(g.sum), t(g.paid), t(g.left), g.late, g.done, g.from, g.to))),
    };`,
    context,
  );
  return context.oracle;
}

// Поля продукта: отчёт глазами плана месяца.
function input(db) {
  const types = ref.reportTypes;
  const T = Object.fromEntries(types.map((t) => [t.id, t]));
  // отчёт | контрагент | что сделать | статус | периодичность | начало периода | дата события | к уплате | оплачено | заменён | место вида в каталоге
  return db.reports.map((r) =>
    [
      r.id,
      r.cp,
      r.act ?? T[r.t].act,
      STATUS[r.status],
      T[r.t].per,
      r.pkey,
      r.p?.ev && r.p.y && r.p.m ? `${r.p.y}-${String(r.p.m).padStart(2, '0')}-01` : '',
      t100(r.sum) ?? '',
      t100(r.paid ?? 0),
      r.superseded ? 1 : 0,
      types.indexOf(T[r.t]),
    ].join('|'),
  );
}

const RUNS = [
  { today: '2026-10-18', taxpay: true },
  { today: '2026-10-18', taxpay: false },
  { today: '2026-11-30', taxpay: true },
];
const datasets = [
  { name: 'демо', db: demo },
  { name: 'демо с правками', db: variant(demo) },
].map(({ name, db }) => ({
  name,
  reports: input(db),
  runs: RUNS.map(({ today, taxpay }) => ({ today, taxpay, ...run(clone(db), today, taxpay) })),
}));

const fixture = { source: 'modules/report-months.js, core/derive.js', datasets };
const out = fileURLToPath(new URL('../src/reports/__fixtures__/month-plan.json', import.meta.url));
writeFileSync(
  out,
  await format(JSON.stringify(fixture), { ...(await resolveConfig(out)), filepath: out }),
);
console.log(
  `month-plan.json: ${datasets.map((d) => `${d.name} — ${d.reports.length} отчётов, ${d.runs[0].groups.length} месяцев`).join('; ')}`,
);
