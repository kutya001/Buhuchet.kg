import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeGuardFiles, needsStagingMigration, protectedChanges } from './protected-paths.mjs';

test('проверки, автослияние и хуки останавливают автослияние', () => {
  assert.deepEqual(
    mergeGuardFiles([
      '.github/workflows/ci.yml',
      'scripts/automerge.mjs',
      'scripts/check-pr-policy.mjs',
      '.claude/hooks/guard-bash.mjs',
      '.claude/settings.json',
      'packages/api/src/app.ts',
      'scripts/spec-sync.mjs',
      '.claude/skills/db-migration/SKILL.md',
    ]),
    [
      '.github/workflows/ci.yml',
      'scripts/automerge.mjs',
      'scripts/check-pr-policy.mjs',
      '.claude/hooks/guard-bash.mjs',
      '.claude/settings.json',
    ],
  );
});

test('новая миграция и журнал — можно', () => {
  const diff = [
    'A\tpackages/db/migrations/0002_users.sql',
    'A\tpackages/db/migrations/meta/0002_snapshot.json',
    'M\tpackages/db/migrations/meta/_journal.json',
  ].join('\n');
  assert.deepEqual(protectedChanges(diff), []);
});

test('изменённая или удалённая миграция из main — ошибка', () => {
  const diff = [
    'M\tpackages/db/migrations/0001_foundation_tables.sql',
    'D\tpackages/db/migrations/meta/0000_snapshot.json',
  ].join('\n');
  assert.equal(protectedChanges(diff).length, 2);
});

test('spec/ только с SOURCE.json (синхронизация)', () => {
  assert.equal(protectedChanges('M\tspec/ТЗ Buhuchet.kg.md').length, 1);
  assert.deepEqual(protectedChanges('M\tspec/ТЗ Buhuchet.kg.md\nM\tspec/SOURCE.json\n'), []);
});

test('остальные файлы не проверяются', () => {
  assert.deepEqual(protectedChanges('M\tpackages/api/src/app.ts\nD\tdocs/old.md'), []);
});

test('миграции стенда — только когда PR меняет базу или данные spec/', () => {
  assert.equal(needsStagingMigration(['packages/db/migrations/0003_users.sql']), true);
  assert.equal(needsStagingMigration(['spec/data/refDB.json', 'spec/SOURCE.json']), true);
  assert.equal(needsStagingMigration(['packages/api/src/app.ts', 'spec/ТЗ Buhuchet.kg.md']), false);
});
