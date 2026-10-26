import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from './translate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('t: текст из словаря', () => {
  const t = makeTranslate({
    'health.title': 'Проверка работы системы',
    'health.check_ok': '{name}: доступна',
  });

  it('берёт текст по ключу и подставляет значения', () => {
    expect(t('health.title')).toBe('Проверка работы системы');
    expect(t('health.check_ok', { name: 'База данных' })).toBe('База данных: доступна');
  });

  it('ключа нет в словаре — показывает ключ, а не пустоту', () => {
    expect(t('health.state')).toBe('health.state');
  });
});

describe('линтер: в коде сайта нет русских строк вне словаря', () => {
  const eslint = new ESLint({ cwd: root });
  const problems = async (code: string, file: string) => {
    const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
    return result!.messages.map((m) => m.ruleId);
  };

  it('строка, шаблон и текст в разметке с русскими буквами — ошибка', async () => {
    expect(await problems("export const x = 'Сохранить';\n", 'apps/web/app/x.ts')).toEqual([
      'no-restricted-syntax',
    ]);
    expect(
      await problems('export const x = (n: number) => `Всего ${n}`;\n', 'apps/web/src/x.ts'),
    ).toEqual(['no-restricted-syntax']);
    expect(
      await problems('export const X = () => <p>Привет</p>;\n', 'packages/ui/src/x.tsx'),
    ).toEqual(['no-restricted-syntax']);
  });

  it('ключ словаря, комментарий и название теста — можно', async () => {
    const code = "// Комментарий по-русски\nexport const key = 'health.title';\n";
    expect(await problems(code, 'apps/web/app/x.ts')).toEqual([]);
    expect(
      await problems(
        "import { it } from 'vitest';\nit('проверка', () => {});\n",
        'apps/web/src/x.test.ts',
      ),
    ).toEqual([]);
  });
});
