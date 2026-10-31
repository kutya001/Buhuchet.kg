import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blockingCheck,
  mergeGuardFiles,
  needsStagingMigration,
  protectedChanges,
} from './protected-paths.mjs';

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

const REQUIRED = ['check', 'docker-e2e', 'pr-policy'];
const run = (
  name,
  status,
  conclusion,
  suite,
  startedAt = '2026-10-30T18:46:12Z',
  app = 'github-actions',
) => ({
  name,
  status,
  conclusion,
  started_at: startedAt,
  check_suite: { id: suite },
  app: { slug: app },
});
const green = [
  run('check', 'completed', 'success', 1),
  run('docker-e2e', 'completed', 'success', 1),
  run('pr-policy', 'completed', 'success', 2),
];

test('слияние по проверкам: все зелёные — ничего не мешает', () => {
  assert.equal(blockingCheck(green, REQUIRED, '1'), null);
});

test('проверка ещё идёт в другом workflow — ждать его завершения, не перечитывать', () => {
  const runs = [green[0], run('docker-e2e', 'in_progress', null, 1), green[2]];
  // Запустил PR policy (набор 2): CI ещё идёт, его завершение снова запустит автослияние.
  assert.deepEqual(blockingCheck(runs, REQUIRED, '2'), {
    name: 'docker-e2e',
    latest: runs[1],
    stale: false,
  });
});

test('запустивший workflow уже зелёный, а API отдаёт прежнее — перечитать (#145)', () => {
  const runs = [green[0], run('docker-e2e', 'in_progress', null, 1), green[2]];
  // Запустил CI (набор 1), его docker-e2e в ответе ещё in_progress.
  assert.equal(blockingCheck(runs, REQUIRED, 1).stale, true);
  assert.equal(blockingCheck(runs, REQUIRED, '1').stale, true);
  // Без набора (старый запуск) — как раньше: ждать.
  assert.equal(blockingCheck(runs, REQUIRED, undefined).stale, false);
  assert.equal(blockingCheck(runs, REQUIRED, '').stale, false);
});

test('проверки ещё нет — ждать; чужое приложение и прежние запуски не считаются', () => {
  assert.deepEqual(blockingCheck(green.slice(0, 2), REQUIRED, '2'), {
    name: 'pr-policy',
    latest: null,
    stale: false,
  });
  const foreign = [
    green[0],
    green[1],
    run('pr-policy', 'completed', 'success', 9, undefined, 'evil'),
  ];
  assert.equal(blockingCheck(foreign, REQUIRED, '1').name, 'pr-policy');
  // Перезапуск: решает последний по времени запуск.
  const rerun = [run('check', 'completed', 'failure', 1, '2026-10-30T18:00:00Z'), ...green];
  assert.equal(blockingCheck(rerun, REQUIRED, '1'), null);
  const failedAgain = [
    ...green.slice(1),
    run('check', 'completed', 'failure', 3, '2026-10-30T19:00:00Z'),
    green[0],
  ];
  assert.deepEqual(blockingCheck(failedAgain, REQUIRED, '1'), {
    name: 'check',
    latest: failedAgain[2],
    stale: false,
  });
});
