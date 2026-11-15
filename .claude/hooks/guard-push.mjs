// Перед git push в этот репозиторий: те же проверки, что stop-check в конце ответа — переносимость, типы и
// быстрые тесты изменённых пакетов, при правке e2e/ — типы и загрузка сквозных тестов. Пуш в середине ответа
// уходил без них: тесты пакета зелёные, а типы красные, и шаг «Типы» CI обрывался (docs/typical-mistakes.md № 39).
// Отметка о зелёной проверке общая со stop-check: если с прошлой проверки ничего не менялось — пропуск.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { block, readInput, ROOT } from './lib.mjs';
import { pushesRepo } from './push-target.mjs';

const input = readInput();
// Push другого репозитория (прототип, `cd <папка> && git push`, `git -C <папка> push`) — не этот: пропуск.
if (!pushesRepo(input.tool_input?.command ?? '', { cwd: input.cwd ?? process.cwd(), root: ROOT })) {
  process.exit(0);
}

// Проверка — не дольше 13 минут (предел хука в settings.json — 900 с). Не успела — останавливается вместе со
// всеми своими процессами (turbo, vitest), push идёт без неё: проверит CI.
const LIMIT_MS = 13 * 60 * 1000;
const child = spawn(process.execPath, [path.join(ROOT, '.claude/hooks/stop-check.mjs')], {
  cwd: ROOT,
  detached: true,
  stdio: ['pipe', 'ignore', 'pipe'],
});
let stderr = '';
child.stderr.setEncoding('utf8').on('data', (chunk) => {
  stderr += chunk;
});
child.stdin.end('{}');
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // уже завершилась
  }
}, LIMIT_MS);
const status = await new Promise((resolve) => child.on('close', (code) => resolve(code)));
clearTimeout(timer);

if (timedOut) {
  process.stderr.write(
    'Проверка перед git push не успела за 13 минут и остановлена — push идёт без неё, проверит CI.\n',
  );
  process.exit(1);
}
if (status === 2) {
  block(
    `Перед git push: ${stderr.replace(/^Проверка перед завершением не прошла/, 'проверка не прошла')}`,
  );
}
process.exit(0);
