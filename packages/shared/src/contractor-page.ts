import {
  CP_TG_ACTIONS,
  CP_TG_STATUSES,
  DEBT_TOGGLE_REFUSALS,
  INDICATOR_TOTALS,
  INDICATOR_TYPES,
  PAGE_FILE_CATEGORIES,
  PAGE_REPORT_STATUSES,
  PAGE_SECTIONS,
  PAGE_TIPS,
  type PageTipId,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordVersion, Tyiyn, Uuid } from './common';
import { OrgLogoLink, PageSectionSchema } from './org';

/*
 * Схемы страницы контрагента по ссылке (задача 2.42): блок «Страница контрагента» карточки, включение
 * у нескольких контрагентов и страница без входа (ввод кода, «Страница недоступна»); разделы открытой
 * страницы (задача 2.43). Ошибки сервера — `err.<code>`.
 */

/** Почему действие в блоке недоступно — ключ словаря `err.<код>` (`PAGE_MESSAGES`). */
export const PageRefusalCode = z.enum([
  'page_manage_right',
  'page_send_right',
  'page_archived',
  'page_off',
]);

/** Блок «Страница контрагента» на вкладке «Основное» карточки (прототип pgBox). */
export const ContractorPage = z.object({
  /** Функция «Страница контрагента по ссылке» включена в учётной политике; иначе блока нет. */
  featureOn: z.boolean(),
  enabled: z.boolean(),
  archived: z.boolean(),
  /** Ссылка для контрагента и код доступа — только у включённой страницы. */
  link: z.string().nullable(),
  code: z.string().nullable(),
  lastOpenAt: z.iso.datetime().nullable(),
  lastDevice: z.string().nullable(),
  /**
   * Страница закрыта после 5 неверных кодов за сутки — до «Сменить код» (docs/deviations.md п. О-21).
   */
  closed: z.boolean(),
  /** Разделы организации, которые можно скрыть у этого контрагента, по порядку страницы. */
  sections: z.array(PageSectionSchema),
  hiddenSections: z.array(PageSectionSchema),
  /** Версия строки страницы — для «Разделов страницы»; null — страницу ещё не включали. */
  version: RecordVersion.nullable(),
  /** Включить, выключить, сменить код, разделы — и почему нельзя. */
  manage: PageRefusalCode.nullable(),
  /** Скопировать ссылку и отправить в WhatsApp — и почему нельзя. */
  send: PageRefusalCode.nullable(),
  /**
   * «Отправить в WhatsApp»: номер контрагента и готовое сообщение по шаблону waPage со ссылкой и
   * кодом — у включённой страницы и тому, кто может отправить.
   */
  whatsApp: z
    .object({
      /** Название контрагента — в подзаголовке окна. */
      contractor: z.string(),
      /** Номер контрагента цифрами для ссылки wa.me и для показа («+996 505 89 00 76»). */
      phone: z.string(),
      phoneText: z.string(),
      text: z.string(),
    })
    .nullable(),
});
export type ContractorPage = z.infer<typeof ContractorPage>;

/** «Разделы страницы» у контрагента: скрытые разделы и версия, которую видел сотрудник. */
export const ContractorPageSectionsInput = z.object({
  hiddenSections: z
    .array(PageSectionSchema)
    .max(PAGE_SECTIONS.length)
    .refine((s) => new Set(s).size === s.length, 'Разделы без повторов'),
  version: RecordVersion,
});

/** «Включить страницу» у выбранных контрагентов (ТЗ «Массово: выбрать контрагентов в списке…»). */
export const ContractorPagesEnableInput = z.object({
  ids: z
    .array(Uuid)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Контрагенты без повторов'),
});

