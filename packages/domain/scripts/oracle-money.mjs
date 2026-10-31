// Эталон для денег по отчётам: статус оплаты, график оплаты, сверка денег контрагента («Получено от
// контрагента», «Достаточно» / «Недостача», свободный остаток), просрочка оплаты, «Сдан» только после
// оплаты и окно «Отметить оплаченным» (прототип core/derive.js `derive`, core/org.js `schedule`,
// ui/status-scale.js `subNeedPay`, `subPayWhy`, `payDlg`). Данные — отчёты и операции demoDB.json и тот
// же набор с правками, которые проходят остальные ветки (оплатил сам, уточнённый, «Уплата», возвраты,
// обратные записи, переводы, отрицательный остаток); «сегодня» — две даты. Вход записывается полями
// продукта. Запуск: node packages/domain/scripts/oracle-money.mjs — пишет
// packages/domain/src/money/__fixtures__/tax.json (скилл prototype-oracle).
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
const SCALE = 'spec/prototype/src/js/ui/status-scale.js';
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
// Из окна «Отметить оплаченным»: начало (сумма по умолчанию, «денег не хватает») и текст ошибки суммы.
const payDlg = block(SCALE, 'payDlg');
const payHead = /const need=[\s\S]*?const short=[^;]*;/.exec(payDlg)?.[0];
const payErr = /setErr\(el,'py-sum',([\s\S]*?)\)\)return;/.exec(payDlg)?.[1];
if (!payHead || !payErr) throw new Error('В payDlg не найдены сумма по умолчанию или текст ошибки');
// Вкладка «Деньги» карточки контрагента: сверка по сроку оплаты до конца месяца и причина неактивных
// «Списать в бонус» / «Вернуть остаток».
const CARD = 'spec/prototype/src/js/modules/contractor-card.js';
const moneyTab = /const need=REPORTS[\s\S]*?(?=const ops=OPS)/.exec(read(CARD))?.[0];
if (!moneyTab) throw new Error('В карточке контрагента не найдена сверка вкладки «Деньги»');

const source = `
  ${pick(DATA, /^const (D|toIso|mkDate|diffDays|addDays|ym|addMonths|lastDay|MONTHS|MONTHS_G|minIso|som)=/)}
  ${block(DATA, 'fmtM')}
  ${read('spec/prototype/src/js/core/reference.js').replace("'use strict';", '')}
  ${pick(ORG, /^const (inService|cpStatus|curTariff)=/)}
  ${['schedule', 'tariffAt', 'feeDue', 'feeMonths', 'feeCharge'].map((n) => block(ORG, n)).join('\n')}
  ${read('spec/prototype/src/js/core/derive.js').replace("'use strict';", '')}
  ${pick(SCALE, /^const (payFirstOn|subNeedPay|subPayWhy)=/)}
  ${pick(CARD, /^const OPK=/)}
  function moneyTab(c, pm) {
    ${moneyTab}
    return { need, needSum, have, later, laterSum, diff, noFree };
  }
`;

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Набор B: ветки, которых нет в демо-данных. */
function variant(db) {
  const x = clone(db);
  const rep = (id) => x.reports.find((r) => r.id === id);
  const open = x.reports.filter((r) => r.status === 'К сдаче' && r.sum > 0 && r.paid === 0);
  const add = (o) => x.moneyOps.push({ id: 10000 + x.moneyOps.length, date: '2026-10-10', ...o });
  // «Оплатил контрагент сам» — часть и всё.
  const [a, b, c, d, e, f] = open;
  add({ cp: a.cp, kind: 'pay', self: true, amount: Math.round(a.sum / 2), report: a.id });
  a.paid += Math.round(a.sum / 2);
  add({ cp: b.cp, kind: 'pay', self: true, amount: b.sum + 150, report: b.id });
  b.paid += b.sum + 150;
  // «Уплата» по отчёту вида «Сдача + уплата» (отчёт сохранил «Что сделать» прежнего вида).
  c.act = 'pay';
  // Уточнённый: первичный заменён, у новой версии оплаченное перенесено.
  const s = x.reports.find(
    (r) => r.status === 'Сдан' && r.sum > 0 && r.paid >= r.sum && r.t !== 'imn',
  );
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
  // Без суммы и с нулевой суммой.
  d.sum = null;
  e.sum = 0;
  // Возврат контрагенту, возврат по уточнённому, обратная запись (и отрицательная), перевод.
  add({ cp: f.cp, kind: 'refund', amount: 1000 });
  add({ cp: f.cp, kind: 'back', amount: 700 });
  add({ cp: f.cp, kind: 'corr', amount: -300 });
  add({ cp: f.cp, kind: 'corr', amount: 200 });
  add({ cp: f.cp, kind: 'xfer', amount: 5000 });
  // Отрицательный остаток: списание больше поступлений.
  add({ cp: open.at(-1).cp, kind: 'bonus', amount: 900000 });
  // Отчёт «Не требуется» с суммой.
  rep(open[6].id).status = 'Не требуется';
  return x;
}

