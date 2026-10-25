// Перед командой: запрет опасного — force-push, push в main, drizzle-kit push, команды к рабочей базе,
// удаление данных, выкладка на рабочий сайт мимо выпуска.
import { block, readInput } from './lib.mjs';

const command = readInput().tool_input?.command ?? '';
const c = command.replace(/\s+/g, ' ');
// git push, в том числе git -C <папка> push и git -c <настройка> push.
const GIT_PUSH = String.raw`\bgit(\s+-[Cc]\s+\S+)*\s+push\b`;

const rules = [
  [
    new RegExp(
      `${GIT_PUSH}[^;&|]*(\\s--force\\b|\\s-[a-zA-Z]*f[a-zA-Z]*\\b|\\s--force-with-lease\\b|\\s--mirror\\b|\\s\\+\\S)`,
    ),
    'git push --force запрещён: история веток не переписывается.',
  ],
  [
    new RegExp(`${GIT_PUSH}[^;&|]*(\\s(\\S+:)?(refs\\/heads\\/)?main\\b(?![\\w/-])|\\s--all\\b)`),
    'В main напрямую не пушим: только PR со всеми зелёными проверками.',
  ],
  [
    /\bdrizzle-kit\s+push\b|\bdb:push\b/,
    'drizzle-kit push запрещён: схема меняется только миграциями (pnpm db:generate → pnpm db:migrate).',
  ],
  [
    /\b[\w-]+\.supabase\.(co|com)\b|pooler\.supabase|\bprod(uction)?[_-]?database/i,
    'Команды к базе Supabase (стенд, рабочий сайт) запрещены: Claude Code работает с локальным PostgreSQL; рабочую базу меняет только GitHub Actions.',
  ],
  [
    /\bdrop\s+database\b(?!\s+(if\s+exists\s+)?\\?"?test_)/i,
    'DROP DATABASE запрещён (кроме временных баз тестов test_*).',
  ],
  [
    /\b(drop\s+(schema|table)|truncate\s+(table\s+)?\w)/i,
    'DROP SCHEMA, DROP TABLE и TRUNCATE запрещены: схема и данные меняются только миграцией.',
  ],
  [
    /\bdelete\s+from\s+[\w."]+\s*(;|'|"|\\|$)/i,
    'DELETE без WHERE запрещён: данные удаляются только миграцией.',
  ],
  [
    /\brm\s+(-\w*\s+)*\S*(spec|packages\/db\/migrations)(\/|\s|$)/,
    'Удалять spec/ и миграции нельзя.',
  ],
  [
    /\bvercel\b[^;&|]*(\s--prod\b|\spromote\b|\srollback\b)|\bvercel\s+env\s+(add|rm|pull)\b/,
    'Рабочий сайт и его настройки меняет только выпуск по команде заказчика «выпускай» (GitHub Actions).',
  ],
];

for (const [re, reason] of rules) {
  if (re.test(c)) block(`Команда остановлена хуком: ${reason}`);
}
process.exit(0);
