// Эталон для проверок ГКЭД контрагента: gkCheck и gkEnSig из прототипа (spec/prototype/src/js/core/gked.js)
// на справочниках refDB.json и gkedDB.json. Случаи — пункты приёмки 17, 18, 56, 57, 58, придуманные
// случаи, которые проходят остальные ветки, и все контрагенты demoDB.json с их назначенными видами.
// Вход записывается полями продукта (коды режимов, форм, льгот и видов), как их кладёт наполнение
// (packages/db/src/seed/platform-dicts.ts). Запуск: node packages/domain/scripts/oracle-gked.mjs — пишет
// packages/domain/src/contractors/__fixtures__/gked.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const ref = JSON.parse(read('spec/data/refDB.json'));
const gkedItems = JSON.parse(read('spec/data/gkedDB.json')).items;
const demo = JSON.parse(read('spec/data/demoDB.json'));

const pick = (file, wanted) =>
  read(file)
    .split('\n')
    .filter((line) => wanted.test(line))
    .join('\n');
const REF = 'spec/prototype/src/js/core/reference.js';

// Как в core/data.js: справочник ГКЭД — отдельный файл, группы кодов — массив с id.
const REFDB = {
  ...ref,
  gked: gkedItems,
  gkedGroups: Object.entries(ref.gkedGroups).map(([id, g]) => ({ id, ...g })),
};
const context = vm.createContext({ REFDB, EMPLOYEES: demo.employees });
vm.runInContext(
  `'use strict';
  const DB = { ref: REFDB };
  ${pick(REF, /^(const DICT=|const TAXES=|const RT=|const T=|const regsOf=|const formEnd=|const benOf=)/)}
  ${pick('spec/prototype/src/js/core/data.js', /^const fmtD=/)}
  ${pick('spec/prototype/src/js/ui/grid.js', /^const norm=/)}
  const EM = Object.fromEntries(EMPLOYEES.map((e) => [e.id, e]));
  ${pick('spec/prototype/src/js/core/org.js', /^const empName=/)}
  ${pick('spec/prototype/src/js/core/session.js', /^const whoName=/)}
  ${read('spec/prototype/src/js/core/gked.js')}
  globalThis.oracle = { gkCheck, gkEnSig, whoName };`,
  context,
);
const { gkCheck, gkEnSig, whoName } = context.oracle;

const dicts = ref.dictionaries;
const byName = (items, name, what) => {
  const x = items.find((i) => i.name === name);
  if (!x) throw new Error(`${what}: нет «${name}»`);
  return x.code;
};
const regimeCode = (name) => (name ? byName(dicts.regimes.items, name, 'Режим') : null);
const formOf = (name) => {
  const f = dicts.forms.items.find((x) => x.name === name);
  return f ? { code: f.code, declarationFor: f.end } : null;
};

/** Контрагент прототипа → вход продукта: коды вместо названий. */
function subject(c) {
  return {
    gked: c.gked || null,
    gkedExtra: c.gked2 || [],
    form: formOf(c.form),
    regimes: [c.regime, c.regime2].filter(Boolean).map(regimeCode),
    benefits: (c.ben || []).map((n) => byName(dicts.benefits.items, n, 'Льгота')),
  };
}

const IP = { form: 'ИП' };
const LLC = { form: 'ОсОО' };
const ITD = { form: 'Физическое лицо на патенте (индивидуальная трудовая деятельность)' };
const EN = { regime: 'Единый налог' };
const PATENT = { regime: 'Патент' };
const confirm = (base, ask = '') => ({ base, by: 'e4', at: '2026-10-23', ask });

