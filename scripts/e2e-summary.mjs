// Сводка сквозных тестов машины CI по json-отчётам Playwright (playwright-report/<запуск>.json):
// что упало, что прошло только со второй попытки, что не запускалось и какой запуск оборван без отчёта.
// Пишется в журнал задания и в сводку прогона GitHub ($GITHUB_STEP_SUMMARY); тест со второй попытки
// ещё и предупреждением на странице PR — он не зелёный (docs/typical-mistakes.md № 10, 18).
// Запуск: node scripts/e2e-summary.mjs <папка отчётов> <машина> <запуск>...
// Всегда выходит с кодом 0: это только сводка, красным задание делает сам шаг тестов.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Цвета терминала в тексте ошибки (ESC [ … m). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** Начало ошибки (до трёх строк) без цветов, одной строкой не длиннее 240 знаков. */
function firstLine(text) {
  const line = String(text ?? '')
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
  return line.length > 240 ? `${line.slice(0, 239)}…` : line;
}

/** Все тесты отчёта: файл:строка, название с describe, проект, итог и попытки. */
function collect(report) {
  const out = [];
  // Верхний уровень — файлы (их название — имя файла), ниже — describe.
  const walk = (suite, path, top) => {
    const here = !top && suite.title ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const failed = results.filter((r) => r.status !== 'passed' && r.status !== 'skipped');
        // Шёл, когда шаг оборвали по пределу времени, — скорее всего, он и завис.
        const interrupted = results.some((r) => r.status === 'interrupted');
        // Не запускался: очередь не дошла (результатов нет) или тест последовательной группы после
        // упавшего соседа (результат «skipped», хотя тест не помечен пропущенным нарочно).
        const notRun =
          !interrupted &&
          test.status === 'skipped' &&
          (test.expectedStatus ? test.expectedStatus !== 'skipped' : results.length === 0);
        out.push({
          where: `${spec.file}:${spec.line}`,
          title: [...here, spec.title].join(' › '),
          project: test.projectName,
          status: test.status,
          notRun,
          interrupted,
          error: firstLine(failed[0]?.error?.message ?? failed[0]?.errors?.[0]?.message),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here, false);
  };
  for (const suite of report.suites ?? []) walk(suite, [], true);
  return out;
}

/**
 * Сводка машины. `reports` — { запуск: отчёт | null } (null — отчёта нет: запуск оборван).
 * Возвращает markdown и предупреждения для GitHub.
 */
export function summarize(machine, reports) {
  const lines = [`### Сквозные тесты, машина ${machine}`, ''];
  const annotations = [];
  const failed = [];
  const flaky = [];
  const notRun = [];
  const interrupted = [];
  let total = 0;
  for (const [run, report] of Object.entries(reports)) {
    if (!report) {
      lines.push(
        `- Запуск \`${run}\`: отчёта нет — запуск оборван (предел времени шага или машины) или не начинался.`,
      );
      continue;
    }
    for (const error of report.errors ?? []) {
      failed.push({
        run,
        where: '—',
        title: 'ошибка загрузки или прогона',
        project: run,
        error: firstLine(error.message),
      });
    }
    for (const t of collect(report)) {
      total += 1;
      const row = { run, ...t };
      if (t.interrupted) interrupted.push(row);
      else if (t.notRun) notRun.push(row);
      else if (t.status === 'unexpected') failed.push(row);
      else if (t.status === 'flaky') flaky.push(row);
    }
  }
  lines.push(
    `- Всего тестов в отчётах: ${total}; упало: ${failed.length}; со второй попытки: ${flaky.length}; не запускалось: ${notRun.length}${interrupted.length ? `; оборвано на ходу: ${interrupted.length}` : ''}.`,
    '',
  );
  const table = (title, rows, withError) => {
    if (rows.length === 0) return;
    lines.push(
      `**${title}**`,
      '',
      withError ? '| Тест | Проект | Ошибка |' : '| Тест | Проект |',
      withError ? '| --- | --- | --- |' : '| --- | --- |',
    );
    for (const r of rows) {
      const cell = (v) =>
        String(v)
          .replace(/[\r\n]+/g, ' ')
          .replace(/\|/g, '\\|');
      lines.push(
        withError
          ? `| ${cell(r.where)} ${cell(r.title)} | ${cell(r.project)} | ${cell(r.error)} |`
          : `| ${cell(r.where)} ${cell(r.title)} | ${cell(r.project)} |`,
      );
    }
    lines.push('');
  };
  table('Упало', failed, true);
  table(
    'Оборвано на ходу — шёл, когда шаг оборвали по пределу времени (вероятно, завис)',
    interrupted,
    false,
  );
  table('Прошло только со второй попытки — причину найти в этом же PR', flaky, true);
  table('Не запускалось — может упасть в следующем прогоне', notRun, false);
  for (const r of flaky) {
    // Команды GitHub: перевод строки и «%» в тексте — экранировать, иначе название теста станет новой командой.
    const escaped = `${r.where} [${r.project}] ${r.title} — ${r.error}`
      .replace(/%/g, '%25')
      .replace(/\r/g, '%0D')
      .replace(/\n/g, '%0A');
    annotations.push(`::warning title=Тест прошёл только со второй попытки::${escaped}`);
  }
  return { markdown: lines.join('\n'), annotations };
}

function main() {
  const [dir, machine, ...runs] = process.argv.slice(2);
  if (!dir || !machine || runs.length === 0) {
    console.error('Запуск: node scripts/e2e-summary.mjs <папка отчётов> <машина> <запуск>...');
    return;
  }
  const reports = {};
  for (const run of runs) {
    const file = join(dir, `${run}.json`);
    try {
      reports[run] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    } catch {
      reports[run] = null;
    }
  }
  const { markdown, annotations } = summarize(machine, reports);
  console.log(markdown);
  for (const a of annotations) console.log(a);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