/** Итог: у скольких включено (у каждого свой код) и сколько пропущено — уже включена или в архиве. */
export const ContractorPagesEnabled = z.object({
  enabled: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

/** Адрес страницы без входа: /<адрес организации>/inn/<ИНН>; неверный вид — «недоступна». */
export const PublicPageParams = z.object({
  slug: z.string().max(64),
  inn: z.string().max(32),
});

/** Файл отчёта со страницы: адрес страницы и номер файла. */
export const PublicPageFileParams = PublicPageParams.extend({ id: Uuid });

/** `download=1` — картинку и PDF скачать, а не открыть («Скачать» окна просмотра раздела «Файлы»). */
export const PublicPageFileQuery = z.object({ download: z.literal('1').optional() });

const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Телефон: как показать и цифры для «Позвонить» и «WhatsApp». */
export const PagePhone = z.object({ text: z.string(), digits: z.string() });

/** Сотрудник на странице: ФИО, должность (название роли), телефон. */
export const PagePerson = z.object({
  name: z.string(),
  role: z.string(),
  phone: PagePhone.nullable(),
});

/**
 * Карточка «Как оплатить» (прототип pubPay): перевод по номеру телефона, расчётный счёт организации
 * или счёт и кошелёк бухгалтера; номер для показа и для «Скопировать», банки номера, БИК, получатель.
 */
export const PagePay = z.object({
  kind: z.enum(['phone', 'account', 'wallet']),
  bank: z.string(),
  number: z.string(),
  copy: z.string(),
  banks: z.array(z.string()),
  bik: z.string().nullable(),
  holder: z.string(),
});
export type PagePay = z.infer<typeof PagePay>;

/** Вид отчёта на плитке «Отчётов»: краткое и полное название, орган, периодичность, «что это». */
export const PageReportType = z.object({
  code: z.string(),
  short: z.string(),
  name: z.string(),
  organ: z.string(),
  periodicity: z.enum(['M', 'Q', 'H', 'Y', 'oneoff']),
  note: z.string(),
});

/**
 * Файл, приложенный к отчёту: открывается и скачивается по ссылке страницы; картинка и PDF
 * (`preview`) — в окне просмотра на странице (прототип v74 `pubFileOpen`), остальное скачивается.
 */
export const PageFile = z.object({
  id: Uuid,
  name: z.string(),
  preview: z.enum(['image', 'pdf']).nullable(),
});
export type PageFile = z.infer<typeof PageFile>;

/**
 * Отчёт на странице (без «Не требуется» и прежних версий уточнённых): период полностью, срок, статус
 * сдачи, дата сдачи, сумма к уплате и статус оплаты (у вида с суммой), файлы.
 */
export const PageReport = z.object({
  id: Uuid,
  type: z.string(),
  period: z.string(),
  due: IsoDate,
  status: z.enum(PAGE_REPORT_STATUSES),
  submittedOn: IsoDate.nullable(),
  hasSum: z.boolean(),
  sum: Tyiyn.nullable(),
  /** Только при «Учёте оплаты налогов» и сумме больше 0. */
  payStatus: z.enum(['unpaid', 'partial', 'paid']).nullable(),
  files: z.array(PageFile),
});
export type PageReport = z.infer<typeof PageReport>;

/**
 * Файл раздела «Файлы» (решение заказчика 06.11.2026, прототип v74 `pubFiles`): категория, к чему
 * относится, дата добавления, размер; `preview` — картинка или PDF открываются в окне просмотра на
 * странице, остальное скачивается. Ссылка — `/<адрес>/inn/<ИНН>/files/<id>`, как у файлов отчётов.
 */
export const PageFilesItem = z.object({
  id: Uuid,
  name: z.string(),
  category: z.enum(PAGE_FILE_CATEGORIES),
  rel: z.string(),
  date: IsoDate,
  size: z.number().int().nonnegative(),
  preview: z.enum(['image', 'pdf']).nullable(),
});
export type PageFilesItem = z.infer<typeof PageFilesItem>;

/** «Главное»: итоги, которые сервер посчитал по показанным разделам. */
export const PageMain = z.object({
  /** «Отчёты {год}: сдано» и «Ближайший срок» — при показанных «Отчётах». */
  reports: z
    .object({
      submitted: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      next: z.object({ due: IsoDate, type: z.string(), period: z.string() }).nullable(),
    })
    .nullable(),
  /** «Налоги {год}, сом»: «получено» и «оплачено» — при «Учёте оплаты налогов»; куда ведёт плитка. */
  taxes: z
    .object({
      due: Tyiyn,
      got: Tyiyn.nullable(),
      paid: Tyiyn.nullable(),
      go: z.enum(['money', 'reports']),
    })
    .nullable(),
  /** «Обслуживание» — при показанной «Оплате за обслуживание». */
  fee: z.object({ debt: Tyiyn, paidTill: YearMonth.nullable() }).nullable(),
});

/** «Деньги на налоги» (прототип pubMoney): сверка за текущий месяц и итоги года. */
export const PageMoney = z.object({
  monthEnd: IsoDate,
  verdict: z.enum(['short', 'enough', 'enough_surplus', 'surplus']),
  amount: Tyiyn,
  dueSum: Tyiyn,
  got: Tyiyn,
  paid: Tyiyn,
  due: z.array(
    z.object({ id: Uuid, type: z.string(), period: z.string(), left: Tyiyn, payDue: IsoDate }),
  ),
});

/** «Оплата за обслуживание»: текущая ставка, день оплаты, долг, начисления и оплаты по месяцам. */
export const PageFee = z.object({
  tariff: z.object({ amount: Tyiyn, period: z.enum(['M', 'Y']) }).nullable(),
  feeDay: z.number().int(),
  debt: Tyiyn,
  paidTill: YearMonth.nullable(),
  /** Месяцы с начислением или оплатой, сначала поздние. */
  months: z.array(
    z.object({
      month: YearMonth,
      charge: Tyiyn,
      got: Tyiyn,
      status: z.enum(['unpaid', 'partial', 'paid']),
    }),
  ),
});

/** «Показатели»: показатели контрагента и их значения по месяцам до текущего. */
export const PageKpi = z.object({
  /** Годы для выбора: текущий и годы значений контрагента. */
  years: z.array(z.string()),
  indicators: z.array(
    z.object({
      id: Uuid,
      name: z.string(),
      unit: z.string(),
      type: z.enum(INDICATOR_TYPES),
      total: z.enum(INDICATOR_TOTALS),
      values: z.array(z.object({ month: YearMonth, value: z.number() })),
    }),
  ),
});

/** «Контакты»: кто ведёт отчёты контрагента и какие, и данные самого контрагента. */
export const PageContacts = z.object({
  people: z.array(PagePerson.extend({ responsible: z.boolean(), types: z.array(z.string()) })),
  head: z.string(),
  contact: z.string(),
  phone: z.string(),
});

const PageTipIdSchema = z.enum(Object.keys(PAGE_TIPS) as [PageTipId, ...PageTipId[]]);

/**
 * Раздел «Telegram» страницы (прототип v92 pgTgPub): только числа — имён подключённых Telegram
 * страница не показывает (её открывают по коду, имена видит только организация). `full` — мест нет.
 */
export const PageTelegram = z.object({
  on: z.number().int().nonnegative(),
  wait: z.number().int().nonnegative(),
  full: z.boolean(),
});
export type PageTelegram = z.infer<typeof PageTelegram>;

/** «Подключить Telegram»: одноразовая ссылка на бота (24 часа) — только адрес t.me с ключом страницы. */
export const PublicPageTelegramLink = z.object({
  url: z.string().regex(/^https:\/\/t\.me\/[A-Za-z0-9_]{3,64}\?start=cp_[A-Za-z0-9_-]{43}$/),
});

/** Строка списка «Telegram контрагента» в карточке (прототип pgTgBox). Номера чата в ответе нет. */
export const ContractorTelegramItem = z.object({
  id: Uuid,
  name: z.string(),
  status: z.enum(CP_TG_STATUSES),
  requestedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  /** Краткое ФИО сотрудника, который решил; null — решил сам контрагент или решения ещё нет. */
  decidedBy: z.string().nullable(),
  byClient: z.boolean(),
  /** Клиент выключил напоминания о долге кнопкой «Не напоминать». */
  noDebt: z.boolean(),
  version: RecordVersion,
});
export type ContractorTelegramItem = z.infer<typeof ContractorTelegramItem>;

/** Список «Telegram контрагента» блока «Страница контрагента» карточки. */
export const ContractorTelegram = z.object({
  /** Название контрагента — для окон подтверждения. */
  contractor: z.string(),
  /** Раздел «Telegram» включён: страница включена, раздел не скрыт, бот подключён. */
  sectionOn: z.boolean(),
  items: z.array(ContractorTelegramItem),
  on: z.number().int().nonnegative(),
  wait: z.number().int().nonnegative(),
  max: z.number().int().positive(),
  /** Подтвердить, отклонить, отключить — и почему нельзя (нет права). */
  manage: z.literal('page_manage_right').nullable(),
  /**
   * «Напоминать о долге в Telegram» у этого контрагента (доработки 13.11.2026, К5; прототип pgDebtRow);
   * null — напоминать не о чем: у организации нет ни «Платы за обслуживание», ни «Учёта оплаты налогов».
   */
  debt: z
    .object({
      /** Напоминание включено: у организации и у этого контрагента. */
      on: z.boolean(),
      /** «Напоминать контрагентам о долге» включено у организации. */
      orgOn: z.boolean(),
      /** Что мешает переключить (нет права, выключено у организации). */
      refusal: z.enum(DEBT_TOGGLE_REFUSALS).nullable(),
      /** Долг сейчас, тыйыны; null — сотрудник сумм не видит. */
      sum: Tyiyn.nullable(),
      /** Версия записи страницы контрагента — для переключения. */
      version: RecordVersion,
    })
    .nullable(),
});
export type ContractorTelegram = z.infer<typeof ContractorTelegram>;

/** Переключить «Напоминать о долге в Telegram» у контрагента — с версией записи страницы. */
export const ContractorTelegramDebtInput = z.object({
  on: z.boolean(),
  version: RecordVersion,
});

/** Решение сотрудника по строке: подтвердить, отклонить, отключить — с версией строки. */
export const ContractorTelegramDecisionInput = z.object({
  action: z.enum(CP_TG_ACTIONS),
  version: RecordVersion,
});

/**
 * Открытая страница (прототип pubBody): шапка, строка состояния, «Главное», «Ваш бухгалтер» — всегда;
 * содержимое остальных разделов приходит, только если раздел показан (ТЗ «Разделы, скрытые в учётной
 * политике или в карточке контрагента, сервер не передаёт на страницу вовсе»), иначе — null.
 */
export const PublicPageBody = z.object({
  /** «Данные на <дата и время>». */
  asOf: z.iso.datetime(),
  /** Сегодня по Бишкеку: просрочки, ближайшие сроки и месяцы показателей. */
  today: IsoDate,
  contractor: z.object({ name: z.string(), inn: z.string(), regime: z.string().nullable() }),
  org: z.object({
    name: z.string(),
    logo: OrgLogoLink.nullable(),
    phone: PagePhone.nullable(),
  }),
  sections: z.array(PageSectionSchema),
  issues: z.object({
    late: z.number().int().nonnegative(),
    short: Tyiyn,
    feeDebt: Tyiyn,
  }),
  main: PageMain,
  accountant: PagePerson.nullable(),
  pay: z.object({ tax: PagePay.nullable(), fee: PagePay.nullable() }).nullable(),
  reports: z.object({ types: z.array(PageReportType), items: z.array(PageReport) }).nullable(),
  /** «Файлы»: сначала новые; только при показанном разделе. */
  files: z.array(PageFilesItem).nullable(),
  money: PageMoney.nullable(),
  fee: PageFee.nullable(),
  kpi: PageKpi.nullable(),
  contacts: PageContacts.nullable(),
  /** Раздел «Telegram»; только при показанном разделе и подключённом боте. */
  telegram: PageTelegram.nullable(),
  /** Пояснения страницы из «Текстов элементов экрана» (группа → подпись → текст). */
  /** Пояснения «ⓘ» по обозначениям страницы (PAGE_TIPS). */
  texts: z.partialRecord(PageTipIdSchema, z.string()),
});
export type PublicPageBody = z.infer<typeof PublicPageBody>;

/**
 * Что показать по ссылке: «Страница недоступна» (выключенная, неизвестный ИНН, архив — одинаково),
 * ввод кода, перерыв после неверных кодов, «Страница закрыта» после 5 неверных кодов за сутки (до
 * смены кода, docs/deviations.md п. О-21) или саму страницу.
 */
export const PublicPage = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unavailable') }),
  z.object({ state: z.literal('code') }),
  z.object({ state: z.literal('locked'), lockedUntil: z.iso.datetime() }),
  z.object({ state: z.literal('closed') }),
  z.object({ state: z.literal('open'), page: PublicPageBody }),
]);
export type PublicPage = z.infer<typeof PublicPage>;

/** Ввод кода доступа: ровно 6 цифр (прототип: «Введите 6 цифр»). */
export const PublicPageCodeInput = z.object({
  code: z.string().regex(/^\d{6}$/, 'pub.code.format'),
});

export const PublicPageCodeOk = z.object({ ok: z.literal(true) });
