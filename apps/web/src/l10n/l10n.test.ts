import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { fieldErrorText, makeErrorText, makeTranslate } from './translate';

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

describe('ошибка ответа API на экране', () => {
  const errorText = makeErrorText({ 'err.inn_dup': 'Такой ИНН уже есть' });

  it('текст словаря по коду, а если ключа нет — текст сервера', () => {
    expect(errorText({ code: 'inn_dup', message: 'ИНН занят' })).toBe('Такой ИНН уже есть');
    expect(errorText({ code: 'slug_taken', message: 'Адрес занят' })).toBe('Адрес занят');
  });

  it('подстановки из details и вариант текста; не хватает значения — текст сервера', () => {
    const text = makeErrorText({
      'err.login_locked': 'Вход закрыт на {minutes} минут, до {time}.',
      'err.user_blocked': 'Обратитесь к владельцу',
      'err.user_blocked.platform_admin': 'Обратитесь к администратору',
    });
    expect(
      text({
        code: 'login_locked',
        message: 'сервер',
        details: { lockedUntil: '2026-10-26T08:35:00.000Z', minutes: 15, time: '14:35' },
      }),
    ).toBe('Вход закрыт на 15 минут, до 14:35.');
    expect(text({ code: 'login_locked', message: 'сервер', details: { minutes: 15 } })).toBe(
      'сервер',
    );
    expect(
      text({ code: 'user_blocked', message: 'с', details: { variant: 'platform_admin' } }),
    ).toBe('Обратитесь к администратору');
    expect(text({ code: 'user_blocked', message: 'с', details: { variant: 'другой' } })).toBe(
      'Обратитесь к владельцу',
    );
    expect(text({ code: 'user_blocked', message: 'с', details: ['не объект'] })).toBe(
      'Обратитесь к владельцу',
    );
  });
});

describe('ошибка поля формы', () => {
  const t = makeTranslate({
    'auth.err.short': 'Пароль короче {min} символов',
    'auth.err.code': 'Введите код из Telegram: {code} цифр',
  });

  it('сообщение схемы — ключ словаря; числа правил подставляются; нет ошибки — пусто', () => {
    expect(fieldErrorText(t, 'auth.err.short')).toBe('Пароль короче 8 символов');
    expect(fieldErrorText(t, 'auth.err.code')).toBe('Введите код из Telegram: 6 цифр');
    expect(fieldErrorText(t, undefined)).toBeUndefined();
  });
});

// Первый запуск ESLint с проверкой типов занимает несколько секунд, под нагрузкой — больше пяти.
describe('линтер: в коде сайта нет русских строк вне словаря', { timeout: 30_000 }, () => {
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
