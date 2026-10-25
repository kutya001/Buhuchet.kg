import { defineConfig } from 'drizzle-kit';

// Только генерация SQL-миграций из схемы: `pnpm db:generate`. Применяет миграции `pnpm db:migrate`,
// `drizzle-kit push` запрещён (хук Claude Code и правило в CLAUDE.md).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
