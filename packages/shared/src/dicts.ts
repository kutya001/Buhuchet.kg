import {
  ALL_VALUES_DICTS,
  DICT_REQUEST_COMMENT_MAX,
  DICT_REQUEST_DICTS,
  DICT_REQUEST_STATUSES,
  DICT_REQUEST_WHAT_MAX,
  ORG_DICT_IDS,
  ORG_DICT_WINDOW_IDS,
  REMIND_DAY_MAX,
  REPORT_ACTS,
  REPORT_KINDS,
  REPORT_PERIODS,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordAudit, RecordVersion } from './common';
import { listPageSchema } from './list';

/*
 * Модуль «Справочники» → «Виды отчётов» (задача 2.02): каталог видов отчётов платформы глазами
 * организации — подключён ли вид и настройки организации по нему.
 */

/** Код вида отчёта каталога (nds, soc, t1m…). */
const TypeCode = z.string().min(1).max(64);

/** Дни напоминаний до срока: за сколько дней, от 1 до 60; в день срока — всегда, здесь его нет. */
const RemindDays = z.array(z.number().int()).max(REMIND_DAY_MAX);

/** Строка списка «Виды отчётов»: вид каталога, сроки словами и настройки организации. */
export const OrgReportTypeRow = z.object({
  code: z.string(),
  name: z.string(),
  shortName: z.string(),
  formCode: z.string(),
  statIndex: z.string(),
  /** Орган — название. */
  authority: z.string(),
  period: z.enum(REPORT_PERIODS),
  oneOff: z.boolean(),
  act: z.enum(REPORT_ACTS),
  kind: z.enum(REPORT_KINDS),
  rates: z.array(z.string()),
  /** «Применимые режимы» — краткими названиями. */
  regimes: z.array(z.string()),
  /** «Срок сдачи» словами. */
  due: z.string(),
  /** «Срок оплаты» словами; у вида «Сдача» — пусто. */
  pay: z.string(),
  /** «Что уплачивается». */
  pays: z.string(),
  enabled: z.boolean(),
  /** null — вид не подключён. */
  remindDays: z.array(z.number().int()).nullable(),
  needFile: z.boolean(),
  needReceipt: z.boolean(),
  /** Версия строки организации; null — вид ещё ни разу не подключали. */
  version: RecordVersion.nullable(),
  /** «Назначено контрагентам». */
  assigned: z.number().int().nonnegative(),
  /** «Создано» — когда организация подключила вид; null — не подключали. */
  audit: RecordAudit.nullable(),
});
export type OrgReportTypeRow = z.infer<typeof OrgReportTypeRow>;

export const OrgReportTypeList = listPageSchema(OrgReportTypeRow);
export type OrgReportTypeList = z.infer<typeof OrgReportTypeList>;

/** Настройки организации по виду отчёта. */
export const OrgReportTypeSetting = z.object({
  code: z.string(),
  enabled: z.boolean(),
  remindDays: z.array(z.number().int()),
  needFile: z.boolean(),
  needReceipt: z.boolean(),
  version: RecordVersion,
});
export type OrgReportTypeSetting = z.infer<typeof OrgReportTypeSetting>;

/**
 * Все строки организации (подключённые и отключённые) и набор дней по умолчанию из учётной политики —
 * для окна «Выбор налогов» и формы просмотра вида.
 */
export const OrgReportTypeSettings = z.object({
  items: z.array(OrgReportTypeSetting),
  remindDays: z.array(z.number().int()),
});
export type OrgReportTypeSettings = z.infer<typeof OrgReportTypeSettings>;

export const OrgReportTypeCodeParam = z.object({ code: TypeCode });

/**
 * Подключить, отключить, изменить дни напоминаний, «Файл при сдаче обязателен», «Квитанция о приёме
 * обязательна». `version` — версия строки, которую видел пользователь; null — вид ещё ни разу не
 * подключали (тогда его можно только подключить).
 */