// Пункты приёмки и придуманные случаи. `confirmed` — подтверждение, данное при состоянии `base`.
const cases = [
  ['п. 17: 47.11 на едином налоге — ставка торговли', { ...LLC, ...EN, gked: '47.11.0' }],
  [
    'п. 17: 47.11 со статусом «Резидент ПВТ» — ни один ГКЭД не входит в перечень ПВТ',
    { ...LLC, ...EN, gked: '47.11.0', ben: ['Резидент ПВТ'] },
  ],
  [
    'п. 18: основной 64.19.1 на едином налоге — запрет (ст. 419)',
    { ...LLC, ...EN, gked: '64.19.1' },
  ],
  [
    'п. 18: 64.19.1 дополнительным — только предупреждение',
    { ...LLC, ...EN, gked: '47.11.0', gked2: ['64.19.1'] },
  ],
  [
    'п. 56: 61.10 на едином налоге — вопрос «Оказывает услуги интернета?»',
    { ...LLC, ...EN, gked: '61.10.0' },
  ],
  [
    'п. 56: 61.10 после подтверждения — жёлтая отметка',
    { ...LLC, ...EN, gked: '61.10.0' },
    confirm({ ...LLC, ...EN, gked: '61.10.0' }, 'Оказывает услуги интернета?'),
  ],
  ['п. 56: 64.19.2 (МФО) на едином налоге — «Проверьте право»', { ...LLC, ...EN, gked: '64.19.2' }],
  ['п. 57: ИП 47.11 на патенте — без предупреждения', { ...IP, ...PATENT, gked: '47.11.0' }],
  ['п. 57: ИП 47.77 на патенте — предупреждение', { ...IP, ...PATENT, gked: '47.77.0' }],
  ['п. 57: ИТД 74.20.0 на патенте — без предупреждения', { ...ITD, ...PATENT, gked: '74.20.0' }],
  ['п. 57: ИТД 47.11 на патенте — предупреждение', { ...ITD, ...PATENT, gked: '47.11.0' }],
  [
    'ИП 47.11 и 47.77 на патенте — подтверждения нет, только «другой режим»',
    { ...IP, ...PATENT, gked: '47.11.0', gked2: ['47.77.0'] },
  ],
  [
    'п. 58: демо-ИП 96.02.0 с подтверждением',
    { ...IP, ...PATENT, gked: '96.02.0' },
    confirm({ ...IP, ...PATENT, gked: '96.02.0' }),
  ],
  [
    'п. 58: добавили ГКЭД тоже вне перечня — спрашивается снова',
    { ...IP, ...PATENT, gked: '96.02.0', gked2: ['62.01.0'] },
    confirm({ ...IP, ...PATENT, gked: '96.02.0' }),
  ],
  [
    'п. 58: сменили форму собственности — спрашивается снова',
    { ...LLC, ...PATENT, gked: '96.02.0' },
    confirm({ ...IP, ...PATENT, gked: '96.02.0' }),
  ],
  [
    'п. 58: добавили 96.04.0 из перечня «Для ИП» — предупреждения нет',
    { ...IP, ...PATENT, gked: '96.02.0', gked2: ['96.04.0'] },
    confirm({ ...IP, ...PATENT, gked: '96.02.0' }),
  ],
  ['Организация на патенте вне перечня', { ...LLC, ...PATENT, gked: '47.11.0' }],
  ['Организация на патенте: обменное бюро', { ...LLC, ...PATENT, gked: '66.12.9' }],
  ['СЭЗ при основном 12.00 — вопрос с подтверждением', { ...LLC, regime: 'СЭЗ', gked: '12.00.0' }],
  ['СЭЗ при 46.1 — «Кроме»', { ...LLC, regime: 'СЭЗ', gked: '46.11.0' }],
  [
    'СЭЗ: 46.1 дополнительным — «другой режим»',
    { ...LLC, regime: 'СЭЗ', gked: '62.01.0', gked2: ['46.11.0'] },
  ],
  ['ПВТ при 62.01 — подходит', { ...LLC, regime: 'ПВТ', gked: '62.01.0' }],
  [
    'ПВТ проверяется только по основному ГКЭД',
    { ...LLC, regime: 'ПВТ', gked: '47.11.0', gked2: ['62.01.0'] },
  ],
  ['Майнинг вне перечня («сверить»)', { ...LLC, regime: 'Майнинг', gked: '47.11.0' }],
  ['ПКИ: часть перечня ещё сверяется', { ...LLC, regime: 'ПКИ', gked: '47.11.0' }],
  [
    'ОНР и майнинг: дополнительный режим тоже проверяется',
    { ...LLC, regime: 'ОНР', regime2: 'Майнинг', gked: '47.11.0' },
  ],
  [
    'Единый налог и патент: два вопроса, подтверждение одно на оба',
    { ...IP, ...EN, regime2: 'Патент', gked: '61.10.0' },
  ],
  [
    'Единый налог и патент: после подтверждения отмечены оба',
    { ...IP, ...EN, regime2: 'Патент', gked: '61.10.0' },
    confirm({ ...IP, ...EN, regime2: 'Патент', gked: '61.10.0' }, 'Оказывает услуги интернета?'),
  ],
  [
    'Единый налог: дополнительный ГКЭД с другой ставкой',
    { ...LLC, ...EN, gked: '62.01.0', gked2: ['47.11.0', '56.10.0'] },
  ],
  [
    'Единый налог: торговля (ЕНС-01) — одна ставка на всю деятельность',
    { ...LLC, ...EN, gked: '47.11.0', gked2: ['62.01.0'] },
  ],
  [
    'Единый налог: резидент ПКИ — ставка ПКИ первой',
    { ...LLC, ...EN, gked: '62.01.0', ben: ['Резидент ПКИ'] },
  ],
  [
    'Единый налог: нет совпадения — «Остальные виды деятельности»',
    { ...LLC, ...EN, gked: '01.11.1' },
  ],
  [
    'Единый налог: дополнительный 64.19.2 не спрашивается — только основной',
    { ...LLC, ...EN, gked: '47.11.0', gked2: ['64.19.2'] },
  ],
  [
    'Льгота «только по основному ГКЭД»',
    {
      ...LLC,
      regime: 'ОНР',
      gked: '47.11.0',
      gked2: ['01.11.1'],
      ben: ['Сельскохозяйственный производитель'],
    },
  ],
  [
    'Статус «только подсказка» не предупреждает',
    { ...LLC, regime: 'ОНР', gked: '47.11.0', ben: ['Субъект публичного интереса'] },
  ],
  [
    'Льгота «сверить» вне перечня',
    { ...LLC, regime: 'ОНР', gked: '47.11.0', ben: ['Сельскохозяйственный кооператив'] },
  ],
  ['Без ГКЭД — проверок нет', { ...LLC, ...EN, gked: '' }],
  [
    'Назначенные отчёты, которые не подходят по ГКЭД',
    { ...LLC, regime: 'ОНР', gked: '47.11.0' },
    null,
    ['akc', 'gdn', 'nds'],
  ],
  [
    'Режимный вид патента проверяется перечнем режима, а не своим',
    { ...LLC, ...PATENT, gked: '66.12.9' },
    null,
    ref.reportTypes
      .filter((t) => t.kind === 'regime' && (t.regimes || []).includes('Патент'))
      .map((t) => t.id),
  ],
].map(([title, cp, confirmed, types]) => ({ title, cp, confirmed, types }));

