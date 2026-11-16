import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Заготовки файлов для тестов окна просмотра — не код продукта.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/files/view/fixtures.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
