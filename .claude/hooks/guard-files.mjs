// Перед правкой файла: запрет менять spec/, применённые миграции, .env*, сборки и lock-файл.
import { execFileSync } from 'node:child_process';
import { block, readInput, relative, ROOT } from './lib.mjs';

const input = readInput();
const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!file) process.exit(0);
const rel = relative(file);

if (rel.startsWith('..')) process.exit(0);
if (rel === 'spec' || rel.startsWith('spec/')) {
  block(
    'spec/ — копия ТЗ и прототипа, руками не правится. Обновление: `pnpm spec:sync`. Расхождение с ТЗ — в docs/deviations.md (скилл spec-deviation).',
  );
}
if (/(^|\/)\.env($|\.)/.test(rel) && !rel.endsWith('.env.example')) {
  block(
    'Файлы .env* не правятся через Claude Code: секреты задаются в настройках окружения. Новая переменная — в .env.example и схему config.',
  );
}
if (/(^|\/)(dist|\.next|coverage|node_modules)\//.test(rel)) {
  block('Это результат сборки — правьте исходники.');
}
if (rel === 'pnpm-lock.yaml') {
  block('pnpm-lock.yaml меняется только командами pnpm (add, install, update).');
}
if (rel.startsWith('packages/db/migrations/')) {
  // Миграция уже в main — значит, применена на стенде или рабочем сайте: только новая миграция поверх.
  const applied = (() => {
    try {
      execFileSync('git', ['cat-file', '-e', `origin/main:${rel}`], { cwd: ROOT, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  if (applied) {
    block(
      `${rel} уже в main (применена). Применённые миграции не меняются — создайте новую: pnpm db:generate или drizzle-kit generate --custom.`,
    );
  }
}
process.exit(0);
