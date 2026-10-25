#!/usr/bin/env node
// pnpm check:portability — не даёт коду незаметно привязаться к Vercel или Supabase.
// Правила — раздел «Как избежать привязки к поставщику» плана разработки и CLAUDE.md.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_EXT = /\.(c|m)?(t|j)sx?$/;
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'coverage',
  '.turbo',
  'test-results',
  'playwright-report',
]);
const ALLOWED_EXTENSIONS = new Set(['pg_trgm', 'pgcrypto', 'citext']);
const ALLOWED_VERCEL_KEYS = new Set(['$schema', 'regions', 'crons']);

const FORBIDDEN_SQL = [
  [/\bauth\.(uid|jwt|role|email)\s*\(/i, 'функции Supabase Auth в SQL'],
  [/\bstorage\.(objects|buckets)\b/i, 'схема storage Supabase'],
  [/\brealtime\./i, 'Supabase Realtime'],
  [/\bsupabase_\w+/i, 'служебные роли и схемы Supabase'],
  [/\bpg_cron\b|\bcron\.schedule\s*\(/i, 'pg_cron (расписание — только наш планировщик)'],
  [/\bpgsodium\b|\bvault\./i, 'pgsodium/Vault Supabase'],
  [/\bpg_net\b|\bnet\.http_/i, 'pg_net Supabase'],
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function each(re, text, fn) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (const m of text.matchAll(g)) fn(m, lineOf(text, m.index ?? 0));
}

/** Проверить репозиторий; вернуть список нарушений `{ file, line, rule }`. */
export function checkPortability(root) {
  const problems = [];
  const add = (file, line, rule) => problems.push({ file: rel(root, file), line, rule });

  // 1. Зависимости @supabase/* и @vercel/* — только у packages/adapters.
  for (const base of ['apps', 'packages']) {
    const dir = path.join(root, base);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const pkgFile = path.join(dir, name, 'package.json');
      if (!existsSync(pkgFile) || `${base}/${name}` === 'packages/adapters') continue;
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
      for (const field of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
      ]) {
        for (const dep of Object.keys(pkg[field] ?? {})) {
          if (/^@(supabase|vercel)\//.test(dep))
            add(pkgFile, 1, `зависимость ${dep} разрешена только в packages/adapters`);
        }
      }
    }
  }
  const rootPkg = path.join(root, 'package.json');
  if (existsSync(rootPkg)) {
    const pkg = JSON.parse(readFileSync(rootPkg, 'utf8'));
    for (const field of ['dependencies', 'devDependencies']) {
      for (const dep of Object.keys(pkg[field] ?? {})) {
        if (/^@(supabase|vercel)\//.test(dep))
          add(rootPkg, 1, `зависимость ${dep} разрешена только в packages/adapters`);
      }
    }
  }

  // 2. Исходный код.
  const files = [...walk(path.join(root, 'apps')), ...walk(path.join(root, 'packages'))].filter(
    (f) => SOURCE_EXT.test(f),
  );
  for (const file of files) {
    const r = rel(root, file);
    const text = readFileSync(file, 'utf8');
    const inAdapters = r.startsWith('packages/adapters/');
    const isTest = /\.test\.(c|m)?(t|j)sx?$/.test(r);
    const isToolConfig = /(^|\/)[\w.-]+\.config\.(c|m)?(t|j)s$/.test(r);
    const isCli = /\/src\/cli\//.test(r);

    if (!inAdapters) {
      each(
        /from\s+['"]@(supabase|vercel)\/[^'"]*['"]|import\s*\(\s*['"]@(supabase|vercel)\/|require\(\s*['"]@(supabase|vercel)\//,
        text,
        (_m, line) => add(file, line, 'импорт @supabase/* или @vercel/* вне packages/adapters'),
      );
    }
    if (r !== 'packages/adapters/src/config.ts' && !isToolConfig) {
      // process.env.NEXT_RUNTIME — не настройка, а признак среды Next.js (instrumentation.ts).
      each(/\bprocess\.env\b(?!\.NEXT_RUNTIME\b)/, text, (_m, line) =>
        add(
          file,
          line,
          'process.env читается только в packages/adapters/src/config.ts (loadConfig)',
        ),
      );
    }
    each(/\b[\w-]+\.supabase\.(co|com|in)\b|\b[\w-]+\.vercel\.app\b/, text, (_m, line) =>
      add(file, line, 'адрес Supabase или Vercel в коде: только через переменные окружения'),
    );
    if (r.startsWith('apps/web/')) {
      each(
        /export\s+const\s+runtime\s*=\s*['"]edge['"]|runtime\s*:\s*['"]edge['"]/,
        text,
        (_m, line) => add(file, line, 'Edge Runtime запрещён: только nodejs'),
      );
      each(/^\s*['"]use server['"]/m, text, (_m, line) =>
        add(file, line, 'Server Actions запрещены: данные только через API'),
      );
    }
    if (!isTest && !isCli && !isToolConfig && !r.startsWith('packages/db/')) {
      each(
        /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|mkdirSync|mkdtempSync)\s*\(/,
        text,
        (m, line) =>
          add(
            file,
            line,
            `приложение не пишет на свой диск (${m[1]}): файлы — только через storage`,
          ),
      );
    }
  }

  // 3. SQL-миграции.
  for (const file of walk(path.join(root, 'packages/db/migrations')).filter((f) =>
    f.endsWith('.sql'),
  )) {
    const text = readFileSync(file, 'utf8').replace(/--[^\n]*/g, (c) => ' '.repeat(c.length));
    for (const [re, rule] of FORBIDDEN_SQL)
      each(re, text, (_m, line) => add(file, line, `SQL: ${rule}`));
    each(/create\s+extension\s+(?:if\s+not\s+exists\s+)?"?([\w-]+)"?/i, text, (m, line) => {
      if (!ALLOWED_EXTENSIONS.has(m[1].toLowerCase())) {
        add(file, line, `расширение ${m[1]} не из списка ${[...ALLOWED_EXTENSIONS].join(', ')}`);
      }
    });
  }

  // 4. vercel.json — только регион и вызов расписания.
  for (const file of walk(path.join(root, 'apps')).filter(
    (f) => path.basename(f) === 'vercel.json',
  )) {
    const config = JSON.parse(readFileSync(file, 'utf8'));
    for (const key of Object.keys(config)) {
      if (!ALLOWED_VERCEL_KEYS.has(key))
        add(
          file,
          1,
          `vercel.json: ключ «${key}» привязывает к Vercel (разрешены ${[...ALLOWED_VERCEL_KEYS].join(', ')})`,
        );
    }
  }

  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkPortability(root);
  if (problems.length) {
    console.error('Переносимость нарушена:');
    for (const p of problems) console.error(`  ${p.file}:${p.line}  ${p.rule}`);
    process.exit(1);
  }
  console.log('Переносимость: нарушений нет.');
}
