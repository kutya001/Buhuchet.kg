#!/usr/bin/env node
// pnpm check:retired — текст словаря, убранный из кода или из прототипа, записан в список на удаление.
// Наполнение только добавляет и обновляет строки `ui_texts`: убранный ключ остаётся в базе стенда и
// рабочего сайта (и в Админке → «Локализация»), пока его нет в `RETIRED.uiTexts`
// (packages/db/src/seed/retired.ts). В сборке переноса v131–v146 так забыли 61 ключ
// (docs/typical-mistakes.md № 68).
//
// Что сравнивается: ключи словаря в коммите main, от которого идёт ветка, и в рабочей папке.
//   - тексты продукта — ключи, записанные строкой (`'ключ': {`) в packages/domain/src/l10n/*.ts;
//   - тексты прототипа — `localization[].key` в spec/data/refDB.json.
// Ключ, который был и которого больше нет ни там, ни там, должен быть в `RETIRED.uiTexts`.
// Ключи, которые собирает код (названия месяцев, отказы сервера `err.*`), строкой не записаны и сюда
// не попадают — их по-прежнему смотрят ревьюеры.
//
// Запуск: node scripts/check-retired-texts.mjs [коммит main]. Без коммита: в CI у PR — HEAD^1
// (коммит слияния PR, как у check-protected.mjs), иначе — общий предок с origin/main.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const L10N_DIR = 'packages/domain/src/l10n';
export const SPEC_REFDB = 'spec/data/refDB.json';
export const RETIRED_FILE = 'packages/db/src/seed/retired.ts';

/**
 * Ключ больше не записан строкой, но наполнение его по-прежнему заводит (его теперь собирает код).
 * Такой ключ в `RETIRED.uiTexts` нельзя — наполнение удаляло бы живой текст; его записывают сюда.
 */
export const STILL_SEEDED = new Set([]);

const isL10nSource = (file) => file.endsWith('.ts') && !file.endsWith('.test.ts');

/** Ключи словаря, записанные строкой в начале строки файла: `'ключ': {` или `"ключ": {`. */
export function literalKeys(source) {
  const keys = [];
  for (const m of source.matchAll(/^[ \t]*(?:'([^'\n]+)'|"([^"\n]+)")[ \t]*:[ \t]*\{/gm)) {
    keys.push(m[1] ?? m[2]);
  }
  return keys;
}

/** Ключи текстов прототипа: раздел `localization` refDB.json. */
export function specKeys(json) {
  const list = JSON.parse(json).localization;
  return Array.isArray(list) ? list.map((x) => x.key).filter((k) => typeof k === 'string') : [];
}

/** Строки списка `uiTexts: [ … ]` из retired.ts. */
export function retiredUiTexts(source) {
  const start = source.search(/\buiTexts\s*:\s*\[/);
  if (start < 0) return [];
  const from = source.indexOf('[', start);
  const to = source.indexOf(']', from);
  if (to < 0) return [];
  const keys = [];
  for (const m of source.slice(from + 1, to).matchAll(/'([^'\n]+)'|"([^"\n]+)"/g)) {
    keys.push(m[1] ?? m[2]);
  }
  return keys;
}

/** Убранные ключи, которых нет в списке на удаление, по алфавиту. */
export function missingRetired({ baseKeys, headKeys, retired, stillSeeded = STILL_SEEDED }) {
  const head = new Set(headKeys);
  const listed = new Set(retired);
  return [...new Set(baseKeys)]
    .filter((key) => !head.has(key) && !listed.has(key) && !stillSeeded.has(key))
    .sort();
}

const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const gitOk = (root, args) => {
  try {
    return git(root, args).trim();
  } catch {
    return '';
  }
};

/** Коммит main для сравнения: названный, HEAD^1 у PR в CI или общий предок с origin/main; '' — не найден. */
export function resolveBase(root, named, env = process.env) {
  const candidates = named
    ? [named]
    : env.GITHUB_EVENT_NAME === 'pull_request'
      ? ['HEAD^1']
      : [gitOk(root, ['merge-base', 'HEAD', 'origin/main'])];
  for (const ref of candidates) {
    if (ref && gitOk(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) return ref;
  }
  return '';
}

function keysAt(root, base) {
  const files = git(root, ['ls-tree', '-r', '--name-only', base, '--', L10N_DIR])
    .split('\n')
    .filter((f) => f && isL10nSource(f));
  const keys = files.flatMap((f) => literalKeys(git(root, ['show', `${base}:${f}`])));
  const spec = gitOk(root, ['show', `${base}:${SPEC_REFDB}`]);
  return spec ? [...keys, ...specKeys(spec)] : keys;
}

function keysNow(root) {
  const dir = path.join(root, L10N_DIR);
  const keys = readdirSync(dir)
    .filter(isL10nSource)
    .flatMap((f) => literalKeys(readFileSync(path.join(dir, f), 'utf8')));
  return [...keys, ...specKeys(readFileSync(path.join(root, SPEC_REFDB), 'utf8'))];
}

/** Проверка папки: `{ base, removed, missing }`; `base: ''` — сравнивать не с чем. */
export function checkRetiredTexts(root, named, env = process.env) {
  const base = resolveBase(root, named, env);
  if (!base) return { base: '', removed: 0, missing: [] };
  const baseKeys = keysAt(root, base);
  const headKeys = keysNow(root);
  const head = new Set(headKeys);
  const retired = retiredUiTexts(readFileSync(path.join(root, RETIRED_FILE), 'utf8'));
  return {
    base,
    removed: new Set(baseKeys.filter((k) => !head.has(k))).size,
    missing: missingRetired({ baseKeys, headKeys, retired }),
  };
}

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { base, removed, missing } = checkRetiredTexts(REPO_ROOT, process.argv[2]);
  if (!base) {
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      console.error(
        'Нет коммита main для сравнения (HEAD^1): проверка убранных текстов не прошла.',
      );
      process.exit(1);
    }
    console.log('Убранные тексты словаря: нет коммита main для сравнения (git fetch origin main).');
    process.exit(0);
  }
  if (missing.length) {
    console.error(
      `Убранные тексты словаря не записаны в RETIRED.uiTexts (${RETIRED_FILE}) — ${missing.length}:`,
    );
    for (const key of missing) console.error(`  '${key}',`);
    console.error(
      'Допишите их в список: иначе текст останется в базе стенда и рабочего сайта. Если ключ теперь\n' +
        'собирает код и наполнение его по-прежнему заводит — запишите его в STILL_SEEDED этого скрипта.',
    );
    process.exit(1);
  }
  console.log(`Убранные тексты словаря: ${removed}, все в списке на удаление.`);
}
