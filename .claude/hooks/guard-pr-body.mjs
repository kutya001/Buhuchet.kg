// Перед созданием или правкой PR: описание проверяется той же функцией, что и `pr-policy` в CI
// (scripts/check-pr-policy.mjs). Красный pr-policy после открытия PR — лишний круг до слияния: за пакет 14.11
// их было 9 (docs/typical-mistakes.md № 29, 35, 46; скилл pr-body).
import { checkPrPolicy } from '../../scripts/check-pr-policy.mjs';
import { block, readInput } from './lib.mjs';

const input = readInput().tool_input ?? {};
// Описание не меняется (правка заголовка, состояния, метки) — проверять нечего.
if (typeof input.body !== 'string') process.exit(0);
// Только PR этого репозитория и только в main: на них смотрят pr-policy и автослияние.
if (typeof input.repo === 'string' && input.repo.toLowerCase() !== 'buhuchet.kg') process.exit(0);
if (typeof input.base === 'string' && input.base !== 'main') process.exit(0);

const problems = checkPrPolicy(input.body);
if (problems.length) {
  block(
    `Описание PR не пройдёт pr-policy — поправьте до отправки (скилл pr-body):\n- ${problems.join('\n- ')}`,
  );
}
process.exit(0);
