#!/usr/bin/env node
// Проверка PR: в описании есть «Отчёт ревьюеров» с выводами spec-reviewer и security-reviewer,
// и ни один не нашёл критичного. Без этого PR не сливается (человека-разработчика нет).
// Вердикты — как в инструкциях агентов (.claude/agents): spec-reviewer — «соответствует» /
// «не соответствует», security-reviewer — «замечаний нет» / «есть замечания» (+ «критично: …»).

const VERDICTS = {
  'spec-reviewer': {
    ok: (t) => /(^|[^а-яё])соответствует/i.test(t),
    stop: (t) => /не\s+соответствует/i.test(t),
  },
  'security-reviewer': {
    ok: (t) => /замечаний\s+нет|есть\s+замечания/i.test(t),
    // «критично: …» останавливает, кроме «критично: нет» и «критичных нет».
    stop: (t) =>
      [...t.matchAll(/критичн[а-яё]*[\s:—-]*([а-яё]*)/gi)].some(
        (m) => m[1].toLowerCase() !== 'нет',
      ),
  },
};

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
  for (const [agent, verdict] of Object.entries(VERDICTS)) {
    const line = new RegExp(`^\\s*[-*]\\s*\\**${agent}\\**\\s*:\\s*(.+)$`, 'mi').exec(section);
    const found = line?.[1].trim() ?? '';
    if (!found || /^<.*>$/.test(found)) {
      problems.push(`Нет вывода агента ${agent}: строка «- ${agent}: <вердикт и главное>».`);
    } else if (verdict.stop(found)) {
      problems.push(
        `${agent} нашёл то, что нельзя сливать: «${found}». Исправьте и запустите агента снова.`,
      );
    } else if (!verdict.ok(found)) {
      problems.push(`У ${agent} нет вердикта из инструкции агента: «${found}».`);
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
