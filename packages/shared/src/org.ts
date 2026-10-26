import {
  FEATURES,
  MENU_MODULES,
  ORG_ADDRESS_MAX_LENGTH,
  ORG_HEAD_MAX_LENGTH,
  ORG_NAME_MAX_LENGTH,
  ORG_TIMEZONE_IDS,
  PAGE_SECTIONS,
  REMIND_DAY_MAX,
  type MenuModuleId,
  type OrgTimezone,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordAudit, RecordVersion, Uuid } from './common';
import { Phone } from './staff';

/** Функция учётной политики (tasks, calendar, fee, …). */
export const FeatureSchema = z.enum(FEATURES);

/** Модуль меню организации (home, cps, reports, …). */
export const MenuModuleIdSchema = z.enum(
  MENU_MODULES.map((m) => m.id) as [MenuModuleId, ...MenuModuleId[]],
);

/** Раздел страницы контрагента по ссылке. */
export const PageSectionSchema = z.enum(PAGE_SECTIONS);

/**
 * Временная подписанная ссылка на картинку логотипа в хранилище. Живёт 15 минут (до `expiresAt`),
 * потом экран запрашивает новую: GET /api/org/logo.
 */
export const OrgLogoLink = z.object({
  url: z.string(),
  expiresAt: z.iso.datetime(),
});
export type OrgLogoLink = z.infer<typeof OrgLogoLink>;

/**
 * «Моя организация» → «Основное» (прототип modules/org.js, renderOrg → main). Видят все сотрудники,
 * меняет владелец (право «Настройки и учётная политика»).
 */
export const OrgProfile = z.object({
  id: Uuid,
  name: z.string(),
  /** 14 цифр; у организаций, созданных без ИНН, — null. */
  inn: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  head: z.string().nullable(),
  /** «Адрес страницы организации»: buhuchet.kg/<slug>/inn/<ИНН>. */
  slug: z.string(),
  /** Ссылка на картинку логотипа на 15 минут; null — логотипа нет. */
  logo: OrgLogoLink.nullable(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type OrgProfile = z.infer<typeof OrgProfile>;

/**
 * Сохранить «Основное». Не переданное поле не меняется; пустая строка в необязательном поле очищает
 * его. Название, ИНН, телефон и адрес страницы сервер проверяет с текстами прототипа.
 */
export const UpdateOrgProfileRequest = z.object({
  version: RecordVersion,
  name: z.string().trim().max(ORG_NAME_MAX_LENGTH).optional(),
  inn: z.string().trim().max(20).optional(),
  address: z.string().trim().max(ORG_ADDRESS_MAX_LENGTH).nullable().optional(),
  phone: Phone.nullable().optional(),
  head: z.string().trim().max(ORG_HEAD_MAX_LENGTH).nullable().optional(),
  /** Как в прототипе: пробелы по краям убираются, буквы — строчные. */
  slug: z.string().trim().toLowerCase().max(64).optional(),
});
export type UpdateOrgProfileRequest = z.infer<typeof UpdateOrgProfileRequest>;

/** Версия «Основного», которую видел пользователь, — для загрузки и удаления логотипа. */
export const OrgVersionQuery = z.object({ version: z.coerce.number().int().nonnegative() });

/**
 * Учётная политика и настройки (прототип modules/org.js, renderOrg → policy и settings). Видят все
 * сотрудники, меняет владелец; отключённая функция пропадает из меню, вкладок и полей у всех.
 */
export const OrgPolicy = z.object({
  features: z.record(FeatureSchema, z.boolean()),
  /** «Задачи требуют подтверждения» — начальное значение в форме новой задачи. */
  taskConfirm: z.boolean(),
  /** «Сдача отчётов требует подтверждения». */
  reportConfirm: z.boolean(),
  /** Напомнить о неподтверждённой сдаче через N дней (1–30). */
  confirmWaitDays: z.number().int(),
  /** «Сдача отчёта только после оплаты» (при включённом «Учёте оплаты налогов»). */
  payBeforeSubmit: z.boolean(),
  /** Напоминания о сроках по умолчанию: за сколько дней, от большего к меньшему; в день срока — всегда. */
  remindDays: z.array(z.number().int()),
  /** Разделы страницы контрагента по ссылке для всех контрагентов. */
  pageSections: z.array(PageSectionSchema),
  timezone: z.string(),
  /** Повторять напоминание при просрочке каждый день. */
  overdueRepeat: z.boolean(),
  /** Время еженедельной сводки по понедельникам, ЧЧ:ММ. */
  digestTime: z.string(),
  /** Роль по умолчанию для новых сотрудников; null — не выбрана. */
  defaultRoleId: Uuid.nullable(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type OrgPolicy = z.infer<typeof OrgPolicy>;

/** Сохранить учётную политику или настройки: только переданные поля; функции — только переданные. */
export const UpdateOrgPolicyRequest = z.object({
  version: RecordVersion,
  features: z.partialRecord(FeatureSchema, z.boolean()).optional(),
  taskConfirm: z.boolean().optional(),
  reportConfirm: z.boolean().optional(),
  confirmWaitDays: z.number().int().optional(),
  payBeforeSubmit: z.boolean().optional(),
  remindDays: z.array(z.number().int()).max(REMIND_DAY_MAX).optional(),
  pageSections: z.array(PageSectionSchema).max(PAGE_SECTIONS.length).optional(),
  timezone: z.enum(ORG_TIMEZONE_IDS as [OrgTimezone, ...OrgTimezone[]]).optional(),
  overdueRepeat: z.boolean().optional(),
  digestTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  defaultRoleId: Uuid.optional(),
});
export type UpdateOrgPolicyRequest = z.infer<typeof UpdateOrgPolicyRequest>;

/** Изменённое поле в истории: было → стало (значения как в JSON). */
const HistoryChangeSchema = z.object({
  field: z.string(),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
});

/**
 * «История изменений учётной политики»: что изменено, было → стало, кто, когда; сначала новые.
 * Изменения вкладки «Настройки» сюда не входят (как в прототипе). total — сколько записей всего.
 */
export const OrgPolicyHistory = z.object({
  total: z.number().int(),
  items: z.array(
    z.object({
      at: z.iso.datetime(),
      /** Короткое имя сотрудника, «Администратор платформы» или null — система. */
      actor: z.string().nullable(),
      action: z.string(),
      changes: z.array(HistoryChangeSchema),
      reason: z.string().nullable(),
    }),
  ),
});
export type OrgPolicyHistory = z.infer<typeof OrgPolicyHistory>;
