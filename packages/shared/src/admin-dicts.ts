import {
  ADMIN_TAX_LISTS,
  ADMIN_VALUE_DICTS,
  BANK_KINDS,
  BENEFIT_KINDS,
  CALENDAR_ADD_TYPES,
  CALENDAR_DAY_KINDS,
  DECLARATION_FOR,
  DICT_NAME_MAX,
  DICT_NOTE_MAX,
  DICT_REQUEST_ANSWER_MAX,
  DICT_REQUEST_ANSWERS,
  DICT_REQUEST_DICTS,
  DICT_REQUEST_STATUSES,
  DUE_FROM,
  isIsoDate,
  LAST_DAY_OF_MONTH,
  ORGAN_CONTACTS_MAX,
  PHONE_DIAL_CODE_PATTERN,
  PAYER_KINDS,
  PHONE_MASK_PATTERN,
  REPORT_ACTS,
  REPORT_KINDS,
  REPORT_PERIODS,
  organSiteUrl,
  REGIME_KINDS,
  UGNS_CODE_PATTERN,
  type UiTextKey,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordAudit, RecordVersion, Uuid } from './common';
import { listPageSchema } from './list';

/*
 * Админка → «Справочники платформы» (задача 2.36; прототип admin/platform-dicts*.js): значения
 * справочников с «№», «Используется» и «Статусом», окна правки, «История изменений» и «Запросы»
 * организаций с ответом.
 */

const message = (key: UiTextKey) => ({ message: key });

export const AdminValueDictParam = z.object({ dict: z.enum(ADMIN_VALUE_DICTS) });

export const AdminDictCodeParam = AdminValueDictParam.extend({ code: z.string().min(1).max(80) });

const Contact = z.object({ label: z.string(), value: z.string() });

/**
 * «Тип»: у банковского провайдера — банк или кошелёк, у режима — общий или специальный, у льготы —
 * льгота или статус.
 */
const Kind = z.enum([...BANK_KINDS, ...REGIME_KINDS, ...BENEFIT_KINDS]);

const dueDay = z.number().int().min(1).max(LAST_DAY_OF_MONTH).nullable();
const dueAfter = z.number().int().min(0).max(12).nullable();

/**
 * Строка «Меняет сроки» статуса: свой срок сдачи и (или) уплаты вида отчёта; пусто — как у вида, день
 * 31 — последний день месяца.
 */
export const BenefitDueRule = z.object({
  reportType: z.string().min(1).max(80),
  dueDay,
  dueAfter,
  dueMonth: z.number().int().min(1).max(12).nullable(),
  payDay: dueDay,
  payAfter: dueAfter,
});
export type BenefitDueRule = z.infer<typeof BenefitDueRule>;

