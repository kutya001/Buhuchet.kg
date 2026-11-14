// Сквозные тесты загружаются: Playwright собирает список тестов (без браузера, сайта и базы).
// Ловит до CI то, что раньше находили только сквозные тесты через полчаса: пропавший при слиянии
// помощник, неверный импорт, повтор названия теста (docs/typical-mistakes.md № 16, 17; п. О-53).
// Типы папки e2e/ проверяет `pnpm typecheck` (`typecheck:e2e`).
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const res = spawnSync(
  'pnpm',
  ['-s', 'exec', 'playwright', 'test', '-c', 'e2e/playwright.config.ts', '--list'],
  { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' },
);
const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
const total = out.split('\n').find((l) => l.startsWith('Total:'));
if (res.status !== 0 || !total) {
  process.stderr.write(out.split('\n').slice(-60).join('\n'));
  console.error('\nСквозные тесты не загружаются — исправьте ошибку выше (pnpm test:e2e --list).');
  process.exit(1);
}
console.log(`Сквозные тесты загружаются: ${total.replace('Total:', '').trim()}.`);
