import {
  BIZ_SIZES,
  CONTRACTOR_KINDS,
  CONTRACTOR_TEXT_MAX,
  FEE_DAY_MAX,
  FEE_DAY_MIN,
  FIRST_MONTH_MODES,
  PAYS_TO,
  SERVICE_STATUSES,
  SOCFUND_TARIFFS,
  TARIFF_PERIODS,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordAudit, RecordVersion, Tyiyn, Uuid } from './common';
import { ContractorRegdocs } from './contractor-regdocs';
import { YearMonth } from './kpi';
import { listPageSchema } from './list';
import { TaxTariff } from './platform-dicts';
import { Phone } from './staff';

/** Без нулевого символа: PostgreSQL его в тексте не принимает, и сохранение упало бы ошибкой сервера. */
const noNul = (s: string) => !s.includes('\u0000');

/** Постоянный код значения справочника платформы (ФС-01, РЕЖ-03, ЛЬГ-01, employees, 47.11.0). */
const Code = z.string().trim().min(1).max(60).refine(noNul);
const Text = (max: number) => z.string().trim().max(max).refine(noNul);

/** Значение справочника в ответе: код и название, как его видит пользователь. */
const Named = z.object({ code: z.string(), name: z.string() });

/** Льгота или особый статус со сроком действия. */
export const ContractorBenefit = z.object({
  code: Code,
  validFrom: IsoDate.nullable(),
  validTo: IsoDate.nullable(),
});

/** Регистрационные данные (ТЗ «Реквизиты из регистрационных документов»): только заполненные. */
export const ContractorRegistration = z.object({
  fullName: Text(CONTRACTOR_TEXT_MAX.registration).optional(),
  regNo: Text(100).optional(),
  okpo: Text(8).optional(),
  address: Text(CONTRACTOR_TEXT_MAX.registration).optional(),
  email: Text(200).optional(),
  regDate: IsoDate.optional(),
  reRegDate: IsoDate.optional(),
  founders: z.number().int().nonnegative().max(100_000).optional(),
  foreign: z.enum(['yes', 'no']).optional(),
});

/** Первая запись журнала тарифов: сумма в тыйынах (0 — допустимо) и периодичность. */
export const ContractorTariffRequest = z.object({
  amount: Tyiyn.refine((v) => v >= 0, 'Сумма не может быть отрицательной'),
  period: z.enum(TARIFF_PERIODS),
});

/** Признак для тарифа Соцфонда: да, нет или не указан (null). */
const SocfundFlag = z.boolean().nullable().default(null);

/**
 * Признаки и выбор тарифа Соцфонда из формы (прототип socfund-ui.js, sfApply): `tariff` не передан —
 * выбор не трогали, null — «Определить автоматически». Причина обязательна, если выбор расходится с
 * условиями (`socfund_reason_required`).
 */
export const ContractorSocfundRequest = z.strictObject({
  flags: z.strictObject({
    cashless: SocfundFlag,
    registry: SocfundFlag,
    confirmed: SocfundFlag,
    gov: SocfundFlag,
  }),
  tariff: z.enum(SOCFUND_TARIFFS).nullable().optional(),
  reason: Text(CONTRACTOR_TEXT_MAX.socfundReason).default(''),
});
export type ContractorSocfundRequest = z.input<typeof ContractorSocfundRequest>;