/** Поля значения сверх кода и названия — у каждого справочника свои (`ADMIN_DICT_META.fields`). */
export const AdminDictData = z.object({
  fullName: z.string().optional(),
  shortName: z.string().optional(),
  declarationFor: z.enum(DECLARATION_FOR).optional(),
  note: z.string().optional(),
  description: z.string().optional(),
  contacts: z.array(Contact).optional(),
  hours: z.string().optional(),
  site: z.string().optional(),
  contactsNote: z.string().optional(),
  /** Код ГНС управления; null — не сверен. */
  gnsCode: z.string().nullable().optional(),
  region: z.string().optional(),
  /** У банковского провайдера и режима — «Тип»; у провайдера — «Переводы по номеру телефона». */
  kind: Kind.optional(),
  byPhone: z.boolean().optional(),
  /** У режима: «Освобождает от», «Кто применяет», «Как переходят», «Совмещается с». */
  frees: z.string().optional(),
  who: z.string().optional(),
  how: z.string().optional(),
  combines: z.string().optional(),
  accountantNote: z.string().optional(),
  article: z.string().optional(),
  /** У основания: коды видов отчётов, в порядке каталога. */
  types: z.array(z.string()).optional(),
  /** У кода страны: флаг, телефонный код без «+» и маска номера. */
  flag: z.string().optional(),
  dialCode: z.string().optional(),
  mask: z.string().optional(),
  /**
   * У льготы: «Что даёт», «Кто может применять», «Условия», «Как подтверждается», «Срок действия»,
   * «Действует до» (null — без даты), «Сверить» и «Что сверить».
   */
  gives: z.string().optional(),
  payer: z.enum(PAYER_KINDS).optional(),
  conditions: z.string().optional(),
  confirmation: z.string().optional(),
  term: z.string().optional(),
  validUntil: IsoDate.nullable().optional(),
  verify: z.boolean().optional(),
  verifyNote: z.string().optional(),
  /** У льготы: виды отчётов, которые статус делает ненужными и добавляет, — в порядке каталога. */
  removes: z.array(z.string()).optional(),
  adds: z.array(z.string()).optional(),
  /** У льготы: «Меняет сроки» — в порядке каталога видов. */
  dueRules: z.array(BenefitDueRule).optional(),
  /** У льготы: «Ставится по УГНС» — постоянные ключи управлений. */
  offices: z.array(z.string()).optional(),
});
export type AdminDictData = z.infer<typeof AdminDictData>;

/** Значение справочника: «№» (у справочника без порядка — null), «Используется», «Статус». */
export const AdminDictValue = z.object({
  code: z.string(),
  n: z.number().int().nullable(),
  name: z.string(),
  data: AdminDictData,
  active: z.boolean(),
  used: z.number().int().nonnegative(),
  /** У УГНС: у скольких контрагентов указано. */
  contractors: z.number().int().nonnegative(),
  audit: RecordAudit.extend({
    /** Когда администратор добавил значение; у значений из наполнения — null. */
    createdAt: z.iso.datetime().nullable(),
  }),
  version: RecordVersion,
});
export type AdminDictValue = z.infer<typeof AdminDictValue>;

export const AdminDictList = listPageSchema(AdminDictValue).extend({
  /** Всего значений в справочнике (без фильтров): «Ниже» у последнего по «№» недоступно. */
  count: z.number().int().nonnegative(),
});
export type AdminDictList = z.infer<typeof AdminDictList>;

const text = (max: number) => z.string().trim().max(max, message('form.too_long'));

/**
 * Окно значения (прототип valueDlg, ugnsDlg; React Hook Form): название обязательно — «Введите
 * название»; остальные поля — у своих справочников. Код ГНС — ровно три цифры или пусто.
 */
