import { describe, expect, it } from 'vitest';
import { readSpecJson } from '../spec-data';
import { uiTextSeedRows } from './l10n';
import { RETIRED } from './retired';

/** Повторы в списке. */
const twice = (list: readonly string[]) => list.filter((key, i) => list.indexOf(key) !== i);

// Без базы: списки на удаление сверяются с тем, что наполнение заводит сейчас. Обратную сторону —
// убранный текст не забыт в списке — проверяет `pnpm check:retired` (scripts/check-retired-texts.mjs).
describe('список на удаление наполнения (RETIRED)', () => {
  it('в списках нет повторов', () => {
    expect(twice(RETIRED.news)).toEqual([]);
    expect(twice(RETIRED.messageTemplates)).toEqual([]);
    expect(twice(RETIRED.uiTexts)).toEqual([]);
  });

  it('текст словаря, который наполнение заводит, в список на удаление не записан', async () => {
    // Иначе каждое `db:seed --update` заводило бы текст и тут же его удаляло — вместе с правкой
    // администратора платформы в «Локализации».
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    const seeded = new Set(uiTextSeedRows(refDB.localization).map((row) => row.key));
    expect(RETIRED.uiTexts.filter((key) => seeded.has(key))).toEqual([]);
  });
});