/** Поля формы контрагента, общие для создания и «Изменить» (ТЗ «Обязательные поля», «Необязательные поля»). */
const contractorFields = {
  name: z.string().trim().min(1).max(CONTRACTOR_TEXT_MAX.name).refine(noNul),
  inn: z.string().trim().max(20).refine(noNul),
  phone: Phone.min(1),
  formCode: Code,
  regimeCode: Code.nullable(),
  regime2Code: Code.nullable(),
  gked: Code.nullable(),
  gkedExtra: z.array(Code).max(200),
  taxOfficeCode: Code.nullable(),
  bizSize: z.enum(BIZ_SIZES),
  benefits: z.array(ContractorBenefit).max(100),
  bases: z.array(Code).max(50),
  head: Text(CONTRACTOR_TEXT_MAX.person),
  contact: Text(CONTRACTOR_TEXT_MAX.person),
  contractNo: Text(CONTRACTOR_TEXT_MAX.contractNo),
  contractDate: IsoDate.nullable(),
  note: Text(CONTRACTOR_TEXT_MAX.note),
  registration: ContractorRegistration,
  startDate: IsoDate,
  firstMonthMode: z.enum(FIRST_MONTH_MODES),
  feeDay: z.number().int().min(FEE_DAY_MIN).max(FEE_DAY_MAX),
  paysTo: z.enum(PAYS_TO),
  /**
   * «Подтверждаю» / «Нет, не оказывает» на вопрос о праве на режим по ГКЭД (прототип gkEnOk): без него
   * сохранение с таким вопросом отклоняется (`gked_confirm_required`), с ним — подтверждение
   * сохраняется у контрагента и пишется в историю.
   */
  gkedConfirm: z.boolean().optional(),
  /** Признаки и тариф Соцфонда; не переданы — не меняются (у разового контрагента их нет). */
  socfund: ContractorSocfundRequest.optional(),
  /**
   * «Сохранить» в окне «Тариф не совпадает с условиями» (прототип sfConfirm): без него ручной выбор,
   * который расходится с условиями, отклоняется (`socfund_confirm_required`).
   */
  socfundConfirm: z.boolean().optional(),
};

/**
 * Отчёт, который форма создания назначает новому контрагенту (прототип addCpDlg, rateRows): ставка из
 * ставок вида (null — по умолчанию, как `defRate` прототипа), строки ЕНС у единого налога (пусто — по
 * ГКЭД и статусам, как `enAuto`) и добавленные строки налога с продаж. Строка ЕНС — как
 * `AssignmentEnRate` в reports.ts (тот файл сам импортирует этот, поэтому схема своя).
 */
export const ContractorNewReport = z.strictObject({
  code: Code,
  rate: Text(60).min(1).nullable().default(null),
  enRates: z
    .array(z.strictObject({ code: Code, variant: z.number().int().min(0).max(20).nullable() }))
    .max(20)
    .default([]),
  rateAdditions: z.array(Code).max(20).default([]),
});
export type ContractorNewReport = z.input<typeof ContractorNewReport>;

/**
 * Новый контрагент (прототип modules/contractor-form.js, addCpDlg). Ответственный обязателен;
 * стоимость обслуживания — у постоянного и только с правом «Видеть плату за обслуживание».
 * Отчёты (`reports`) создаются вместе с контрагентом одним целым: у постоянного нужен хотя бы один, у
 * разового их нет; `reportsForced` — обязательные, которые сняли с подтверждением «Снять обязательный
 * отчёт?» (в истории «Не назначен отчёт …, хотя он …»).
 */
export const CreateContractorRequest = z.object({
  ...contractorFields,
  kind: z.enum(CONTRACTOR_KINDS),
  responsibleEmployeeId: Uuid,
  regimeCode: contractorFields.regimeCode.default(null),
  regime2Code: contractorFields.regime2Code.default(null),
  gkedExtra: contractorFields.gkedExtra.default([]),
  taxOfficeCode: contractorFields.taxOfficeCode.default(null),
  bizSize: contractorFields.bizSize.default('small'),
  // Список из формы берётся как есть (статусы по УГНС форма ставит и снимает сама); без поля статусы
  // по УГНС ставит сервер.
  benefits: contractorFields.benefits.optional(),
  bases: contractorFields.bases.default([]),
  head: contractorFields.head.default(''),
  contact: contractorFields.contact.default(''),
  contractNo: contractorFields.contractNo.default(''),
  contractDate: contractorFields.contractDate.default(null),
  note: contractorFields.note.default(''),
  registration: ContractorRegistration.default({}),
  // День оплаты и «Первый неполный месяц» задаёт только тот, кто видит плату за обслуживание;
  // не переданы — 10-е число и «Пропорционально дням» при ставке «в месяц», иначе «Полный месяц»
  // (docs/deviations.md п. А-1).
  firstMonthMode: contractorFields.firstMonthMode.optional(),
  feeDay: contractorFields.feeDay.optional(),
  paysTo: contractorFields.paysTo.default('emp'),
  tariff: ContractorTariffRequest.nullable().default(null),
  // Без поля — контрагент без отчётов, как до формы 2.09 (docs/decisions.md п. А-5).
  reports: z.array(ContractorNewReport).max(300).optional(),
  reportsForced: z.array(Code).max(300).default([]),
  // Создание «Из свидетельства и выписки» (задача 2.17): документы окна прикрепятся к контрагенту.
  regdocs: ContractorRegdocs.optional(),
});
export type CreateContractorRequest = z.input<typeof CreateContractorRequest>;