export const OrgReportTypeSave = z.object({
  enabled: z.boolean().optional(),
  remindDays: RemindDays.optional(),
  needFile: z.boolean().optional(),
  needReceipt: z.boolean().optional(),
  version: RecordVersion.nullable(),
});
export type OrgReportTypeSave = z.infer<typeof OrgReportTypeSave>;

/**
 * Окно «Выбор налогов»: подключить отмеченные, отключить снятые; дни напоминаний для новых
 * подключённых (без них или пустым набором — набор из учётной политики).
 */
export const OrgReportTypesConnect = z.object({
  connect: z.array(TypeCode).max(500),
  disconnect: z.array(TypeCode).max(500),
  remindDays: RemindDays.optional(),
});
export type OrgReportTypesConnect = z.infer<typeof OrgReportTypesConnect>;

export const OrgReportTypesConnected = z.object({
  connected: z.number().int().nonnegative(),
  disconnected: z.number().int().nonnegative(),
});
export type OrgReportTypesConnected = z.infer<typeof OrgReportTypesConnected>;

/* ───────────── «Справочники платформы» глазами организации (задача 2.03) ───────────── */

/** Плитка справочника: название, число значений, что это и где используется. */
export const PlatformDictTile = z.object({
  id: z.enum(ORG_DICT_IDS),
  tab: z.string(),
  about: z.string(),
  usedIn: z.string(),
  count: z.number().int(),
});

/** Плитки по группам (раздел `dictGroups`), без служебных справочников администратора. */
export const PlatformDictGroups = z.object({
  groups: z.array(z.object({ group: z.string(), tabs: z.array(PlatformDictTile) })),
});
export type PlatformDictGroups = z.infer<typeof PlatformDictGroups>;

/** Справочник с окном значений: все, кроме «Видов отчётов». */
export const PlatformDictParam = z.object({ id: z.enum(ORG_DICT_WINDOW_IDS) });

/** Строка окна справочника: код значения и тексты столбцов по ключам (дата — `YYYY-MM-DD`). */
export const PlatformDictRow = z.object({
  id: z.string(),
  values: z.record(z.string(), z.string()),
});
export type PlatformDictRow = z.infer<typeof PlatformDictRow>;

export const PlatformDictList = listPageSchema(PlatformDictRow);
export type PlatformDictList = z.infer<typeof PlatformDictList>;

/** Строка «Поиска по всем значениям»: справочник, значение, кто и когда менял. */
export const PlatformValueRow = z.object({
  id: z.string(),
  dict: z.enum(ALL_VALUES_DICTS),
  dictName: z.string(),
  name: z.string(),
  audit: z.object({
    /** Даты появления значения у справочников платформы нет. */
    updatedAt: z.iso.datetime().nullable(),
    createdBy: z.string().nullable(),
    updatedBy: z.string().nullable(),
  }),
});
export type PlatformValueRow = z.infer<typeof PlatformValueRow>;

export const PlatformValueList = listPageSchema(PlatformValueRow);
export type PlatformValueList = z.infer<typeof PlatformValueList>;

/** «Попросить добавить»: справочник, что добавить (обязательно), комментарий. */
export const DictRequestCreate = z.object({
  dict: z.enum(DICT_REQUEST_DICTS),
  what: z.string().trim().min(1).max(DICT_REQUEST_WHAT_MAX),
  comment: z.string().trim().max(DICT_REQUEST_COMMENT_MAX).default(''),
});
export type DictRequestCreate = z.input<typeof DictRequestCreate>;

/** Запрос организации в «Моих запросах». */
export const DictRequest = z.object({
  id: z.uuid(),
  dict: z.enum(DICT_REQUEST_DICTS),
  what: z.string(),
  comment: z.string(),
  status: z.enum(DICT_REQUEST_STATUSES),
  /** Ответ администратора платформы. */
  answer: z.string(),
  createdAt: z.iso.datetime(),
  /** Кто отправил — краткое ФИО. */
  createdBy: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
});
export type DictRequest = z.infer<typeof DictRequest>;

export const DictRequests = z.object({ items: z.array(DictRequest) });
export type DictRequests = z.infer<typeof DictRequests>;
