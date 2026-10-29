import {
  BIZ_SIZES,
  CONTRACTOR_KINDS,
  CONTRACTOR_TEXT_MAX,
  FEE_DAY_MAX,
  FEE_DAY_MIN,
  FIRST_MONTH_MODES,
  PAYS_TO,
  SERVICE_STATUSES,
  TARIFF_PERIODS,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordAudit, RecordVersion, Tyiyn, Uuid } from './common';
import { listPageSchema } from './list';
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
};

/**
 * Новый контрагент (прототип modules/contractor-form.js, addCpDlg). Ответственный обязателен;
 * стоимость обслуживания — у постоянного и только с правом «Видеть плату за обслуживание».
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
  benefits: contractorFields.benefits.default([]),
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
  audit: RecordAudit,
  version: RecordVersion,
});
export type Contractor = z.infer<typeof Contractor>;

/** Ответ на создание и «Изменить»: карточка и уведомления «Отмечен статус «…» по УГНС». */
export const ContractorSaved = Contractor.extend({ notices: z.array(z.string()) });
export type ContractorSaved = z.infer<typeof ContractorSaved>;

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
  audit: RecordAudit,
  version: RecordVersion,
});
export type ContractorRow = z.infer<typeof ContractorRow>;

/** Страница списка контрагентов: сортировка, страницы, фильтры и группы — на сервере. */
export const ContractorList = listPageSchema(ContractorRow);
export type ContractorList = z.infer<typeof ContractorList>;

/** Вкладка списка (прототип cpsTabs): «Все» и «Мои контрагенты». */
export const ContractorTabParam = z.object({ tab: z.enum(['all', 'mine']).default('all') });

/** Счётчики вкладок: в области и свои; без архива. */
export const ContractorTabCounts = z.object({
  all: z.number().int().nonnegative(),
  mine: z.number().int().nonnegative(),
});
export type ContractorTabCounts = z.infer<typeof ContractorTabCounts>;

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