/**
 * «Изменить» в карточке (прототип editCpDlg): не переданное поле не меняется. Ответственного меняет
 * «Сменить ответственного» (`AssignContractorsRequest`), тариф — журнал тарифов (поток В), статус —
 * приостановка и архив (задача 2.12); дата начала обслуживания и «Первый неполный месяц» после
 * создания не меняются («тариф и дата начала меняются своими действиями»).
 */
export const UpdateContractorRequest = z
  .object(contractorFields)
  .omit({ startDate: true, firstMonthMode: true })
  .partial()
  .extend({ version: RecordVersion });
export type UpdateContractorRequest = z.infer<typeof UpdateContractorRequest>;

/**
 * Тариф Соцфонда словами (прототип sfState, sfCardKv): нужен ли (постоянный контрагент с наёмными
 * сотрудниками, docs/deviations.md п. А-5), признаки, выбранный тариф, тариф по условиям с причинами, `bad` — выбранный
 * не совпадает с условиями (`badWhy` — почему), `ask` — «Тариф под вопросом».
 */
export const ContractorSocfund = z.object({
  needed: z.boolean(),
  flags: z.object({
    cashless: z.boolean().nullable(),
    registry: z.boolean().nullable(),
    confirmed: z.boolean().nullable(),
    gov: z.boolean().nullable(),
  }),
  tariff: z
    .object({
      id: z.enum(SOCFUND_TARIFFS),
      short: z.string(),
      title: z.string(),
      total: z.string(),
      manual: z.boolean(),
      reason: z.string().nullable(),
    })
    .nullable(),
  auto: z
    .object({
      id: z.enum(SOCFUND_TARIFFS).nullable(),
      short: z.string(),
      total: z.string(),
      why: z.array(z.string()),
      miss: z.array(z.string()),
      warn: z.array(z.string()),
    })
    .nullable(),
  bad: z.boolean(),
  badWhy: z.string(),
  ask: z.boolean(),
});
export type ContractorSocfund = z.infer<typeof ContractorSocfund>;

/** Сверка с ГКЭД словами (как в форме и карточке, `gkedCheckTexts`). */
export const ContractorGkedNotes = z.object({
  /** Режим нельзя применять: контрагент не сохраняется. */
  block: z.array(z.string()),
  /** Замечания по режимам: вопросы с подтверждением, «не подходит», «не применяется к …». */
  regime: z.array(z.string()),
  benefits: z.array(z.string()),
  /** Подсказка ставки единого налога. */
  rate: z.array(z.string()),
  /** Назначенные виды отчётов, которые не подходят по ГКЭД. */
  types: z.array(z.string()),
  /** Коды, которые больше не действуют. */
  off: z.array(z.string()),
  /** Есть вопрос о праве на режим, на который ещё не ответили (нужно «Подтверждаю»). */
  confirmNeeded: z.boolean(),
  /** Вопрос группы кода («Оказывает услуги интернета?»); пусто — общий «Подтверждаю». */
  ask: z.string(),
  /**
   * Окно «Проверьте право на режим «…»» с текстом и кнопкой — у сверки для формы, пока нужен ответ;
   * в карточке — null.
   */
  confirm: z.object({ title: z.string(), text: z.string(), ok: z.string() }).nullable(),
});
export type ContractorGkedNotes = z.infer<typeof ContractorGkedNotes>;

