import { loadDatabaseConfig, runningInCi } from '@buhuchet/adapters/config';
import { describe, expect, it } from 'vitest';

// В CI тесты API идут с пулом из одного соединения (п. О-53): запрос к пулу из открытой транзакции
// там сразу виснет, и тест падает. Переменная доходит до тестов только через turbo.json
// (`globalPassThroughEnv`) — тест краснеет, если её снова потеряют.
describe('пул тестов API', () => {
  it.runIf(runningInCi())('в CI — одно соединение', () => {
    expect(loadDatabaseConfig().TEST_DATABASE_POOL_MAX).toBe(1);
  });
});
