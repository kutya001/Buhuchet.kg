import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { checkPortability } from './check-portability.mjs';

const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function repo(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'portability-'));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

const rules = (root) => checkPortability(root).map((p) => `${p.file}: ${p.rule}`);

test('чистый репозиторий проходит', () => {
  const root = repo({
    'packages/adapters/package.json': JSON.stringify({
      dependencies: { '@vercel/functions': '1' },
    }),
    'packages/adapters/src/config.ts': 'export const env = process.env;',
    'packages/adapters/src/vercel.ts': "import { waitUntil } from '@vercel/functions';",
    'packages/api/src/a.ts': "import { x } from '@buhuchet/adapters';",
    'packages/db/migrations/0000.sql':
      'CREATE EXTENSION IF NOT EXISTS pg_trgm; -- auth.uid() в комментарии можно',
    'apps/web/next.config.ts': 'process.env.X;',
    'apps/web/vercel.json': JSON.stringify({ regions: ['fra1'], crons: [] }),
  });
  assert.deepEqual(rules(root), []);
});

test('ловит зависимости и импорты поставщиков вне adapters', () => {
  const root = repo({
    'apps/web/package.json': JSON.stringify({ dependencies: { '@supabase/supabase-js': '2' } }),
    'apps/web/app/page.tsx': "import { createClient } from '@supabase/supabase-js';",
    'packages/api/src/b.ts': "const k = await import('@vercel/kv');",
  });
  const found = rules(root);
  assert.equal(found.length, 3);
  assert.match(found.join('\n'), /зависимость @supabase\/supabase-js/);
  assert.match(found.join('\n'), /apps\/web\/app\/page.tsx: импорт/);
  assert.match(found.join('\n'), /packages\/api\/src\/b.ts: импорт/);
});

test('ловит process.env, Edge Runtime, Server Actions, запись на диск и адреса поставщиков', () => {
  const root = repo({
    'packages/api/src/env.ts': 'const url = process.env.DATABASE_URL;',
    'apps/web/app/edge/route.ts': "export const runtime = 'edge';",
    'apps/web/app/actions.ts': "'use server';\nexport async function save() {}",
    'packages/api/src/files.ts':
      "import { writeFile } from 'node:fs/promises'; await writeFile('/tmp/x', '');",
    'packages/api/src/host.ts': "const u = 'https://abcd.supabase.co';",
  });
  const found = rules(root).join('\n');
  assert.match(found, /env.ts: process.env/);
  assert.match(found, /Edge Runtime/);
  assert.match(found, /Server Actions/);
  assert.match(found, /не пишет на свой диск \(writeFile\)/);
  assert.match(found, /адрес Supabase или Vercel/);
});

test('ловит запрещённый SQL и расширения', () => {
  const root = repo({
    'packages/db/migrations/0001.sql': [
      'CREATE POLICY p ON t USING (owner = auth.uid());',
      'SELECT cron.schedule($$x$$);',
      'CREATE EXTENSION IF NOT EXISTS "postgis";',
      'insert into storage.objects values (1);',
    ].join('\n'),
  });
  const found = rules(root);
  assert.equal(found.length, 4);
  assert.match(found.join('\n'), /Supabase Auth/);
  assert.match(found.join('\n'), /pg_cron/);
  assert.match(found.join('\n'), /расширение postgis/);
  assert.match(found.join('\n'), /схема storage/);
});

test('vercel.json — только регион и расписание', () => {
  const root = repo({
    'apps/web/vercel.json': JSON.stringify({ regions: ['fra1'], rewrites: [] }),
  });
  assert.match(rules(root).join('\n'), /ключ «rewrites»/);
});

test('настоящий репозиторий проходит', () => {
  const root = path.resolve(import.meta.dirname, '..');
  assert.deepEqual(rules(root), []);
});
