import { UI_LANGUAGES, UI_TEXT_MAX_LENGTH, type UiTextKey } from '@buhuchet/domain';
import { z } from 'zod';
import { RecordAudit, RecordVersion } from './common';
import { listPageSchema } from './list';

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

/**
 * Текст словаря в Админке → «Локализация» (прототип admin/l10n.js: «Ключ», «Русский текст», «Раздел»).
 */
export const AdminUiText = z.object({
  key: z.string(),
  text: z.string(),
  section: z.string(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type AdminUiText = z.infer<typeof AdminUiText>;

/** Страница словаря: сортировка, страницы и фильтры — на сервере. */
export const AdminUiTextList = listPageSchema(AdminUiText);
export type AdminUiTextList = z.infer<typeof AdminUiTextList>;

const message = (key: UiTextKey) => ({ message: key });

/**
 * Окно «Текст интерфейса» (React Hook Form): новый текст и версия, которую видел администратор.
 * Пустой — «Введите текст»; подстановки `{имя}` сверяет сервер с прежним текстом (`uiTextProblem`).
 */
export const UiTextUpdateRequest = z.object({
  text: z
    .string()
    .trim()
    .min(1, message('locale.err.empty'))
    .max(UI_TEXT_MAX_LENGTH, message('form.too_long')),
  version: RecordVersion,
});
export type UiTextUpdateRequestInput = z.input<typeof UiTextUpdateRequest>;
export type UiTextUpdateRequest = z.output<typeof UiTextUpdateRequest>;

/** Форма окна «Текст интерфейса»: поле текста; версию записи добавляет экран. */
export const UiTextForm = UiTextUpdateRequest.pick({ text: true });
export type UiTextFormInput = z.input<typeof UiTextForm>;
export type UiTextForm = z.output<typeof UiTextForm>;

/**
 * Языки интерфейса на плашках «Локализации» (ТЗ: «Список языков: русский — включён и единственный»):
 * сколько текстов у языка и сколько всего ключей словаря, доля переведённого в процентах.
 */
export const UiLanguages = z.object({
  items: z.array(
    z.object({
      lang: UiLanguageSchema,
      isDefault: z.boolean(),
      enabled: z.boolean(),
      texts: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      share: z.number().int().min(0).max(100),
    }),
  ),
});
export type UiLanguages = z.infer<typeof UiLanguages>;