export const AdminDictValueForm = z.object({
  name: z
    .string()
    .trim()
    .min(1, message('pdicts.err.name_required'))
    .max(DICT_NAME_MAX, message('form.too_long')),
  fullName: text(DICT_NAME_MAX).optional(),
  shortName: text(DICT_NAME_MAX).optional(),
  declarationFor: z.enum(DECLARATION_FOR).optional(),
  note: text(DICT_NOTE_MAX).optional(),
  description: text(DICT_NOTE_MAX).optional(),
  // Строка телефона с подписью — с номером; пустые строки сервер не сохраняет.
  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-4
  contacts: z
    .array(
      z.object({ label: text(100), value: text(100) }).refine((c) => !c.label || c.value, {
        path: ['value'],
        ...message('pdicts.err.phone_required'),
      }),
    )
    .max(ORGAN_CONTACTS_MAX)
    .optional(),
  hours: text(300).optional(),
  site: text(300).transform(organSiteUrl).optional(),
  contactsNote: text(300).optional(),
  gnsCode: z
    .string()
    .trim()
    .refine((v) => v === '' || UGNS_CODE_PATTERN.test(v), message('pdicts.err.ugns_code'))
    .optional(),
  region: text(DICT_NAME_MAX).optional(),
  kind: Kind.optional(),
  byPhone: z.boolean().optional(),
  frees: text(DICT_NOTE_MAX).optional(),
  who: text(DICT_NOTE_MAX).optional(),
  how: text(DICT_NOTE_MAX).optional(),
  combines: text(DICT_NOTE_MAX).optional(),
  accountantNote: text(DICT_NOTE_MAX).optional(),
  article: text(DICT_NAME_MAX).optional(),
  types: z.array(z.string().min(1).max(80)).max(500).optional(),
  flag: text(16).optional(),
  dialCode: z
    .string()
    .trim()
    .regex(PHONE_DIAL_CODE_PATTERN, message('pdicts.err.dial_code'))
    .optional(),
  mask: z.string().trim().max(30).regex(PHONE_MASK_PATTERN, message('pdicts.err.mask')).optional(),
  gives: text(DICT_NOTE_MAX).optional(),
  payer: z.enum(PAYER_KINDS).optional(),
  conditions: text(DICT_NOTE_MAX).optional(),
  confirmation: text(DICT_NOTE_MAX).optional(),
  term: text(DICT_NAME_MAX).optional(),
  // Пусто — без даты окончания.
  validUntil: z
    .string()
    .trim()
    .refine((v) => v === '' || isIsoDate(v), message('pdicts.err.until'))
    .optional(),
  verify: z.boolean().optional(),
  verifyNote: text(300).optional(),
  removes: z.array(z.string().min(1).max(80)).max(500).optional(),
  adds: z.array(z.string().min(1).max(80)).max(500).optional(),
  dueRules: z.array(BenefitDueRule).max(500).optional(),
  offices: z.array(z.string().min(1).max(80)).max(500).optional(),
});
export type AdminDictValueFormInput = z.input<typeof AdminDictValueForm>;
export type AdminDictValueForm = z.output<typeof AdminDictValueForm>;

/** Окно налогового органа: краткое название тоже обязательно — «Введите краткое название». */
export const UgnsValueForm = AdminDictValueForm.extend({
  shortName: z
    .string()
    .trim()
    .min(1, message('pdicts.err.short_required'))
    .max(DICT_NAME_MAX, message('form.too_long')),
});

/** Окно режима: полное название тоже обязательно — «Введите полное название». */
export const RegimeValueForm = AdminDictValueForm.extend({
  fullName: z
    .string()
    .trim()
    .min(1, message('pdicts.err.full_required'))
    .max(DICT_NAME_MAX, message('form.too_long')),
});

/** Окно льготы или статуса: «Что даёт» тоже обязательно — «Опишите, что даёт статус». */
export const BenefitValueForm = AdminDictValueForm.extend({
  gives: z
    .string()
    .trim()
    .min(1, message('pdicts.err.gives_required'))
    .max(DICT_NOTE_MAX, message('form.too_long')),
});
export type BenefitValueFormInput = z.input<typeof BenefitValueForm>;
export type BenefitValueForm = z.output<typeof BenefitValueForm>;

/** Окно кода страны: телефонный код и маска обязательны. */
export const PhoneValueForm = AdminDictValueForm.extend({
  dialCode: z.string().trim().regex(PHONE_DIAL_CODE_PATTERN, message('pdicts.err.dial_code')),
  mask: z.string().trim().max(30).regex(PHONE_MASK_PATTERN, message('pdicts.err.mask')),
});

/** Изменить значение: поля окна и версия, которую видел администратор. */
export const AdminDictValueUpdate = AdminDictValueForm.extend({ version: RecordVersion });
export type AdminDictValueUpdate = z.infer<typeof AdminDictValueUpdate>;

/** «Выше» (−1) и «Ниже» (1). */
export const AdminDictMove = z.object({
  step: z.union([z.literal(-1), z.literal(1)]),
  version: RecordVersion,
});

/** «Отключить» / «Включить». */
export const AdminDictActive = z.object({ active: z.boolean(), version: RecordVersion });

/** «Удалить»: версия, которую видел администратор. */
export const AdminDictDeleteQuery = z.object({ version: z.coerce.number().int().nonnegative() });

