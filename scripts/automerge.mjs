#!/usr/bin/env node
// Автослияние PR (вызывается из .github/workflows/automerge.yml после каждой завершённой проверки).
import { execFileSync } from 'node:child_process';

const REQUIRED_CHECKS = ['check', 'docker-e2e', 'pr-policy'];
const BEHIND_MARKER = '<!-- automerge:behind -->';
const { REPO, HEAD_SHA } = process.env;

const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const api = (path) => JSON.parse(gh('api', '-H', 'Accept: application/vnd.github+json', path));

const pr = api(`repos/${REPO}/commits/${HEAD_SHA}/pulls`).find(
  (p) => p.state === 'open' && p.head.sha === HEAD_SHA && p.head.repo?.full_name === REPO,
);
if (!pr) {
  console.log('Открытого PR с этим коммитом нет (или он из форка) — пропуск.');
  process.exit(0);
}
if (pr.draft) {
  console.log(`PR #${pr.number} — черновик, не сливаем.`);
  process.exit(0);
}
if (pr.labels.some((l) => l.name === 'hold')) {
  console.log(`PR #${pr.number} с меткой hold — не сливаем.`);
  process.exit(0);
}

// Последний запуск каждой обязательной проверки должен быть успешным.
const runs = api(`repos/${REPO}/commits/${HEAD_SHA}/check-runs?per_page=100`).check_runs;
for (const name of REQUIRED_CHECKS) {
  const latest = runs
    .filter((r) => r.name === name)
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') {
    console.log(
      `Проверка ${name}: ${latest ? `${latest.status}/${latest.conclusion}` : 'ещё нет'} — ждём.`,
    );
    process.exit(0);
  }
}

// Ветка должна содержать свежий main: иначе зелёные проверки не про то, что окажется в main.
const compare = api(`repos/${REPO}/compare/${pr.base.ref}...${HEAD_SHA}`);
if (compare.behind_by > 0) {
  const comments = api(`repos/${REPO}/issues/${pr.number}/comments?per_page=100`);
  if (!comments.some((c) => c.body.includes(BEHIND_MARKER))) {
    gh(
      'pr',
      'comment',
      String(pr.number),
      '--repo',
      REPO,
      '--body',
      `${BEHIND_MARKER}\nВсе проверки зелёные, но ветка отстала от main на ${compare.behind_by} коммит(а). ` +
        'Обновите ветку (rebase или merge с main) и запушьте — после новых зелёных проверок PR сольётся сам.',
    );
  }
  console.log(`PR #${pr.number} отстал от main на ${compare.behind_by} — ждём обновления ветки.`);
  process.exit(0);
}

gh(
  'pr',
  'merge',
  String(pr.number),
  '--repo',
  REPO,
  '--squash',
  '--delete-branch',
  '--match-head-commit',
  HEAD_SHA,
);
console.log(`PR #${pr.number} слит (squash).`);
