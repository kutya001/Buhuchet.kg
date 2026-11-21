import {
  CP_NOTICE_DAYS,
  FEATURES,
  isValidOrgInn,
  MENU_MODULE_IDS,
  ORG_ADDRESS_MAX_LENGTH,
  ORG_HEAD_MAX_LENGTH,
  ORG_LEGAL_FORMS,
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
  /** 14 цифр; у организаций, созданных без ИНН, — null. Меняет только администратор платформы. */
  inn: z.string().nullable(),
  /** «Форма» — ОсОО или ИП (доработки 14.11.2026, блок 1, пункт 4): меняет только администратор платформы. */
  legalForm: z.enum(ORG_LEGAL_FORMS).nullable(),
  /** «ОКПО» — 8 цифр. */
  okpo: z.string().nullable(),
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
 * его. Название, ОКПО, телефон и адрес страницы сервер проверяет с текстами прототипа. ИНН и форму
 * владелец не меняет (доработки 14.11.2026, блок 1, пункт 4): их в запросе нет, присланные — не меняются
 * (как прочие лишние поля) — «ИНН и форма» Админки.
 */
export const UpdateOrgProfileRequest = z.object({
  version: RecordVersion,
  name: z.string().trim().max(ORG_NAME_MAX_LENGTH).optional(),
  okpo: z.string().trim().max(20).nullable().optional(),
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
  okpo: z
    .string()
    .trim()
    .regex(/^([0-9]{8})?$/, message('err.okpo_invalid')),
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
  /** «Действия из Telegram»: кнопки под сообщениями бота, которые меняют данные. */
  telegramActions: z.boolean(),
  /** «Отправлять «К оплате» контрагентам»: бот сам пишет клиенту за 5 дней до срока оплаты. */
  cpTgPay: z.boolean(),
  cpTgDebt: z.boolean(),
  /** «Контрагент может отправлять файлы» — для всех контрагентов. */
  cpFilesUpload: z.boolean(),
  /**
   * «Внешний доступ по API» (доработки 20.11.2026: Витрина данных, блок 5, пункт 9): выдавать данные
   * внешним программам по API-токенам; сначала выключен, меняет только владелец.
   */
  extApi: z.boolean(),
  /**
   * «Час напоминаний», ЧЧ:ММ по Бишкеку: в этот час каждый день уходят напоминания о сроках, недельная
   * сводка (в свой день) и сводка дня в общий чат (блок «Telegram-уведомления», прототип v111).
   */
  digestTime: z.string(),
  /** День недельной сводки: 1 — понедельник … 7 — воскресенье (по умолчанию понедельник). */
  weekDay: z.number().int(),
  /**
   * Строка «К оплате» (поток К, этап 2): галочки «за 5» … «за 1 день» до ближайшего срока оплаты месяца
   * (от большего к меньшему, хотя бы одна) и время отправки «ЧЧ:ММ» по Бишкеку.
   */
  cpPayDays: z.array(z.number().int()),
  cpPayAt: z.string(),
  /** Строка «Оплата за обслуживание»: дни до дня оплаты, время (оба сообщения) и день долга (1–7). */
  cpFeeDays: z.array(z.number().int()),
  cpFeeAt: z.string(),
  cpDebtWeekDay: z.number().int(),
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
 * modules/org.js, st-role): все роли организации, кроме роли владельца, по названию.
 */
export const OrgRoleOptions = z.object({
  items: z.array(z.object({ id: Uuid, name: z.string() })),
});
export type OrgRoleOptions = z.infer<typeof OrgRoleOptions>;

/**
 * Сколько отчётов организации ждут подтверждения — для вопроса «Выключить подтверждение сдачи?»
 * (прототип modules/org.js, repConfSet).
 */
export const OrgWaitingReports = z.object({ count: z.number().int().nonnegative() });
export type OrgWaitingReports = z.infer<typeof OrgWaitingReports>;

/**
 * Блок «Внешний доступ по API» вкладки «Настройки» (прототип v155 `dmApiBox`): демо-организация (там
 * токены не выпускаются и выключатель недоступен) и сколько токенов организации сейчас «Действует» —
 * для подписи и вопроса «Выключить внешний доступ?».
 */
export const OrgExtApi = z.object({
  demo: z.boolean(),
  activeTokens: z.number().int().nonnegative(),
});
export type OrgExtApi = z.infer<typeof OrgExtApi>;

/** Время отправки «ЧЧ:ММ» (00:00–23:59). */
const NoticeTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Галочки «за 5» … «за 1 день»: числа 1–5 без повторов, хотя бы одна. */
const CpNoticeDays = z
  .array(z.number().int().min(1).max(CP_NOTICE_DAYS.length))
  .min(1)
  .max(CP_NOTICE_DAYS.length)
  .refine((days) => new Set(days).size === days.length);

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
  /** Меняет только владелец организации. */
  telegramActions: z.boolean().optional(),
  cpTgPay: z.boolean().optional(),
  cpTgDebt: z.boolean().optional(),
  cpFilesUpload: z.boolean().optional(),
  /** «Внешний доступ по API». Меняет только владелец; в демо-организации — нельзя. */
  extApi: z.boolean().optional(),
  digestTime: NoticeTime.optional(),
  /** День недельной сводки, 1–7 (понедельник … воскресенье). */
  weekDay: z.number().int().min(1).max(7).optional(),
  /** Галочки «за N дней» строки «К оплате»: 1–5, хотя бы одна. Меняет только владелец организации. */
  cpPayDays: CpNoticeDays.optional(),
  cpPayAt: NoticeTime.optional(),
  cpFeeDays: CpNoticeDays.optional(),
  cpFeeAt: NoticeTime.optional(),
  cpDebtWeekDay: z.number().int().min(1).max(7).optional(),
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

/**
 * «ИНН и форма» организации в Админке (прототип v114 ldInnFormDlg; доработки 14.11.2026, блок 1,
 * пункт 4): меняет только администратор платформы, с версией записи.
 */
export const OrgInnFormRequest = z.strictObject({
  inn: z.string().trim().refine(isValidOrgInn, message('err.inn_invalid')),
  legalForm: z.enum(ORG_LEGAL_FORMS, message('err.org_form_required')),
  version: RecordVersion,
});
export type OrgInnFormRequest = z.infer<typeof OrgInnFormRequest>;

/** «ИНН и форма» сохранены: новая версия организации; `changed` false — «Изменений нет». */
export const OrgInnFormSaved = z.object({
  changed: z.boolean(),
  version: z.number().int().nonnegative(),
});
export type OrgInnFormSaved = z.infer<typeof OrgInnFormSaved>;