const HistoryChange = z.object({
  field: z.string(),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
});

/** «История изменений · N» справочника: последние записи, сначала новые; total — сколько всего. */
export const AdminDictHistory = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      id: z.string(),
      at: z.iso.datetime(),
      actor: z.string().nullable(),
      action: z.string(),
      code: z.string(),
      /** Как значение называлось: название, у УГНС — «код кратко». */
      label: z.string(),
      changes: z.array(HistoryChange),
      /** Правка кода страны: вся строка до и после («Кыргызстан +996 XXX XXX XXX»), как в прототипе. */
      summary: z.object({ from: z.string(), to: z.string() }).optional(),
    }),
  ),
});
export type AdminDictHistory = z.infer<typeof AdminDictHistory>;

/**
 * День вкладки «Календарь»: ключ записи (`MM-DD` — праздник каждый год, иначе дата), дата в году
 * списка, вид и название. У дней из наполнения «Создано» пусто, как у значений справочников.
 */
export const AdminCalendarDay = z.object({
  key: z.string(),
  date: IsoDate,
  kind: z.enum(CALENDAR_DAY_KINDS),
  name: z.string(),
  everyYear: z.boolean(),
  audit: RecordAudit.extend({ createdAt: z.iso.datetime().nullable() }),
  version: RecordVersion,
});
export type AdminCalendarDay = z.infer<typeof AdminCalendarDay>;

/** Дни текущего и следующего года; `nextFilled` — в следующем году уже есть даты «только в этом году». */
export const AdminCalendarList = listPageSchema(AdminCalendarDay).extend({
  year: z.number().int(),
  nextFilled: z.boolean(),
});
export type AdminCalendarList = z.infer<typeof AdminCalendarList>;

/** Окно «Нерабочий день» (прототип holidayDlg): дата, тип и название праздника. */
export const AdminCalendarAddForm = z
  .object({
    date: z.string().trim().refine(isIsoDate, message('pdicts.cal.err.date')),
    type: z.enum(CALENDAR_ADD_TYPES),
    name: text(DICT_NAME_MAX),
  })
  .refine((x) => x.type === 'workday' || x.name.length > 0, {
    path: ['name'],
    ...message('pdicts.cal.err.name'),
  });
export type AdminCalendarAddFormInput = z.input<typeof AdminCalendarAddForm>;
export type AdminCalendarAddForm = z.output<typeof AdminCalendarAddForm>;

/** Ключ дня календаря: `MM-DD` или `YYYY-MM-DD`. */
export const AdminCalendarDayParam = z.object({
  key: z.string().regex(/^(\d{4}-)?\d{2}-\d{2}$/),
});

/** Ответ правки календаря: у скольких несданных отчётов пересчитан срок. */
export const AdminCalendarChanged = z.object({ recalculated: z.number().int().nonnegative() });
export type AdminCalendarChanged = z.infer<typeof AdminCalendarChanged>;

/** «Календарь на следующий год копированием»: что будет скопировано в год `year`. */
export const AdminCalendarCopyPlan = z.object({
  year: z.number().int(),
  items: z.array(
    z.object({
      from: IsoDate,
      to: IsoDate,
      kind: z.enum(CALENDAR_DAY_KINDS),
      name: z.string(),
    }),
  ),
});
export type AdminCalendarCopyPlan = z.infer<typeof AdminCalendarCopyPlan>;

/** Скопировано дней и у скольких несданных отчётов пересчитан срок. */
export const AdminCalendarCopied = AdminCalendarChanged.extend({
  year: z.number().int(),
  copied: z.number().int().nonnegative(),
});
export type AdminCalendarCopied = z.infer<typeof AdminCalendarCopied>;

/**
 * Каталог видов отчётов кратко: выбор видов у основания и статуса, подписи «Виды отчётов» и правило
 * срока сдачи — для строк «Меняет сроки» статуса.
 */
