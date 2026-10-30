// Эталон для обслуживания контрагента: периоды после «Приостановить», «Возобновить», «Отменить
// приостановку», отката приостановки, «В архив», «Вернуть из архива», «Перевести в постоянное
// обслуживание», запланированная приостановка и что станет с отчётами (прототип core/org.js: inService,
// periodsText; ui/status-scale.js: planPause, rollbackDlg('svc'); modules/services.js: applyService,
// pauseDlg, resumeDlg, unpauseCp, toRegularDlg; modules/contractors.js: archiveDlg, unarchiveCp).
// Изменение периодов в прототипе — строки внутри окон: они берутся из исходников дословно (пропала
// строка после spec:sync — скрипт падает). Периоды — demoDB.json и полученные из них случайной цепочкой
// действий; «сегодня» — несколько дат. Запуск: node packages/domain/scripts/oracle-service.mjs — пишет
// packages/domain/src/contractors/__fixtures__/service.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const demo = JSON.parse(read('spec/data/demoDB.json'));

const DATA = 'spec/prototype/src/js/core/data.js';
const ORG = 'spec/prototype/src/js/core/org.js';
const SCALE = 'spec/prototype/src/js/ui/status-scale.js';
const SERVICES = 'spec/prototype/src/js/modules/services.js';
const CPS = 'spec/prototype/src/js/modules/contractors.js';
const pick = (file, wanted) =>
  read(file)
    .split('\n')
    .filter((line) => wanted.test(line))
    .join('\n');
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
/** Строка прототипа дословно: изменилась — эталон надо проверить заново. */
const exact = (file, code) => {
  if (!read(file).includes(code)) throw new Error(`В ${file} больше нет строки: ${code}`);
  return code;
};

const source = `
  ${pick(DATA, /^const (D|toIso|ym|addMonths|addDays)=/)}
  ${pick(ORG, /^const (inService|lastPeriod|pTxt|periodsText)=/)}
  ${pick('spec/prototype/src/js/core/derive.js', /^const OPEN=/)}
  ${block(SCALE, 'planPause')}
  let REPORTS = [];
  const assignTypes = () => {};
  ${block(SERVICES, 'applyService')}
  function pauseP(c, f, t) { ${exact(SERVICES, 'const l=lastPeriod(c);if(l){l.to=addMonths(f,-1);if(l.to<l.from)c.periods.pop()}if(t)c.periods.push({from:t,to:null});')} }
  function resumeP(c, f) { ${exact(SERVICES, 'const l=lastPeriod(c);if(l&&!l.to&&l.from>ym(TODAY)){l.from=f;const pv=c.periods[c.periods.length-2];if(pv&&pv.to&&addMonths(pv.to,1)>=f){c.periods.pop();pv.to=null}}else if(l&&l.to&&addMonths(l.to,1)>=f)l.to=null;else c.periods.push({from:f,to:null});')} }
  function unpauseP(c) { const pp=planPause(c);if(!pp)return false; ${exact(SERVICES, 'if(pp.fut)c.periods.pop();pp.prev.to=null;')} return true }
  function skippedP(o) { ${exact(SCALE, 'const l=lastPeriod(o);const from=l&&l.to?addMonths(l.to,1):ym(TODAY);const ms=[];for(let x=from;x<=ym(TODAY);x=addMonths(x,1))ms.push(x);')} return ms }
  function rollbackP(o) { const ps=o.periods;// a pause from the very first month leaves no period at all
    ${exact(SCALE, 'if(!ps.length)ps.push({from:ym(TODAY),to:null});let l=ps[ps.length-1];if(l.from>ym(TODAY)&&ps.length>1){ps.pop();l=ps[ps.length-1]}if(l.from>ym(TODAY))l.from=ym(TODAY);l.to=null;')} }
  function archiveP(c) { ${exact(CPS, '{const l=lastPeriod(c);if(l&&(!l.to||l.to>ym(TODAY)))l.to=ym(TODAY)}')} }
  function unarchiveP(c) { ${exact(CPS, "const l=lastPeriod(c);if(c.kind!=='oneoff'){if(l&&l.to&&l.to>=ym(TODAY))l.to=null;else c.periods.push({from:ym(TODAY),to:null})}")} }
  function toRegularP(c, f) { ${exact(SERVICES, '{const lp=c.periods[c.periods.length-1];if(lp&&!lp.to){if(lp.from<f)lp.to=addMonths(f,-1);else c.periods.pop()}}c.periods.push({from:f,to:null});')} }
  function archiveReports(c) { ${exact(CPS, "REPORTS.filter(r=>r.cp===c.id&&OPEN.has(r.status)&&r.due>=TODAY&&!inService(c,ym(r.pkey))).forEach(r=>{r.status='Не требуется'})")} }
`;

