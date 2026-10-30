// Эталон для опросника владельца: obAnsInit, obPlan и переключатели экрана «Что будет включено»
// (wlChange) из прототипа (spec/prototype/src/js/modules/onboard.js) на вопросах и основном наборе
// refDB.json `onboarding`. Запуск: node packages/domain/scripts/oracle-onboarding.mjs — пишет
// packages/domain/src/onboarding/__fixtures__/onboarding.json (скилл prototype-oracle).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const ref = JSON.parse(read('spec/data/refDB.json'));

const org = read('spec/prototype/src/js/core/org.js');
const features = /^const FEATURES=\[[\s\S]*?\]\];$/m.exec(org)?.[0];
if (!features) throw new Error('В core/org.js не найден список FEATURES');
const onboard = read('spec/prototype/src/js/modules/onboard.js');
const fn = (name) => {
  const body = new RegExp(
    `^function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n(?=function |//|const )`,
    'm',
  ).exec(onboard)?.[0];
  if (!body) throw new Error(`В onboard.js не найдена функция ${name}`);
  return body;
};
// Тело wlChange без перерисовки: только правка плана, как при щелчке переключателя.
const toggle = /FEATURES\.forEach\(\(\[f,,,dep\]\)=>\{[^}]*\}\)/.exec(fn('wlChange'))?.[0];
if (!toggle) throw new Error('В wlChange не найдено правило зависимых функций');

const context = vm.createContext({ REF: ref });
vm.runInContext(
  `'use strict';
  const DB = { ref: REF };
  ${features}
  const OB = DB.ref.onboarding;
  const ORG = { features: {}, taskConfirm: true };
  const feat = (f) => !!ORG.features[f];
  const WL = { ans: {} };
  ${fn('obAnsInit')}
  ${fn('obPlan')}
  function planToggle(p, k, checked) { const x = { checked }; p.f[k] = checked; ${toggle}; return p }
  globalThis.oracle = { obAnsInit, obPlan, planToggle, ORG, WL };`,
  context,
);
const { oracle } = context;
const copy = (x) => JSON.parse(JSON.stringify(x));

// Ответы: каждый вопрос по очереди «Да» / «Нет» / «Не знаю» при остальных «Не знаю», подвопросы при
// «Да», и набор псевдослучайных сочетаний (детерминированный генератор).
const questions = ref.onboarding.questions;
const ids = questions.flatMap((q) => [q.id, ...(q.sub ? [q.sub.id] : [])]);
const ANSWERS = ['yes', 'no', 'unk'];
const unknown = Object.fromEntries(ids.map((id) => [id, 'unk']));
const cases = [unknown];
for (const q of questions) {
  for (const a of ANSWERS) cases.push({ ...unknown, [q.id]: a });
  if (q.sub) for (const b of ANSWERS) cases.push({ ...unknown, [q.id]: 'yes', [q.sub.id]: b });
  if (q.sub) cases.push({ ...unknown, [q.id]: 'no', [q.sub.id]: 'yes' });
}
let seed = 20261027;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
for (let i = 0; i < 60; i++) {
  cases.push(Object.fromEntries(ids.map((id) => [id, ANSWERS[Math.floor(rnd() * 3)]])));
}
cases.push({ ...unknown, 'q-proj': 'no', 'q-kpi': 'no', 'q-money': 'yes' });

const plans = cases.map((answers) => {
  oracle.WL.ans = copy(answers);
  const p = oracle.obPlan();
  return { answers, features: copy(p.f), taskConfirm: p.tc };
});

// «Пройти опросник заново»: ответы по текущей учётной политике.
const featureIds = JSON.parse(
  JSON.stringify(vm.runInContext('FEATURES.map((f) => f[0])', context)),
);
const policies = [];
for (let i = 0; i < 24; i++) {
  const f = Object.fromEntries(featureIds.map((k) => [k, rnd() < 0.5]));
  policies.push({ features: f, taskConfirm: rnd() < 0.5 });
}
policies.push({ features: { ...ref.onboarding.base }, taskConfirm: true });
const retakes = policies.map((policy) => {
  oracle.ORG.features = copy(policy.features);
  oracle.ORG.taskConfirm = policy.taskConfirm;
  return { policy, answers: copy(oracle.obAnsInit(true)) };
});

// Переключатели плана: снять и включить каждую функцию на плане основного набора и на плане «всё да».
const yes = Object.fromEntries(ids.map((id) => [id, 'yes']));
const toggles = [];
for (const answers of [unknown, yes]) {
  for (const k of featureIds) {
    for (const checked of [true, false]) {
      oracle.WL.ans = copy(answers);
      const p = oracle.obPlan();
      const before = copy(p.f);
      toggles.push({
        before,
        feature: k,
        checked,
        after: copy(oracle.planToggle(p, k, checked).f),
      });
    }
  }
}

const out = fileURLToPath(
  new URL('../src/onboarding/__fixtures__/onboarding.json', import.meta.url),
);
const json = JSON.stringify({
  source: 'spec/prototype/src/js/modules/onboard.js',
  features: featureIds,
  plans,
  retakes,
  toggles,
});
writeFileSync(out, await format(json, { ...(await resolveConfig(out)), filepath: out }));
console.log(
  `onboarding.json: планов ${plans.length}, повторных ответов ${retakes.length}, переключений ${toggles.length}`,
);
