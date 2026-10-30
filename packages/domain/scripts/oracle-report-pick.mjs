// Эталон для «Подбора отчётов» и окна «Льготы и особые статусы»: pkCalc, pkEn, pkMustWhy, benWarns из
// прототипа (modules/report-pick.js) на справочниках refDB.json и ГКЭД gkedDB.json. Случаи — все
// контрагенты demoDB.json с видами, подключёнными в демо-организации, и придуманные контрагенты на
// пункты приёмки 28, 51, 53–55 и ветки правила со всеми подключёнными видами. Вход записывается полями
// продукта (коды форм, режимов, льгот); строки ЕНС для «Не для ставок ЕН» — ответ pkEn.
// Запуск: node packages/domain/scripts/oracle-report-pick.mjs — пишет
// packages/domain/src/contractors/__fixtures__/report-pick.json (скилл prototype-oracle).
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
const REF = 'spec/prototype/src/js/core/reference.js';
const LINES = 'spec/prototype/src/js/core/tax-lines.js';
const PICK = 'spec/prototype/src/js/modules/report-pick.js';
const TODAY = '2026-10-27';

const dicts = ref.dictionaries;
const byName = (items, name, what) => {
  const x = items.find((i) => i.name === name);
  if (!x) throw new Error(`${what}: нет «${name}»`);
  return x;
};

// Все виды каталога подключены — у придуманных контрагентов; у демо — виды демо-организации.
const allOn = Object.fromEntries(ref.reportTypes.map((t) => [t.id, { on: true }]));
const demoOn = demo.organization.types;

const LLC = 'ОсОО';
const IP = 'ИП';
const PKI = 'Резидент ПКИ';
const invented = [
  // п. 28: ОсОО на едином налоге, резидент ПКИ, есть наёмные сотрудники.
  { form: LLC, regime: 'Единый налог', ben: [PKI], bases: ['employees'], gked: '62.01.0' },
  // п. 51: ОНР, средний бизнес — годовая финансовая отчётность «Для всех»; малый — нет; малый со статусом.
  { form: LLC, regime: 'ОНР', size: 'medium', gked: '46.34.0' },
  { form: LLC, regime: 'ОНР', size: 'small', gked: '46.34.0' },
  { form: LLC, regime: 'ОНР', size: 'small', ben: ['Субъект публичного интереса'] },
  // п. 53 и 54: ГКЭД 94.99 без основания «В списке Нацстаткома» и с ним.
  { form: 'Общественное объединение', regime: 'ОНР', gked: '94.99.0' },
  { form: 'Общественное объединение', regime: 'ОНР', gked: '94.99.0', bases: ['statSample'] },
  { form: LLC, regime: 'ОНР', gked: '47.11.0', bases: ['statSample', 'employees'] },
  // п. 55: утилизационный сбор; бонус недр без основания и с ним.
  { form: LLC, regime: 'ОНР', bases: ['utilGoods'] },
  { form: LLC, regime: 'ОНР', bases: ['subsoil'], gked: '07.29.0' },
  { form: LLC, regime: 'ОНР', gked: '08.12.0' },
  // Без режима и формы, ИП, патент, дополнительный режим, ЕН с нулевой ставкой и «Не для ставок ЕН».
  { form: '', regime: '' },
  { form: LLC, regime: '' },
  { form: IP, regime: 'Единый налог', gked: '47.11.0' },
  { form: IP, regime: 'Патент', gked: '96.02.0' },
  { form: IP, regime: 'ОНР', regime2: 'Патент', bases: ['employees'] },
  { form: LLC, regime: 'Единый налог', gked: '01.11.0' },
  {
    form: LLC,
    regime: 'Единый налог',
    gked: '47.11.0',
    size: 'large',
    bases: ['property', 'land'],
  },
  {
    form: LLC,
    regime: 'Единый налог',
    assign: [{ t: 'enq', en: [{ code: 'ЕНС-15' }] }],
  },
  { form: LLC, regime: 'ОНР', ben: ['Сельскохозяйственный производитель', 'Резидент ПВТ'] },
  {
    form: LLC,
    regime: 'ОНР',
    ben: ['Добыча золота, серебра, меди, сурьмы, ртути, вольфрама, олова'],
  },
  { form: 'Крестьянское (фермерское) хозяйство', regime: 'Единый налог' },
  { form: LLC, regime: 'ОНР', regime2: 'Игорная деятельность', size: 'medium' },
  { form: LLC, regime: 'СЭЗ' },
  {
    form: LLC,
    regime: 'ОНР',
    bases: [
      'employees',
      'property',
      'residential',
      'land',
      'importEAEU',
      'exportEAEU',
      'excise',
      'subsoil',
      'foreignPayments',
      'rentState',
      'emissions',
      'utilGoods',
    ],
  },
].map((c, i) => ({
  name: `придуманный ${i + 1}`,
  assign: [],
  ben: [],
  bases: [],
  ...c,
  on: allOn,
}));