const TODAYS = ['2026-10-18', '2026-11-30'];
const STATUS = {
  'К сдаче': 'todo',
  'В работе': 'in_progress',
  Сдан: 'submitted',
  'Требует исправления': 'needs_fix',
  'Не требуется': 'not_required',
};
const PAY = {
  'Не оплачено': 'unpaid',
  'Оплачено частично': 'partial',
  Оплачено: 'paid',
  'Не требуется': 'not_required',
};
const MONEY = { paid: 'paid', ok: 'enough', short: 'short' };
const t100 = (v) => (v == null ? null : Math.round(v * 100));

function run(db, today) {
  const context = vm.createContext({
    DB: { ref },
    CPS: db.contractors,
    REPORTS: db.reports,
    OPS: db.moneyOps,
    FEEPAYS: db.feePayments,
    ORG: db.organization,
    TODAY0: today,
    MAP: { STATUS, PAY, MONEY },
  });
  vm.runInContext(
    `'use strict';
    const TODAY = TODAY0;
    const S = { me: 'e1' };
    const feat = () => true;
    const kpiIndex = () => {}, enNorm = () => {};
    const CPM = Object.fromEntries(CPS.map((c) => [c.id, c]));
    ${source}
    derive();
    const t = (v) => (v == null ? null : Math.round(v * 100));
    const sentSums = [undefined, 4000, 0];
    const j = (...a) => a.map((v) => (v == null ? '' : v === true ? 1 : v === false ? 0 : v)).join('|');
    const taxed = REPORTS.filter((r) => tR(r).sum);
    globalThis.oracle = {
      contractors: CPS.map((c) => j(c.id, t(c.avail), t(c.free), cpStatus(c))),
      // отчёт | статус сдачи | оплата | срок оплаты | получено | отложено | сверка | нужно | не хватает | просрочка оплаты
      reports: REPORTS.map((r) => {
        const m = r.money || {};
        return j(r.id, MAP.STATUS[r.status], MAP.PAY[r.payStatus], r.payDue, t(r.got), t(r.ear), r.money ? MAP.MONEY[m.s] : '', t(m.need), t(m.n), r.payOverdue);
      }),
      ruleDues: Object.fromEntries(taxed.filter((r) => !(Array.isArray(tR(r).inst) && tR(r).inst.length)).map((r) => [r.id, schedule(r)[0].due])),
      // платежи графика: срок | сумма | оплачено — у отчётов с оплатой долями
      schedules: Object.fromEntries(taxed.filter((r) => schedule(r).length > 1).map((r) => [r.id, schedule(r).map((x) => j(x.due, t(x.amount), t(x.paid)))])),
      // отчёт | нужна оплата при сумме отчёта, 4 000 сом, 0 | причина при сумме отчёта
      submit: taxed.map((r) => j(r.id, ...sentSums.map((s) => subNeedPay(r, s)), subPayWhy(r))),
      // отчёт | сумма по умолчанию | «Оплатил сам» включён | ошибки без «Оплатил сам»: 0, 1 сом, остаток + 1 сом
      pay: taxed.filter((r) => r.sum > 0 && r.paid < r.sum && r.status !== 'Не требуется').map((r) => {
        const c = CPM[r.cp];
        ${payHead}
        const err = (n, self) => { const st = { self }; return ${payErr}; };
        const ns = [0, 1, c.avail + 1];
        return [j(r.id, t(def), short), ...ns.map((n) => j(t(n), err(n, false), err(n, true)))];
      }),
      // контрагент | конец месяца | к оплате | сумма | отложено | сумма | разница | почему нет свободного остатка
      reconciliation: CPS.flatMap((c) => [-2, -1, 0, 1].map((k) => {
        const pm = addMonths(ym(TODAY), k);
        const x = moneyTab(c, pm);
        return j(c.id, lastDay(pm), x.need.map((r) => r.id).join(','), t(x.needSum), x.later.map((r) => r.id).join(','), t(x.laterSum), t(x.diff), x.noFree);
      })),
    };`,
    context,
  );
  return context.oracle;
}

