#!/usr/bin/env node
// Данные модуля Админки «Техническая документация» (ТЗ «Админка» → «Техническая документация», решение
// заказчика 09.11.2026; прототип admin/techdocs.js). Собираются перед `next build` и `next dev` в папку
// apps/web/techdocs (в git не попадает), сайт отдаёт их только администратору платформы:
//   api.json    — описание API со связями «метод → таблицы → SQL». Его собирает скрипт прототипа
//                 spec/prototype/db/api_snapshot.py по исходникам этого репозитория: он только разбирает
//                 текст, код продукта не запускает;
//   schema.json — описание базы данных, единственный источник схемы (spec/prototype/db/schema.json);
//   page.html   — страница «База данных Buhuchet.kg» (spec/prototype/db/index.html).
// Если снимок собрать не удалось (нет python3, скрипт не разобрал код), берётся снимок прототипа
// spec/data/apiDocs.json: в строке версии модуля видно, по какому коммиту он собран.
//
//   node scripts/build-techdocs.mjs   — собрать (ошибка сборки снимка — предупреждение, не отказ)

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TECHDOCS_DIR = path.join(ROOT, 'apps/web/techdocs');
const DB_DIR = path.join(ROOT, 'spec/prototype/db');

// Окружение — только нужное: при сборке на Vercel и в Docker в process.env есть ключи и пароли, а
// скрипт приходит из репозитория прототипа (spec:sync).
const safeEnv = () => ({
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  LANG: 'C.UTF-8',
  PYTHONUTF8: '1',
});

/**
 * Коммит и дата версии продукта: git, а где его нет (сборка без .git: образ Docker) — переменная
 * сборки и сегодняшний день по Бишкеку.
 */
export function sourceVersion(env = process.env, root = ROOT) {
  const git = (format) => {
    try {
      return execFileSync('git', ['-C', root, 'log', '-1', `--format=${format}`], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: safeEnv(),
      })
        .toString()
        .trim();
    } catch {
      return '';
    }
  };
  const given = String(env.SOURCE_COMMIT ?? env.VERCEL_GIT_COMMIT_SHA ?? env.GITHUB_SHA ?? '');
  const commit = git('%h') || (/^[0-9a-f]{7,40}$/.test(given) ? given.slice(0, 7) : '');
  const date = git('%cs') || new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
  return { commit, date };
}

/**
 * Собрать снимок API в `out`. Скрипт ждёт раскладку репозитория прототипа (db/ и data/ рядом), поэтому
 * работает во временной папке. Код выхода 2 — в коде есть таблица, которой нет в schema.json (схема в
 * spec/ отстаёт от миграций до следующего spec:sync): снимок при этом записан, берём его.
 */
export function buildApiSnapshot(out, version = sourceVersion()) {
  const work = mkdtempSync(path.join(tmpdir(), 'buhuchet-techdocs-'));
  try {
    cpSync(DB_DIR, path.join(work, 'db'), { recursive: true });
    mkdirSync(path.join(work, 'data'));
    const made = path.join(work, 'data/apiDocs.json');
    let note = '';
    try {
      execFileSync(
        'python3',
        [
          'db/api_snapshot.py',
          ROOT,
          `--commit=${version.commit || 'нет данных'}`,
          `--date=${version.date}`,
        ],
        { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], env: safeEnv() },
      );
    } catch (err) {
      if (err.status !== 2 || !existsSync(made)) throw err;
      note = 'в коде есть таблицы, которых нет в spec/prototype/db/schema.json';
    }
    JSON.parse(readFileSync(made, 'utf8'));
    copyFileSync(made, out);
    return note;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Собрать папку данных модуля; возвращает, откуда взято описание API и предупреждение. */
export function buildTechDocs(dir = TECHDOCS_DIR) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(DB_DIR, 'schema.json'), path.join(dir, 'schema.json'));
  copyFileSync(path.join(DB_DIR, 'index.html'), path.join(dir, 'page.html'));
  const api = path.join(dir, 'api.json');
  try {
    const note = buildApiSnapshot(api);
    return { source: 'repo', note };
  } catch (err) {
    copyFileSync(path.join(ROOT, 'spec/data/apiDocs.json'), api);
    return {
      source: 'spec',
      note: String(err.stderr || err.message)
        .trim()
        .slice(0, 400),
    };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const made = buildTechDocs();
  const meta = JSON.parse(readFileSync(path.join(TECHDOCS_DIR, 'api.json'), 'utf8')).meta;
  const size = Math.round(statSync(path.join(TECHDOCS_DIR, 'api.json')).size / 1024);
  console.log(
    `Техническая документация: ${path.relative(ROOT, TECHDOCS_DIR)} — ${meta.methods} методов, ${size} КБ, коммит ${meta.commit} от ${meta.date}`,
  );
  if (made.source === 'spec') {
    console.warn(
      `Снимок API не собран, взят снимок прототипа spec/data/apiDocs.json: ${made.note}`,
    );
  } else if (made.note) {
    console.warn(`Снимок API: ${made.note}`);
  }
}
