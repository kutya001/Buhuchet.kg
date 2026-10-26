import { UI_LANGUAGES } from '@buhuchet/domain';
import { z } from 'zod';

export const UiLanguageSchema = z.enum(UI_LANGUAGES);

export const UiDictionaryQuery = z.object({
  lang: UiLanguageSchema.optional(),
});

/**
 * Словарь текстов интерфейса одного языка. `version` меняется с каждой правкой словаря: по ней
 * браузер перепроверяет ответ (ETag) и не скачивает словарь заново, пока он не изменился.
 */
export const UiDictionary = z.object({
  lang: UiLanguageSchema,
  version: z.string(),
  texts: z.record(z.string(), z.string()),
});
export type UiDictionary = z.infer<typeof UiDictionary>;
