#!/usr/bin/env node
// Автослияние PR (вызывается из .github/workflows/automerge.yml после каждой завершённой проверки).
import { execFileSync } from 'node:child_process';
import { mergeGuardFiles, needsStagingMigration } from './protected-paths.mjs';

const REQUIRED_CHECKS = ['check', 'docker-e2e', 'pr-policy'];
const BEHIND_MARKER = '<!-- automerge:behind -->';
const GUARD_MARKER = '<!-- automerge:guards -->';
const { REPO, HEAD_SHA } = process.env;

// Буфер больше 1 МБ по умолчанию: ответы gh api по длинной истории ветки бывают больше.
const gh = (...args) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
const api = (path) => JSON.parse(gh('api', '-H', 'Accept: application/vnd.github+json', path));
const comment = (number, marker, text) => {
  const comments = api(`repos/${REPO}/issues/${number}/comments?per_page=100`);
  if (comments.some((c) => c.body.includes(marker))) return;
  gh('pr', 'comment', String(number), '--repo', REPO, '--body', `${marker}\n${text}`);
};

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

// PR, который меняет проверки, автослияние или хуки, сливает только заказчик.
const files = gh(
  'api',
  '--paginate',
  `repos/${REPO}/pulls/${pr.number}/files?per_page=100`,
  '--jq',
  '.[].filename',
)
  .split('\n')
  .filter(Boolean);
const guards = mergeGuardFiles(files);
if (guards.length) {
  comment(
    pr.number,
    GUARD_MARKER,
    `PR меняет проверки, автослияние или хуки (${guards.join(', ')}), поэтому сам не сливается: ` +
      'сливает заказчик после просмотра.',
  );
  console.log(`PR #${pr.number} меняет ${guards.join(', ')} — автослияние остановлено.`);
  process.exit(0);
}

// Последний запуск каждой обязательной проверки должен быть успешным.
const runs = api(`repos/${REPO}/commits/${HEAD_SHA}/check-runs?per_page=100`).check_runs;
for (const name of REQUIRED_CHECKS) {
  const latest = runs
    // Только проверки GitHub Actions: чужое приложение не может «зажечь» зелёный check с тем же именем.
    .filter((r) => r.name === name && r.app?.slug === 'github-actions')
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') {
    console.log(
      `Проверка ${name}: ${latest ? `${latest.status}/${latest.conclusion}` : 'ещё нет'} — ждём.`,
    );
    process.exit(0);
  }
}

// Ветка должна содержать свежий main: иначе зелёные проверки не про то, что окажется в main.
// Нужно только число: полный ответ сравнения (коммиты и патчи ветки) бывает больше мегабайта.
const behindBy = Number(
  gh(
    'api',
    '-H',
    'Accept: application/vnd.github+json',
    `repos/${REPO}/compare/${pr.base.ref}...${HEAD_SHA}`,
    '--jq',
    '.behind_by',
  ).trim(),
);
if (!Number.isInteger(behindBy)) {
  throw new Error(`Не удалось узнать, отстала ли ветка PR #${pr.number} от ${pr.base.ref}.`);
}
if (behindBy > 0) {
  comment(
    pr.number,
    BEHIND_MARKER,
    `Все проверки зелёные, но ветка отстала от main на ${behindBy} коммит(а). ` +
      'Обновите ветку (rebase или merge с main) и запушьте — после новых зелёных проверок PR сольётся сам.',
  );
  console.log(`PR #${pr.number} отстал от main на ${behindBy} — ждём обновления ветки.`);
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

// Слияние токеном GITHUB_TOKEN не запускает workflow на push, а workflow_dispatch — запускает.
// Стенд — это main: слияние в другую ветку (например, production) стенд не трогает.
if (pr.base.ref === 'main' && needsStagingMigration(files)) {
  try {
    gh('workflow', 'run', 'migrate-test.yml', '--repo', REPO, '--ref', 'main');
    console.log('Запущены миграции стенда (migrate-test.yml).');
  } catch {
    console.log(
      '::warning::PR слит, но миграции стенда не запустились: Actions → Migrate test → Run workflow (main).',
    );
  }
}