const subjects = [...demo.contractors.map((c) => ({ ...c, on: demoOn })), ...invented];

// Окно «Льготы и особые статусы»: предупреждения при отметке каждой льготы у каждого контрагента.
const benefitCases = subjects.map((c) => c.ben ?? []);

const context = vm.createContext({
  REFDB: { ...ref, gked: gkedItems },
  SUBJECTS: subjects,
  structuredClone,
});
vm.runInContext(
  `'use strict';
  const DB = { ref: REFDB };
  const TODAY = '${TODAY}';
  let ORG = { types: {} };
  ${pick(REF, /^(const DICT=|const TAXES=|const RT=|const T=|const benOf=|const formEnd=|const regsOf=|const END_IDS=|const ugK=)/)}
  ${read('spec/prototype/src/js/core/gked.js')}
  ${pick(LINES, /^(const EN_IDS|const isEnT|const EN_NO_EXTRA|const enRow|const RT_PCT|const rtSegs|const rtIso|const enPlace|const enItem)\b/)}
  ${block(LINES, 'rtVars')}
  ${block(LINES, 'rtByDate')}
  ${block(LINES, 'rtParts')}
  ${block(LINES, 'rtTxt')}
  ${block(LINES, 'aRows')}
  ${block(LINES, 'enVarAuto')}
  ${block(LINES, 'enAuto')}
  ${block(REF, 'compatible')}
  ${pick(PICK, /^(const PK_GROUPS|const PK_MUST|const PK_STAT|const PK_ONE|const pkOffT|const BIZSZ|const benByName|const baseOf|const baseLow|const pkBens|const pkOn|const pkWho|const whoText|const benConflicts)\b/)}
  ${block(PICK, 'pkEn')}
  ${block(PICK, 'pkEnNot')}
  ${block(PICK, 'pkGkCode')}
  ${block(PICK, 'pkCalc')}
  ${block(PICK, 'pkMustWhy')}
  ${block(PICK, 'benWarns')}
  globalThis.oracle = SUBJECTS.map((c) => {
    ORG = { types: c.on };
    const cx = { assign: [], ben: [], bases: [], ...c };
    const r = pkCalc(cx);
    const ids = RT.map((t) => t.id);
    const fits = DICT.benefits.items
      .filter((b) => !gkEmpty(b.gked) && (b.gked.in || []).length && cpCodes(cx).length && (gkFit(b.gked, cpCodes(cx), cx) || []).length > 0)
      .map((b) => b.code);
    return {
      en: pkEn(cx),
      rec: ids.filter((id) => r.rec[id]).map((id) => ({ code: id, ...r.rec[id], must: PK_MUST.has(r.rec[id].grp) && r.rec[id].pre ? pkMustWhy(r.rec[id]) : '' })),
      no: r.no,
      off: r.off,
      hidden: r.hidden,
      stat: Object.keys(r.stat),
      fits,
      warns: Object.fromEntries(DICT.benefits.items.map((b) => [b.code, benWarns(b, cx, [...new Set([...(cx.ben || []), b.name])])]).filter(([, w]) => w.length)),
    };
  });`,
  context,
);
const { oracle } = context;

const regimeCode = (name) => byName(dicts.regimes.items, name, 'Режим').code;
const benefitCode = (name) => byName(dicts.benefits.items, name, 'Льгота').code;

