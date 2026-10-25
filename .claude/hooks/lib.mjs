// Общее для хуков Claude Code: чтение входа, ответ «запрещено», ветка main для сравнения.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

/** Код 2 и текст в stderr — Claude Code отменяет действие и показывает причину. */
export function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

export function relative(file) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

/** С чем сравнивать правки: origin/main, а в клоне без него — локальная main; нет ни той, ни другой — null. */
export function mainRef() {
  for (const ref of ['origin/main', 'main']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '-q', `${ref}^{commit}`], {
        cwd: ROOT,
        stdio: 'ignore',
      });
      return ref;
    } catch {
      // нет такой ветки — пробуем следующую
    }
  }
  return null;
}
