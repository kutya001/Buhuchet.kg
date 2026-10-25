#!/usr/bin/env node
// Проверка PR в CI: применённые миграции и spec/ не тронуты (см. protected-paths.mjs).
// Запуск: node scripts/check-protected.mjs <коммит main> (в CI — HEAD^1 коммита слияния PR)
import { execFileSync } from 'node:child_process';
import { protectedChanges } from './protected-paths.mjs';

const base = process.argv[2];
if (!base) {
  console.error('Укажите коммит main: node scripts/check-protected.mjs <коммит>');
  process.exit(2);
}
const diff = execFileSync('git', ['diff', '--name-status', '--no-renames', base, 'HEAD'], {
  encoding: 'utf8',
});
const problems = protectedChanges(diff);
if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log('Применённые миграции и spec/ не тронуты.');
