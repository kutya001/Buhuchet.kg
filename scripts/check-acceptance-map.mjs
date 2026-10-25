#!/usr/bin/env node
// pnpm check:acceptance — у каждого пункта приёмки ТЗ есть сквозной тест.
// Формат строки в docs/acceptance-map.md:
//   - <пункт ТЗ> → e2e/<файл>.spec.ts › <название теста>
// Пункт без теста пишется как «→ нет теста» и роняет проверку.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkAcceptanceMap(root, mapFile = 'docs/acceptance-map.md') {
  const problems = [];
  const text = readFileSync(path.join(root, mapFile), 'utf8');
  let items = 0;
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line.startsWith('- ') || !line.includes('→')) return;
    items++;
    const [item, target] = line
      .slice(2)
      .split('→')
      .map((s) => s.trim());
    const where = `${mapFile}:${i + 1}`;
    if (!target || /^нет теста/i.test(target)) {
      problems.push(`${where}  у пункта «${item}» нет теста`);
      return;
    }
    const m = /^(e2e\/[\w./-]+\.spec\.ts)\s*›\s*(.+)$/.exec(target);
    if (!m) {
      problems.push(
        `${where}  ожидается «e2e/<файл>.spec.ts › <название теста>», получено «${target}»`,
      );
      return;
    }
    const [, file, title] = m;
    const full = path.join(root, file);
    if (!existsSync(full)) {
      problems.push(`${where}  нет файла ${file}`);
      return;
    }
    if (!readFileSync(full, 'utf8').includes(title)) {
      problems.push(`${where}  в ${file} нет теста «${title}»`);
    }
  });
  return { items, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { items, problems } = checkAcceptanceMap(root);
  if (problems.length) {
    console.error('Карта приёмки неполна:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`Карта приёмки: ${items} пунктов, у всех есть тесты.`);
}
