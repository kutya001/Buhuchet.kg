import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOT_BUTTON_TEXT_MAX,
  fillTemplate,
  MESSAGE_TEMPLATE_VARIABLES,
  messageTemplateMax,
  TELEGRAM_TEMPLATE_DEFAULTS,
  unknownTemplateVariables,
} from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';

/*
 * «Все старые и новые сообщения бота» (доработки 20.11.2026, пакет 2, «Порядок работ» → «Этап 2 —
 * общая проверка», Т; поток Т, этап 2, П10). Сообщения бота собираются из шаблонов: из справочника
 * платформы (Админка → «Шаблоны», refDB.json прототипа) и из текстов по умолчанию продукта
 * (`TELEGRAM_TEMPLATE_DEFAULTS`). Проверка всех разом:
 *   — каждый шаблон бота прототипа есть в продукте с тем же текстом и правится в «Шаблонах»;
 *   — шаблоны только продукта — ровно записанные в docs/deviations.md (новый — в прототип или в пункт);
 *   — после подстановки всех значений в тексте нет ни одной «{…}», текст не пустой и влезает в
 *     сообщение Telegram (4 096 знаков), подпись кнопки без подстановки — в 40 знаков, с подстановкой
 *     режется до предела Telegram;
 *   — каждый шаблон продукта где-то отправляется: в коде нет забытых текстов.
 * Что каждое отправленное сообщение идёт по правилам Bot API (кнопки, разметка, длина), проверяет
 * подставной бот после каждого теста API (`packages/api/src/test-setup.ts`, docs/decisions.md п. Т-13).
 */

/** Шаблоны продукта, которых нет в прототипе, и пункт, где это записано. */
const PRODUCT_ONLY: Readonly<Record<string, string>> = {
  tgPayToday: 'Б-10',
  tgPayOver: 'Б-10',
  tgTaskSoon: 'Б-10',
  tgTaskOver: 'Б-10',
  tgTaskWait: 'Б-10',
  tgTaskDone: 'Б-10',
  tgTaskConfirmed: 'Б-10',
  tgTaskRework: 'Б-10',
  tgTaskCancelled: 'Б-10',
  tgCpOffWhich: 'К-2',
  tgActMemFull: 'О-93',
  tgCpFileMem: 'О-93',
  tgDmTokNew: 'Т-31',
  tgDmTokRevoked: 'Т-31',
  tgDmTokSoon: 'Т-31',
};

/**
 * Кнопки с подстановкой и функция, которая собирает подпись: имя может быть любой длины, поэтому
 * подпись режется `botClip(…, BOT_BUTTON_TEXT_MAX)` (`packages/domain/src/telegram/tables.ts`), а
 * 40 знаков — предел самого шаблона.
 */
const CLIPPED_BUTTONS: Readonly<Record<string, string>> = {
  tgBtnNudge: 'nudge',
  tgBtnFeeCopy: 'feeCopy',
};

/** Предел текста сообщения Telegram (Bot API, sendMessage). */
const TELEGRAM_TEXT_MAX = 4096;
/** Значение подстановки: длинное, как список из нескольких отчётов. */
const SAMPLE = 'Значение подстановки '.repeat(4).trim();

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const refDB = JSON.parse(readFileSync(join(ROOT, 'spec/data/refDB.json'), 'utf8')) as {
  messageTemplates: Record<string, string>;
};
const own: Readonly<Record<string, string>> = refDB.messageTemplates;
const defaults: Readonly<Record<string, string>> = TELEGRAM_TEMPLATE_DEFAULTS;
const botKeys = (keys: Iterable<string>) => [...keys].filter((k) => k.startsWith('tg')).sort();

/** Исходный код (без тестов) пакетов, которые собирают и отправляют сообщения бота. */
function sourceText(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        parts.push(readFileSync(path, 'utf8'));
      }
    }
  };
  for (const dir of ['packages/api/src', 'packages/domain/src', 'packages/db/src']) {
    walk(join(ROOT, dir));
  }
  return parts.join('\n');
}

describe('Этап 2, П10: все сообщения бота', () => {
  it('каждый шаблон бота прототипа — в продукте с тем же текстом и правится в «Шаблонах»', () => {
    for (const key of botKeys(Object.keys(own))) {
      expect(Object.hasOwn(MESSAGE_TEMPLATE_VARIABLES, key), key).toBe(true);
      // Шаблоны заявок с сайта собирает сам справочник (`tgLead`, `tgLeadRep`): текста по умолчанию нет.
      if (Object.hasOwn(defaults, key)) expect(defaults[key], key).toBe(own[key]);
    }
  });

  it('шаблоны только продукта — ровно записанные в отклонениях, и не правятся в «Шаблонах»', () => {
    const productOnly = botKeys(Object.keys(defaults)).filter((k) => !Object.hasOwn(own, k));
    expect(productOnly).toEqual(Object.keys(PRODUCT_ONLY).sort());
    const deviations = readFileSync(join(ROOT, 'docs/deviations.md'), 'utf8');
    for (const [key, item] of Object.entries(PRODUCT_ONLY)) {
      expect(deviations, `${key}: docs/deviations.md п. ${item}`).toMatch(
        new RegExp(`^## ${item}\\. `, 'm'),
      );
      expect(Object.hasOwn(MESSAGE_TEMPLATE_VARIABLES, key), key).toBe(false);
    }
  });

  it('после подстановки — ни одной «{…}», не пусто, влезает в сообщение и в кнопку', () => {
    const all = new Map<string, string>([
      ...Object.entries(own).filter(([k]) => k.startsWith('tg')),
      ...Object.entries(defaults),
    ]);
    expect(all.size).toBeGreaterThan(200);
    for (const [key, text] of all) {
      const names = [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]!);
      if (Object.hasOwn(MESSAGE_TEMPLATE_VARIABLES, key)) {
        expect(unknownTemplateVariables(key, text), key).toEqual([]);
      }
      const filled = fillTemplate(text, Object.fromEntries(names.map((n) => [n, SAMPLE])));
      expect(filled, key).not.toMatch(/\{[^{}]+\}/);
      expect(filled.trim(), key).not.toBe('');
      expect(text.length, key).toBeLessThanOrEqual(messageTemplateMax(key));
      expect(filled.length, key).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX);
      if (key.startsWith('tgBtn') && names.length === 0) {
        expect(filled.length, key).toBeLessThanOrEqual(40);
      }
      if (key.startsWith('tgBtn') && names.length > 0) {
        expect(Object.hasOwn(CLIPPED_BUTTONS, key), `${key}: подпись с подстановкой`).toBe(true);
      }
    }
  });

  it('кнопка с подстановкой режется до предела Telegram', () => {
    const tables = readFileSync(join(ROOT, 'packages/domain/src/telegram/tables.ts'), 'utf8');
    for (const fn of Object.values(CLIPPED_BUTTONS)) {
      expect(tables, fn).toContain(`botClip(texts.${fn}(`);
    }
    expect(tables).toContain(`, BOT_BUTTON_TEXT_MAX)`);
    expect(BOT_BUTTON_TEXT_MAX).toBeLessThanOrEqual(64);
  });

  it('каждый шаблон продукта где-то отправляется: забытых текстов нет', () => {
    const code = sourceText();
    const unused = Object.keys(defaults).filter(
      (key) =>
        !code.includes(`'${key}'`) && !code.includes(`"${key}"`) && !code.includes(`.${key}`),
    );
    expect(unused).toEqual([]);
  });
});
