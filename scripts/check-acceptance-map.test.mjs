import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { checkAcceptanceMap } from './check-acceptance-map.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'acceptance-'));
after(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(path.join(root, 'docs'));
mkdirSync(path.join(root, 'e2e'));
writeFileSync(
  path.join(root, 'e2e/login.spec.ts'),
  "test('вход по логину и паролю', async () => {});",
);

function check(lines) {
  writeFileSync(path.join(root, 'docs/acceptance-map.md'), ['# Карта', '', ...lines].join('\n'));
  return checkAcceptanceMap(root);
}

test('пункт с существующим тестом проходит', () => {
  assert.deepEqual(check(['- Вход → e2e/login.spec.ts › вход по логину и паролю']), {
    items: 1,
    problems: [],
  });
});

test('пункт без теста, с неверным файлом или названием — ошибка', () => {
  const { items, problems } = check([
    '- Блокировка → нет теста',
    '- Выход → e2e/logout.spec.ts › выход',
    '- Вход → e2e/login.spec.ts › вход по коду',
    '- Сброс → где-то в тестах',
  ]);
  assert.equal(items, 4);
  assert.equal(problems.length, 4);
  assert.match(problems[0], /нет теста/);
  assert.match(problems[1], /нет файла e2e\/logout.spec.ts/);
  assert.match(problems[2], /нет теста «вход по коду»/);
  assert.match(problems[3], /ожидается/);
});

test('настоящая карта проходит', () => {
  const real = checkAcceptanceMap(path.resolve(import.meta.dirname, '..'));
  assert.deepEqual(real.problems, []);
  assert.ok(real.items > 0);
});
