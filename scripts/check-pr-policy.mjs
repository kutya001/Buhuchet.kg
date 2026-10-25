#!/usr/bin/env node
// Проверка PR: в описании есть «Отчёт ревьюеров» с выводами spec-reviewer и security-reviewer,
// и ни один не нашёл критичного. Без этого PR не сливается (человека-разработчика нет).

export function checkPrPolicy(body) {
  const problems = [];
  const text = body ?? '';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s*Отчёт ревьюеров\s*$/.test(l));
  if (start === -1) {
    return [
      'В описании PR нет раздела «## Отчёт ревьюеров» (выводы агентов spec-reviewer и security-reviewer).',
    ];
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  const section = (end === -1 ? rest : rest.slice(0, end)).join('\n');
  for (const agent of ['spec-reviewer', 'security-reviewer']) {
    const line = new RegExp(`^\\s*[-*]\\s*\\**${agent}\\**\\s*:\\s*(.+)$`, 'mi').exec(section);
    if (!line || /^<.*>$/.test(line[1].trim())) {
      problems.push(`Нет вывода агента ${agent}: строка «- ${agent}: <вердикт и главное>».`);
    } else if (/не соответствует|критично(?!\s*:?\s*нет)/i.test(line[1])) {
      problems.push(
        `${agent} нашёл то, что нельзя сливать: «${line[1].trim()}». Исправьте и запустите агента снова.`,
      );
    }
  }
  return problems;
}

if (process.argv[1]?.endsWith('check-pr-policy.mjs')) {
  const labels = (process.env.PR_LABELS ?? '').split(',').filter(Boolean);
  const problems = checkPrPolicy(process.env.PR_BODY);
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log(
    `Отчёт ревьюеров на месте.${labels.includes('hold') ? ' Метка hold: автослияние остановлено.' : ''}`,
  );
}