/** Контрагент прототипа → вход продукта: коды вместо названий; строки ЕНС — ответ pkEn. */
function subject(c, en) {
  const form = c.form ? byName(dicts.forms.items, c.form, 'Форма') : null;
  return {
    form: form && { code: form.code, declarationFor: form.end },
    regimes: [c.regime, c.regime2]
      .filter(Boolean)
      .map((name) => ({ code: regimeCode(name), name })),
    benefits: (c.ben ?? []).map(benefitCode),
    bases: [...(c.bases ?? [])],
    bizSize: c.size ?? 'small',
    gked: c.gked ?? null,
    gkedExtra: [...(c.gked2 ?? [])],
    singleTax: (c.assign ?? [])
      .filter((a) => !a.to && ['enq', 'enm'].includes(a.t) && (a.en ?? []).length)
      .slice(0, 1)
      .flatMap((a) => a.en.map((e) => ({ code: e.code, variant: e.v ?? null }))),
    enCodes: [...en],
    connected: Object.entries(c.on)
      .filter(([, o]) => o.on)
      .map(([id]) => id),
  };
}

// Нужные узлы ГКЭД: коды контрагентов и все выше по дереву.
const gkedByCode = new Map(gkedItems.map((g) => [g.code, g]));
const indexCodes = new Set();
for (const c of subjects) {
  for (const k of [c.gked, ...(c.gked2 ?? [])].filter(Boolean)) {
    for (let g = gkedByCode.get(k); g && !indexCodes.has(g.code); g = gkedByCode.get(g.parent))
      indexCodes.add(g.code);
  }
}

const rule = (r) =>
  r && {
    in: r.in ?? [],
    ex: r.ex ?? [],
    ...(r.ip ? { ip: r.ip } : {}),
    ...(r.ipEx ? { ipEx: r.ipEx } : {}),
    ...(r.itd ? { itd: r.itd } : {}),
    ...(r.main ? { main: true } : {}),
    ...(r.hint ? { hint: true } : {}),
  };

const fixture = {
  source: PICK,
  date: TODAY,
  dict: {
    types: ref.reportTypes.map((t) => ({
      code: t.id,
      shortName: t.short,
      active: t.active !== false,
      kind: t.kind,
      payer: t.who ?? 'all',
      regimes: (t.regimes ?? []).map(regimeCode),
      notForRegimes: (t.regimesNot ?? []).map(regimeCode),
      pickGroup: t.group,
      preselect: !!t.preselect,
      choiceNote: t.choice ?? '',
      bizSizes: t.bizSize ?? [],
      notForEnRates: t.enRatesNot ?? [],
      bases: t.basis ?? [],
      oneOff: !!t.oneOff,
      gked: rule(t.gked),
    })),
    benefits: dicts.benefits.items.map((b) => ({
      code: b.code,
      name: b.name,
      payer: b.who ?? 'all',
      combines: b.combines ?? '',
      gked: rule(b.gked),
      adds: b.adds ?? [],
      removes: b.removes ?? [],
    })),
    bases: dicts.bases.items.map((b) => ({ code: b.code, name: b.name })),
    rates: ref.enRates.map((x) => ({
      code: x.code,
      rate: x.rate,
      rateCashless: x.rateCashless ?? '',
      rateCash: x.rateCash ?? '',
      addsTo: x.addTo ?? [],
    })),
    index: [...indexCodes].map((code) => {
      const g = gkedByCode.get(code);
      return { code, level: g.level, parent: g.parent ?? null, active: g.active !== false };
    }),
  },
  cases: subjects.map((c, i) => ({
    name: c.name,
    subject: subject(c, oracle[i].en),
    expected: { ...oracle[i], en: undefined },
  })),
  benefitCases: benefitCases.length,
};

const out = fileURLToPath(
  new URL('../src/contractors/__fixtures__/report-pick.json', import.meta.url),
);
writeFileSync(
  out,
  await format(JSON.stringify(fixture), { ...(await resolveConfig(out)), filepath: out }),
);
console.log(`report-pick.json: ${subjects.length} контрагентов × ${ref.reportTypes.length} видов`);