const ctx = vm.createContext({ console });
vm.runInContext(`${source}; var TODAY;`, ctx);
const run = (code) => vm.runInContext(code, ctx);
const clone = (x) => JSON.parse(JSON.stringify(x));

// Детерминированный «случайный» выбор: эталон не меняется от запуска к запуску.
let seed = 20261030;
const rand = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};
const addM = (m, n) => run(`addMonths(${JSON.stringify(m)}, ${n})`);

const TODAYS = ['2026-10-18', '2026-11-01', '2027-05-20'];
const STATUS = {
  'К сдаче': 'open',
  'В работе': 'open',
  'Требует исправления': 'open',
  'Не требуется': 'not_required',
};

/** Набор периодов: демо и полученные из них цепочкой действий прототипа. */
function states(today) {
  run(`TODAY = ${JSON.stringify(today)}`);
  const month = today.slice(0, 7);
  const out = demo.contractors.map((c) => ({
    archived: !!c.archived,
    oneOff: c.kind === 'oneoff',
    periods: clone(c.periods),
  }));
  out.push({ archived: false, oneOff: false, periods: [] });
  const regular = out.filter((c) => !c.oneOff && !c.archived);
  for (let i = 0; i < 120; i++) {
    const c = clone(regular[rand(regular.length)]);
    for (let k = rand(3) + 1; k > 0; k--) {
      ctx.c = { periods: c.periods, archived: false, kind: 'regular' };
      const op = rand(4);
      const l = c.periods[c.periods.length - 1];
      const pp = run('planPause(c)');
      if (op === 0 && l && !l.to && l.from <= month && !pp) {
        const f = addM(month, rand(3));
        run(
          `pauseP(c, ${JSON.stringify(f)}, ${rand(2) ? JSON.stringify(addM(f, rand(6) + 1)) : 'null'})`,
        );
      } else if (op === 1 && !(l && !l.to && l.from <= month) && !(pp && !pp.resume)) {
        run(`resumeP(c, ${JSON.stringify(addM(month, rand(4)))})`);
      } else if (op === 2 && pp) run('unpauseP(c)');
      else if (op === 3 && !run('inService(c, ym(TODAY))') && !pp) run('rollbackP(c)');
      c.periods = ctx.c.periods;
    }
    out.push(c);
  }
  const seen = new Set();
  return out.filter((c) => {
    const key = JSON.stringify(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const cases = [];
for (const today of TODAYS) {
  const month = today.slice(0, 7);
  for (const s of states(today)) {
    run(`TODAY = ${JSON.stringify(today)}`);
    const proto = () => ({
      periods: clone(s.periods),
      archived: s.archived,
      kind: s.oneOff ? 'oneoff' : 'regular',
    });
    const after = (code, extra = {}) => {
      ctx.c = proto();
      Object.assign(ctx, extra);
      run(code);
      return clone(ctx.c.periods);
    };
    ctx.c = proto();
    const pp = run('planPause(c)');
    const base = {
      today,
      subject: s,
      inService: run('inService(c, ym(TODAY))'),
      text: run('periodsText(c)'),
      planned: pp && { from: pp.from, resume: pp.resume },
    };
    const ops = {};
    if (!s.archived && !s.oneOff) {
      const f = addM(month, rand(3));
      const t = rand(2) ? addM(f, rand(6) + 1) : null;
      ops.pause = { from: f, resume: t, periods: after('pauseP(c, f, t)', { f, t }) };
      const r = addM(month, rand(4));
      ops.resume = { from: r, periods: after('resumeP(c, r)', { r }) };
      ctx.c = proto();
      ops.cancel = run('unpauseP(c)') ? clone(ctx.c.periods) : null;
      ctx.c = proto();
      ops.skipped = clone(run('skippedP(c)'));
      ops.rollback = after('rollbackP(c)');
      ops.archive = after('archiveP(c)');
      const g = addM(month, rand(3));
      ops.toRegular = { from: g, periods: after('toRegularP(c, g)', { g }) };
    }
    ops.unarchive = after('unarchiveP(c)');
    cases.push({ ...base, ops });
  }
}

// Отчёты: applyService после изменения периодов и отправка в архив (сроки вокруг «сегодня»).
const reports = [];
for (const today of TODAYS) {
  run(`TODAY = ${JSON.stringify(today)}`);
  const month = today.slice(0, 7);
  for (let i = 0; i < 60; i++) {
    const periods = [{ from: addM(month, -6), to: addM(month, rand(3) - 2) }];
    if (rand(2)) periods.push({ from: addM(month, rand(4)), to: null });
    const archived = rand(4) === 0;
    const statuses = Object.keys(STATUS).concat('Сдан');
    const list = Array.from({ length: 6 }, (_, k) => {
      const pkey = `${addM(month, rand(6) - 3)}-01`;
      const due = run(`addDays(${JSON.stringify(today)}, ${rand(90) - 45})`);
      const status = statuses[rand(statuses.length)];
      return {
        id: k,
        cp: 1,
        t: rand(2) ? 'a' : 'b',
        pkey,
        due,
        status,
        subDate: status === 'Сдан' || rand(5) === 0 ? due : null,
        superseded: false,
      };
    });
    const assign = [
      { t: 'a', to: null },
      { t: 'b', to: rand(2) ? today : null },
    ];
    run('REPORTS.length = 0');
    for (const r of clone(list)) run(`REPORTS.push(${JSON.stringify(r)})`);
    ctx.c = { id: 1, periods: clone(periods), archived, kind: 'regular', assign };
    run('applyService(c)');
    const applied = run('REPORTS.map(r => r.status)');
    run('REPORTS.length = 0');
    for (const r of clone(list)) run(`REPORTS.push(${JSON.stringify(r)})`);
    ctx.c = { id: 1, periods: clone(periods), archived: true, kind: 'regular', assign };
    run('archiveReports(c)');
    const archivedOut = run('REPORTS.map(r => r.status)');
    reports.push({
      today,
      periods,
      archived,
      reports: list.map((r, k) => ({
        month: r.pkey.slice(0, 7),
        due: r.due,
        status: STATUS[r.status] ?? 'other',
        submitted: !!r.subDate,
        assigned: assign.some((a) => a.t === r.t && !a.to),
        applied: STATUS[applied[k]] ?? 'other',
        onArchive: STATUS[archivedOut[k]] ?? 'other',
      })),
    });
  }
}

const out = fileURLToPath(new URL('../src/contractors/__fixtures__/service.json', import.meta.url));
writeFileSync(
  out,
  await format(
    JSON.stringify({ source: 'services.js, status-scale.js, contractors.js', cases, reports }),
    {
      ...(await resolveConfig(out)),
      filepath: out,
    },
  ),
);
console.log(`service.json: ${cases.length} контрагентов, ${reports.length} наборов отчётов`);
