// Разбор команды Bash для хуков: есть ли в ней git push из этого репозитория (guard-push) и общий образец
// git push с глобальными опциями (guard-bash). Чистая функция — тест в scripts/push-target.test.mjs.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Глобальные опции git до подкоманды: -C <папка>, -c <ключ=значение>, --git-dir <путь>, --no-pager, -P…
// Без них `git --no-pager push --force` проходил мимо запретов guard-bash.
export const GIT_GLOBAL_OPTS = String.raw`(?:\s+(?:-[Cc]\s+\S+|--(?:git-dir|work-tree|namespace|config-env|exec-path)(?:=|\s+)\S+|--[a-z][\w-]*(?:=\S+)?|-[pP]))*`;

const PUSH = new RegExp(String.raw`^(?:\w+=\S*\s+)*git(${GIT_GLOBAL_OPTS})\s+push(?:\s|$)`);
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\n|$)/g;

/** Корень репозитория git, в котором лежит папка, или null. */
export function gitToplevel(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function real(dir) {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * Идёт ли в команде git push из репозитория root. Папка push — cwd из входа хука, затем каждый `cd` перед ним
 * (через `&&`, `;`, `||`, `|`, перевод строки, в скобках) и `-C` у самого git. Текст в кавычках и тело heredoc —
 * не команды: `git commit -m "… git push …"` и `git grep "git push"` проверку не запускают.
 */
export function pushesRepo(
  command,
  { cwd, root, projectDir = root, home = os.homedir(), toplevel = gitToplevel },
) {
  const quoted = [];
  const text = command
    .replace(HEREDOC, '')
    .replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, (q) => `\uE000${quoted.push(q.slice(1, -1)) - 1}\uE000`);
  const unquote = (word) => word.replace(/\uE000(\d+)\uE000/g, (_, i) => quoted[Number(i)]);
  const expand = (word, from) => {
    const dir = unquote(word)
      .replace(/^~(?=\/|$)/, home)
      .replace(/^\$(?:\{HOME\}|HOME)(?=\/|$)/, home)
      .replace(/^\$(?:\{PWD\}|PWD)(?=\/|$)/, from)
      .replace(/^\$(?:\{CLAUDE_PROJECT_DIR\}|CLAUDE_PROJECT_DIR)(?=\/|$)/, projectDir);
    return dir.includes('$') ? null : path.resolve(from, dir);
  };

  const target = real(root);
  let dir = cwd;
  for (const raw of text.split(/&&|\|\||[;|\n]/)) {
    const part = raw
      .replace(/^[\s({!]+/, '')
      .replace(/^(?:then|do|else)\s+/, '')
      .trimEnd();
    const cd = /^cd\s+(\S+)$/.exec(part);
    if (cd) {
      dir = dir && expand(cd[1], dir);
      continue;
    }
    const push = PUSH.exec(part);
    if (!push || !dir) continue;
    let at = dir;
    for (const m of push[1].matchAll(/-C\s+(\S+)/g)) at = at && expand(m[1], at);
    const top = at && toplevel(at);
    if (top && real(top) === target) return true;
  }
  return false;
}
