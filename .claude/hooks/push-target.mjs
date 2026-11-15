// Разбор команды Bash для хуков: есть ли в ней git push из этого репозитория (guard-push) и общий образец
// git push с глобальными опциями (guard-bash). Чистая функция — тест в scripts/push-target.test.mjs.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Глобальные опции git до подкоманды: -C <папка>, -c <ключ=значение>, --git-dir <путь>, --no-pager, -P…
// Без них `git --no-pager push --force` проходил мимо запретов guard-bash. Значение — и в кавычках с пробелом
// (`git -C "/my dir" push`); варианты не пересекаются, чтобы разбор длинной команды не рос степенью.
const VAL = String.raw`(?:"[^"]*"|'[^']*'|[^\s"']\S*)`;
const WITH_VAL = 'git-dir|work-tree|namespace|config-env|exec-path';
export const GIT_GLOBAL_OPTS = String.raw`(?:\s+(?:-[Cc]\s+${VAL}|--(?:${WITH_VAL})(?:=|\s+)${VAL}|--(?!(?:${WITH_VAL})\b)[a-z][\w-]*(?:=\S+)?|-[pP]))*`;

// Перед git: переменные окружения, `timeout N`, `env`, `command`, `time`, `if`/`while`, путь до git.
const LEAD = String.raw`(?:(?:timeout\s+\S+|env|command|time|nice|exec|if|elif|while|until|then|do|else)\s+|\w+=\S*\s+)*`;
const PUSH = new RegExp(String.raw`^${LEAD}(?:\S*/)?git(${GIT_GLOBAL_OPTS})\s+push(?=[\s)}]|$)`);
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
 * (через `&&`, `;`, `||`, `|`, перевод строки; `cd` в скобках действует только до `)`) и `-C` у самого git.
 * Папку не узнать (`cd -`, неизвестная переменная) — считается, что push отсюда: лишняя проверка лучше пропуска.
 * Текст в кавычках и тело heredoc — не команды: `git commit -m "… git push …"` и `git grep "git push"` не в счёт.
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
    if (from === null || word === '-') return null;
    const dir = unquote(word)
      .replace(/^~(?=\/|$)/, home)
      .replace(/^\$(?:\{HOME\}|HOME)(?=\/|$)/, home)
      .replace(/^\$(?:\{PWD\}|PWD)(?=\/|$)/, from)
      .replace(/^\$(?:\{CLAUDE_PROJECT_DIR\}|CLAUDE_PROJECT_DIR)(?=\/|$)/, projectDir);
    return dir.includes('$') ? null : path.resolve(from, dir);
  };
  const count = (str, ch) => str.split(ch).length - 1;

  const target = real(root);
  const outer = [];
  let dir = cwd;
  for (const raw of text.split(/&&|\|\||[;|\n]/)) {
    let part = raw.trim();
    for (let m; (m = /^([({!])\s*/.exec(part)); part = part.slice(m[0].length)) {
      if (m[1] === '(') outer.push(dir);
    }
    const closes = Math.max(0, count(part, ')') - count(part, '('));
    const cd = /^cd(?:\s+--)?(?:\s+([^\s)}]+))?\s*[)}]*$/.exec(part);
    if (cd) {
      dir = cd[1] === undefined ? home : expand(cd[1], dir);
    } else {
      const push = PUSH.exec(part);
      if (push) {
        let at = dir;
        for (const m of push[1].matchAll(/-C\s+(\S+)/g)) at = expand(m[1], at);
        if (at === null) return true;
        const top = toplevel(at);
        if (top && real(top) === target) return true;
      }
    }
    for (let i = 0; i < closes && outer.length; i += 1) dir = outer.pop();
  }
  return false;
}
