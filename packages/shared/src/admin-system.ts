import {
  MESSAGE_TEMPLATE_MAX,
  PERIOD_ROWS,
  PERMISSION_DESCRIPTION_MAX,
  SCOPES,
  STATUS_SCALES,
  STATUS_TONES,
  SYSTEM_NAME_MAX,
  type UiTextKey,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordVersion } from './common';
import { listPageSchema } from './list';

/*
 * Админка → «Справочники платформы», вкладки группы «Работа системы» (задача 2.36, часть 3; прототип
 * admin/platform-dicts.js): «Статусы», «Права ролей», «Шаблоны ролей» и «Шаблоны» сообщений.
 */

const message = (key: UiTextKey) => ({ message: key });

/** Название: обязательно, не длиннее `SYSTEM_NAME_MAX`. */
const name = z
  .string()
  .trim()
  .min(1, message('pdicts.err.name_required'))
  .max(SYSTEM_NAME_MAX, message('form.too_long'));

const PERIOD_CODES = PERIOD_ROWS.map((p) => p.code) as [
  (typeof PERIOD_ROWS)[number]['code'],
  ...(typeof PERIOD_ROWS)[number]['code'][],
];

/* ---------- «Статусы» ---------- */

const StatusPlace = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('step'), n: z.number().int().positive() }),
  z.object({ kind: z.literal('mark') }),
  z.object({ kind: z.literal('side') }),
]);

export const AdminStatus = z.object({
  scale: z.enum(STATUS_SCALES),
  code: z.string(),
  place: StatusPlace,
  name: z.string(),
  /** Версия текста названия в словаре. */
  nameVersion: RecordVersion,
  /** Пояснение статуса отчёта; у других шкал — пусто. */
  note: z.string(),
  tone: z.enum(STATUS_TONES),
  toneVersion: RecordVersion,
});
export type AdminStatus = z.infer<typeof AdminStatus>;

export const AdminPeriod = z.object({
  code: z.enum(PERIOD_CODES),
  perYear: z.number().int().positive(),
  name: z.string(),
  nameVersion: RecordVersion,
});
export type AdminPeriod = z.infer<typeof AdminPeriod>;

export const AdminStatuses = z.object({
  statuses: z.array(AdminStatus),
  periods: z.array(AdminPeriod),
});
export type AdminStatuses = z.infer<typeof AdminStatuses>;

export const AdminStatusParam = z.object({
  scale: z.enum(STATUS_SCALES),
  code: z.string().min(1).max(40),
});

export const AdminPeriodParam = z.object({ code: z.enum(PERIOD_CODES) });

/** «Название статуса» и «Название периодичности»: новое название. */
export const AdminSystemNameForm = z.object({ name, version: RecordVersion });
export type AdminSystemNameForm = z.infer<typeof AdminSystemNameForm>;

/** Поле окна «Новое название» (версию добавляет экран). */
export const AdminSystemNameFields = AdminSystemNameForm.pick({ name: true });
export type AdminSystemNameFields = z.infer<typeof AdminSystemNameFields>;

export const AdminStatusToneForm = z.object({
  tone: z.enum(STATUS_TONES),
  version: RecordVersion,
});
export type AdminStatusToneForm = z.infer<typeof AdminStatusToneForm>;

/* ---------- «Права ролей» ---------- */

export const AdminPermission = z.object({
  id: z.string(),
  group: z.string(),
  /** Название группы (словарь `roles.group.<группа>`). */
  groupText: z.string(),
  name: z.string(),
  description: z.string(),
  version: RecordVersion,
});
export type AdminPermission = z.infer<typeof AdminPermission>;

export const AdminPermissionList = listPageSchema(AdminPermission);
export type AdminPermissionList = z.infer<typeof AdminPermissionList>;

export const AdminPermissionParam = z.object({ id: z.string().min(1).max(40) });

/** «Право роли»: название и описание обязательны (прототип permEditDlg). */
export const AdminPermissionForm = z.object({
  name,
  description: z
    .string()
    .trim()
    .min(1, message('pdicts.err.description_required'))
    .max(PERMISSION_DESCRIPTION_MAX, message('form.too_long')),
  version: RecordVersion,
});
export type AdminPermissionForm = z.infer<typeof AdminPermissionForm>;

/** Поля окна «Право роли» (версию добавляет экран). */
export const AdminPermissionFields = AdminPermissionForm.omit({ version: true });
export type AdminPermissionFields = z.infer<typeof AdminPermissionFields>;

/* ---------- «Шаблоны ролей» ---------- */

export const AdminRoleTemplate = z.object({
  code: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
  scopes: z.record(z.string(), z.string()),
  version: RecordVersion,
});
export type AdminRoleTemplate = z.infer<typeof AdminRoleTemplate>;

export const AdminRoleTemplates = z.object({ items: z.array(AdminRoleTemplate) });
export type AdminRoleTemplates = z.infer<typeof AdminRoleTemplates>;

export const AdminRoleTemplateParam = z.object({ code: z.string().min(1).max(40) });

/**
 * Шаблон роли: название, права и область по группам («Свои» / «Все»). Какие права можно дать шаблону,
 * проверяет сервер (`roleTemplateProblem`).
 */
export const AdminRoleTemplateForm = z.object({
  name,
  permissions: z.array(z.string().max(40)).max(100),
  scopes: z.record(z.string().max(40), z.enum(SCOPES)),
  version: RecordVersion,
});
export type AdminRoleTemplateForm = z.infer<typeof AdminRoleTemplateForm>;

/* ---------- «Шаблоны» сообщений ---------- */

export const AdminMessageTemplate = z.object({
  key: z.string(),
  note: z.string(),
  text: z.string(),
  /** Подстановки шаблона (прототип TPL_VARS). */
  variables: z.array(z.string()),
  version: RecordVersion,
});
export type AdminMessageTemplate = z.infer<typeof AdminMessageTemplate>;

export const AdminMessageTemplates = z.object({ items: z.array(AdminMessageTemplate) });
export type AdminMessageTemplates = z.infer<typeof AdminMessageTemplates>;

/** Текст шаблона: обязателен, не длиннее `MESSAGE_TEMPLATE_MAX`; подстановки проверяет сервер. */
export const MessageTemplateText = z
  .string()
  .trim()
  .min(1, message('pdicts.err.text_required'))
  .max(MESSAGE_TEMPLATE_MAX, message('form.too_long'));

/** «Сохранить шаблоны»: тексты всех шаблонов вкладки с версиями. */
export const AdminMessageTemplatesForm = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        text: MessageTemplateText,
        version: RecordVersion,
      }),
    )
    .min(1)
    .max(50),
});
export type AdminMessageTemplatesForm = z.infer<typeof AdminMessageTemplatesForm>;

/** Поля вкладки «Шаблоны»: тексты по порядку вкладки (версии добавляет экран). */
export const AdminMessageTemplatesFields = z.object({
  items: z.array(z.object({ key: z.string(), text: MessageTemplateText })),
});
export type AdminMessageTemplatesFields = z.infer<typeof AdminMessageTemplatesFields>;

/** Сколько шаблонов изменено. */
export const AdminMessageTemplatesSaved = z.object({ changed: z.number().int().nonnegative() });
