// Общее для хуков Claude Code: чтение входа и ответ «запрещено».
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
