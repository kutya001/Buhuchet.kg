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
