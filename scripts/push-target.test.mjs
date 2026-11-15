import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GIT_GLOBAL_OPTS, pushesRepo } from '../.claude/hooks/push-target.mjs';

// Две «папки с репозиториями» без настоящего git: /work/product (этот) и /work/proto (прототип).
const toplevel = (dir) => {
  for (const repo of ['/work/product', '/work/proto']) {
    if (dir === repo || dir.startsWith(`${repo}/`)) return repo;
  }
  return null;
};
const opts = { root: '/work/product', projectDir: '/work/product', home: '/home/u', toplevel };
const ours = (command, cwd = '/work/product') => pushesRepo(command, { ...opts, cwd });

test('push из этого репозитория — проверка', () => {
  assert.equal(ours('git push -u origin claude/x'), true);
  assert.equal(ours('FOO=1 git push'), true);
  assert.equal(ours('git --no-pager push origin x'), true);
  assert.equal(ours('git -P push'), true);
  assert.equal(ours('git -c core.x=1 -C apps push'), true);
  assert.equal(ours('git -C /work/proto status && git push'), true);
});

test('папка push — по cwd из входа хука и cd перед ним', () => {
  assert.equal(ours('git push', '/work/proto'), false);
  assert.equal(ours('cd /work/proto; git push'), false);
  assert.equal(ours('(cd /work/proto && git push)'), false);
  assert.equal(ours('cd /tmp && cd /work/product && git push', '/work/proto'), true);
  assert.equal(ours('cd /work/product/apps && git push', '/tmp'), true);
  assert.equal(ours('cd apps && git push'), true);
  assert.equal(ours('cd "$CLAUDE_PROJECT_DIR" && git push', '/tmp'), true);
  assert.equal(ours('cd ~ && git -C /work/product push'), true);
  assert.equal(ours('git -C "$PWD" push'), true);
  assert.equal(ours('git -C /work/proto push'), false);
  assert.equal(ours('git push', '/tmp'), false);
});

test('push в тексте, а не командой, — не проверка', () => {
  assert.equal(ours('git grep -n "git push" -- .claude'), false);
  assert.equal(ours('git commit -m "потом; git push"'), false);
  assert.equal(ours("echo 'git push'"), false);
  assert.equal(ours('git commit -F - <<EOF\nЗаголовок\ngit push\nEOF\ngit log -1'), false);
  assert.equal(ours('git status'), false);
});

test('неизвестная переменная в папке — пропуск, а не догадка', () => {
  assert.equal(ours('cd "$SOMEWHERE" && git push'), false);
});

test('глобальные опции git для запретов guard-bash', () => {
  const force = new RegExp(String.raw`\bgit${GIT_GLOBAL_OPTS}\s+push\b[^;&|]*\s--force\b`);
  assert.equal(force.test('git --no-pager push --force origin x'), true);
  assert.equal(force.test('git --git-dir=/r/.git push --force'), true);
  assert.equal(force.test('git --git-dir /r/.git push --force'), true);
  assert.equal(force.test('git -C /r -c a=b push --force'), true);
  assert.equal(force.test('git log --force'), false);
});
