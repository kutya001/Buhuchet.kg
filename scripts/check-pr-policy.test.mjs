import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPrPolicy } from './check-pr-policy.mjs';

const body = (spec, sec) =>
  `## Что сделано\nКаркас.\n\n## Отчёт ревьюеров\n- spec-reviewer: ${spec}\n- security-reviewer: ${sec}\n\n## Вопросы к ТЗ\nНет.`;

test('оба вывода на месте и без критичного — проходит', () => {
  assert.deepEqual(checkPrPolicy(body('соответствует', 'замечаний нет; критично: нет')), []);
});

test('нет раздела — ошибка', () => {
  assert.equal(checkPrPolicy('## Что сделано\nЧто-то').length, 1);
  assert.equal(checkPrPolicy(undefined).length, 1);
});

test('нет вывода агента или заглушка из шаблона — ошибка', () => {
  const problems = checkPrPolicy('## Отчёт ревьюеров\n- spec-reviewer: <вердикт и главное>\n');
  assert.equal(problems.length, 2);
});

test('вывод без вердикта («в работе») — ошибка', () => {
  const problems = checkPrPolicy(body('в работе', 'в работе'));
  assert.equal(problems.length, 2);
  assert.match(problems[0], /нет вердикта/);
});

test('замечания без критичного — проходит', () => {
  assert.deepEqual(
    checkPrPolicy(body('соответствует, мелочи в отчёте', 'есть замечания, только желательные')),
    [],
  );
});

test('критичное или несоответствие — ошибка', () => {
  const problems = checkPrPolicy(
    body(
      'не соответствует: нет теста блокировки',
      'есть замечания, критично: утечка между организациями',
    ),
  );
  assert.equal(problems.length, 2);
});