// Поля продукта: отчёт глазами денег (без производных полей прототипа), операции, сроки платежей —
// так, как их даст расчёт сроков отчёта (у «Сдача» — срок сдачи).
function input(db) {
  const T = Object.fromEntries(ref.reportTypes.map((t) => [t.id, t]));
  const recv = {};
  const self = {};
  for (const o of db.moneyOps) {
    if (o.kind === 'in') for (const x of o.alloc ?? []) recv[x.r] = (recv[x.r] ?? 0) + x.a;
    if (o.kind === 'pay' && o.self && o.report) self[o.report] = (self[o.report] ?? 0) + o.amount;
  }
  // отчёт | контрагент | вид | год | что сделать | статус | к уплате | оплачено | из них сам | принято под него | заменён | срок сдачи
  return {
    reports: db.reports.map((r) =>
      [
        r.id,
        r.cp,
        r.t,
        r.p.y,
        r.act ?? T[r.t].act,
        STATUS[r.status],
        t100(r.sum) ?? '',
        t100(r.paid),
        t100(self[r.id] ?? 0),
        t100(recv[r.id] ?? 0),
        r.superseded ? 1 : 0,
        r.due,
      ].join('|'),
    ),
    // контрагент | вид | сумма | оплатил сам
    ops: db.moneyOps.map((o) => [o.cp, o.kind, t100(o.amount), o.self ? 1 : 0].join('|')),
  };
}

const datasets = [
  { name: 'демо', db: demo },
  { name: 'демо с правками', db: variant(demo) },
].map(({ name, db }) => {
  const [first, ...rest] = TODAYS.map((today) => run(clone(db), today));
  return {
    name,
    ...input(db),
    expected: {
      today: TODAYS[0],
      ...first,
      // другие даты: меняются только просрочка оплаты и приостановленные контрагенты
      later: rest.map((x, i) => ({
        today: TODAYS[i + 1],
        paused: x.contractors
          .filter((c) => c.endsWith('|Приостановлен'))
          .map((c) => c.split('|')[0]),
        overdue: x.reports.filter((r) => r.endsWith('|1')).map((r) => r.split('|')[0]),
      })),
    },
  };
});

const installments = Object.fromEntries(
  ref.reportTypes.filter((t) => Array.isArray(t.inst) && t.inst.length).map((t) => [t.id, t.inst]),
);
const fixture = {
  source: 'core/derive.js, core/org.js, ui/status-scale.js',
  holidays: ref.holidays,
  workingSaturdays: ref.workingSaturdays,
  installments,
  datasets,
};

const out = fileURLToPath(new URL('../src/money/__fixtures__/tax.json', import.meta.url));
writeFileSync(
  out,
  await format(JSON.stringify(fixture), { ...(await resolveConfig(out)), filepath: out }),
);
console.log(
  `tax.json: ${datasets.map((d) => `${d.name} — ${d.reports.length} отчётов, ${d.ops.length} операций`).join('; ')}`,
);