/** Карточка контрагента (прототип modules/contractor-card.js, вкладка «Основное»). */
export const Contractor = z.object({
  id: Uuid,
  name: z.string(),
  inn: z.string(),
  phone: z.string(),
  /** Телефон по маске справочника «Коды телефонов»: «+996 505 890 076». */
  phoneText: z.string(),
  kind: z.enum(CONTRACTOR_KINDS),
  form: Named.extend({ declarationFor: z.enum(['org', 'ip']) }),
  regime: Named.nullable(),
  regime2: Named.nullable(),
  gked: Named.nullable(),
  gkedExtra: z.array(Named),
  taxOffice: Named.nullable(),
  bizSize: z.enum(BIZ_SIZES),
  /** `byOffice` — статус ставит УГНС контрагента: метка «по УГНС». */
  benefits: z.array(
    Named.extend({
      validFrom: IsoDate.nullable(),
      validTo: IsoDate.nullable(),
      byOffice: z.boolean(),
    }),
  ),
  bases: z.array(Named),
  /** null — нет ответственного (после блокировки сотрудника): контрагент подсвечивается. */
  responsible: z.object({ id: Uuid, shortName: z.string(), active: z.boolean() }).nullable(),
  head: z.string(),
  contact: z.string(),
  contractNo: z.string(),
  contractDate: IsoDate.nullable(),
  note: z.string(),
  registration: ContractorRegistration,
  startDate: IsoDate,
  /** День оплаты и «Первый неполный месяц»; null — нет права «Видеть плату за обслуживание». */
  firstMonthMode: z.enum(FIRST_MONTH_MODES).nullable(),
  feeDay: z.number().int().nullable(),
  paysTo: z.enum(PAYS_TO),
  /** «Файл при поступлении»: поступление нельзя сохранить без файла (задача 2.19). */
  needReceiptFile: z.boolean(),
  /**
   * Создан «Из свидетельства и выписки» с документами (задача 2.17; прототип `c.regFiles`): подпись у
   * блока «Регистрационные данные».
   */
  regdocs: z.boolean(),
  /** «Платит одной суммой» (задача 2.21); null — нет права «Видеть плату за обслуживание». */
  oneSum: z.boolean().nullable(),
  serviceStatus: z.enum(SERVICE_STATUSES),
  /** Действующая ставка обслуживания; null — нет ставки или нет права «Видеть плату за обслуживание». */
  tariff: z
    .object({ amount: Tyiyn, period: z.enum(TARIFF_PERIODS), validFrom: IsoDate })
    .nullable(),
  /** Кто и когда подтвердил право на режим по ГКЭД (жёлтая отметка в карточке). */
  gkedConfirmation: z
    .object({ by: z.string(), employeeId: Uuid, at: IsoDate, ask: z.string() })
    .nullable(),
  gkedNotes: ContractorGkedNotes,
  socfund: ContractorSocfund,
  /** Просроченных отчётов (у приостановленного — 0): в подписи карточки и на вкладке «Отчёты к сдаче». */
  overdue: z.number().int().nonnegative(),
  /** Есть отчёты: «Удалить» недоступно, только «В архив». */
  hasReports: z.boolean(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type Contractor = z.infer<typeof Contractor>;

/**
 * Ответ на создание и «Изменить»: карточка, уведомления «Отмечен статус «…» по УГНС» и у скольких
 * несданных отчётов статусы изменили срок (уведомление «Сроки по статусу изменены у N отчётов»).
 */
export const ContractorSaved = Contractor.extend({
  notices: z.array(z.string()),
  redued: z.number().int().nonnegative(),
});
export type ContractorSaved = z.infer<typeof ContractorSaved>;

/** Ответ на создание: ещё и сколько отчётов создано («Контрагент добавлен, отчётов создано: N»). */
export const ContractorCreated = ContractorSaved.extend({
  reportsCreated: z.number().int().nonnegative(),
});
export type ContractorCreated = z.infer<typeof ContractorCreated>;

/** Строка списка контрагентов (прототип cpCols): тексты, как в столбцах экрана. */
export const ContractorRow = z.object({
  id: Uuid,
  name: z.string(),
  inn: z.string(),
  phone: z.string(),
  phoneText: z.string(),
  kind: z.enum(CONTRACTOR_KINDS),
  form: z.string(),
  regime: z.string().nullable(),
  regimeCode: z.string().nullable(),
  regime2: z.string().nullable(),
  benefits: z.string().nullable(),
  gked: Named.nullable(),
  gkedExtra: z.string().nullable(),
  taxOffice: z.string().nullable(),
  serviceStatus: z.enum(SERVICE_STATUSES),
  responsible: z.object({ id: Uuid, shortName: z.string() }).nullable(),
  startDate: IsoDate,
  contractNo: z.string(),
  contractDate: IsoDate.nullable(),
  head: z.string(),
  contact: z.string(),
  /** null — нет ставки или нет права «Видеть плату за обслуживание». */
  tariff: z.object({ amount: Tyiyn, period: z.enum(TARIFF_PERIODS) }).nullable(),
  /** Долг за обслуживание (задача 2.21); null — нет права «Видеть плату за обслуживание». */
  feeDebt: Tyiyn.nullable(),
  /**
   * Есть начисления за обслуживание — хотя бы одно больше 0 (прототип `feeAccOk`: пункт «Принять оплату
   * за обслуживание» в меню строки); null — нет права «Видеть плату за обслуживание».
   */
  feeCharged: z.boolean().nullable(),
  /** «Платит одной суммой». */
  oneSum: z.boolean(),
  /** «Файл к поступлению обязателен». */
  needReceiptFile: z.boolean(),
  /**
   * Тариф Соцфонда: выбранный кратко (`id` null — «Не определён») и «Тариф под вопросом» (не определён
   * или выбран вручную вопреки условиям); null — тариф контрагенту не нужен.
   */
  socfund: z
    .object({
      id: z.enum(SOCFUND_TARIFFS).nullable(),
      short: z.string(),
      total: z.string(),
      ask: z.boolean(),
    })
    .nullable(),
  /** Просроченных отчётов (у приостановленного — 0). */
  overdue: z.number().int().nonnegative(),
  /** Незавершённых отчётов: ещё не сданы и не «Не требуется». */
  openReports: z.number().int().nonnegative(),
  /** Видов отчётов: действующие назначения. */
  reportTypes: z.number().int().nonnegative(),
  /** Есть отчёты: «Удалить» недоступно, только «В архив». */
  hasReports: z.boolean(),
  /**
   * Обслуживание для пунктов меню строки (правила `serviceMenu`): периоды, идущий месяц по Бишкеку и
   * запланированное.
   */
  service: z.object({
    periods: z.array(z.object({ from: YearMonth, to: YearMonth.nullable() })),
    month: YearMonth,
    plannedPause: z.object({ from: YearMonth, resume: YearMonth.nullable() }).nullable(),
    plannedResume: YearMonth.nullable(),
  }),
  /** Когда и кто поставил нынешний статус обслуживания; без смен — создание контрагента. */
  serviceSince: z.object({ at: z.iso.datetime(), by: z.string().nullable() }),
  audit: RecordAudit,
  version: RecordVersion,
});
export type ContractorRow = z.infer<typeof ContractorRow>;

/** Страница списка контрагентов: сортировка, страницы, фильтры и группы — на сервере. */
export const ContractorList = listPageSchema(ContractorRow);
export type ContractorList = z.infer<typeof ContractorList>;

/** Вкладка списка (прототип cpsTabs): «Все» и «Мои контрагенты». */
/** Вкладка списка: «Все», «Мои контрагенты», «Должники» (задача 2.21: только тем, кто видит плату). */
export const ContractorTabParam = z.object({
  tab: z.enum(['all', 'mine', 'debtors']).default('all'),
});

/** Счётчики вкладок: в области, свои и должники (null — плата не видна); без архива. */
export const ContractorTabCounts = z.object({
  all: z.number().int().nonnegative(),
  mine: z.number().int().nonnegative(),
  debtors: z.number().int().nonnegative().nullable(),
});
export type ContractorTabCounts = z.infer<typeof ContractorTabCounts>;

/**
 * Итоги плашек списка (прототип renderCps) в области сотрудника: кроме «В архиве» — без архивных;
 * `kpiMissing` null — плашки «Не заполнены показатели» нет (функция выключена или нет права).
 */
export const ContractorSummary = z.object({
  active: z.number().int().nonnegative(),
  noResponsible: z.number().int().nonnegative(),
  withOverdue: z.number().int().nonnegative(),
  noGked: z.number().int().nonnegative(),
  socfundAsk: z.number().int().nonnegative(),
  kpiMissing: z.number().int().nonnegative().nullable(),
  paused: z.number().int().nonnegative(),
  oneoff: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  /**
   * Плашка «Должники» (задача 2.21): контрагентов с долгом за обслуживание и сумма долгов; null —
   * плата не видна.
   */
  debtors: z.object({ count: z.number().int().nonnegative(), sum: Tyiyn }).nullable(),
  /** Область «Все контрагенты» («вся организация» под «На обслуживании»). */
  scopeAll: z.boolean(),
});
export type ContractorSummary = z.infer<typeof ContractorSummary>;

/**
 * Вкладка «История» карточки контрагента: записи самого контрагента, его назначений, отчётов, задач и
 * страницы — от новых к старым; `subject` — «НДС 09.2026» у отчёта, вид у назначения, название задачи;
 * `names` — названия сотрудников и справочных кодов из «было → стало».
 */
export const ContractorHistory = z.object({
  items: z.array(
    z.object({
      id: z.number().int(),
      at: z.iso.datetime(),
      actor: z.string().nullable(),
      entity: z.string(),
      action: z.string(),
      reason: z.string().nullable(),
      changes: z.array(
        z.object({ field: z.string(), from: z.unknown().optional(), to: z.unknown().optional() }),
      ),
      subject: z.string().nullable(),
    }),
  ),
  names: z.record(z.string(), z.string()),
});
export type ContractorHistory = z.infer<typeof ContractorHistory>;

/** «Назначить ответственного» одному или нескольким контрагентам (прототип respDlg). */
export const AssignContractorsRequest = z.object({
  ids: z.array(Uuid).min(1).max(5000),
  responsibleEmployeeId: Uuid,
});
export type AssignContractorsRequest = z.infer<typeof AssignContractorsRequest>;

/** Сколько контрагентов получили нового ответственного (тот же ответственный — без изменений). */
export const AssignContractorsResult = z.object({ changed: z.number().int().nonnegative() });
export type AssignContractorsResult = z.infer<typeof AssignContractorsResult>;

/** Передача дел от сотрудника (прототип transferDlg). */
export const TransferContractorsQuery = z.object({ from: Uuid });
export const TransferContractorsPreview = z.object({
  contractors: z.number().int().nonnegative(),
  /** Незавершённые отчёты этих контрагентов, которые перейдут вместе с ними. */
  reports: z.number().int().nonnegative(),
  /** «Открытые задачи по ним» — исполнитель этот сотрудник. */
  tasks: z.number().int().nonnegative(),
  /** «Кому» по умолчанию — главный бухгалтер; null — передать некому. */
  defaultTo: Uuid.nullable(),
});
export type TransferContractorsPreview = z.infer<typeof TransferContractorsPreview>;

export const TransferContractorsRequest = z.object({ from: Uuid, to: Uuid });
export type TransferContractorsRequest = z.infer<typeof TransferContractorsRequest>;

/**
 * Значения для формы контрагента: действующие сотрудники для «Ответственный бухгалтер», ответственный
 * по умолчанию (сам сотрудник, если он видит только своих контрагентов), видит ли он плату за
 * обслуживание (`fee`) и включена ли она в организации (`feeOn` — иначе поля нет совсем).
 */
export const ContractorFormOptions = z.object({
  employees: z.array(z.object({ id: Uuid, shortName: z.string() })),
  defaultResponsible: Uuid.nullable(),
  fee: z.boolean(),
  feeOn: z.boolean(),
});
export type ContractorFormOptions = z.infer<typeof ContractorFormOptions>;

/** Окно выбора ГКЭД: код, начало кода или слова названия (прототип gkPickDlg). */
export const GkedSearchQuery = z.object({ q: Text(200).default('') });

/** Найденные подклассы ГКЭД: первые по порядку справочника, путь — коды от секции до класса. */
export const GkedSearchResult = z.object({
  items: z.array(z.object({ code: z.string(), name: z.string(), path: z.array(z.string()) })),
  total: z.number().int().nonnegative(),
});
export type GkedSearchResult = z.infer<typeof GkedSearchResult>;

/**
 * Сверка с ГКЭД для формы (ТЗ: «под полями ГКЭД сразу видны предупреждения»): набранные значения и, у
 * созданного контрагента, его номер — для сохранённого подтверждения.
 */
export const ContractorGkedCheckRequest = z.object({
  contractorId: Uuid.optional(),
  gked: Code.nullable(),
  gkedExtra: z.array(Code).max(200).default([]),
  formCode: Code.nullable(),
  regimeCode: Code.nullable(),
  regime2Code: Code.nullable(),
  benefits: z.array(Code).max(100).default([]),
  /** Назначенные виды отчётов (коды каталога). */
  reportTypes: z.array(Code).max(300).default([]),
});
export type ContractorGkedCheckRequest = z.input<typeof ContractorGkedCheckRequest>;

/**
 * Тариф Соцфонда для формы и окна «Тариф Соцфонда» (прототип sfFields): набранные значения и, у
 * созданного контрагента, его номер — для сохранённого выбора и действующих назначений (STI-161).
 */
export const ContractorSocfundCheckRequest = ContractorSocfundRequest.extend({
  contractorId: Uuid.optional(),
  kind: z.enum(CONTRACTOR_KINDS),
  bases: z.array(Code).max(50).default([]),
  gked: Code.nullable(),
  formCode: Code.nullable(),
  benefits: z.array(Code).max(100).default([]),
});
export type ContractorSocfundCheckRequest = z.input<typeof ContractorSocfundCheckRequest>;

/** Тариф справочника для выбора и «Ставки»: название, ставки одной строкой, предельная база, ставки по фондам. */
export const SocfundTariffInfo = z.object({
  id: z.enum(SOCFUND_TARIFFS),
  title: z.string(),
  short: z.string(),
  total: z.string(),
  rates: z.string(),
  cap: z.string(),
  tariff: TaxTariff,
});
export type SocfundTariffInfo = z.infer<typeof SocfundTariffInfo>;

/**
 * Ответ форме: тариф по набранным значениям (`tariff` — выбранный в форме), нужны ли причина и
 * подтверждение (`manualMismatch`, текст окна — `confirm`), тарифы справочника и пояснение о ГНПФ.
 */
export const ContractorSocfundCheck = ContractorSocfund.extend({
  manualMismatch: z.boolean(),
  confirm: z.string(),
  tariffs: z.array(SocfundTariffInfo),
  gnpf: z.object({ text: z.string(), verifyNote: z.string() }).nullable(),
});
export type ContractorSocfundCheck = z.infer<typeof ContractorSocfundCheck>;

/** Тариф кратко для отчёта STI-161: название, итоговая ставка, ставки одной строкой, предельная база. */
export const SocfundBrief = z.object({
  id: z.enum(SOCFUND_TARIFFS),
  short: z.string(),
  total: z.string(),
  rates: z.string(),
  cap: z.string(),
});
export type SocfundBrief = z.infer<typeof SocfundBrief>;

/** Окно «Тариф Соцфонда» из карточки: признаки, выбор, причина, версия и подтверждение. */
export const SaveContractorSocfundRequest = ContractorSocfundRequest.extend({
  version: RecordVersion,
  confirm: z.boolean().optional(),
});
export type SaveContractorSocfundRequest = z.input<typeof SaveContractorSocfundRequest>;
