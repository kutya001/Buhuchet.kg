// Эталон для окна «Выбор налогов»: txGroups и txMain из прототипа (spec/prototype/src/js/modules/tax-pick.js)
// на каталоге refDB.json. Вход записывается так, как его собирает экран продукта: действующие виды
// отчётов, действующие основания, виды, которые добавляют льготы, полные названия режимов. Запуск:
// node packages/domain/scripts/oracle-tax-pick.mjs — пишет
// packages/domain/src/dicts/__fixtures__/tax-pick.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const ref = JSON.parse(read('spec/data/refDB.json'));
const pick = (file, wanted) =>
  read(file)
    .split('\n')
    .filter((line) => wanted.test(line))
    .join('\n');

// txGroups занимает несколько строк: от объявления до `return G}`.
const taxPick = read('spec/prototype/src/js/modules/tax-pick.js');
const txGroups = /^function txGroups\(\)\{[\s\S]*?return G\}$/m.exec(taxPick)?.[0];
if (!txGroups) throw new Error('В tax-pick.js не найдена функция txGroups');

const context = vm.createContext({ REF: ref });
vm.runInContext(
  `'use strict';
  const DB = { ref: REF };
  ${pick('spec/prototype/src/js/core/reference.js', /^(const DICT=|const REGIME_FULL=|const RT=)/)}
  ${pick('spec/prototype/src/js/modules/tax-pick.js', /^(const TX_STREG=|const TX_REG_ORDER=|const txMain=)/)}
  ${txGroups}
  globalThis.oracle = { groups: txGroups(), main: txMain() };`,
  context,
);

const dicts = ref.dictionaries;
const types = ref.reportTypes
  .filter((t) => t.active)
  .map((t) => ({
    code: t.id,
    kind: t.kind,
    pickGroup: t.group,
    regimes: t.regimes ?? [],
    bases: t.basis ?? [],
    authority: t.organ,
    preselect: t.preselect ?? true,
  }));
const out = fileURLToPath(new URL('../src/dicts/__fixtures__/tax-pick.json', import.meta.url));
const json = JSON.stringify({
  source: 'spec/prototype/src/js/modules/tax-pick.js',
  catalog: {
    types,
    bases: dicts.bases.items.filter((b) => b.active).map((b) => ({ code: b.code, name: b.name })),
    benefitAdds: [
      ...new Set(dicts.benefits.items.filter((b) => b.active).flatMap((b) => b.adds ?? [])),
    ],
    regimeFullNames: Object.fromEntries(dicts.regimes.items.map((r) => [r.name, r.full])),
  },
  expected: {
    groups: context.oracle.groups.map((g) => ({
      id: g.id,
      title: g.t,
      who: g.who,
      subs: g.subs.map((s) => ({ title: s.t, codes: s.ids })),
    })),
    main: context.oracle.main,
  },
});
writeFileSync(out, await format(json, { ...(await resolveConfig(out)), filepath: out }));
console.log(
  `tax-pick.json: ${context.oracle.groups.length} групп, основных — ${context.oracle.main.length}`,
);