export const AdminReportTypeOptions = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      shortName: z.string(),
      kind: z.enum(REPORT_KINDS),
      active: z.boolean(),
      period: z.enum(REPORT_PERIODS),
      dueDay: z.number().int(),
      dueAfter: z.number().int().nullable(),
      dueMonth: z.number().int().nullable(),
      dueFrom: z.enum(DUE_FROM),
      act: z.enum(REPORT_ACTS),
      oneOff: z.boolean(),
      periodPerAssignment: z.boolean(),
    }),
  ),
});
export type AdminReportTypeOptions = z.infer<typeof AdminReportTypeOptions>;

/** Шапки вкладок: группы справочников платформы (раздел `dictGroups`) — что это и где используется. */
export const AdminDictGroups = z.object({
  items: z.array(
    z.object({
      group: z.string(),
      tabs: z.array(
        z.object({
          tab: z.string(),
          key: z.string(),
          about: z.string().optional(),
          usedIn: z.string().optional(),
        }),
      ),
    }),
  ),
});
export type AdminDictGroups = z.infer<typeof AdminDictGroups>;

/** Числа на вкладках модуля: новых запросов. */
export const PdictsTabCounts = z.object({ requests: z.number().int().nonnegative() });
export type PdictsTabCounts = z.infer<typeof PdictsTabCounts>;

/** Запрос организации в «Запросах»: кто, что просил, статус и ответ. «Создал» — кто отправил. */
export const AdminDictRequest = z.object({
  id: Uuid,
  orgName: z.string(),
  dict: z.enum(DICT_REQUEST_DICTS),
  what: z.string(),
  comment: z.string(),
  status: z.enum(DICT_REQUEST_STATUSES),
  answer: z.string(),
  decidedAt: z.iso.datetime().nullable(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type AdminDictRequest = z.infer<typeof AdminDictRequest>;

export const AdminDictRequestList = listPageSchema(AdminDictRequest);
export type AdminDictRequestList = z.infer<typeof AdminDictRequestList>;

export const DictRequestIdParam = z.object({ id: Uuid });

/** Окно ответа (прототип v59 reqAnswerDlg): «Ответ организации». */
export const DictRequestAnswerForm = z.object({
  answer: text(DICT_REQUEST_ANSWER_MAX),
});
export type DictRequestAnswerFormInput = z.input<typeof DictRequestAnswerForm>;

/** «Добавлено» или «Отклонено» с ответом; при отказе ответ обязателен. */
export const DictRequestAnswerRequest = DictRequestAnswerForm.extend({
  status: z.enum(DICT_REQUEST_ANSWERS),
  version: RecordVersion,
}).refine((x) => x.status === 'added' || x.answer.length > 0, {
  message: 'pdicts.req.answer.required',
  path: ['answer'],
});
export type DictRequestAnswerRequest = z.infer<typeof DictRequestAnswerRequest>;

/** Таблица вкладки «Налоги и ставки»: налоги и платежи, ставки единого налога, ставки на имущество. */
export const AdminTaxListParam = z.object({ list: z.enum(ADMIN_TAX_LISTS) });

/** Строка таблицы «Налогов и ставок»: ключ и значения столбцов (деньги — в тыйынах). */
export const AdminTaxRow = z.object({
  id: z.string(),
  values: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type AdminTaxRow = z.infer<typeof AdminTaxRow>;

export const AdminTaxRowList = listPageSchema(AdminTaxRow);
export type AdminTaxRowList = z.infer<typeof AdminTaxRowList>;

/** Пояснения вкладки: размер бизнеса, кто не может применять единый налог, ставки на имущество. */
export const AdminTaxInfo = z.object({
  bizSize: z.array(
    z.object({ code: z.string(), name: z.string(), rule: z.string(), note: z.string() }),
  ),
  enRates: z.array(z.string()),
  propertyRates: z.string(),
});
export type AdminTaxInfo = z.infer<typeof AdminTaxInfo>;
