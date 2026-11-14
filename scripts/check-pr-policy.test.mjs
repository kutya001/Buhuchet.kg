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

test('PR Dependabot: отчёт привязан к коммиту головы PR', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const ok = body('соответствует', 'замечаний нет; критичных нет');
  const opts = { author: 'dependabot[bot]', headSha: sha };
  // Без SHA — ошибка; SHA старого коммита (Dependabot допушил новую версию) — тоже.
  assert.equal(checkPrPolicy(ok, opts).length, 1);
  assert.match(checkPrPolicy(ok, opts)[0], /проверенного коммита/);
  assert.equal(
    checkPrPolicy(
      `${ok.replace('## Вопросы', '- проверен коммит: fedcba9876\n\n## Вопросы')}`,
      opts,
    ).length,
    1,
  );
  // SHA головы целиком или от 7 знаков — проходит.
  for (const given of [sha, sha.slice(0, 7), sha.toUpperCase().slice(0, 12)]) {
    const withSha = ok.replace('## Вопросы', `- проверен коммит: ${given}\n\n## Вопросы`);
    assert.deepEqual(checkPrPolicy(withSha, opts), []);
  }
  // SHA вне раздела «Отчёт ревьюеров» не считается.
  assert.equal(checkPrPolicy(`${sha}\n${ok}`, opts).length, 1);
  // PR сессий Claude Code и людей — как раньше, без SHA.
  assert.deepEqual(checkPrPolicy(ok, { author: 'kutya001', headSha: sha }), []);
  assert.deepEqual(checkPrPolicy(ok), []);
});

test('PR Dependabot без отчёта: понятно, что ждёт проверки Claude, а не сломан', () => {
  const problems = checkPrPolicy('Bumps the actions group with 2 updates.', {
    author: 'dependabot[bot]',
    headSha: '0123456789abcdef0123456789abcdef01234567',
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ждёт проверки Claude/);
  assert.match(problems[0], /так и задумано/);
  // У остальных — прежний текст.
  assert.match(checkPrPolicy('Без отчёта', { author: 'kutya001' })[0], /нет раздела/);
});
