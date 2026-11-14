// Короткая сводка сохранённого журнала задания GitHub Actions — для сессии и агента ci-triage
// (скилл ci-red, docs/decisions.md п. О-53). Журнал машины сквозных тестов — десятки тысяч строк,
// большая часть — журналы контейнеров; здесь остаются строки о падениях, повторах, пределах, сводка
// машины (scripts/e2e-summary.mjs) и из контейнеров — только ошибки сайта и базы (не больше 60 строк).
// Вход — файл: текст журнала или JSON, который вернул get_job_logs (поле logs_content или logs[]).
// Запуск: node scripts/ci-log-summary.mjs <файл>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Цвета терминала (ESC [ … m). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
/** Строки журналов контейнеров (docker compose logs): «web-1  | …», «postgres-1  | …». */
const CONTAINER = /^(worker|web|db|minio|app|postgres|fake-telegram)-\d+\s+\|/;
/** Ошибки в журналах контейнеров: ошибка и сбой сайта (pino 50 и 60), ошибки, блокировки и обрывы базы. */
const CONTAINER_IMPORTANT =
  /"level":(50|60)\b|\b(ERROR|FATAL|PANIC):|idle[- ]in[- ]transaction|deadlock|terminating connection|canceling statement/;
/** Сколько строк контейнеров оставить: остальные — в полном журнале. */
const CONTAINER_LIMIT = 60;
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

/**
 * Важные строки журнала по порядку, без повторов, меток времени и цветов. Из журналов контейнеров —
 * только ошибки сайта и базы, не больше `containerLimit` строк (о лишних — строка в конце).
 */
export function summarizeLog(raw, { maxLine = 400, containerLimit = CONTAINER_LIMIT } = {}) {
  const seen = new Set();
  const out = [];
  let containerKept = 0;
  let containerSkipped = 0;
  for (const line of logText(raw).split('\n')) {
    const body = line.replace(/^\S+Z /, '').replace(ANSI, '');
    const container = CONTAINER.test(body);
    if (container ? !CONTAINER_IMPORTANT.test(body) : !IMPORTANT.test(body)) continue;
    const short = body.length > maxLine ? `${body.slice(0, maxLine - 1)}…` : body;
    if (seen.has(short)) continue;
    seen.add(short);
    if (container && containerKept >= containerLimit) {
      containerSkipped += 1;
      continue;
    }
    if (container) containerKept += 1;
    out.push(short);
  }
  if (containerSkipped > 0) {
    out.push(`… ещё ${containerSkipped} строк ошибок контейнеров — в полном журнале.`);
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
