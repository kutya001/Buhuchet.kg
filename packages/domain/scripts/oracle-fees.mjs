// Эталон для платы за обслуживание: ставки, начисления, срок оплаты, оплаты по месяцам, аванс, долг,
// напоминание о долге, окна «Новая ставка» и «Принять / Изменить оплату за обслуживание» (прототип
// core/org.js `tariffAt`, `feeMonths`, `feeCharge`, `feeDue`, core/derive.js `fpAlloc`, `fpAdv`,
// `feeAdvSplit`, `feeGot`, `derive`, modules/contractor-card.js `tariffDlg`, `feePayDlg`, вкладка
// «Обслуживание», ui/status-scale.js `waDlg`). Данные — контрагенты и оплаты demoDB.json и тот же набор
// с правками, которые проходят остальные ветки (полный первый месяц, «со следующего месяца», контрагента
// завели позже начала, долги, аванс, удалённая оплата); «сегодня» — две даты. Вход записывается полями
// продукта. Запуск: node packages/domain/scripts/oracle-fees.mjs — пишет
// packages/domain/src/fees/__fixtures__/fees.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const demo = JSON.parse(read('spec/data/demoDB.json'));

const DATA = 'spec/prototype/src/js/core/data.js';
const ORG = 'spec/prototype/src/js/core/org.js';
const DERIVE = 'spec/prototype/src/js/core/derive.js';
const CARD = 'spec/prototype/src/js/modules/contractor-card.js';
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
const grab = (text, re, what) => {
  const m = re.exec(text);
  if (!m) throw new Error(`Не найдено: ${what}`);
  return m[1] ?? m[0];
};

