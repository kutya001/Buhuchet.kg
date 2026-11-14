import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logText, summarizeLog } from './ci-log-summary.mjs';

const log = [
  '2026-11-14T10:00:00.0000000Z Running 120 tests using 2 workers',
  '2026-11-14T10:00:01.0000000Z web-1  | {"level":50,"msg":"Error: внутри контейнера"}',
  '2026-11-14T10:00:01.0000000Z web-1  | {"level":30,"msg":"Error: в обычной строке сайта"}',
  '2026-11-14T10:00:02.0000000Z postgres-1  | ERROR:  canceling statement due to user request',
  '2026-11-14T10:05:00.0000000Z   ✘  12 [desktop] › auth.spec.ts:10:3 › Вход › неверный пароль (31.0s)',
  '2026-11-14T10:05:00.0000000Z   ✘  12 [desktop] › auth.spec.ts:10:3 › Вход › неверный пароль (31.0s)',
  '2026-11-14T10:05:01.0000000Z     Error: \u001b[31mexpect(locator).toBeVisible() failed\u001b[39m',
  '2026-11-14T10:09:00.0000000Z   1 failed',
  '2026-11-14T10:09:00.0000000Z   52 did not run',
  '2026-11-14T10:09:00.0000000Z   67 passed (9.0m)',
  '2026-11-14T10:09:01.0000000Z ### Сквозные тесты, машина 2/6',
  '2026-11-14T10:09:01.0000000Z | auth.spec.ts:10 Вход › неверный пароль | desktop | Error: … |',
  '2026-11-14T10:09:02.0000000Z обычная строка',
].join('\n');

test('остаются падения, итоги, сводка машины и ошибки контейнеров; без меток времени, цветов и повторов', () => {
  const lines = summarizeLog(log);
  assert.equal(lines.length, 9);
  assert.match(lines[0], /^web-1 {2}\| \{"level":50/);
  assert.match(lines[1], /^postgres-1 {2}\| ERROR: {2}canceling statement/);
  assert.match(lines[2], /^ {2}✘ {2}12 \[desktop\]/);
  assert.equal(lines[3], '    Error: expect(locator).toBeVisible() failed');
  assert.ok(lines.includes('  52 did not run'));
  assert.ok(lines.includes('### Сквозные тесты, машина 2/6'));
  assert.ok(lines.every((l) => !l.includes('в обычной строке') && !l.includes('обычная строка')));
});

test('строк контейнеров — не больше предела, о лишних — строка в конце', () => {
  const many = Array.from(
    { length: 5 },
    (_, i) => `postgres-1  | ERROR:  deadlock detected ${i}`,
  ).join('\n');
  const lines = summarizeLog(many, { containerLimit: 2 });
  assert.equal(lines.length, 3);
  assert.equal(lines[2], '… ещё 3 строк ошибок контейнеров — в полном журнале.');
});

test('JSON get_job_logs: logs_content и logs[]', () => {
  assert.equal(logText(JSON.stringify({ logs_content: 'a' })), 'a');
  assert.equal(
    logText(JSON.stringify({ logs: [{ logs_content: 'a' }, { logs_content: 'b' }] })),
    'a\nb',
  );
  assert.equal(logText('просто текст'), 'просто текст');
});
