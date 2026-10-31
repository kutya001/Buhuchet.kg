#!/usr/bin/env node
// Автослияние PR (вызывается из .github/workflows/automerge.yml после каждого успешно завершённого
// workflow CI и PR policy).
import { execFileSync } from 'node:child_process';
import { blockingCheck, mergeGuardFiles, needsStagingMigration } from './protected-paths.mjs';

const REQUIRED_CHECKS = ['check', 'docker-e2e', 'pr-policy'];
const BEHIND_MARKER = '<!-- automerge:behind -->';
const GUARD_MARKER = '<!-- automerge:guards -->';
// Сколько раз и через сколько перечитать проверки, если API отстаёт от завершённого workflow.
const STALE_RETRIES = 6;
const STALE_DELAY_MS = 10_000;
// TRIGGER_SUITE_ID — набор проверок workflow, успешное завершение которого запустило автослияние.
const { REPO, HEAD_SHA, TRIGGER_SUITE_ID } = process.env;

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

// Последний запуск каждой обязательной проверки должен быть успешным. Проверка ещё идёт в другом
// workflow — выйти: его завершение снова запустит автослияние. Workflow проверки уже завершён (это
// запустивший или найденный по API), а API отдаёт её прежнее состояние — перечитать: следующего
// события не будет.
const finishedSuites = new Set([TRIGGER_SUITE_ID].filter(Boolean).map(String));
let blocking;
let retried = false;
for (let attempt = 0; ; attempt++) {
  const runs = api(`repos/${REPO}/commits/${HEAD_SHA}/check-runs?per_page=100`).check_runs;
  blocking = blockingCheck(runs, REQUIRED_CHECKS, finishedSuites);
  const suite = blocking?.latest?.check_suite?.id;
  if (blocking && !blocking.stale && blocking.latest?.status !== 'completed' && suite != null) {
    // Проверка другого workflow: завершён ли он на самом деле (CI и PR policy закончились почти разом).
    const owner = api(`repos/${REPO}/actions/runs?check_suite_id=${suite}&per_page=1`)
      .workflow_runs?.[0];
    if (owner?.status === 'completed') {
      finishedSuites.add(String(suite));
      blocking = blockingCheck(runs, REQUIRED_CHECKS, finishedSuites);
    }
  }
  if (!blocking?.stale || attempt === STALE_RETRIES) break;
  retried = true;
  console.log(
    `Проверка ${blocking.name} уже завершилась, но GitHub отдаёт ` +
      `${blocking.latest.status}/${blocking.latest.conclusion} — перечитываем через ${STALE_DELAY_MS / 1000} с.`,
  );
  await new Promise((resolve) => setTimeout(resolve, STALE_DELAY_MS));
}
if (blocking) {
  const { name, latest, stale } = blocking;
  const state = latest ? `${latest.status}/${latest.conclusion}` : 'ещё нет';
  if (stale) {
    // Запуск красный, чтобы его было видно: Actions → Automerge → Re-run.
    throw new Error(
      `Проверка ${name} завершилась, но GitHub так и отдаёт ${state}. Перезапустите Automerge (Re-run).`,
    );
  }
  console.log(`Проверка ${name}: ${state} — ждём.`);
  process.exit(0);
}
// Пока перечитывали (до минуты), PR могли закрыть, сделать черновиком, поставить hold или запушить.
if (retried) {
  const fresh = api(`repos/${REPO}/pulls/${pr.number}`);
  if (
    fresh.state !== 'open' ||
    fresh.draft ||
    fresh.head.sha !== HEAD_SHA ||
    fresh.labels.some((l) => l.name === 'hold')
  ) {
    console.log(`PR #${pr.number} изменился, пока перечитывали проверки, — не сливаем.`);
    process.exit(0);
  }
}

// Ветка должна содержать свежий main: иначе зелёные проверки не про то, что окажется в main.
// Нужно только число: полный ответ сравнения (коммиты и патчи ветки) бывает больше мегабайта.
const behindOut = gh(
  'api',
  '-H',
  'Accept: application/vnd.github+json',
  `repos/${REPO}/compare/${pr.base.ref}...${HEAD_SHA}`,
  '--jq',
  '.behind_by',
).trim();
// Пустой вывод (поля нет или null) — тоже непонятный ответ: без числа не сливаем.
if (!/^\d+$/.test(behindOut)) {
  throw new Error(`Не удалось узнать, отстала ли ветка PR #${pr.number} от ${pr.base.ref}.`);
}
const behindBy = Number(behindOut);
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
