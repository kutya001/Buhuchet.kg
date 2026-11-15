// Перед git push в этот репозиторий: те же проверки, что stop-check в конце ответа — переносимость, типы и
// быстрые тесты изменённых пакетов, при правке e2e/ — типы и загрузка сквозных тестов. Пуш в середине ответа
// уходил без них: тесты пакета зелёные, а типы красные, и шаг «Типы» CI обрывался (docs/typical-mistakes.md № 39).
// Отметка о зелёной проверке общая со stop-check: если с прошлой проверки ничего не менялось — пропуск.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { block, readInput, ROOT } from './lib.mjs';

const command = (readInput().tool_input?.command ?? '').replace(/\s+/g, ' ');
const push = /\bgit((?:\s+-[Cc]\s+\S+)*)\s+push\b/.exec(command);
if (!push) process.exit(0);

// Пуш другого репозитория (`git -C <папка> push`, `cd <папка> && git push`) — не этот: пропуск.
const unquote = (dir) => dir.replace(/^["']|["']$/g, '');
const dirs = [...push[1].matchAll(/-C\s+(\S+)/g)].map((m) => unquote(m[1]));
const cd = /^\s*cd\s+(\S+)\s*&&/.exec(command);
if (cd) dirs.unshift(unquote(cd[1]));
if (dirs.some((dir) => path.resolve(ROOT, dir) !== path.resolve(ROOT))) process.exit(0);

const res = spawnSync(process.execPath, [path.join(ROOT, '.claude/hooks/stop-check.mjs')], {
  cwd: ROOT,
  input: '{}',
  encoding: 'utf8',
});
if (res.status === 2) {
  block(
    `Перед git push: ${res.stderr.replace(/^Проверка перед завершением не прошла/, 'проверка не прошла')}`,
  );
}
process.exit(0);
