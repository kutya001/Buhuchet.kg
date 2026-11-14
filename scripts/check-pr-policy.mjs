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

// PR Dependabot ведёт не сессия, а сам Dependabot: он может допушить в открытый PR новую версию уже после
// ревью. Поэтому его отчёт привязан к коммиту: в разделе должен быть SHA головы PR (от 7 знаков) — после
// нового пуша pr-policy снова красный, пока отчёт не обновят (docs/decisions.md п. О-40).
const UNATTENDED_AUTHORS = ['dependabot[bot]'];

export function checkPrPolicy(body, { author, headSha } = {}) {
  const problems = [];
  const text = body ?? '';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s*Отчёт ревьюеров\s*$/.test(l));
  if (start === -1) {
    // PR Dependabot приходит без отчёта: красный pr-policy у него — норма, пока его не проверил Claude
    // (скилл dependabot-review), а не поломка (п. О-53).
    if (UNATTENDED_AUTHORS.includes(author)) {
      return [
        `PR от ${author} ждёт проверки Claude (скилл dependabot-review): сессия допишет «## Отчёт ревьюеров» ` +
          'со строкой «- проверен коммит: <SHA головы PR>»; потом PR с пакетами сливается сам, PR с .github/ сливает заказчик. ' +
          'Пока отчёта нет, pr-policy красный — так и задумано.',
      ];
    }
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
  if (UNATTENDED_AUTHORS.includes(author)) {
    const sha = (headSha ?? '').toLowerCase();
    const reviewed = [...section.matchAll(/\b[0-9a-f]{7,40}\b/gi)].some(
      (m) => sha && sha.startsWith(m[0].toLowerCase()),
    );
    if (!reviewed) {
      problems.push(
        `PR от ${author}: в «Отчёте ревьюеров» нет проверенного коммита — строка «- проверен коммит: <SHA головы PR>». ` +
          'После нового пуша в PR ревью и отчёт повторяются.',
      );
    }
  }
  return problems;
}

if (process.argv[1]?.endsWith('check-pr-policy.mjs')) {
  const labels = (process.env.PR_LABELS ?? '').split(',').filter(Boolean);
  const problems = checkPrPolicy(process.env.PR_BODY, {
    author: process.env.PR_AUTHOR,
    headSha: process.env.PR_HEAD_SHA,
  });
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log(
    `Отчёт ревьюеров на месте.${labels.includes('hold') ? ' Метка hold: автослияние остановлено.' : ''}`,
  );
}
