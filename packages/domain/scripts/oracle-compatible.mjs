// Эталон для «подходит ли вид отчёта контрагенту»: compatible из прототипа (core/reference.js) со
// строками ставок core/tax-lines.js на справочнике refDB.json. Случаи — все контрагенты demoDB.json с
// видами «Для организаций», «Для ИП», «По режиму» и ЕНД, и придуманные контрагенты на каждую ветку:
// ИП, КФХ без юрлица, патент, зона торговли, налог на транзакцию, единый налог по нулевой ставке, по
// ставке по датам, со строкой-надбавкой. Вход записывается полями продукта (коды форм, режимов, видов).
// Запуск: node packages/domain/scripts/oracle-compatible.mjs — пишет
// packages/domain/src/reports/__fixtures__/compatible.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const ref = JSON.parse(read('spec/data/refDB.json'));
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
const TODAY = '2026-10-27';

const dicts = ref.dictionaries;
const code = (items, name, what) => {
  const x = items.find((i) => i.name === name);
  if (!x) throw new Error(`${what}: нет «${name}»`);
  return x.code;
};

// Виды: «Для организаций» и «Для ИП», все «По режиму», ЕНД, «сквозной» для всех.
const typeIds = [
  ...new Set([
    'endo',
    'endi',
    'gam',
    'patw',
    'socip',
    'soc',
    't1q',
    ...ref.reportTypes.filter((t) => t.kind === 'regime').map((t) => t.id),
  ]),
];
const types = typeIds.map((id) => {
  const t = ref.reportTypes.find((x) => x.id === id);
  if (!t) throw new Error(`Нет вида ${id}`);
  return t;
});

const LLC = 'ОсОО';
const IP = 'ИП';
const FARM = 'Крестьянское (фермерское) хозяйство';
const FARM_ORG = 'Крестьянское (фермерское) хозяйство с образованием юрлица';
const ITD = 'Физическое лицо на патенте (индивидуальная трудовая деятельность)';
const en = (...rows) => [{ t: 'enq', en: rows.map(([c, v]) => ({ code: c, v })) }];
const invented = [
  { form: IP, regime: 'Единый налог' },
  { form: IP, regime: 'ОНР', regime2: 'Патент' },
  { form: FARM, regime: 'Единый налог' },
  { form: FARM_ORG, regime: 'Единый налог' },
  { form: ITD, regime: 'Патент' },
  { form: LLC, regime: 'Зона торговли' },
  { form: LLC, regime: 'ОНР', regime2: 'Налог на транзакцию' },
  { form: LLC, regime: '' },
  { form: LLC, regime: 'ОНР', regime2: 'Игорная деятельность' },
  { form: LLC, regime: 'Единый налог', assign: en(['ЕНС-15']) },
  { form: LLC, regime: 'Единый налог', assign: en(['ЕНС-01'], ['ЕНС-16']) },
  { form: LLC, regime: 'Единый налог', assign: en(['ЕНС-01'], ['ЕНС-04']) },
  { form: LLC, regime: 'Единый налог', assign: en(['ЕНС-13']) },
  { form: LLC, regime: 'Единый налог', assign: en(['ЕНС-14'], ['ЕНС-06']) },
  { form: IP, regime: 'Единый налог', assign: en(['ЕНС-12', 0]) },
  { form: IP, regime: 'Единый налог', assign: en(['ЕНС-12', 2]) },
  { form: LLC, regime: 'Единый налог', assign: en(['ЕНС-16']) },
  {
    form: LLC,
    regime: 'Единый налог',
    assign: [{ t: 'enq', en: [{ code: 'ЕНС-15' }], to: '2026-09-30' }],
  },
  { form: 'Другое', regime: 'СЭЗ' },
];
const subjects = [...demo.contractors, ...invented];

const context = vm.createContext({ REFDB: ref, SUBJECTS: subjects, TYPE_IDS: typeIds });
vm.runInContext(
  `'use strict';
  const DB = { ref: REFDB };
  const TODAY = '${TODAY}';
  ${pick(REF, /^(const DICT=|const TAXES=|const RT=|const T=|const regsOf=|const END_IDS=|const formEnd=)/)}
  ${pick(LINES, /^(const EN_IDS|const isEnT|const enRow|const RT_PCT|const rtSegs|const rtIso)\b/)}
  ${block(LINES, 'rtVars')}
  ${block(LINES, 'rtByDate')}
  ${block(LINES, 'rtParts')}
  ${block(LINES, 'rtTxt')}
  ${block(LINES, 'aRows')}
  ${block(REF, 'compatible')}
  globalThis.oracle = SUBJECTS.map((c) =>
    TYPE_IDS.map((id) => compatible(T[id], { assign: [], ...c })),
  );`,
  context,
);

/** Контрагент прототипа → вход продукта: коды вместо названий. */
function subject(c) {
  const form = dicts.forms.items.find((f) => f.name === c.form);
  if (!form) throw new Error(`Нет формы «${c.form}»`);
  return {
    form: { code: form.code, declarationFor: form.end },
    regimes: [c.regime, c.regime2]
      .filter(Boolean)
      .map((name) => ({ code: code(dicts.regimes.items, name, 'Режим'), name })),
    assignments: (c.assign ?? []).map((a) => ({
      reportTypeCode: a.t,
      endedOn: a.to ?? null,
      enRates: (a.en ?? []).map((e) => ({ code: e.code, variant: e.v ?? null })),
    })),
  };
}

const fixture = {
  source: REF,
  date: TODAY,
  rates: ref.enRates.map((x) => ({
    code: x.code,
    rate: x.rate,
    rateCashless: x.rateCashless ?? '',
    rateCash: x.rateCash ?? '',
    addsTo: x.addTo ?? [],
  })),
  types: types.map((t) => ({
    code: t.id,
    payer: t.who ?? 'all',
    kind: t.kind,
    regimes: (t.regimes ?? []).map((name) => code(dicts.regimes.items, name, 'Режим')),
  })),
  cases: subjects.map((c, i) => ({
    name:
      c.name ?? `${c.form} · ${[c.regime, c.regime2].filter(Boolean).join(' + ') || 'без режима'}`,
    subject: subject(c),
    expected: Object.fromEntries(typeIds.map((id, k) => [id, context.oracle[i][k]])),
  })),
};

const out = fileURLToPath(new URL('../src/reports/__fixtures__/compatible.json', import.meta.url));
writeFileSync(
  out,
  await format(JSON.stringify(fixture), { ...(await resolveConfig(out)), filepath: out }),
);
console.log(`compatible.json: ${subjects.length} контрагентов × ${typeIds.length} видов`);
