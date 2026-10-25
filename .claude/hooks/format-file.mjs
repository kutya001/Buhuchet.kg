// После правки файла: Prettier и ESLint только этого файла. Ошибки линтера показываются Claude.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readInput, relative, ROOT } from './lib.mjs';

const file = readInput().tool_input?.file_path;
if (!file || !existsSync(file)) process.exit(0);
const rel = relative(file);
if (rel.startsWith('..') || rel.startsWith('spec/') || rel.startsWith('packages/db/migrations/'))
  process.exit(0);

const bin = (name) => `${ROOT}/node_modules/.bin/${name}`;
if (/\.(c|m)?(t|j)sx?$|\.(json|css|ya?ml)$/.test(rel) && existsSync(bin('prettier'))) {
  spawnSync(bin('prettier'), ['--write', '--log-level', 'warn', '--ignore-unknown', file], {
    cwd: ROOT,
    stdio: 'ignore',
  });
}
if (/\.(c|m)?(t|j)sx?$/.test(rel) && existsSync(bin('eslint'))) {
  const res = spawnSync(bin('eslint'), ['--fix', '--max-warnings=0', file], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    process.stderr.write(`ESLint нашёл ошибки в ${rel}:\n${res.stdout}${res.stderr}`);
    process.exit(2);
  }
}
process.exit(0);
