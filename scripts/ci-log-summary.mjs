// Короткая сводка сохранённого журнала задания GitHub Actions — для сессии и агента ci-triage
// (скилл ci-red, docs/decisions.md п. О-53). Журнал машины сквозных тестов — десятки тысяч строк,
// большая часть — журналы контейнеров; здесь остаются только строки о падениях, повторах, пределах
// и сводка машины (scripts/e2e-summary.mjs).
// Вход — файл: текст журнала или JSON, который вернул get_job_logs (поле logs_content или logs[]).
// Запуск: node scripts/ci-log-summary.mjs <файл>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Строки журналов контейнеров (docker compose logs): «web-1  | …», «postgres-1  | …». */
const CONTAINER = /^(worker|web|db|minio|app|postgres|fake-telegram)-\d+\s+\|/;
/** Что важно для разбора: падения, повторы, пределы, итоги Playwright и сводка машины. */
const IMPORTANT = new RegExp(
  [
    '✘',
    '\\bfailed\\b',
    '\\bflaky\\b',
    'passed \\(',
    'did not run',
    '\\d+ skipped',
    'Error:',
    'Timeout',
    'timed out',
    'exceeded',
    '##\\[error\\]',
    '::error',
    '::warning',
    '##\\[warning\\]',
    'interrupted',
    'Received',
    'Expected',
    '^\\s*\\d+\\) \\[',
    '^### Сквозные тесты',
    '^- (Всего|Запуск)',
    '^\\| ',
    'мин из \\d+',
    'idle in transaction',
    'The operation was canceled',
    'cancel',
  ].join('|'),
  'i',
);

/** Текст журнала из файла: сам текст или JSON get_job_logs. */
export function logText(raw) {
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data?.logs)) return data.logs.map((l) => l?.logs_content ?? '').join('\n');
    if (typeof data?.logs_content === 'string') return data.logs_content;
  } catch {
    // не JSON — обычный текст журнала
  }
  return raw;
}

/** Важные строки журнала по порядку, без повторов, без меток времени и журналов контейнеров. */
export function summarizeLog(raw, { maxLine = 400 } = {}) {
  const seen = new Set();
  const out = [];
  for (const line of logText(raw).split('\n')) {
    const body = line.replace(/^\S+Z /, '').replace(/\u001b\[[0-9;]*m/g, '');
    if (CONTAINER.test(body) || !IMPORTANT.test(body)) continue;
    const short = body.length > maxLine ? `${body.slice(0, maxLine - 1)}…` : body;
    if (seen.has(short)) continue;
    seen.add(short);
    out.push(short);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2];
  if (!file) {
    console.error('Запуск: node scripts/ci-log-summary.mjs <файл журнала>');
    process.exit(1);
  }
  for (const line of summarizeLog(readFileSync(file, 'utf8'))) console.log(line);
}
