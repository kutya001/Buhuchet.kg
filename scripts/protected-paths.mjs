// Неприкосновенное в PR: что решает слияние, применённые миграции и копия спецификации.

// Файлы, от которых зависит, что и как сливается. PR с ними сам не сливается — только заказчик:
// иначе PR мог бы ослабить проверки сам себе (для pull_request GitHub берёт workflow из ветки PR).
const MERGE_GUARDS = [
  /^\.github\//,
  /^scripts\/(automerge|check-pr-policy|check-protected|protected-paths)\.mjs$/,
  /^\.claude\/(hooks\/|settings\.json$)/,
];

/** Файлы PR, из-за которых автослияние останавливается. */
export function mergeGuardFiles(files) {
  return files.filter((f) => MERGE_GUARDS.some((re) => re.test(f)));
}

/**
 * Какая обязательная проверка коммита мешает слиянию (`runs` — check_runs из API): первая, последний
 * запуск которой не зелёный, или null — все зелёные. Учитываются только проверки GitHub Actions:
 * чужое приложение не может «зажечь» зелёный check с тем же именем.
 *
 * `stale` — проверка из набора запустившего workflow (`triggerSuiteId`, событие workflow_run
 * completed с успехом): она уже зелёная, а API ещё несколько секунд отдаёт прежнее состояние. Такой
 * ответ надо перечитать, а не ждать: следующего события не будет, и PR встанет (так было с #145).
 */
export function blockingCheck(runs, required, triggerSuiteId) {
  for (const name of required) {
    const latest = runs
      .filter((r) => r.name === name && r.app?.slug === 'github-actions')
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0];
    if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') {
      const stale =
        Boolean(latest) &&
        Boolean(triggerSuiteId) &&
        String(latest.check_suite?.id) === String(triggerSuiteId);
      return { name, latest: latest ?? null, stale };
    }
  }
  return null;
}

/** Меняет ли PR базу или данные справочников: тогда после слияния нужны миграции стенда (migrate-test.yml). */
export function needsStagingMigration(files) {
  return files.some((f) => f.startsWith('packages/db/') || f.startsWith('spec/data/'));
}

/**
 * Ошибки в изменениях PR относительно main (строки `git diff --name-status --no-renames`):
 * миграция из main уже применена — её нельзя менять или удалять, только добавить новую;
 * spec/ меняется только синхронизацией с прототипом (`pnpm spec:sync`), которая обновляет spec/SOURCE.json.
 */
export function protectedChanges(nameStatus) {
  const changes = nameStatus
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split('\t');
      return { status: status[0], file };
    });
  const problems = [];
  for (const { status, file } of changes) {
    if (
      file.startsWith('packages/db/migrations/') &&
      status !== 'A' &&
      file !== 'packages/db/migrations/meta/_journal.json'
    ) {
      problems.push(
        `${file}: применённая миграция ${status === 'D' ? 'удалена' : 'изменена'}. Создайте новую миграцию поверх.`,
      );
    }
  }
  const spec = changes.filter((c) => c.file.startsWith('spec/'));
  if (spec.length && !spec.some((c) => c.file === 'spec/SOURCE.json')) {
    problems.push(
      `spec/ изменена вручную (${spec.length} файл(ов), например ${spec[0].file}). spec/ обновляется только командой pnpm spec:sync.`,
    );
  }
  return problems;
}