for (const c of demo.contractors) {
  cases.push({
    title: `Демо: ${c.name}`,
    cp: c,
    confirmed: c.gkOk ? { proto: c.gkOk } : null,
    types: c.assign.filter((a) => !a.to).map((a) => a.t),
  });
}

const typeIds = new Set();
const codes = new Set();
const out = cases.map(({ title, cp, confirmed, types }) => {
  const c = { gked2: [], ben: [], regime2: '', ...cp };
  let gkOk = null;
  let base = null;
  if (confirmed?.base) {
    const b = { gked2: [], ben: [], regime2: '', ...confirmed.base };
    gkOk = { sig: gkEnSig(b), by: confirmed.by, at: confirmed.at, ask: confirmed.ask };
    base = subject(b);
  } else if (confirmed?.proto) {
    gkOk = confirmed.proto;
    // Демо записано при том же состоянии, что сейчас: подпись прототипа должна совпасть с его же расчётом.
    if (gkOk.sig !== gkEnSig(c)) throw new Error(`${title}: подпись подтверждения не совпала`);
    base = subject(c);
  }
  if (gkOk) c.gkOk = gkOk;
  const sel = types ?? [];
  sel.forEach((id) => typeIds.add(id));
  [c.gked, ...c.gked2].filter(Boolean).forEach((k) => codes.add(k));
  const r = gkCheck(c, new Set(sel));
  return {
    title,
    subject: subject(c),
    types: sel,
    confirmed: gkOk ? { base, by: whoName(gkOk.by), at: gkOk.at, ask: gkOk.ask || '' } : null,
    expected: {
      block: r.block,
      regime: r.regime,
      confirm: r.rwarn.map((w) => ({
        regime: regimeCode(w.n),
        code: w.code,
        list: w.list ?? '',
        group: w.grp ? w.grp.id : null,
        ask: w.ask ?? '',
        art: w.art,
      })),
      benefits: r.ben,
      rate: r.rate,
      types: r.types,
      off: r.off,
    },
  };
});

// Справочник ГКЭД — только коды случаев и их предки (для «секции буквой»).
const items = new Map(gkedItems.map((x) => [x.code, x]));
const index = new Map();
for (const code of codes) {
  let x = items.get(code);
  while (x && !index.has(x.code)) {
    index.set(x.code, {
      code: x.code,
      level: x.level,
      parent: x.parent || null,
      active: x.active !== false,
    });
    x = x.parent ? items.get(x.parent) : null;
  }
}
const regimeCodeOf = (name) => dicts.regimes.items.find((r) => r.name === name)?.code;
const catalog = {
  gked: [...index.values()].sort((a, b) => (a.code < b.code ? -1 : 1)),
  regimes: dicts.regimes.items.map((r) => ({
    code: r.code,
    name: r.name,
    article: r.art || '',
    gked: r.gked ?? null,
  })),
  benefits: dicts.benefits.items.map((b) => ({ code: b.code, name: b.name, gked: b.gked ?? null })),
  rates: ref.enRates.map((x) => ({
    code: x.code,
    rate: x.rate,
    activity: x.activity,
    gked: x.gked ?? null,
  })),
  types: ref.reportTypes
    .filter((t) => typeIds.has(t.id))
    .map((t) => ({
      code: t.id,
      shortName: t.short,
      kind: t.kind,
      regimes: (t.regimes || []).map(regimeCodeOf).filter(Boolean),
      gked: t.gked ?? null,
    })),
  groups: Object.entries(ref.gkedGroups).map(([id, g]) => ({
    id,
    name: g.name,
    codes: g.codes,
    ask: g.ask ?? '',
  })),
};

const file = fileURLToPath(new URL('../src/contractors/__fixtures__/gked.json', import.meta.url));
const json = JSON.stringify({ source: 'spec/prototype/src/js/core/gked.js', catalog, cases: out });
writeFileSync(file, await format(json, { ...(await resolveConfig(file)), filepath: file }));
console.log(`gked.json: случаев ${out.length}, кодов ГКЭД ${index.size}`);
