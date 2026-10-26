import {
  FEATURES,
  isValidOrgInn,
  MENU_MODULE_IDS,
  ORG_ADDRESS_MAX_LENGTH,
  ORG_HEAD_MAX_LENGTH,
  ORG_NAME_MAX_LENGTH,
  ORG_TIMEZONE_IDS,
  PAGE_SECTIONS,
  REMIND_DAY_MAX,
  slugProblem,
  type MenuModuleId,
  type OrgTimezone,
  type UiTextKey,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordAudit, RecordVersion, Uuid } from './common';
import { Phone } from './staff';

/** Функция учётной политики (tasks, calendar, fee, …). */
export const FeatureSchema = z.enum(FEATURES);

/** Модуль меню организации (home, cps, reports, …) или Админки (accounts, orgs, …). */
export const MenuModuleIdSchema = z.enum(MENU_MODULE_IDS as [MenuModuleId, ...MenuModuleId[]]);

/** Раздел страницы контрагента по ссылке. */
export const PageSectionSchema = z.enum(PAGE_SECTIONS);

/**
 * Временная подписанная ссылка на картинку логотипа в хранилище. Живёт 15 минут (до `expiresAt`,
 * по настоящему времени — сравнивать с часами браузера, а не с датой демо-стенда), потом экран
 * запрашивает новую: GET /api/org/logo.
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

const message = (key: UiTextKey) => ({ message: key });

/**
 * Форма «Основное» на экране (прототип modules/org.js, og-save): «Введите название», «ИНН — 14 цифр».
 * Адрес страницы проверяется отдельно (`OrgSlugField`): поле видно, только когда включена «Страница
 * контрагента по ссылке». Телефон проверяет поле ввода по маске страны. Сообщения — ключи словаря.
 */
export const OrgMainForm = z.object({
  name: z
    .string()
    .trim()
    .min(1, message('err.name_required'))
    .max(ORG_NAME_MAX_LENGTH, message('form.too_long')),
  inn: z.string().trim().refine(isValidOrgInn, message('err.inn_invalid')),
  address: z.string().trim().max(ORG_ADDRESS_MAX_LENGTH, message('form.too_long')),
  head: z.string().trim().max(ORG_HEAD_MAX_LENGTH, message('form.too_long')),
  slug: z.string(),
});
export type OrgMainFormInput = z.input<typeof OrgMainForm>;
export type OrgMainForm = z.output<typeof OrgMainForm>;

/**
 * «Адрес страницы организации» в форме: как на сервере — пробелы по краям убираются, буквы строчные;
 * формат и занятые слова программы — тексты прототипа (slugErr). Занят ли адрес другой
 * организацией, отвечает сервер.
 */
export const OrgSlugField = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((value, ctx) => {
    const problem = slugProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: `err.${problem}` satisfies UiTextKey });
  });

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
  /** Её название — для «Настроек» только для просмотра (список ролей видит тот, кто меняет). */
  defaultRoleName: z.string().nullable(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type OrgPolicy = z.infer<typeof OrgPolicy>;

/**
 * Роли для поля «Роль по умолчанию для новых сотрудников» на вкладке «Настройки» (прототип
 * modules/org.js, st-role): все роли организации, кроме роли владельца, в порядке создания.
 */
export const OrgRoleOptions = z.object({
  items: z.array(z.object({ id: Uuid, name: z.string() })),
});
export type OrgRoleOptions = z.infer<typeof OrgRoleOptions>;

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
