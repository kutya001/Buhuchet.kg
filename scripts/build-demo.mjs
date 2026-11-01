#!/usr/bin/env node
// Демо-организация для buhuchet.kg/demo (ТЗ «Лендинг» → «Демо-организация», решение заказчика
// 01.11.2026): собранный файл прототипа той версии, что лежит в spec/ (spec/SOURCE.json), с признаком
// «демо» (BU_DEMO). Собирает его build.py самого прототипа — тот же, что собирает dist/demo.html в
// репозитории прототипа, — командой из ТЗ: `python3 build.py --demo <файл> --site=/ --lead=/#lead`.
// Файл кладётся в apps/web/public/demo.html (в git не попадает); сайт отдаёт его по /demo как готовый
// файл с запретом исходящих запросов (next.config.ts). Запускается перед `next build` и `next dev`.
//
//   node scripts/build-demo.mjs          — собрать; без python3 — ошибка (сборка сайта не проходит)
//   node scripts/build-demo.mjs --dev    — без python3 только предупреждение: /demo локально не будет

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_FILE = path.join(ROOT, 'apps/web/public/demo.html');

/**
 * Собрать демо-версию в `out`: адреса «Вернуться на сайт» и «Оставить заявку» — страницы сайта.
 * build.py ждёт раскладку репозитория прототипа (data/ рядом с src/), а в spec/ данные лежат отдельно
 * (spec/data), поэтому прототип собирается во временной папке: spec/prototype и spec/data → data.
 */
export function buildDemo(out = DEMO_FILE) {
  const work = mkdtempSync(path.join(tmpdir(), 'buhuchet-demo-'));
  try {
    cpSync(path.join(ROOT, 'spec/prototype'), work, { recursive: true });
    cpSync(path.join(ROOT, 'spec/data'), path.join(work, 'data'), { recursive: true });
    // Окружение — только нужное python3: при сборке на Vercel и в Docker в process.env есть ключи
    // и пароли, а build.py приходит из репозитория прототипа (spec:sync).
    execFileSync('python3', ['build.py', '--demo', out, '--site=/', '--lead=/#lead'], {
      cwd: work,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONUTF8: '1' },
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dev = process.argv.includes('--dev');
  try {
    const out = buildDemo();
    const commit = JSON.parse(readFileSync(path.join(ROOT, 'spec/SOURCE.json'), 'utf8')).commit;
    console.log(
      `Демо-версия: ${path.relative(ROOT, out)} (${Math.round(statSync(out).size / 1024)} КБ, прототип ${String(commit).slice(0, 7)})`,
    );
  } catch (err) {
    if (!dev) throw err;
    console.warn(`Демо-версия не собрана (нужен python3): ${err.message}`);
  }
}
