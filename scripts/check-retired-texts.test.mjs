import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  L10N_DIR,
  REPO_ROOT,
  RETIRED_FILE,
  SPEC_REFDB,
  checkRetiredTexts,
  literalKeys,
  missingRetired,
  resolveBase,
  retiredUiTexts,
  specKeys,
} from './check-retired-texts.mjs';

test('ключи словаря — только записанные строкой в начале строки файла', () => {
  const source = [
    "const S = 'Задачи';",
    'export const TASKS_TEXTS = {',
    "  'task.count.one': { ru: '{n} задача', section: S },",
    "  'task.long': {",
    "    ru: 'Длинный текст',",
    '    section: S,',
    '  },',
    '  "task.quoted": { ru: \'Кавычки\', section: S },',
    "  // 'task.commented': { ru: 'Убрано', section: S },",
    '  ...Object.fromEntries(MONTHS.map((m, i) => [`month.${i + 1}`, { ru: m, section: S }])),',
    "  note: { ru: 'не ключ словаря', section: S },",
    '};',
  ].join('\n');
  assert.deepEqual(literalKeys(source), ['task.count.one', 'task.long', 'task.quoted']);
});

test('ключи прототипа — раздел localization refDB.json; без раздела — пусто', () => {
  assert.deepEqual(
    specKeys(JSON.stringify({ localization: [{ key: 'nav.home', ru: 'Главная', sec: 'Меню' }] })),
    ['nav.home'],
  );
  assert.deepEqual(specKeys(JSON.stringify({ news: [] })), []);
});

test('список на удаление — строки uiTexts, а не новостей и шаблонов', () => {
  const source = [
    'export const RETIRED = {',
    "  news: ['v104'],",
    "  messageTemplates: ['tgTopicReports'],",
    '  uiTexts: [',
    "    'tgadm.view.topics',",
    "    'task.reg.closes',",
    '  ],',
    '} as const;',
  ].join('\n');
  assert.deepEqual(retiredUiTexts(source), ['tgadm.view.topics', 'task.reg.closes']);
  assert.deepEqual(retiredUiTexts('export const RETIRED = {};'), []);
});

test('убранный ключ без записи в списке — замечание; оставшийся, записанный и собираемый кодом — нет', () => {
  assert.deepEqual(
    missingRetired({
      baseKeys: ['a.kept', 'b.retired', 'c.forgotten', 'd.computed', 'c.forgotten'],
      headKeys: ['a.kept', 'e.new'],
      retired: ['b.retired'],
      stillSeeded: new Set(['d.computed']),
    }),
    ['c.forgotten'],
  );
});

// Настоящий репозиторий git во временной папке: ветка убирает текст продукта и текст прототипа.
const root = mkdtempSync(path.join(tmpdir(), 'retired-'));
after(() => rmSync(root, { recursive: true, force: true }));
const git = (...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
const write = (file, text) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
const texts = (keys) =>
  `export const T = {\n${keys.map((k) => `  '${k}': { ru: 'Текст', section: 'Р' },`).join('\n')}\n};\n`;
const refDB = (keys) =>
  JSON.stringify({ localization: keys.map((key) => ({ key, ru: 'Текст', sec: 'Р' })) });
const retired = (keys) =>
  `export const RETIRED = {\n  news: [],\n  uiTexts: [${keys.map((k) => `'${k}'`).join(', ')}],\n} as const;\n`;

git('init', '-q', '-b', 'main');
write(`${L10N_DIR}/tasks-texts.ts`, texts(['task.kept', 'task.gone', 'task.moved']));
write(`${L10N_DIR}/texts.test.ts`, texts(['test.only']));
write(SPEC_REFDB, refDB(['spec.kept', 'spec.gone', 'task.shared']));
write(RETIRED_FILE, retired([]));
git('add', '.');
git('commit', '-q', '-m', 'main');
const base = git('rev-parse', 'HEAD').trim();

test('ветка убрала тексты продукта и прототипа: названы только те, которых нет в списке', () => {
  // «task.moved» переехал в другой файл, «task.shared» теперь есть в продукте — они не убраны.
  write(`${L10N_DIR}/tasks-texts.ts`, texts(['task.kept']));
  write(`${L10N_DIR}/projects-texts.ts`, texts(['task.moved', 'task.shared', 'project.new']));
  write(SPEC_REFDB, refDB(['spec.kept']));
  assert.deepEqual(checkRetiredTexts(root, base), {
    base,
    removed: 2,
    missing: ['spec.gone', 'task.gone'],
  });
  write(RETIRED_FILE, retired(['task.gone']));
  assert.deepEqual(checkRetiredTexts(root, base).missing, ['spec.gone']);
  write(RETIRED_FILE, retired(['task.gone', 'spec.gone']));
  assert.deepEqual(checkRetiredTexts(root, base), { base, removed: 2, missing: [] });
});

test('коммит main: названный; у PR в CI — HEAD^1; иначе общий предок с origin/main; нет — пусто', () => {
  assert.equal(resolveBase(root, base, {}), base);
  assert.equal(resolveBase(root, 'нет-такого-коммита', {}), '');
  // origin/main в этой папке нет — сравнивать не с чем, проверка ничего не называет.
  assert.equal(resolveBase(root, undefined, {}), '');
  assert.deepEqual(checkRetiredTexts(root, undefined, {}), { base: '', removed: 0, missing: [] });
  // У PR в CI HEAD — коммит слияния, main — его первый родитель.
  git('add', '.');
  git('commit', '-q', '-m', 'ветка');
  assert.equal(resolveBase(root, undefined, { GITHUB_EVENT_NAME: 'pull_request' }), 'HEAD^1');
  assert.deepEqual(
    checkRetiredTexts(root, undefined, { GITHUB_EVENT_NAME: 'pull_request' }).missing,
    [],
  );
});

test('в этой ветке каждый убранный текст словаря записан в RETIRED.uiTexts', () => {
  const { base: found, missing } = checkRetiredTexts(REPO_ROOT);
  // У PR в CI коммит main есть всегда (fetch-depth: 2): без него проверка не должна молча пройти.
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') assert.notEqual(found, '');
  assert.deepEqual(missing, []);
});