const derive = read(DERIVE);
const feeFadv = grab(derive, /(const fadv=\{\};FEEPAYS\.forEach[^\n]*)/, 'аванс по контрагентам');
const feeDerive = grab(
  derive,
  /(const sp=feeAdvSplit\(c,[^\n]*\n\s*let debt=0;[^\n]*c\.feeDebt=debt;)/,
  'долг и аванс в derive',
);
const pay = block(CARD, 'feePayDlg');
const payHead = grab(pay, /(const own=\{\};[\s\S]*?else auto\(\);)/, 'начало окна оплаты');
const payRow = grab(
  pay,
  /const m=td\.dataset\.fps,a=\+st\.rows\[m\]\|\|0;td\.innerHTML=([\s\S]*?)\}\);/,
  '«Станет» у строки',
);
const payLine = grab(pay, /line\.innerHTML=([\s\S]*?);return \{t,d\}/, 'строка «Распределено»');
const paySumErr = grab(pay, /setErr\(el,'fp-sum',([\s\S]*?)\)\)return;/, 'ошибка суммы');
const payDateErr = grab(pay, /setErr\(el,'fp-date',([\s\S]*?)\)\)return;/, 'ошибка даты');
const payTxt = grab(pay, /(const txt=al=>[^\n]*;)\n/, 'текст распределения');
const payCh = grab(
  pay,
  /(const al0=fpAlloc\(edit\),ch=\[\];[\s\S]*?ch\.push\(`куда[^\n]*?\);)/,
  'изменения',
);
const payWhy = grab(pay, /setErr\(el,'fp-why',([\s\S]*?)\)\)return;/, 'причина изменения');
const payLog = grab(pay, /log\('fp',f\.id,(`[^`]*`),c\.id\)/, 'запись истории оплаты');
const tariff = block(CARD, 'tariffDlg');
const tariffErr = grab(
  tariff,
  /setErr\(el,'tf-from',([\s\S]*?)\)\)return;/,
  'ошибка месяца ставки',
);
const tariffSumErr = grab(
  tariff,
  /setErr\(el,'tf-sum',([\s\S]*?)\)\)return;/,
  'ошибка суммы ставки',
);
const tariffNote = grab(tariff, /inp\('tf-note',(.*?)\),\{full/, 'примечание ставки');
const tariffLog = grab(tariff, /log\('cp',c\.id,(`[^`]*`),c\.id\)/, 'запись истории ставки');
const wa = read(SCALE); // у waDlg параметры в фигурных скобках — ищем по файлу
const waFee = grab(
  wa,
  /(const months=feeMonths\(c\)\.filter[^;]*;const m=[^;]*;)/,
  'месяцы напоминания',
);
const waDate = grab(
  wa,
  /replaceAll\('\{дата\}',(\(\(\)=>\{[\s\S]*?\}\)\(\))\)/,
  'дата напоминания',
);

const source = `
  ${pick(DATA, /^const (D|toIso|mkDate|addDays|diffDays|ym|addMonths|lastDay|MONTHS|MONTHS_G|minIso|ymG|ymLabel|fmtD|som|parseNum)=/)}
  ${block(DATA, 'fmtM')}
  ${pick(ORG, /^const (curTariff|inService|cpStatus)=/)}
  ${['tariffAt', 'feeDue', 'feeMonths', 'feeCharge'].map((n) => block(ORG, n)).join('\n')}
  ${pick(DERIVE, /^const (fpAlloc|fpAdv|feeGot)=/)}
  ${block(DERIVE, 'feeAdvSplit')}
  ${pick(CARD, /^const feeAccOk=/)}
`;

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Набор B: ветки, которых нет в демо-данных. */
function variant(db) {
  const x = clone(db);
  const cp = (id) => x.contractors.find((c) => c.id === id);
  const pays = (id) => x.feePayments.filter((f) => f.cp === id);
  let n = 0;
  const add = (f) => {
    const p = { id: `fv${++n}`, date: '2026-10-12', by: 'e1', holder: 'org', ...f };
    x.feePayments.push(p);
    const c = cp(p.cp);
    for (const a of p.alloc ?? (p.month ? [{ m: p.month, a: p.amount }] : []))
      c.feePaid[a.m] = (c.feePaid[a.m] || 0) + a.a;
  };
  const drop = (f) => {
    f.del = true;
    const c = cp(f.cp);
    for (const a of f.alloc ?? (f.month ? [{ m: f.month, a: f.amount }] : []))
      c.feePaid[a.m] = (c.feePaid[a.m] || 0) - a.a;
  };
  // Полный первый месяц и «со следующего месяца».
  cp(21).first = 'full';
  cp(24).first = 'next';
  // Контрагента завели позже начала обслуживания (срок первого месяца — по дню, когда завели).
  cp(23)._ca = '2026-05-20 10:00';
  // Долги: удалены оплаты за август — октябрь; у одного — частичная оплата октября.
  for (const id of [3, 5, 22])
    pays(id)
      .filter((f) => ['2026-08', '2026-09', '2026-10'].includes(f.month))
      .forEach(drop);
  add({ cp: 5, amount: 5000, alloc: [{ m: '2026-08', a: 5000 }] });
  // Аванс без месяцев и оплата с месяцами и авансом сверху.
  add({ cp: 3, amount: 10000, alloc: [] });
  add({ cp: 22, amount: 30000, alloc: [{ m: '2026-08', a: 9000 }] });
  // Оплата наперёд, больше начисления за месяц: всё сверх — аванс.
  add({ cp: 4, amount: 40000, alloc: [] });
  // Только что начали обслуживать: день оплаты в месяце начала прошёл — срок первого месяца переносится.
  Object.assign(cp(28), {
    start: '2026-10-16',
    _ca: '2026-10-16 09:00',
    periods: [{ from: '2026-10', to: null }],
  });
  cp(28).tariffs[0].from = '2026-10';
  pays(28).forEach(drop);
  // Ставка на будущий месяц.
  cp(6).tariffs.push({ amount: 20000, per: 'M', from: '2026-12', by: 'e1', at: '2026-10-01' });
  return x;
}

const TODAYS = ['2026-10-18', '2026-11-03'];
const t100 = (v) => (v == null || v === '' ? null : Math.round(v * 100));

function run(db, today) {
  const context = vm.createContext({
    CPS: db.contractors,
    FEEPAYS: db.feePayments,
    TODAY0: today,
  });
  vm.runInContext(
    `'use strict';
    const TODAY = TODAY0;
    const feat = () => true, can = () => true;
    const ic = () => '';
    const fpTo = () => [['org', 'Счёт организации']];
    const fpToName = (t) => t === 'owner' ? 'владельцу организации' : 'счёт организации';
    ${source}
    // derive: только плата за обслуживание
    ${feeFadv}
    // «Оплачено» за месяц — сумма распределений оплат (кэш \`feePaid\` в demoDB.json без оплат 2025 года)
    CPS.forEach((c) => {
      c.feePaid = {};
      FEEPAYS.filter((f) => f.cp === c.id && !f.del).forEach((f) =>
        fpAlloc(f).forEach((a) => { c.feePaid[a.m] = (c.feePaid[a.m] || 0) + a.a; }));
      ${feeDerive}
    });
    const t = (v) => (v == null || v === '' ? null : Math.round(v * 100));
    const j = (...a) => a.map((v) => (v == null ? '' : v === true ? 1 : v === false ? 0 : v)).join('|');
    const state = (html) => !html ? '' : /больше долга|больше суммы/.test(html) ? 'over' : /аванс/.test(html) ? 'advance' : /сходится/.test(html) ? 'even' : /оплачено/.test(html) ? 'paid' : /частично/.test(html) ? 'partial' : '';
    // окно оплаты: заголовок, строки, ошибки
    function dlg(c, edit) {
      ${payHead}
      return { ms, debt, st, order, got, left, base, auto };
    }
    function rowState(c, d, m, a) { const { left, got } = d; const st = d.st; return state(${payRow}); }
    function lineState(T_, d) { return state(${payLine}); }
    function errs(c, d, sum, rows, date) {
      const { left } = d;
      const st = { ...d.st, rows, date };
      const t = parseNum(sum);
      const dd = Object.values(rows).reduce((a, v) => a + (+v || 0), 0);
      const bad = Object.entries(st.rows).some(([m, v]) => v < 0 || v > left(m) + 0.001);
      return [((d) => ${paySumErr})(dd), ${payDateErr}];
    }
    function changes(c, edit, t, alloc, date, to, why) {
      const st = { date, to, why };
      ${payTxt}
      ${payCh}
      return [ch, ${payWhy}];
    }
    const months = (c) => feeMonths(c);
    const out = { contractors: [], months: [], reminders: [], dialogs: [], edits: [], tariffs: [] };
    CPS.forEach((c) => {
      out.contractors.push(j(c.id, t(c.feeDebt), t(c.feeAdv), feeAccOk(c), t((curTariff(c) || {}).amount)));
      // месяц | начислено | оплачено | из аванса | срок оплаты | статус | просрочено (вкладка «Обслуживание»:
      // красная отметка по сроку оплаты с переносом первого месяца — решение заказчика 27.10.2026, п. В-6)
      months(c).forEach((m) => {
        const ch = feeCharge(c, m), p = feeGot(c, m);
        out.months.push(j(c.id, m, t(ch), t(c.feePaid[m] || 0), t((c.feeAdvUse || {})[m] || 0), feeDue(c, m), p >= ch ? 'paid' : p > 0 ? 'partial' : 'unpaid', p < ch && feeDue(c, m) < TODAY));
      });
      if (c.feeDebt > 0) {
        ${waFee}
        const d = ${waDate};
        out.reminders.push(j(c.id, months.join(','), t(c.feeDebt), d));
      }
      // «Новая ставка»: сумма, периодичность, месяц, примечание; ошибки месяца
      {
        const nm = addMonths(ym(TODAY), 1), ct = curTariff(c);
        const note = ${tariffNote};
        const fromErr = (f) => ${tariffErr};
        const sumErr = (n) => ${tariffSumErr};
        const n = 40000, per = 'M', f = nm;
        const log = ${tariffLog};
        const fs = [addMonths(ym(TODAY), -1), ym(TODAY), nm, ...c.tariffs.map((x) => x.from), ''];
        out.tariffs.push([j(c.id, t(ct ? ct.amount : null), ct ? ct.per || 'M' : 'M', note, log, sumErr(NaN), sumErr(-1), sumErr(0)), ...fs.map((f) => j(f, fromErr(f)))]);
      }
      if (!feeAccOk(c)) return;
      const pays = FEEPAYS.filter((f) => f.cp === c.id && !f.del);
      const d = dlg(c, null);
      const rows = (r) => Object.entries(r).map(([m, a]) => m + ':' + t(a)).join(',');
      // новая оплата: строки | долг | сумма по умолчанию | распределение; суммы: по умолчанию, 1 000, долг + 5 000
      const totals = [d.st.sum, 1000, (+d.st.sum || 0) + 5000];
      out.dialogs.push({
        id: c.id,
        head: j(t(d.debt), t(d.st.sum), rows(d.st.rows)),
        months: d.ms.map((m) => j(m, t(feeCharge(c, m)), t(d.got(m)), t(d.left(m)), feeDue(c, m) < TODAY && d.left(m) > 0)),
        auto: totals.map((sum) => {
          d.st.sum = sum;
          d.auto();
          const r = d.st.rows;
          const dd = Object.values(r).reduce((a, v) => a + v, 0);
          const ln = lineState(+sum, dd);
          return j(t(sum), rows(r), ln, ...d.ms.map((m) => rowState(c, d, m, r[m] || 0)));
        }),
        errors: [
          errs(c, d, '0', {}, TODAY),
          errs(c, d, '100', d.ms.length ? { [d.ms[0]]: d.left(d.ms[0]) + 10 } : {}, TODAY),
          errs(c, d, '100', d.ms.length ? { [d.ms[0]]: Math.min(d.left(d.ms[0]), 150) } : {}, TODAY),
          errs(c, d, '100', {}, ''),
          errs(c, d, '100', {}, addDays(TODAY, 1)),
        ].map((e) => j(...e)),
        log: (() => { d.st.sum = totals[0]; d.auto(); const t = +d.st.sum || 0; const alloc = Object.entries(d.st.rows).filter(([, v]) => v > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([m, a]) => ({ m, a })); ${payTxt} return ${payLog}; })(),
      });
      // изменение последних оплат: строки | порядок | распределение по умолчанию; изменения и причина
      // последние две оплаты за месяцы текущего года и оплаты с авансом
      const y0 = TODAY.slice(0, 4) + '-01';
      const recent = pays.filter((f) => fpAlloc(f).every((x) => x.m >= y0)).slice(-2);
      [...recent, ...pays.filter((f) => fpAdv(f) > 0 && !recent.includes(f))].forEach((f) => {
        const e = dlg(c, f);
        const al = fpAlloc(f);
        const mod = [
          [f.amount, al, f.date, f.to || 'org', ''],
          [f.amount + 1000, al, f.date, f.to || 'org', ''],
          [f.amount, al, addDays(f.date, -1), f.to || 'org', 'ошибка в дате'],
          [f.amount, [], f.date, 'owner', ''],
          [f.amount + 500, al.map((x) => ({ m: x.m, a: x.a / 2 })), f.date, f.to || 'org', 'перепутали'],
        ];
        out.edits.push({
          id: c.id,
          payment: f.id,
          head: j(t(e.debt), t(e.st.sum), rows(e.st.rows), e.order.join(',')),
          months: e.ms.map((m) => j(m, t(feeCharge(c, m)), t(e.got(m)), t(e.left(m)))),
          changes: mod.map(([tt, alloc, date, to, why]) => { const [ch, w] = changes(c, f, tt, alloc, date, to, why); return [...ch, w].join(' / '); }),
        });
      });
    });
    globalThis.oracle = out;`,
    context,
  );
  return context.oracle;
}

// Поля продукта: контрагент глазами платы за обслуживание, периоды, ставки, оплаты.
function input(db) {
  return {
    // контрагент | разовый | начало | завели | день оплаты | первый месяц | в архиве
    contractors: db.contractors.map((c) =>
      [
        c.id,
        c.kind === 'oneoff' ? 1 : 0,
        c.start,
        (c._ca || '').slice(0, 10),
        c.feeDay,
        c.first,
        c.archived ? 1 : 0,
      ].join('|'),
    ),
    // контрагент | с | по
    periods: db.contractors.flatMap((c) =>
      (c.periods || []).map((p) => [c.id, p.from, p.to ?? ''].join('|')),
    ),
    // контрагент | сумма | периодичность | с месяца
    tariffs: db.contractors.flatMap((c) =>
      c.tariffs.map((x) => [c.id, t100(x.amount), x.per || 'M', x.from].join('|')),
    ),
    // оплата | контрагент | сумма | месяц:сумма,… | дата | куда | удалена
    payments: db.feePayments.map((f) =>
      [
        f.id,
        f.cp,
        t100(f.amount),
        (f.alloc ?? (f.month ? [{ m: f.month, a: f.amount }] : []))
          .map((x) => `${x.m}:${t100(x.a)}`)
          .join(','),
        f.date,
        f.to || 'org',
        f.del ? 1 : 0,
      ].join('|'),
    ),
  };
}

const datasets = [
  { name: 'демо', db: demo },
  { name: 'демо с правками', db: variant(demo) },
].flatMap(({ name, db }) =>
  TODAYS.map((today) => ({
    name: `${name}, ${today}`,
    today,
    ...input(db),
    expected: run(clone(db), today),
  })),
);

const fixture = {
  source: 'core/org.js, core/derive.js, modules/contractor-card.js, ui/status-scale.js',
  datasets,
};
const out = fileURLToPath(new URL('../src/fees/__fixtures__/fees.json', import.meta.url));
writeFileSync(
  out,
  await format(JSON.stringify(fixture), { ...(await resolveConfig(out)), filepath: out }),
);
console.log(
  `fees.json: ${datasets.map((d) => `${d.name} — ${d.contractors.length} контрагентов, ${d.payments.length} оплат`).join('; ')}`,
);
