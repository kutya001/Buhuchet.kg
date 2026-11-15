import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Образ сайта (Dockerfile, стадия web): настройки сервера Next.js, от которых зависит работа за
// обратным прокси и сквозные тесты в CI (docs/decisions.md п. О-55).

/** Строки стадии `FROM … AS <name>` до следующей стадии. */
function stage(dockerfile, name) {
  const lines = dockerfile.split('\n');
  const start = lines.findIndex((l) =>
    new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`, 'i').test(l),
  );
  assert.ok(start >= 0, `нет стадии ${name}`);
  const end = lines.findIndex((l, i) => i > start && /^FROM\s/i.test(l));
  return lines.slice(start, end < 0 ? undefined : end);
}

/** Значение переменной из строк `ENV A=1 B=2` стадии. */
function env(lines, key) {
  for (const line of lines) {
    const m = /^ENV\s+(.*)$/.exec(line);
    if (!m) continue;
    for (const pair of m[1].trim().split(/\s+/)) {
      const [k, v] = pair.split('=');
      if (k === key) return v;
    }
  }
  return undefined;
}

test('сайт держит простаивающее соединение дольше обратного прокси (Caddy — 120 с)', () => {
  const web = stage(readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8'), 'web');
  const value = Number(env(web, 'KEEP_ALIVE_TIMEOUT'));
  assert.ok(Number.isInteger(value), 'KEEP_ALIVE_TIMEOUT не задан');
  assert.ok(value > 120_000, `KEEP_ALIVE_TIMEOUT = ${value}`);
});
