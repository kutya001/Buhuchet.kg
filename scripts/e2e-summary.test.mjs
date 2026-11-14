import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize } from './e2e-summary.mjs';

const spec = (title, line, status, results, expectedStatus = 'passed') => ({
  title,
  file: 'auth.spec.ts',
  line,
  tests: [{ projectName: 'desktop', expectedStatus, status, results }],
});

// Форма json-отчёта Playwright: файл → describe → тесты; у не запускавшегося теста результатов нет.
const report = {
  errors: [],
  suites: [
    {
      title: 'auth.spec.ts',
      file: 'auth.spec.ts',
      specs: [],
      suites: [
        {
          title: 'Вход',
          file: 'auth.spec.ts',
          specs: [
            spec('проходит', 3, 'expected', [{ status: 'passed' }]),
            spec('падает', 4, 'unexpected', [
              {
                status: 'failed',
                error: { message: '\u001b[31mError: нет кнопки\u001b[39m\n\nстрока' },
              },
              { status: 'failed', error: { message: 'Error: нет кнопки' } },
            ]),
            spec('через раз', 5, 'flaky', [
              { status: 'timedOut', error: { message: 'Test timeout of 30000ms exceeded.' } },
              { status: 'passed' },
            ]),
            spec('пропущен нарочно', 6, 'skipped', [{ status: 'skipped' }], 'skipped'),
            spec('не дошла очередь', 7, 'skipped', []),
            // Последовательная группа: после упавшего соседа — «skipped», хотя тест не пропущен нарочно.
            spec('после соседа', 8, 'skipped', [{ status: 'skipped' }]),
            spec('завис', 9, 'skipped', [{ status: 'interrupted' }]),
          ],
        },
      ],
    },
  ],
};

test('сводка: упавшие, со второй попытки и не запускавшиеся — по отдельности', () => {
  const { markdown, annotations } = summarize('2/6', { main: report });
  assert.match(
    markdown,
    /Всего тестов в отчётах: 7; упало: 1; со второй попытки: 1; не запускалось: 2; оборвано на ходу: 1\./,
  );
  assert.match(
    markdown,
    /\| auth\.spec\.ts:4 Вход › падает \| desktop \| Error: нет кнопки · строка \|/,
  );
  assert.match(markdown, /auth\.spec\.ts:5 Вход › через раз \| desktop \| Test timeout/);
  assert.match(markdown, /\| auth\.spec\.ts:7 Вход › не дошла очередь \| desktop \|/);
  assert.match(markdown, /\| auth\.spec\.ts:8 Вход › после соседа \| desktop \|/);
  assert.match(
    markdown,
    /\*\*Оборвано на ходу[^\n]*\*\*\n\n[^\n]*\n[^\n]*\n\| auth\.spec\.ts:9 Вход › завис \|/,
  );
  assert.doesNotMatch(markdown, /пропущен нарочно/);
  assert.ok(!markdown.includes(String.fromCharCode(27)));
  assert.equal(annotations.length, 1);
  assert.match(
    annotations[0],
    /^::warning title=Тест прошёл только со второй попытки::auth\.spec\.ts:5 \[desktop\]/,
  );
});

test('нет отчёта запуска — сказано, что запуск оборван', () => {
  const { markdown } = summarize('6/6', { main: report, 'mobile-shared': null });
  assert.match(markdown, /Запуск `mobile-shared`: отчёта нет — запуск оборван/);
});

test('ошибка загрузки тестов — в «Упало»', () => {
  const { markdown } = summarize('1/6', {
    main: { errors: [{ message: 'Error: Cannot find module ./helpers' }], suites: [] },
  });
  assert.match(markdown, /упало: 1/);
  assert.match(markdown, /Cannot find module/);
});

test('всё зелёное — без таблиц и предупреждений', () => {
  const green = {
    errors: [],
    suites: [{ title: 'a.spec.ts', specs: [spec('ок', 1, 'expected', [{ status: 'passed' }])] }],
  };
  const { markdown, annotations } = summarize('4/6', { main: green });
  assert.match(markdown, /упало: 0; со второй попытки: 0; не запускалось: 0/);
  assert.doesNotMatch(markdown, /\*\*Упало\*\*/);
  assert.deepEqual(annotations, []);
});

test('перевод строки в названии теста не становится новой командой GitHub', () => {
  const tricky = {
    errors: [],
    suites: [
      {
        title: 'a.spec.ts',
        specs: [
          spec('x\n::add-mask::y 100%', 1, 'flaky', [
            { status: 'failed', error: { message: 'Error: раз' } },
            { status: 'passed' },
          ]),
        ],
      },
    ],
  };
  const { markdown, annotations } = summarize('3/6', { main: tricky });
  assert.equal(annotations.length, 1);
  assert.ok(!annotations[0].includes('\n'));
  assert.match(annotations[0], /x%0A::add-mask::y 100%25/);
  assert.ok(markdown.split('\n').every((l) => !l.startsWith('::')));
});
