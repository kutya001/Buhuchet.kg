// В конце ответа: типы и быстрые тесты изменённых пакетов и pnpm check:portability.
// Красное — Claude продолжает работу и чинит. Если с прошлой зелёной проверки ничего не менялось — пропуск.
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mainRef, readInput, ROOT } from './lib.mjs';

const input = readInput();
if (input.stop_hook_active) process.exit(0);
if (!existsSync(`${ROOT}/node_modules`)) process.exit(0);

const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

const base = mainRef() ?? 'HEAD';
const changed = sh(`git diff --name-only ${base}`) + sh('git ls-files --others --exclude-standard');
const code = changed
  .split('\n')
  .filter((f) =>
    /^(apps|packages|scripts|e2e)\/|^(package\.json|tsconfig\.base\.json|eslint\.config\.mjs)$/.test(
      f,
    ),
  );
if (code.length === 0) process.exit(0);

const stamp = createHash('sha256')
  .update(sh(`git diff ${base}`) + code.join('\n'))
  .digest('hex');
const stampFile = `${ROOT}/.turbo/stop-check.ok`;
if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) process.exit(0);

const steps = [
  ['pnpm', ['check:portability']],
  [
    'pnpm',
    [
      'exec',
      'turbo',
      'run',
      'typecheck',
      'test',
      `--filter=...[${base}]`,
      '--output-logs=errors-only',
    ],
  ],
];
for (const [cmd, args] of steps) {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) {
    const out = `${res.stdout}\n${res.stderr}`.split('\n').slice(-60).join('\n');
    process.stderr.write(
      `Проверка перед завершением не прошла (${cmd} ${args.join(' ')}). Исправьте:\n${out}\n`,
    );
    process.exit(2);
  }
}
mkdirSync(`${ROOT}/.turbo`, { recursive: true });
writeFileSync(stampFile, stamp);
process.exit(0);
