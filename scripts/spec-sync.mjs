#!/usr/bin/env node
// Обновить spec/ — копию ТЗ, справочников, JSON-данных и файлов прототипа из репозитория прототипа.
// spec/ руками не правится (хук Claude Code запрещает); обновляется только этим скриптом.
//
//   pnpm spec:sync                      — main из github.com/kutya001/DevBuhUchet.kg
//   pnpm spec:sync --ref <ветка|коммит>
//   pnpm spec:sync --from ../devbuhuchet.kg [--ref <коммит>]   — из локальной копии прототипа

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = path.join(ROOT, 'spec');
const REPOSITORY = 'https://github.com/kutya001/DevBuhUchet.kg';

/** Что копируется: [путь в прототипе, путь в spec/]. */
export const SPEC_FILES = [
  ['docs/ТЗ Buhuchet.kg.md', 'ТЗ Buhuchet.kg.md'],
  ['docs/Справочники платформы (исчерпывающие).md', 'Справочники платформы (исчерпывающие).md'],
  ['docs/ГКЭД 2022 (справочник).md', 'ГКЭД 2022 (справочник).md'],
  ['docs/Основные паттерны разработки.md', 'Основные паттерны разработки.md'],
  ['data', 'data'],
  ['index.html', 'prototype/index.html'],
  ['build.py', 'prototype/build.py'],
  ['src', 'prototype/src'],
  ['vendor', 'prototype/vendor'],
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function main() {
  const from = arg('--from');
  const ref = arg('--ref') ?? (from ? 'HEAD' : 'main');
  const work = mkdtempSync(path.join(tmpdir(), 'spec-sync-'));
  try {
    const checkout = path.join(work, 'proto');
    mkdirSync(checkout);
    git(checkout, 'init', '-q');
    // Из локальной копии можно указать короткий коммит: сначала превращаем его в полный.
    const wanted = from ? git(path.resolve(from), 'rev-parse', '--verify', `${ref}^{commit}`) : ref;
    git(checkout, 'fetch', '-q', '--depth', '1', from ? path.resolve(from) : REPOSITORY, wanted);
    git(checkout, 'checkout', '-q', 'FETCH_HEAD');
    const commit = git(checkout, 'rev-parse', 'HEAD');

    for (const [src] of SPEC_FILES) {
      if (!existsSync(path.join(checkout, src)))
        throw new Error(`В прототипе нет «${src}» (${commit})`);
    }
    rmSync(SPEC, { recursive: true, force: true });
    mkdirSync(SPEC, { recursive: true });
    for (const [src, dst] of SPEC_FILES) {
      cpSync(path.join(checkout, src), path.join(SPEC, dst), { recursive: true });
    }
    writeFileSync(
      path.join(SPEC, 'SOURCE.json'),
      JSON.stringify(
        { repository: REPOSITORY, ref, commit, syncedAt: new Date().toISOString() },
        null,
        2,
      ) + '\n',
    );
    writeFileSync(path.join(SPEC, 'README.md'), readme(commit));
    console.log(
      `spec/ обновлена из ${REPOSITORY} @ ${commit.slice(0, 7)} (${readdirSync(SPEC).length} элементов).`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function readme(commit) {
  return `# spec/ — источник истины (только чтение)

Копия ТЗ, справочников, JSON-данных и файлов прототипа из ${REPOSITORY} (коммит \`${commit.slice(0, 7)}\`, подробности — \`SOURCE.json\`).

- Руками не правится: обновляется командой \`pnpm spec:sync\` (хук Claude Code запрещает правки).
- \`ТЗ Buhuchet.kg.md\` — итоговое ТЗ; раздел модуля — правила и пункты приёмки.
- \`Справочники платформы (исчерпывающие).md\`, \`ГКЭД 2022 (справочник).md\` — содержание справочников.
- \`Основные паттерны разработки.md\` — как устроены экраны прототипа.
- \`data/*.json\` — refDB (справочники платформы), gkedDB (ГКЭД), demoDB (демо-организация), TemDB (пустая организация); из них \`pnpm db:seed\` заливает начальное наполнение.
- \`prototype/\` — исходники прототипа: \`src/js/core\` (правила: derive.js, gked.js, socfund.js, reference.js…), \`src/js/modules\` (модули), \`src/js/ui\` и \`src/css\` (интерфейс). Открыть прототип: \`python3 prototype/build.py\` собирает один HTML.

На любой вопрос — как в прототипе (\`docs/decisions.md\` п. О-2 продукта), расхождение — в \`docs/deviations.md\` (скилл \`spec-deviation\`).
`;
}

main();
