import {
  ACCOUNT_CARD_STATES,
  ACCOUNT_STATUSES,
  FULL_NAME_MAX_LENGTH,
  isValidLogin,
  isValidOrgInn,
  LOGIN_MAX_LENGTH,
  normalizeLogin,
  ORG_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  SESSION_END_REASONS,
  PASSWORD_MIN_LENGTH,
  type UiTextKey,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordAudit, RecordVersion, Uuid } from './common';
import { listPageSchema } from './list';

/**
 * Организация в Админке → «Организации» (ТЗ «Админка» → «Модуль организаций»; прототип
 * admin/accounts-orgs.js, renderOrgs): название, ИНН, логин владельца, адрес страницы, контрагентов и
 * активных сотрудников, статус. Дата регистрации — `audit.createdAt`.
 */
export const AdminOrganization = z.object({
  id: Uuid,
  name: z.string(),
  inn: z.string().nullable(),
  slug: z.string(),
  /** null — у организации ещё нет владельца (не бывает у созданной Админкой). */
  ownerLogin: z.string().nullable(),
  /** Контрагентов — появится с модулем «Контрагенты»; пока 0. */
  contractors: z.number().int().nonnegative(),
  /** Активных сотрудников. */
  employees: z.number().int().nonnegative(),
  /** Нет — заблокирована: сотрудники не входят, данные сохраняются. */
  active: z.boolean(),
  /** Пометка администратора у заблокированной. */
  blockedReason: z.string().nullable(),
  /** Демо-организация стенда: её не блокируют. */
  isDemo: z.boolean(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type AdminOrganization = z.infer<typeof AdminOrganization>;

/** Страница списка организаций платформы: сортировка, страницы и фильтры — на сервере. */
export const AdminOrganizationList = listPageSchema(AdminOrganization);
export type AdminOrganizationList = z.infer<typeof AdminOrganizationList>;

/**
 * Плашки над списком организаций (прототип renderOrgs): активных организаций, контрагентов на
 * платформе, учётных записей организаций, запросов на добавление в справочники.
 */
export const AdminOrgSummary = z.object({
  active: z.number().int().nonnegative(),
  contractors: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
});
export type AdminOrgSummary = z.infer<typeof AdminOrgSummary>;

/**
 * Новая организация с владельцем (ТЗ: название, ИНН, ФИО владельца, логин владельца, временный
 * пароль — все обязательные). Адрес страницы подбирает сервер по названию.
 */
export const CreateOrganizationRequest = z.object({
  name: z.string().trim().min(1).max(ORG_NAME_MAX_LENGTH),
  inn: z.string().trim().max(20),
  ownerFullName: z.string().trim().min(1).max(FULL_NAME_MAX_LENGTH),
  ownerLogin: z.string().trim().min(1).max(LOGIN_MAX_LENGTH),
  // Не короче 8 символов, как у временного пароля сотрудника (docs/deviations.md, п. 17).
  temporaryPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  /** «Создать организацию» по заявке с сайта: заявка получит «Подключена» и ссылку (задача #165). */
  leadId: Uuid.optional(),
});
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequest>;

/** Организация создана. */
export const CreatedOrganization = z.object({ organization: AdminOrganization });
export type CreatedOrganization = z.infer<typeof CreatedOrganization>;

/** Заблокировать или разблокировать организацию: версия, которую видел администратор. */
export const OrganizationVersionRequest = z.object({ version: RecordVersion });
export type OrganizationVersionRequest = z.infer<typeof OrganizationVersionRequest>;

/**
 * Учётная запись в Админке → «Учётные записи» (ТЗ «Админка» → «Модуль учётных записей»; прототип
 * admin/accounts-orgs.js, renderAccounts): логин, ФИО, организация, роль, последний вход, статус. У
 * администратора платформы ФИО и роль — «Администратор платформы», организация — «Платформа».
 */
export const AdminUser = z.object({
  id: Uuid,
  login: z.string(),
  fullName: z.string(),
  /** null — администратор платформы. */
  orgId: Uuid.nullable(),
  orgName: z.string(),
  role: z.string(),
  isPlatformAdmin: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  /** Заблокирована администратором платформы. */
  blocked: z.boolean(),
  /**
   * `blocked` — администратором платформы, `owner_blocked` — сотрудника заблокировал владелец
   * организации (docs/deviations.md, п. 49).
   */
  status: z.enum(ACCOUNT_STATUSES),
  audit: RecordAudit,
  version: RecordVersion,
});
export type AdminUser = z.infer<typeof AdminUser>;

/**
 * Карточка пользователя в Админке (ТЗ «Админка» → «Карточка пользователя», решение заказчика
 * 09.11.2026; прототип admin/admin-cards.js, accCard): всё по одной учётной записи одним ответом,
 * только для просмотра. Списки — первые 200 строк, `count` — настоящее число записей. Адреса IP,
 * токенов сеансов, паролей и текста сообщений бота в ответе нет.
 */
const cardList = <T extends z.ZodType>(row: T) =>
  z.object({ count: z.number().int(), rows: z.array(row) });

const AdminCardReport = z.object({
  id: Uuid,
  contractor: z.string(),
  type: z.string(),
  /** Вид периода (M, Q, Y…) и его начало: подпись периода собирает экран. */
  period: z.string(),
  periodStart: IsoDate,
  dueDate: IsoDate,
  status: z.string(),
});

export const AdminSession = z.object({
  id: Uuid,
  startedAt: z.iso.datetime(),
  /** Открыт — последнее обращение, закрыт — когда закрыт. */
  lastAt: z.iso.datetime(),
  /** «Действует до» — только у открытого сеанса. */
  till: z.iso.datetime().nullable(),
  /** «Браузер и система» по заголовку браузера; null — не узнаны. */
  device: z.string().nullable(),
  open: z.boolean(),
  endReason: z.enum(SESSION_END_REASONS).nullable(),
});
export type AdminSession = z.infer<typeof AdminSession>;

export const AdminUserCard = z.object({
  user: AdminUser,
  /** Состояния цветными метками: может быть несколько. */
  states: z.array(z.enum(ACCOUNT_CARD_STATES)),
  /** null — администратор платформы: у него только «Основное», «Сеансы» и «История». */
  employee: z
    .object({
      id: Uuid,
      shortName: z.string(),
      phone: z.string().nullable(),
      isOwner: z.boolean(),
      loginFailures: z.number().int(),
      /** Предел неверных паролей подряд, после которого вход закрывается. */
      loginFailuresMax: z.number().int(),
      createdAt: z.iso.datetime(),
      telegram: z.object({ name: z.string(), linkedAt: z.iso.datetime() }).nullable(),
      /** Права роли по группам формы роли; `scope` — только у групп с областью. */
      roleGroups: z.array(
        z.object({
          group: z.string(),
          scope: z.enum(['all', 'own']).nullable(),
          permissions: z.array(z.string()),
        }),
      ),
    })
    .nullable(),
  work: z
    .object({
      contractors: cardList(
        z.object({
          id: Uuid,
          name: z.string(),
          inn: z.string().nullable(),
          regime: z.string().nullable(),
          serviceStatus: z.string(),
        }),
      ),
      due: cardList(AdminCardReport),
      inWork: cardList(AdminCardReport),
      overdue: cardList(AdminCardReport),
      done: cardList(AdminCardReport),
      tasks: cardList(
        z.object({
          id: Uuid,
          title: z.string(),
          contractor: z.string().nullable(),
          dueDate: IsoDate.nullable(),
          status: z.string(),
        }),
      ),
      kpi: cardList(
        z.object({
          id: Uuid,
          contractor: z.string(),
          indicator: z.string(),
          value: z.number().nullable(),
          at: z.iso.datetime(),
        }),
      ),
      /** Месяц показателей (прошлый): «2026-10». */
      kpiMonth: z.string(),
    })
    .nullable(),
  sessions: z.object({
    open: z.number().int(),
    total: z.number().int(),
    /** Карточка своей учётной записи: «Завершить все сеансы» закрыта. */
    self: z.boolean(),
    rows: z.array(AdminSession),
  }),
  kb: z
    .object({
      level: z
        .object({
          level: z.number().int(),
          name: z.string(),
          pct: z.number(),
          of: z.number().int(),
        })
        .nullable(),
      articles: cardList(
        z.object({
          id: z.string(),
          title: z.string(),
          section: z.string(),
          readAt: z.iso.datetime(),
        }),
      ),
      videos: cardList(
        z.object({
          id: z.string(),
          title: z.string(),
          secs: z.number(),
          pct: z.number(),
          lastAt: z.iso.datetime().nullable(),
          status: z.string(),
        }),
      ),
    })
    .nullable(),
  telegram: cardList(
    z.object({
      id: z.string(),
      at: z.iso.datetime(),
      kind: z.string(),
      status: z.string(),
      error: z.string().nullable(),
    }),
  ).nullable(),
  history: z.array(
    z.object({
      id: z.string(),
      at: z.iso.datetime(),
      /** Кто: сотрудник организации; null — система или администратор платформы (`actorAdmin`). */
      actor: z.string().nullable(),
      actorAdmin: z.boolean(),
      entity: z.string(),
      action: z.string(),
      fields: z.array(z.string()),
      reason: z.string().nullable(),
    }),
  ),
});
export type AdminUserCard = z.infer<typeof AdminUserCard>;

/** «Завершить все сеансы»: сколько сеансов ещё действовало. */
export const AdminSessionsEnded = z.object({ ended: z.number().int() });
export type AdminSessionsEnded = z.infer<typeof AdminSessionsEnded>;

/** Учётная запись по логину — для ссылки #accounts/<логин>. */
export const AdminUserLookup = z.object({ id: Uuid });
export type AdminUserLookup = z.infer<typeof AdminUserLookup>;

/** Страница списка учётных записей платформы: сортировка, страницы и фильтры — на сервере. */
export const AdminUserList = listPageSchema(AdminUser);
export type AdminUserList = z.infer<typeof AdminUserList>;

/** Заблокировать или разблокировать учётную запись: версия, которую видел администратор. */
export const AdminUserVersionRequest = z.object({ version: RecordVersion });
export type AdminUserVersionRequest = z.infer<typeof AdminUserVersionRequest>;

const message = (key: UiTextKey) => ({ message: key });

/**
 * Форма «Новая организация» (прототип admin/accounts-orgs.js, addOrgDlg; React Hook Form): «Введите
 * название», «ИНН — 14 цифр», «Введите ФИО», логин — латиница, цифры, точка, дефис, от 3 символов,
 * временный пароль — не короче `PASSWORD_MIN_LENGTH`. Сообщения — ключи словаря.
 */
export const NewOrganizationForm = z.object({
  name: z
    .string()
    .trim()
    .min(1, message('err.name_required'))
    .max(ORG_NAME_MAX_LENGTH, message('form.too_long')),
  inn: z.string().trim().refine(isValidOrgInn, message('err.inn_invalid')),
  ownerFullName: z
    .string()
    .trim()
    .min(1, message('err.owner_fio_required'))
    .max(FULL_NAME_MAX_LENGTH, message('form.too_long')),
  ownerLogin: z
    .string()
    .max(LOGIN_MAX_LENGTH, message('form.too_long'))
    .transform(normalizeLogin)
    .refine(isValidLogin, message('staff.err.login')),
  temporaryPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, message('staff.err.password'))
    .max(PASSWORD_MAX_LENGTH, message('form.too_long')),
});
export type NewOrganizationFormInput = z.input<typeof NewOrganizationForm>;
export type NewOrganizationForm = z.output<typeof NewOrganizationForm>;
